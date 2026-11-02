import { initDb, getDb } from "./db.js";
import { createApp } from "./http/createApp.js";
import { PORT, BODY_LIMIT, LONG_TEXT_MAX, SOURCE_TEXT_MAX } from "./http/serverConfig.js";
import { logger, toErrorMeta } from "./logger.js";

initDb();
// 进程重启后，历史 running 不可能继续执行，启动时自动纠偏。
{
  const d = getDb();
  d.prepare(
    `UPDATE projects
     SET pipeline_status = 'error',
         pipeline_error = COALESCE(NULLIF(pipeline_error, ''), '服务重启导致上次管线中断，请重新运行')
     WHERE pipeline_status = 'running'`,
  ).run();
}

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info("server started", {
    url: `http://127.0.0.1:${PORT}`,
    bodyLimit: BODY_LIMIT,
    longTextMax: LONG_TEXT_MAX,
    sourceTextMax: SOURCE_TEXT_MAX,
    logLevel: process.env.MY_APP_LOG_LEVEL || "info",
    logFormat: process.env.MY_APP_LOG_FORMAT || (process.env.NODE_ENV === "development" ? "pretty" : "json"),
    logToFile: process.env.MY_APP_LOG_TO_FILE === "1" || process.env.MY_APP_LOG_TO_FILE === "true",
    httpSilent: process.env.MY_APP_LOG_HTTP_SILENT_PREFIXES || "default:/api/files",
  });
});

function gracefulShutdown(signal: string) {
  logger.info("graceful shutdown initiated", { signal });
  server.close((err) => {
    if (err) {
      logger.error("error during server close", toErrorMeta(err));
      process.exit(1);
    }
    logger.info("server closed, exiting");
    process.exit(0);
  });
  // 10 秒后强制退出
  setTimeout(() => {
    logger.warn("graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", toErrorMeta(err));
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", toErrorMeta(reason));
});
