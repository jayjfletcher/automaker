/**
 * Codex CLI Detector - Checks if OpenAI Codex CLI is installed
 *
 * Codex CLI is OpenAI's agent CLI tool that allows users to use
 * GPT-5.1/5.2 Codex models for code generation and agentic tasks.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { InstallationStatus } from "./types.js";

export class CodexCliDetector {
  /**
   * Get the path to Codex config directory
   */
  static getConfigDir(): string {
    return path.join(os.homedir(), ".codex");
  }

  /**
   * Get the path to Codex auth file
   */
  static getAuthPath(): string {
    return path.join(this.getConfigDir(), "auth.json");
  }

  /**
   * Check Codex authentication status
   */
  static checkAuth(): {
    authenticated: boolean;
    method: string;
    hasAuthFile?: boolean;
    hasEnvKey?: boolean;
    authPath?: string;
    error?: string;
  } {
    try {
      const authPath = this.getAuthPath();
      const envApiKey = process.env.OPENAI_API_KEY;

      // Try to verify authentication using codex CLI command if available
      try {
        const detection = this.detectCodexInstallation();
        if (detection.installed && detection.path) {
          try {
            // Use 2>&1 to capture both stdout and stderr
            const statusOutput = execSync(
              `"${detection.path}" login status 2>&1`,
              {
                encoding: "utf-8",
                timeout: 5000,
              }
            ).trim();

            // Check if the output indicates logged in status
            if (
              statusOutput &&
              (statusOutput.includes("Logged in") || statusOutput.includes("Authenticated"))
            ) {
              return {
                authenticated: true,
                method: "cli_verified",
                hasAuthFile: fs.existsSync(authPath),
                hasEnvKey: !!envApiKey,
                authPath,
              };
            }
          } catch (statusError) {
            // status command failed, continue with file-based check
          }
        }
      } catch (verifyError) {
        // CLI verification failed, continue with file-based check
      }

      // Check if auth file exists
      if (fs.existsSync(authPath)) {
        try {
          const content = fs.readFileSync(authPath, "utf-8");
          const auth: any = JSON.parse(content);

          // Check for token object structure
          if (auth.token && typeof auth.token === "object") {
            const token = auth.token;
            if (
              token.Id_token ||
              token.access_token ||
              token.refresh_token ||
              token.id_token
            ) {
              return {
                authenticated: true,
                method: "cli_tokens",
                hasAuthFile: true,
                hasEnvKey: !!envApiKey,
                authPath,
              };
            }
          }

          // Check for tokens at root level
          if (
            auth.access_token ||
            auth.refresh_token ||
            auth.Id_token ||
            auth.id_token
          ) {
            return {
              authenticated: true,
              method: "cli_tokens",
              hasAuthFile: true,
              hasEnvKey: !!envApiKey,
              authPath,
            };
          }

          // Check for API key fields
          if (auth.api_key || auth.openai_api_key || auth.apiKey) {
            return {
              authenticated: true,
              method: "auth_file",
              hasAuthFile: true,
              hasEnvKey: !!envApiKey,
              authPath,
            };
          }
        } catch (error) {
          return {
            authenticated: false,
            method: "none",
            hasAuthFile: false,
            hasEnvKey: !!envApiKey,
            authPath,
          };
        }
      }

      // Environment variable override
      if (envApiKey) {
        return {
          authenticated: true,
          method: "env",
          hasAuthFile: fs.existsSync(authPath),
          hasEnvKey: true,
          authPath,
        };
      }

      return {
        authenticated: false,
        method: "none",
        hasAuthFile: fs.existsSync(authPath),
        hasEnvKey: false,
        authPath,
      };
    } catch (error) {
      return {
        authenticated: false,
        method: "none",
        error: (error as Error).message,
      };
    }
  }

  /**
   * Check if Codex CLI is installed and accessible
   */
  static detectCodexInstallation(): InstallationStatus & {
    hasApiKey?: boolean;
  } {
    try {
      // Method 1: Check if 'codex' command is in PATH
      try {
        const codexPath = execSync("which codex 2>/dev/null", {
          encoding: "utf-8",
        }).trim();
        if (codexPath) {
          const version = this.getCodexVersion(codexPath);
          return {
            installed: true,
            path: codexPath,
            version: version || undefined,
            method: "cli",
          };
        }
      } catch (error) {
        // CLI not in PATH, continue checking other methods
      }

      // Method 2: Check for npm global installation
      try {
        const npmListOutput = execSync(
          "npm list -g @openai/codex --depth=0 2>/dev/null",
          { encoding: "utf-8" }
        );
        if (npmListOutput && npmListOutput.includes("@openai/codex")) {
          // Get the path from npm bin
          const npmBinPath = execSync("npm bin -g", {
            encoding: "utf-8",
          }).trim();
          const codexPath = path.join(npmBinPath, "codex");
          const version = this.getCodexVersion(codexPath);
          return {
            installed: true,
            path: codexPath,
            version: version || undefined,
            method: "npm",
          };
        }
      } catch (error) {
        // npm global not found
      }

      // Method 3: Check for Homebrew installation on macOS
      if (process.platform === "darwin") {
        try {
          const brewList = execSync("brew list --formula 2>/dev/null", {
            encoding: "utf-8",
          });
          if (brewList.includes("codex")) {
            const brewPrefixOutput = execSync("brew --prefix codex 2>/dev/null", {
              encoding: "utf-8",
            }).trim();
            const codexPath = path.join(brewPrefixOutput, "bin", "codex");
            const version = this.getCodexVersion(codexPath);
            return {
              installed: true,
              path: codexPath,
              version: version || undefined,
              method: "brew",
            };
          }
        } catch (error) {
          // Homebrew not found or codex not installed via brew
        }
      }

      // Method 4: Check Windows path
      if (process.platform === "win32") {
        try {
          const codexPath = execSync("where codex 2>nul", {
            encoding: "utf-8",
          })
            .trim()
            .split("\n")[0];
          if (codexPath) {
            const version = this.getCodexVersion(codexPath);
            return {
              installed: true,
              path: codexPath,
              version: version || undefined,
              method: "cli",
            };
          }
        } catch (error) {
          // Not found on Windows
        }
      }

      // Method 5: Check common installation paths
      const commonPaths = [
        path.join(os.homedir(), ".local", "bin", "codex"),
        path.join(os.homedir(), ".npm-global", "bin", "codex"),
        "/usr/local/bin/codex",
        "/opt/homebrew/bin/codex",
      ];

      for (const checkPath of commonPaths) {
        if (fs.existsSync(checkPath)) {
          const version = this.getCodexVersion(checkPath);
          return {
            installed: true,
            path: checkPath,
            version: version || undefined,
            method: "cli",
          };
        }
      }

      // Method 6: Check if OPENAI_API_KEY is set (can use Codex API directly)
      if (process.env.OPENAI_API_KEY) {
        return {
          installed: false,
          hasApiKey: true,
        };
      }

      return {
        installed: false,
      };
    } catch (error) {
      return {
        installed: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get Codex CLI version from executable path
   */
  static getCodexVersion(codexPath: string): string | null {
    try {
      const version = execSync(`"${codexPath}" --version 2>/dev/null`, {
        encoding: "utf-8",
      }).trim();
      return version || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get installation info and recommendations
   */
  static getInstallationInfo(): {
    status: string;
    method?: string;
    version?: string | null;
    path?: string | null;
    recommendation: string;
    installCommands?: Record<string, string>;
  } {
    const detection = this.detectCodexInstallation();

    if (detection.installed) {
      return {
        status: "installed",
        method: detection.method,
        version: detection.version,
        path: detection.path,
        recommendation:
          detection.method === "cli"
            ? "Using Codex CLI - ready for GPT-5.1/5.2 Codex models"
            : `Using Codex CLI via ${detection.method} - ready for GPT-5.1/5.2 Codex models`,
      };
    }

    // Not installed but has API key
    if (detection.hasApiKey) {
      return {
        status: "api_key_only",
        method: "api-key-only",
        recommendation:
          "OPENAI_API_KEY detected but Codex CLI not installed. Install Codex CLI for full agentic capabilities.",
        installCommands: this.getInstallCommands(),
      };
    }

    return {
      status: "not_installed",
      recommendation:
        "Install OpenAI Codex CLI to use GPT-5.1/5.2 Codex models for agentic tasks",
      installCommands: this.getInstallCommands(),
    };
  }

  /**
   * Get installation commands for different platforms
   */
  static getInstallCommands(): Record<string, string> {
    return {
      npm: "npm install -g @openai/codex@latest",
      macos: "brew install codex",
      linux: "npm install -g @openai/codex@latest",
      windows: "npm install -g @openai/codex@latest",
    };
  }

  /**
   * Check if Codex CLI supports a specific model
   */
  static isModelSupported(model: string): boolean {
    const supportedModels = [
      "gpt-5.1-codex-max",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gpt-5.1",
      "gpt-5.2",
    ];
    return supportedModels.includes(model);
  }

  /**
   * Get default model for Codex CLI
   */
  static getDefaultModel(): string {
    return "gpt-5.2";
  }

  /**
   * Get comprehensive installation info including auth status
   */
  static getFullStatus() {
    const installation = this.detectCodexInstallation();
    const auth = this.checkAuth();
    const info = this.getInstallationInfo();

    return {
      ...info,
      auth,
      installation,
    };
  }
}
