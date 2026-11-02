import { sleep } from "./sleep.js";
export { sleep } from "./sleep.js";

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
};

export function backoffDelay(attempt: number, opts?: RetryOptions): number {
  const base = Math.max(50, Math.floor(opts?.baseDelayMs ?? 300));
  const max = Math.max(base, Math.floor(opts?.maxDelayMs ?? 10_000));
  const jitterRatio = Math.min(1, Math.max(0, opts?.jitterRatio ?? 0.5));
  const raw = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  const jitterMin = 1 - jitterRatio;
  const jitterMax = 1 + jitterRatio;
  const jitter = jitterMin + Math.random() * (jitterMax - jitterMin);
  return Math.round(raw * jitter);
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export async function withRetry<T>(
  task: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  opts?: RetryOptions,
): Promise<T> {
  const retries = Math.max(0, Math.floor(opts?.retries ?? 2));
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !shouldRetry(e)) break;
      await sleep(backoffDelay(attempt, opts));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
