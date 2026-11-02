import type express from "express";
import type { z } from "zod";
import { buildApiErrorPayload } from "../errorFormat.js";
import { logger } from "../logger.js";

function reqId(res: express.Response): string {
  return String(res.getHeader("x-request-id") ?? "");
}

export function badRequest(res: express.Response, detail?: unknown) {
  res.status(400).json(
    buildApiErrorPayload({
      code: "BadRequest",
      message: "Request validation failed",
      ...(detail !== undefined ? { detail } : {}),
      requestId: reqId(res),
    }),
  );
}

export function notFound(res: express.Response, message = "not found") {
  res.status(404).json(
    buildApiErrorPayload({
      code: "NotFound",
      message,
      requestId: reqId(res),
    }),
  );
}

export function conflict(res: express.Response, message = "conflict", detail?: unknown) {
  res.status(409).json(
    buildApiErrorPayload({
      code: "Conflict",
      message,
      ...(detail !== undefined ? { detail } : {}),
      requestId: reqId(res),
    }),
  );
}

export function badGateway(res: express.Response, message = "upstream error", detail?: unknown) {
  res.status(502).json(
    buildApiErrorPayload({
      code: "BadGateway",
      message,
      ...(detail !== undefined ? { detail } : {}),
      requestId: reqId(res),
    }),
  );
}

export function sendError(res: express.Response, status: number, message: string, detail?: unknown) {
  res.status(status).json(
    buildApiErrorPayload({
      code: httpStatusToCode(status),
      message,
      ...(detail !== undefined ? { detail } : {}),
      requestId: reqId(res),
    }),
  );
}

function httpStatusToCode(status: number): string {
  if (status === 400) return "BadRequest";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "NotFound";
  if (status === 409) return "Conflict";
  if (status === 413) return "PayloadTooLarge";
  if (status === 429) return "TooManyRequests";
  if (status === 502) return "BadGateway";
  return "Error";
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: express.Response): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const req = res.req;
    const reqId = (req as express.Request & { reqId?: string }).reqId;
    logger.warn("request validation failed", {
      ...(reqId ? { reqId } : {}),
      method: req.method,
      path: (req.originalUrl || "").split("?")[0],
      issues: parsed.error.issues.slice(0, 8).map((it) => ({
        path: it.path.join("."),
        code: it.code,
        message: it.message,
      })),
    });
    badRequest(res, parsed.error.flatten());
    return null;
  }
  return parsed.data;
}
