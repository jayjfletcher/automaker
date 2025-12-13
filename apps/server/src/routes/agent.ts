/**
 * Agent routes - HTTP API for Claude agent interactions
 */

import { Router, type Request, type Response } from "express";
import { AgentService } from "../services/agent-service.js";
import type { EventEmitter } from "../lib/events.js";

export function createAgentRoutes(
  agentService: AgentService,
  _events: EventEmitter
): Router {
  const router = Router();

  // Start a conversation
  router.post("/start", async (req: Request, res: Response) => {
    try {
      const { sessionId, workingDirectory } = req.body as {
        sessionId: string;
        workingDirectory?: string;
      };

      if (!sessionId) {
        res.status(400).json({ success: false, error: "sessionId is required" });
        return;
      }

      const result = await agentService.startConversation({
        sessionId,
        workingDirectory,
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Send a message
  router.post("/send", async (req: Request, res: Response) => {
    try {
      const { sessionId, message, workingDirectory, imagePaths, model } = req.body as {
        sessionId: string;
        message: string;
        workingDirectory?: string;
        imagePaths?: string[];
        model?: string;
      };

      if (!sessionId || !message) {
        res
          .status(400)
          .json({ success: false, error: "sessionId and message are required" });
        return;
      }

      // Start the message processing (don't await - it streams via WebSocket)
      agentService
        .sendMessage({
          sessionId,
          message,
          workingDirectory,
          imagePaths,
          model,
        })
        .catch((error) => {
          console.error("[Agent Route] Error sending message:", error);
        });

      // Return immediately - responses come via WebSocket
      res.json({ success: true, message: "Message sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Get conversation history
  router.post("/history", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body as { sessionId: string };

      if (!sessionId) {
        res.status(400).json({ success: false, error: "sessionId is required" });
        return;
      }

      const result = agentService.getHistory(sessionId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Stop execution
  router.post("/stop", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body as { sessionId: string };

      if (!sessionId) {
        res.status(400).json({ success: false, error: "sessionId is required" });
        return;
      }

      const result = await agentService.stopExecution(sessionId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Clear conversation
  router.post("/clear", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body as { sessionId: string };

      if (!sessionId) {
        res.status(400).json({ success: false, error: "sessionId is required" });
        return;
      }

      const result = await agentService.clearSession(sessionId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Set session model
  router.post("/model", async (req: Request, res: Response) => {
    try {
      const { sessionId, model } = req.body as {
        sessionId: string;
        model: string;
      };

      if (!sessionId || !model) {
        res.status(400).json({ success: false, error: "sessionId and model are required" });
        return;
      }

      const result = await agentService.setSessionModel(sessionId, model);
      res.json({ success: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
