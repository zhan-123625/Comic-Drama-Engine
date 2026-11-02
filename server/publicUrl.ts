/** 供视频 Hook 等外网服务拉取本机分镜图（相对 `/api/...` 转绝对 URL） */
export function getPublicBaseUrl(): string {
  return process.env.MY_APP_PUBLIC_URL?.replace(/\/+$/, "") || `http://127.0.0.1:${process.env.MY_APP_PORT || 3710}`;
}

export function toPublicAssetUrl(pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `${getPublicBaseUrl()}${pathOrUrl}`;
  return pathOrUrl;
}

/** 视频/生图云端无法拉取的常见本机地址（未配置公网 MY_APP_PUBLIC_URL 时） */
export function isLikelyLocalHostUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const x = new URL(u);
    const h = (x.hostname || "").toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "0.0.0.0" || h === "::1";
  } catch {
    return false;
  }
}

/** 典型局域网 / 链路本地 IPv4，视频云服务商无法拉取 */
export function isLikelyPrivateLanUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const h = new URL(u).hostname.toLowerCase();
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  } catch {
    return false;
  }
}
