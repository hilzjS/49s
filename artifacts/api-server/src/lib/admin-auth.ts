/**
 * Admin Authentication Middleware
 *
 * Protects administrative endpoints (ingest, optimize, backtest, generate).
 * Reads the shared secret from the ADMIN_API_KEY environment variable only —
 * it is never hard-coded and never exposed to frontend code.
 *
 * Behavior:
 * - If ADMIN_API_KEY is set: requests must carry
 *   `Authorization: Bearer <key>` or the `x-admin-key` header.
 * - If ADMIN_API_KEY is NOT set (local development): requests are allowed
 *   and a warning is logged once at startup.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

let warned = false;

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    if (!warned) {
      logger.warn("ADMIN_API_KEY is not set — administrative endpoints are unprotected (development mode)");
      warned = true;
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const headerKey = req.headers["x-admin-key"];
  const provided = bearer ?? (typeof headerKey === "string" ? headerKey : undefined);

  if (!provided || provided !== adminKey) {
    logger.warn({ url: req.url, method: req.method }, "Rejected unauthenticated admin request");
    res.status(401).json({ error: "Authentication required for administrative endpoints" });
    return;
  }

  next();
}
