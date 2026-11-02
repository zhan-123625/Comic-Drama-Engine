import { readConfig } from "../config.js";
import { chatComplete } from "../providers/openaiCompat.js";
import { logger } from "../logger.js";
import { backoffDelay, sleep } from "../utils/retry.js";

type Role = "system" | "user" | "assistant";

const debugLlm = process.env.MY_APP_DEBUG_LLM === "1" || process.env.MY_APP_DEBUG_LLM === "true";

/**
 * 指数退避配置
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: RegExp[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    /json parse error/i,
    /unexpected token/i,
    /syntaxerror/i,
    /timeout/i,
    /econnreset/i,
    /econnrefused/i,
    /socket hang up/i,
    /rate limit/i,
    /429/,
    /503/,
  ],
};

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DEFAULT_RETRY_CONFIG.retryableErrors.some((pattern) => pattern.test(message));
}

/**
 * 计算下次重试的延迟时间
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  multiplier: number,
  maxDelayMs: number,
): number {
  const scaledBase = Math.max(50, Math.floor(initialDelayMs * Math.pow(multiplier, attempt)));
  return backoffDelay(0, { baseDelayMs: scaledBase, maxDelayMs, jitterRatio: 0.5 });
}

export async function agentChat(messages: { role: Role; content: string }[], temperature = 0.35): Promise<string> {
  const cfg = await readConfig();
  if (!cfg.text) throw new Error("未配置文本模型：请先在「设置」页填写 text provider");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const t0 = debugLlm ? performance.now() : 0;
      const response = await chatComplete({
        baseUrl: cfg.text.baseUrl,
        apiKey: cfg.text.apiKey,
        model: cfg.text.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature,
      });

      if (debugLlm) {
        const ms = Math.round(performance.now() - t0);
        const model = cfg.text.model ?? "?";
        logger.debug("text model request", { model, durationMs: ms, attempt });
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否为可重试错误且还有重试次数
      if (!isRetryableError(error) || attempt >= DEFAULT_RETRY_CONFIG.maxRetries) {
        if (debugLlm) {
          logger.error("agentChat failed after retries", {
            attempt,
            maxRetries: DEFAULT_RETRY_CONFIG.maxRetries,
            error: lastError.message,
            isRetryable: isRetryableError(error),
          });
        }
        throw lastError;
      }

      // 计算延迟并重试
      const delayMs = calculateBackoffDelay(
        attempt,
        DEFAULT_RETRY_CONFIG.initialDelayMs,
        DEFAULT_RETRY_CONFIG.backoffMultiplier,
        DEFAULT_RETRY_CONFIG.maxDelayMs,
      );

      if (debugLlm) {
        logger.warn("agentChat retry", {
          attempt: attempt + 1,
          maxRetries: DEFAULT_RETRY_CONFIG.maxRetries,
          delayMs: Math.round(delayMs),
          error: lastError.message,
        });
      }

      await sleep(delayMs);
    }
  }

  // 这行不会被执行，但为了类型安全保留
  throw lastError || new Error("agentChat failed");
}
