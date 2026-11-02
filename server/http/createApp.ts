import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import { dataDir } from "../db.js";
import { logger, runWithRequestContext, shouldLogHttpAtInfo, toErrorMeta } from "../logger.js";
import { BODY_LIMIT } from "./serverConfig.js";
import { registerApiRoutes } from "./registerApiRoutes.js";
import { sendError, badRequest } from "./httpResponses.js";

export function createApp(): express.Application {
  const app = express();

  // 安全头 + 禁用 x-powered-by
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS：通过 MY_APP_CORS_ORIGIN 环境变量配置允许的来源（逗号分隔）
  const corsOrigin = process.env.MY_APP_CORS_ORIGIN?.trim();
  app.use(
    cors({
      origin: corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : false,
      methods: ["GET", "POST", "PUT", "DELETE"],
      maxAge: 86400,
    }),
  );

  // API 速率限制：每 IP 每分钟最多 120 次请求（SSE/events 端点除外）
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.path.endsWith("/events"),
    message: { error: "请求过于频繁，请稍后再试" },
  });
  app.use("/api", apiLimiter);

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
  app.use(
    "/api/files",
    express.static(path.join(dataDir, "files"), {
      setHeaders(res, filePath) {
        const norm = filePath.replace(/\\/g, "/");
        if (norm.includes("/shots/") || norm.includes("/assets/") || norm.includes("/videos/")) {
          res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
        }
      },
    }),
  );
  app.use((req, res, next) => {
    const reqId = req.header("x-request-id")?.trim() || crypto.randomUUID();
    (req as express.Request & { reqId: string }).reqId = reqId;
    res.setHeader("x-request-id", reqId);
    const t0 = Date.now();
    const pathOnly = (req.originalUrl || "").split("?")[0] || req.originalUrl;
    runWithRequestContext(reqId, () => {
      res.on("finish", () => {
        const payload = {
          method: req.method,
          path: pathOnly,
          status: res.statusCode,
          durationMs: Date.now() - t0,
        };
        if (shouldLogHttpAtInfo(pathOnly)) {
          logger.info("http request", payload);
        } else {
          logger.debug("http request", payload);
        }
      });
      next();
    });
  });

  registerApiRoutes(app);

  // ── 静态资源：生产环境下将 web/dist 挂载到 /mj/ ──────────────────
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDistDir = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDistDir)) {
    app.use("/mj", express.static(webDistDir, { index: false }));
    // SPA 回退：非 /api 且非静态文件的 /mj/* 请求返回 index.html
    app.get("/mj/{*splat}", (_req, res) => {
      res.sendFile(path.join(webDistDir, "index.html"));
    });
  }

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const reqId = (req as express.Request & { reqId?: string }).reqId;
    const isPayloadTooLarge =
      typeof err === "object" &&
      err !== null &&
      (("type" in err ? (err as { type?: unknown }).type : undefined) === "entity.too.large" ||
        ("status" in err ? (err as { status?: unknown }).status : undefined) === 413 ||
        ("name" in err ? (err as { name?: unknown }).name : undefined) === "PayloadTooLargeError");
    const isJsonParseFailed =
      typeof err === "object" &&
      err !== null &&
      ("type" in err ? (err as { type?: unknown }).type : undefined) === "entity.parse.failed";
    logger.error("http unhandled error", {
      ...(reqId ? { reqId } : {}),
      method: req.method,
      path: (req.originalUrl || "").split("?")[0],
      ...toErrorMeta(err),
    });
    if (res.headersSent) return;
    if (isPayloadTooLarge) {
      sendError(res, 413, `request entity too large（当前上限 ${BODY_LIMIT}，可通过 MY_APP_BODY_LIMIT 调整）`);
      return;
    }
    if (isJsonParseFailed) {
      logger.warn("http bad json body", {
        ...(reqId ? { reqId } : {}),
        method: req.method,
        path: (req.originalUrl || "").split("?")[0],
      });
      badRequest(res);
      return;
    }
    sendError(res, 500, "internal error");
  });

  return app;
}
