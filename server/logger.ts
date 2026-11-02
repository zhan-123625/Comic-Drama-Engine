/**
 * 结构化日志（JSON 或 pretty）+ AsyncLocalStorage 请求/任务上下文。
 *
 * 环境变量：
 * - MY_APP_LOG_LEVEL=debug|info|warn|error（默认 info）
 * - MY_APP_LOG_FORMAT=json|pretty（未设且 NODE_ENV=development 时用 pretty）
 * - MY_APP_LOG_TO_FILE=1|true 写入 data/logs/server.log
 * - MY_APP_SERVICE_NAME 服务名（默认 my-app）
 * - MY_APP_LOG_HTTP_SILENT_PREFIXES 逗号分隔；匹配前缀的 HTTP 访问仅打 debug（默认 /api/files）
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

type LogLevel = "debug" | "info" | "warn" | "error";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自动加载 .env 文件，确保 MY_APP_LOG_TO_FILE 等配置生效
try {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (existsSync(envPath)) {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(envPath);
    } else {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed
            .slice(eqIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
    }
  }
} catch {
  /* ignore */
}

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(raw: string | undefined): LogLevel {
  const v = (raw || "").trim().toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v;
  return "info";
}

const minLevel = parseLevel(process.env.MY_APP_LOG_LEVEL);
const logToFile = process.env.MY_APP_LOG_TO_FILE === "1" || process.env.MY_APP_LOG_TO_FILE === "true";
const pretty =
  process.env.MY_APP_LOG_FORMAT === "pretty" ||
  (process.env.MY_APP_LOG_FORMAT !== "json" && process.env.NODE_ENV === "development");
const serviceName = (process.env.MY_APP_SERVICE_NAME || "comic-drama-engine").trim() || "comic-drama-engine";

const logDir = path.join(__dirname, "..", "data", "logs");
const logFile = path.join(logDir, "server.log");

/** 这些路径的 HTTP 访问仅记 debug，减少静态资源刷屏（逗号分隔前缀） */
const httpSilentPrefixes = (process.env.MY_APP_LOG_HTTP_SILENT_PREFIXES ?? "/api/files")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let serviceVersion = "0.0.0";
try {
  const pkgPath = path.join(__dirname, "..", "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    if (pkg.version) serviceVersion = pkg.version;
  }
} catch {
  /* ignore */
}

export type AppLogContext = {
  reqId?: string;
  projectId?: string;
  jobId?: string;
  shotIndex?: number;
  /** 逻辑域：http | job-runner | pipeline | provider … */
  scope?: string;
};

const als = new AsyncLocalStorage<AppLogContext>();

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[minLevel];
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify({ value: String(v) });
  }
}

/** Promise chain that serializes async file writes to prevent interleaving */
let fileWriteQueue: Promise<void> = Promise.resolve();

function writeLine(line: string) {
  process.stdout.write(`${line}\n`);
  if (!logToFile) return;
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const payload = `${line}\n`;
  // Serialize writes via a promise chain to prevent interleaving
  fileWriteQueue = fileWriteQueue.then(() =>
    appendFile(logFile, payload, "utf8").catch(() => {
      /* ignore file-write errors */
    }),
  );
}

function redactSecrets(input: string): string {
  return (
    input
      // Authorization header (Bearer token)
      .replace(/(authorization\s*:\s*["']?bearer\s+)[^\s"']+/gi, "$1***")
      // API Key in headers or JSON
      .replace(/("?api[_-]?key"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/([?&])(apiKey|api_key)=([^&\s"']+)/gi, "$1$2=***")
      // OpenAI/AWS style keys
      .replace(/(sk-[a-zA-Z0-9]{10,})/g, "***")
      .replace(/(AKIA[0-9A-Z]{16})/g, "***")
      // Other sensitive fields in JSON
      .replace(/("?secretKey"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/("?secret"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/("?password"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/("?token"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/("?refresh[_-]?token"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      .replace(/("?access[_-]?token"?\s*:\s*")[^"]*(")/gi, "$1***$2")
      // URL query parameters with sensitive names
      .replace(/([?&])(token|secret|password|key|auth)=([^&\s"']+)/gi, "$1$2=***")
      // URL userinfo (username:password@) 全量掩码，避免凭证泄露
      .replace(/\/\/[^/@:]+:[^/@]+@/g, "//***:***@")
      // JWT in URLs (basic pattern)
      .replace(/([?&])(jwt|token)=([a-zA-Z0-9._-]+)/gi, "$1$2=***")
  );
}

function mergeContext(explicit?: Record<string, unknown>): Record<string, unknown> {
  const store = als.getStore();
  const base: Record<string, unknown> = {
    service: serviceName,
    version: serviceVersion,
  };
  if (store?.reqId) base.reqId = store.reqId;
  if (store?.projectId) base.projectId = store.projectId;
  if (store?.jobId) base.jobId = store.jobId;
  if (store?.shotIndex != null) base.shotIndex = store.shotIndex;
  if (store?.scope) base.scope = store.scope;
  if (explicit) Object.assign(base, explicit);
  return base;
}

function formatPretty(level: LogLevel, message: string, ctx: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const rest = { ...ctx };
  delete (rest as Record<string, unknown>).service;
  delete (rest as Record<string, unknown>).version;
  const tail = Object.keys(rest).length ? ` ${safeStringify(rest)}` : "";
  return `${ts} ${level.toUpperCase().padEnd(5)} [${serviceName}] ${message}${tail}`;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const ctx = mergeContext(context);
  if (pretty) {
    writeLine(redactSecrets(formatPretty(level, message, ctx)));
    return;
  }
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ctx,
  };
  writeLine(redactSecrets(safeStringify(payload)));
}

/** 在 HTTP 中间件内调用，使后续同请求异步链路自动带上 reqId */
export function runWithRequestContext<T>(reqId: string, fn: () => T): T {
  return als.run({ reqId }, fn);
}

/** 合并上下文并执行异步函数（Runner / 管线等无 HTTP 请求时使用） */
export async function runInLogContext<T>(patch: Partial<AppLogContext>, fn: () => Promise<T>): Promise<T> {
  const prev = als.getStore();
  const next: AppLogContext = { ...prev, ...patch };
  return als.run(next, fn);
}

export function getLogContext(): AppLogContext | undefined {
  return als.getStore();
}

export type Logger = {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

function makeLogger(fixed?: Partial<AppLogContext>): Logger {
  const merge = (ctx?: Record<string, unknown>) => ({ ...fixed, ...ctx });
  return {
    debug: (message, context) => emit("debug", message, merge(context)),
    info: (message, context) => emit("info", message, merge(context)),
    warn: (message, context) => emit("warn", message, merge(context)),
    error: (message, context) => emit("error", message, merge(context)),
  };
}

export const logger: Logger = makeLogger();

/** 固定附带 scope / projectId 等，避免每条手写 */
export function createChildLogger(fixed: Partial<AppLogContext>): Logger {
  return makeLogger(fixed);
}

/** HTTP 路径是否降级为 debug（默认含 /api/files） */
export function shouldLogHttpAtInfo(pathWithoutQuery: string): boolean {
  return !httpSilentPrefixes.some((p) => pathWithoutQuery.startsWith(p));
}

export function toErrorMeta(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
  }
  return { error: String(e) };
}
