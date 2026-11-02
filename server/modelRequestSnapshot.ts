/**
 * 任务页「模型实际调用参数」：脱敏与体积控制，避免把完整 API Key 或巨型 data URL 写入 DB。
 */

const MAX_STRING = 12_000;
const MAX_JSON_CHARS = 180_000;

export function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "authorization") {
      out[k] = /^Bearer\s+/i.test(v) ? "Bearer ***" : "***";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function walkTruncate(value: unknown, depth: number): unknown {
  if (depth > 40) return "(嵌套过深，已截断)";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.length > 120) {
      return `(内联 data URL 已省略，约 ${Math.round(value.length / 1024)}KB)`;
    }
    if (value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…(截断)`;
    return value;
  }
  if (Array.isArray(value)) return value.map((x) => walkTruncate(x, depth + 1));
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      next[k] = walkTruncate(v, depth + 1);
    }
    return next;
  }
  return String(value);
}

/** 写入任务记录前的请求体清洗（递归截断字符串、省略 data URL） */
export function sanitizeModelRequestBody(body: unknown): unknown {
  return walkTruncate(body, 0);
}

export function jsonStringifyModelSnapshot(obj: unknown): string {
  const s = JSON.stringify(obj);
  if (s.length <= MAX_JSON_CHARS) return s;
  return `${s.slice(0, MAX_JSON_CHARS)}…(JSON 总长已截断)`;
}
