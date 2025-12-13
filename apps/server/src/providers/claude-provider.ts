/**
 * Claude Provider - Executes queries using Claude Agent SDK
 *
 * Wraps the @anthropic-ai/claude-agent-sdk for seamless integration
 * with the provider architecture.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { BaseProvider } from "./base-provider.js";
import type {
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
} from "./types.js";

export class ClaudeProvider extends BaseProvider {
  getName(): string {
    return "claude";
  }

  /**
   * Execute a query using Claude Agent SDK
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const {
      prompt,
      model,
      cwd,
      systemPrompt,
      maxTurns = 20,
      allowedTools,
      abortController,
      conversationHistory,
    } = options;

    // Build Claude SDK options
    const sdkOptions: Options = {
      model,
      systemPrompt,
      maxTurns,
      cwd,
      allowedTools: allowedTools || [
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "WebSearch",
        "WebFetch",
      ],
      permissionMode: "acceptEdits",
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
      },
      abortController,
    };

    // Build prompt payload with conversation history
    let promptPayload: string | AsyncGenerator<any, void, unknown>;

    if (conversationHistory && conversationHistory.length > 0) {
      // Multi-turn conversation with history
      promptPayload = (async function* () {
        // Yield all previous messages first
        for (const historyMsg of conversationHistory) {
          yield {
            type: historyMsg.role,
            session_id: "",
            message: {
              role: historyMsg.role,
              content: Array.isArray(historyMsg.content)
                ? historyMsg.content
                : [{ type: "text", text: historyMsg.content }],
            },
            parent_tool_use_id: null,
          };
        }

        // Yield current prompt
        yield {
          type: "user" as const,
          session_id: "",
          message: {
            role: "user" as const,
            content: Array.isArray(prompt)
              ? prompt
              : [{ type: "text", text: prompt }],
          },
          parent_tool_use_id: null,
        };
      })();
    } else if (Array.isArray(prompt)) {
      // Multi-part prompt (with images) - no history
      promptPayload = (async function* () {
        yield {
          type: "user" as const,
          session_id: "",
          message: {
            role: "user" as const,
            content: prompt,
          },
          parent_tool_use_id: null,
        };
      })();
    } else {
      // Simple text prompt - no history
      promptPayload = prompt;
    }

    // Execute via Claude Agent SDK
    const stream = query({ prompt: promptPayload, options: sdkOptions });

    // Stream messages directly - they're already in the correct format
    for await (const msg of stream) {
      yield msg as ProviderMessage;
    }
  }

  /**
   * Detect Claude SDK installation (always available via npm)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    // Claude SDK is always available since it's a dependency
    const hasApiKey =
      !!process.env.ANTHROPIC_API_KEY || !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

    return {
      installed: true,
      method: "sdk",
      hasApiKey,
      authenticated: hasApiKey,
    };
  }

  /**
   * Get available Claude models
   */
  getAvailableModels(): ModelDefinition[] {
    return [
      {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        modelString: "claude-opus-4-5-20251101",
        provider: "anthropic",
        description: "Most capable Claude model",
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: "premium",
        default: true,
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        modelString: "claude-sonnet-4-20250514",
        provider: "anthropic",
        description: "Balanced performance and cost",
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: "standard",
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        modelString: "claude-3-5-sonnet-20241022",
        provider: "anthropic",
        description: "Fast and capable",
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: "standard",
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        modelString: "claude-3-5-haiku-20241022",
        provider: "anthropic",
        description: "Fastest Claude model",
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: "basic",
      },
    ];
  }

  /**
   * Check if the provider supports a specific feature
   */
  supportsFeature(feature: string): boolean {
    const supportedFeatures = ["tools", "text", "vision", "thinking"];
    return supportedFeatures.includes(feature);
  }
}
