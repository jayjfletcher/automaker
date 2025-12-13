/**
 * Codex TOML Configuration Manager
 *
 * Manages Codex CLI's TOML configuration file to add/update MCP server settings.
 * Codex CLI looks for config at:
 * - ~/.codex/config.toml (user-level)
 * - .codex/config.toml (project-level, takes precedence)
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled_tools?: string[];
}

interface CodexConfig {
  experimental_use_rmcp_client?: boolean;
  mcp_servers?: Record<string, McpServerConfig>;
  [key: string]: any;
}

export class CodexConfigManager {
  private userConfigPath: string;
  private projectConfigPath: string | null = null;

  constructor() {
    this.userConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  }

  /**
   * Set the project path for project-level config
   */
  setProjectPath(projectPath: string): void {
    this.projectConfigPath = path.join(projectPath, ".codex", "config.toml");
  }

  /**
   * Get the effective config path (project-level if exists, otherwise user-level)
   */
  async getConfigPath(): Promise<string> {
    if (this.projectConfigPath) {
      try {
        await fs.access(this.projectConfigPath);
        return this.projectConfigPath;
      } catch (e) {
        // Project config doesn't exist, fall back to user config
      }
    }

    // Ensure user config directory exists
    const userConfigDir = path.dirname(this.userConfigPath);
    try {
      await fs.mkdir(userConfigDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    return this.userConfigPath;
  }

  /**
   * Read existing TOML config (simple parser for our needs)
   */
  async readConfig(configPath: string): Promise<CodexConfig> {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return this.parseToml(content);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return {};
      }
      throw e;
    }
  }

  /**
   * Simple TOML parser for our specific use case
   * This is a minimal parser that handles the MCP server config structure
   */
  parseToml(content: string): CodexConfig {
    const config: CodexConfig = {};
    let currentSection: string | null = null;
    let currentSubsection: string | null = null;

    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // Section header: [section]
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        const sectionName = sectionMatch[1];
        const parts = sectionName.split(".");

        if (parts.length === 1) {
          currentSection = parts[0];
          currentSubsection = null;
          if (!config[currentSection]) {
            config[currentSection] = {};
          }
        } else if (parts.length === 2) {
          currentSection = parts[0];
          currentSubsection = parts[1];
          if (!config[currentSection]) {
            config[currentSection] = {};
          }
          if (!config[currentSection][currentSubsection]) {
            config[currentSection][currentSubsection] = {};
          }
        }
        continue;
      }

      // Key-value pair: key = value
      const kvMatch = trimmed.match(/^([^=]+)=(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        let value: any = kvMatch[2].trim();

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // Parse boolean
        if (value === "true") value = true;
        else if (value === "false") value = false;
        // Parse number
        else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value);

        if (currentSubsection && currentSection) {
          if (!config[currentSection][currentSubsection]) {
            config[currentSection][currentSubsection] = {};
          }
          config[currentSection][currentSubsection][key] = value;
        } else if (currentSection) {
          if (!config[currentSection]) {
            config[currentSection] = {};
          }
          config[currentSection][key] = value;
        } else {
          config[key] = value;
        }
      }
    }

    return config;
  }

  /**
   * Configure the automaker-tools MCP server
   */
  async configureMcpServer(
    projectPath: string,
    mcpServerScriptPath: string
  ): Promise<string> {
    this.setProjectPath(projectPath);
    const configPath = await this.getConfigPath();

    // Read existing config
    const config = await this.readConfig(configPath);

    // Ensure mcp_servers section exists
    if (!config.mcp_servers) {
      config.mcp_servers = {};
    }

    // Configure automaker-tools server
    config.mcp_servers["automaker-tools"] = {
      command: "node",
      args: [mcpServerScriptPath],
      env: {
        AUTOMAKER_PROJECT_PATH: projectPath,
      },
      startup_timeout_sec: 10,
      tool_timeout_sec: 60,
      enabled_tools: ["UpdateFeatureStatus"],
    };

    // Ensure experimental_use_rmcp_client is enabled (if needed)
    if (!config.experimental_use_rmcp_client) {
      config.experimental_use_rmcp_client = true;
    }

    // Write config back
    await this.writeConfig(configPath, config);

    console.log(
      `[CodexConfigManager] Configured automaker-tools MCP server in ${configPath}`
    );
    return configPath;
  }

  /**
   * Write config to TOML file
   */
  async writeConfig(configPath: string, config: CodexConfig): Promise<void> {
    let content = "";

    // Write top-level keys first (preserve existing non-MCP config)
    for (const [key, value] of Object.entries(config)) {
      if (key === "mcp_servers" || key === "experimental_use_rmcp_client") {
        continue; // Handle these separately
      }
      if (typeof value !== "object") {
        content += `${key} = ${this.formatValue(value)}\n`;
      }
    }

    // Write experimental flag if enabled
    if (config.experimental_use_rmcp_client) {
      if (content && !content.endsWith("\n\n")) {
        content += "\n";
      }
      content += `experimental_use_rmcp_client = true\n`;
    }

    // Write mcp_servers section
    if (config.mcp_servers && Object.keys(config.mcp_servers).length > 0) {
      if (content && !content.endsWith("\n\n")) {
        content += "\n";
      }

      for (const [serverName, serverConfig] of Object.entries(
        config.mcp_servers
      )) {
        content += `\n[mcp_servers.${serverName}]\n`;

        // Write command first
        if (serverConfig.command) {
          content += `command = "${this.escapeTomlString(serverConfig.command)}"\n`;
        }

        // Write args
        if (serverConfig.args && Array.isArray(serverConfig.args)) {
          const argsStr = serverConfig.args
            .map((a) => `"${this.escapeTomlString(a)}"`)
            .join(", ");
          content += `args = [${argsStr}]\n`;
        }

        // Write timeouts (must be before env subsection)
        if (serverConfig.startup_timeout_sec !== undefined) {
          content += `startup_timeout_sec = ${serverConfig.startup_timeout_sec}\n`;
        }

        if (serverConfig.tool_timeout_sec !== undefined) {
          content += `tool_timeout_sec = ${serverConfig.tool_timeout_sec}\n`;
        }

        // Write enabled_tools (must be before env subsection - at server level, not env level)
        if (serverConfig.enabled_tools && Array.isArray(serverConfig.enabled_tools)) {
          const toolsStr = serverConfig.enabled_tools
            .map((t) => `"${this.escapeTomlString(t)}"`)
            .join(", ");
          content += `enabled_tools = [${toolsStr}]\n`;
        }

        // Write env section last (as a separate subsection)
        if (
          serverConfig.env &&
          typeof serverConfig.env === "object" &&
          Object.keys(serverConfig.env).length > 0
        ) {
          content += `\n[mcp_servers.${serverName}.env]\n`;
          for (const [envKey, envValue] of Object.entries(serverConfig.env)) {
            content += `${envKey} = "${this.escapeTomlString(String(envValue))}"\n`;
          }
        }
      }
    }

    // Ensure directory exists
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });

    // Write file
    await fs.writeFile(configPath, content, "utf-8");
  }

  /**
   * Escape special characters in TOML strings
   */
  escapeTomlString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  /**
   * Format a value for TOML output
   */
  formatValue(value: any): string {
    if (typeof value === "string") {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    } else if (typeof value === "boolean") {
      return value.toString();
    } else if (typeof value === "number") {
      return value.toString();
    }
    return `"${String(value)}"`;
  }

  /**
   * Remove automaker-tools MCP server configuration
   */
  async removeMcpServer(projectPath: string): Promise<void> {
    this.setProjectPath(projectPath);
    const configPath = await this.getConfigPath();

    try {
      const config = await this.readConfig(configPath);

      if (config.mcp_servers && config.mcp_servers["automaker-tools"]) {
        delete config.mcp_servers["automaker-tools"];

        // If no more MCP servers, remove the section
        if (Object.keys(config.mcp_servers).length === 0) {
          delete config.mcp_servers;
        }

        await this.writeConfig(configPath, config);
        console.log(
          `[CodexConfigManager] Removed automaker-tools MCP server from ${configPath}`
        );
      }
    } catch (e) {
      console.error(`[CodexConfigManager] Error removing MCP server config:`, e);
    }
  }
}

// Export singleton instance
export const codexConfigManager = new CodexConfigManager();
