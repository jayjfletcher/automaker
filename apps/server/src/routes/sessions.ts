/**
 * Sessions routes - HTTP API for session management
 */

import { Router, type Request, type Response } from "express";
import { AgentService } from "../services/agent-service.js";

export function createSessionsRoutes(agentService: AgentService): Router {
  const router = Router();

  // List all sessions
  router.get("/", async (req: Request, res: Response) => {
    try {
      const includeArchived = req.query.includeArchived === "true";
      const sessionsRaw = await agentService.listSessions(includeArchived);

      // Transform to match frontend SessionListItem interface
      const sessions = await Promise.all(
        sessionsRaw.map(async (s) => {
          const messages = await agentService.loadSession(s.id);
          const lastMessage = messages[messages.length - 1];
          const preview = lastMessage?.content?.slice(0, 100) || "";

          return {
            id: s.id,
            name: s.name,
            projectPath: s.projectPath || s.workingDirectory,
            workingDirectory: s.workingDirectory,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            isArchived: s.archived || false,
            tags: s.tags || [],
            messageCount: messages.length,
            preview,
          };
        })
      );

      res.json({ success: true, sessions });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Create a new session
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, projectPath, workingDirectory, model } = req.body as {
        name: string;
        projectPath?: string;
        workingDirectory?: string;
        model?: string;
      };

      if (!name) {
        res.status(400).json({ success: false, error: "name is required" });
        return;
      }

      const session = await agentService.createSession(
        name,
        projectPath,
        workingDirectory,
        model
      );
      res.json({ success: true, session });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Update a session
  router.put("/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { name, tags, model } = req.body as {
        name?: string;
        tags?: string[];
        model?: string;
      };

      const session = await agentService.updateSession(sessionId, { name, tags, model });
      if (!session) {
        res.status(404).json({ success: false, error: "Session not found" });
        return;
      }

      res.json({ success: true, session });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Archive a session
  router.post("/:sessionId/archive", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const success = await agentService.archiveSession(sessionId);

      if (!success) {
        res.status(404).json({ success: false, error: "Session not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Unarchive a session
  router.post("/:sessionId/unarchive", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const success = await agentService.unarchiveSession(sessionId);

      if (!success) {
        res.status(404).json({ success: false, error: "Session not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  // Delete a session
  router.delete("/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const success = await agentService.deleteSession(sessionId);

      if (!success) {
        res.status(404).json({ success: false, error: "Session not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
