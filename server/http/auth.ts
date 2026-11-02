import type express from "express";
import { timingSafeEqual } from "node:crypto";
import { buildApiErrorPayload } from "../errorFormat.js";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** 认证：验证请求头中的 API Token */
export function verifyAuth(req: express.Request, res: express.Response): boolean {
  const configuredToken = (process.env.API_TOKEN || "").trim() || "dev-token";

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token || !safeCompare(token, configuredToken)) {
    res.status(401).json(
      buildApiErrorPayload({
        code: "Unauthorized",
        message: "Missing or invalid API token. Use Authorization: Bearer <token> header.",
        requestId: String(res.getHeader("x-request-id") ?? ""),
      }),
    );
    return false;
  }

  return true;
}
