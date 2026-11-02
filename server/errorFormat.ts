/** 展开 Error.cause 链与常见 errno code，便于排查网络/证书等问题 */
export function formatErrorMessage(e: unknown, maxLen = 2000): string {
  if (!(e instanceof Error)) return String(e).slice(0, maxLen);
  const parts: string[] = [];
  let cur: unknown = e;
  let depth = 0;
  while (cur instanceof Error && depth < 8) {
    const m = cur.message?.trim();
    if (m) parts.push(m);
    const code = (cur as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code && !parts.some((p) => p === code || p.endsWith(`(${code})`))) {
      parts.push(`(${code})`);
    }
    cur = (cur as Error & { cause?: unknown }).cause;
    depth++;
  }
  const out = parts.join(" ← ");
  return out.length > maxLen ? `${out.slice(0, maxLen)}…` : out;
}

export type ApiErrorPayload = {
  code: string;
  message: string;
  detail?: unknown;
  requestId?: string;
};

export function buildApiErrorPayload(input: {
  code: string;
  message: string;
  detail?: unknown;
  requestId?: string;
}): ApiErrorPayload {
  return {
    code: input.code,
    message: input.message,
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}
