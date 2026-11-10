/** Aliyun routing: preserve the configured region/domain and never substitute model IDs. */
export function isDashScopeEndpoint(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return (
      /(^|\.)dashscope(?:-intl|-us)?\.aliyuncs\.com$/i.test(u.hostname) ||
      /(^|\.)qianwenaiapi\.com$/i.test(u.hostname) ||
      /\/api\/v1\/services\/aigc\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export function dashScopeUrl(baseUrl: string, pathname: string): string {
  const u = new URL(baseUrl.trim());
  u.pathname = pathname;
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function resolveDashScopeTextUrl(baseUrl: string): string | null {
  if (!isDashScopeEndpoint(baseUrl)) return null;
  return dashScopeUrl(baseUrl, "/compatible-mode/v1/chat/completions");
}

/** Upstream bodies may echo credentials. Sanitize before throwing or logging. */
export function redactProviderText(value: unknown, apiKey: string): string {
  let text = String(value ?? "");
  if (apiKey) text = text.split(apiKey).join("[REDACTED]");
  return text.replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]").replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
}

export function providerErrorMessage(raw: string, apiKey: string): string {
  let message = raw;
  try {
    const j = JSON.parse(raw);
    message =
      [j.error?.code ?? j.code, j.error?.message ?? j.message ?? j.output?.message].filter(Boolean).join(": ") || raw;
  } catch {
    /* Plain text response. */
  }
  return redactProviderText(message, apiKey).slice(0, 600);
}
