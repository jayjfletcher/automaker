/**
 * Codex Provider - Executes queries using OpenAI Codex CLI
 *
 * Spawns Codex CLI as a subprocess and converts JSONL output to
 * Claude SDK-compatible message format for seamless integration.
 */

import { BaseProvider } from "./base-provider.js";
import { CodexCliDetector } from "./codex-cli-detector.js";
import { codexConfigManager } from "./codex-config-manager.js";
import { spawnJSONLProcess } from "../lib/subprocess-manager.js";
import type {
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  ContentBlock,
} from "./types.js";

// Codex event types
const CODEX_EVENT_TYPES = {
  THREAD_STARTED: "thread.started",
  THREAD_COMPLETED: "thread.completed",
  ITEM_STARTED: "item.started",
  ITEM_COMPLETED: "item.completed",
  TURN_STARTED: "turn.started",
  ERROR: "error",
};

interface CodexEvent {
  type: string;
  data?: any;
  item?: any;
  thread_id?: string;
  message?: string;
}

export class CodexProvider extends BaseProvider {
  getName(): string {
    return "codex";
  }

  /**
   * Execute a query using Codex CLI
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const {
      prompt,
      model = "gpt-5.2",
      cwd,
      systemPrompt,
      mcpServers,
      abortController,
      conversationHistory,
    } = options;

    // Find Codex CLI path
    const codexPath = this.findCodexPath();
    if (!codexPath) {
      yield {
        type: "error",
        error:
          "Codex CLI not found. Please install it with: npm install -g @openai/codex@latest",
      };
      return;
    }

    // Configure MCP server if provided
    if (mcpServers && mcpServers["automaker-tools"]) {
      try {
        const mcpServerScriptPath = await this.getMcpServerPath();
        if (mcpServerScriptPath) {
          await codexConfigManager.configureMcpServer(cwd, mcpServerScriptPath);
        }
      } catch (error) {
        console.error("[CodexProvider] Failed to configure MCP server:", error);
        // Continue execution even if MCP config fails
      }
    }

    // Build combined prompt with conversation history
    // Codex CLI doesn't support native conversation history or images, so we extract text
    let combinedPrompt = "";

    if (typeof prompt === "string") {
      combinedPrompt = prompt;
    } else if (Array.isArray(prompt)) {
      // Extract text from content blocks (ignore images - Codex CLI doesn't support vision)
      combinedPrompt = prompt
        .filter(block => block.type === "text")
        .map(block => block.text || "")
        .join("\n");
    }

    // Add system prompt first
    if (systemPrompt) {
      combinedPrompt = `${systemPrompt}\n\n---\n\n${combinedPrompt}`;
    }

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      let historyText = "Previous conversation:\n\n";
      for (const msg of conversationHistory) {
        const contentText = typeof msg.content === "string"
          ? msg.content
          : msg.content.map(c => c.text || "").join("");
        historyText += `${msg.role === "user" ? "User" : "Assistant"}: ${contentText}\n\n`;
      }
      combinedPrompt = `${historyText}---\n\nCurrent request:\n${combinedPrompt}`;
    }

    // Build command arguments
    const args = this.buildArgs({ prompt: combinedPrompt, model });

    // Check authentication - either API key or CLI login
    const auth = CodexCliDetector.checkAuth();
    const hasApiKey = this.config.apiKey || process.env.OPENAI_API_KEY;

    if (!auth.authenticated && !hasApiKey) {
      yield {
        type: "error",
        error:
          "Codex CLI is not authenticated. Please run 'codex login' or set OPENAI_API_KEY environment variable.",
      };
      return;
    }

    // Prepare environment variables (API key is optional if using CLI auth)
    const env = {
      ...this.config.env,
      ...(hasApiKey && { OPENAI_API_KEY: hasApiKey }),
    };

    // Spawn the Codex process and stream JSONL output
    try {
      const stream = spawnJSONLProcess({
        command: codexPath,
        args,
        cwd,
        env,
        abortController,
        timeout: 30000, // 30s timeout for no output
      });

      for await (const event of stream) {
        const converted = this.convertToProviderFormat(event as CodexEvent);
        if (converted) {
          yield converted;
        }
      }

      // Yield completion event
      yield {
        type: "result",
        subtype: "success",
        result: "",
      };
    } catch (error) {
      console.error("[CodexProvider] Execution error:", error);
      yield {
        type: "error",
        error: (error as Error).message,
      };
    }
  }

  /**
   * Convert Codex JSONL event to Provider message format (Claude SDK compatible)
   */
  private convertToProviderFormat(event: CodexEvent): ProviderMessage | null {
    const { type, data, item, thread_id } = event;

    switch (type) {
      case CODEX_EVENT_TYPES.THREAD_STARTED:
      case "thread.started":
        // Session initialization - not needed for provider format
        return null;

      case CODEX_EVENT_TYPES.ITEM_COMPLETED:
      case "item.completed":
        return this.convertItemCompleted(item || data);

      case CODEX_EVENT_TYPES.ITEM_STARTED:
      case "item.started":
        // Item started events can show tool usage
        const startedItem = item || data;
        if (
          startedItem?.type === "command_execution" &&
          startedItem?.command
        ) {
          return {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  name: "bash",
                  input: { command: startedItem.command },
                },
              ],
            },
          };
        }
        // Handle todo_list started
        if (startedItem?.type === "todo_list" && startedItem?.items) {
          const todos = startedItem.items || [];
          const todoText = todos
            .map((t: any, i: number) => `${i + 1}. ${t.text || t}`)
            .join("\n");
          return {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: `**Todo List:**\n${todoText}`,
                },
              ],
            },
          };
        }
        return null;

      case "item.updated":
        // Handle updated items (like todo list updates)
        const updatedItem = item || data;
        if (updatedItem?.type === "todo_list" && updatedItem?.items) {
          const todos = updatedItem.items || [];
          const todoText = todos
            .map((t: any, i: number) => {
              const status = t.status === "completed" ? "✓" : " ";
              return `${i + 1}. [${status}] ${t.text || t}`;
            })
            .join("\n");
          return {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: `**Updated Todo List:**\n${todoText}`,
                },
              ],
            },
          };
        }
        return null;

      case CODEX_EVENT_TYPES.THREAD_COMPLETED:
      case "thread.completed":
        return {
          type: "result",
          subtype: "success",
          result: "",
        };

      case CODEX_EVENT_TYPES.ERROR:
      case "error":
        return {
          type: "error",
          error:
            data?.message ||
            item?.message ||
            event.message ||
            "Unknown error from Codex CLI",
        };

      case "turn.started":
      case "turn.completed":
        // Turn markers - not needed for provider format
        return null;

      default:
        return null;
    }
  }

  /**
   * Convert item.completed event to Provider format
   */
  private convertItemCompleted(item: any): ProviderMessage | null {
    if (!item) {
      return null;
    }

    const itemType = item.type || item.item_type;

    switch (itemType) {
      case "reasoning":
        // Thinking/reasoning output
        const reasoningText = item.text || item.content || "";
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: reasoningText,
              },
            ],
          },
        };

      case "agent_message":
      case "message":
        // Assistant text message
        const messageText = item.content || item.text || "";
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: messageText,
              },
            ],
          },
        };

      case "command_execution":
        // Command execution - show both the command and its output
        const command = item.command || "";
        const output = item.aggregated_output || item.output || "";

        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `\`\`\`bash\n${command}\n\`\`\`\n\n${output}`,
              },
            ],
          },
        };

      case "tool_use":
        // Tool use
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: item.tool || item.command || "unknown",
                input: item.input || item.args || {},
              },
            ],
          },
        };

      case "tool_result":
        // Tool result
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_result",
                tool_use_id: item.tool_use_id,
                content: item.output || item.result,
              },
            ],
          },
        };

      case "todo_list":
        // Todo list - convert to text format
        const todos = item.items || [];
        const todoText = todos
          .map((t: any, i: number) => `${i + 1}. ${t.text || t}`)
          .join("\n");
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `**Todo List:**\n${todoText}`,
              },
            ],
          },
        };

      case "file_change":
        // File changes - show what files were modified
        const changes = item.changes || [];
        const changeText = changes
          .map((c: any) => `- Modified: ${c.path}`)
          .join("\n");
        return {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `**File Changes:**\n${changeText}`,
              },
            ],
          },
        };

      default:
        // Generic text output
        const text = item.text || item.content || item.aggregated_output;
        if (text) {
          return {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: String(text),
                },
              ],
            },
          };
        }
        return null;
    }
  }

  /**
   * Build command arguments for Codex CLI
   */
  private buildArgs(options: {
    prompt: string;
    model: string;
  }): string[] {
    const { prompt, model } = options;

    return [
      "exec",
      "--model",
      model,
      "--json", // JSONL output format
      "--full-auto", // Non-interactive mode
      prompt, // Prompt as the last argument
    ];
  }

  /**
   * Find Codex CLI executable path
   */
  private findCodexPath(): string | null {
    // Check config override
    if (this.config.cliPath) {
      return this.config.cliPath;
    }

    // Check environment variable override
    if (process.env.CODEX_CLI_PATH) {
      return process.env.CODEX_CLI_PATH;
    }

    // Auto-detect
    const detection = CodexCliDetector.detectCodexInstallation();
    return detection.path || "codex";
  }

  /**
   * Get MCP server script path
   */
  private async getMcpServerPath(): Promise<string | null> {
    // TODO: Implement MCP server path resolution
    // For now, return null - MCP support is optional
    return null;
  }

  /**
   * Detect Codex CLI installation
   */
  async detectInstallation(): Promise<InstallationStatus> {
    const detection = CodexCliDetector.detectCodexInstallation();
    const auth = CodexCliDetector.checkAuth();

    return {
      installed: detection.installed,
      path: detection.path,
      version: detection.version,
      method: detection.method,
      hasApiKey: auth.hasEnvKey || auth.authenticated,
      authenticated: auth.authenticated,
    };
  }

  /**
   * Get available Codex models
   */
  getAvailableModels(): ModelDefinition[] {
    return [
      {
        id: "gpt-5.2",
        name: "GPT-5.2 (Codex)",
        modelString: "gpt-5.2",
        provider: "openai-codex",
        description: "Latest Codex model for agentic code generation",
        contextWindow: 256000,
        maxOutputTokens: 32768,
        supportsVision: true,
        supportsTools: true,
        tier: "premium",
        default: true,
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        modelString: "gpt-5.1-codex-max",
        provider: "openai-codex",
        description: "Maximum capability Codex model",
        contextWindow: 256000,
        maxOutputTokens: 32768,
        supportsVision: true,
        supportsTools: true,
        tier: "premium",
      },
      {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        modelString: "gpt-5.1-codex",
        provider: "openai-codex",
        description: "Standard Codex model",
        contextWindow: 256000,
        maxOutputTokens: 32768,
        supportsVision: true,
        supportsTools: true,
        tier: "standard",
      },
    ];
  }

  /**
   * Check if the provider supports a specific feature
   */
  supportsFeature(feature: string): boolean {
    const supportedFeatures = ["tools", "text", "vision", "mcp", "cli"];
    return supportedFeatures.includes(feature);
  }
}
