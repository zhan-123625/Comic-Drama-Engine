import dns from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

export type SsrfCheckResult = { safe: true } | { safe: false; reason: string };

/**
 * Check whether an IPv4 address belongs to a private/reserved range.
 * Covers RFC 1918, link-local, loopback, carrier-grade NAT, and broadcast.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true; // fail closed
  const [a, b] = parts;
  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 (carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local / AWS metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (multicast and above)
  if (a >= 224) return true;
  // 255.255.255.255 (broadcast)
  if (a === 255) return true;
  return false;
}

/**
 * Check whether an IPv6 address belongs to a private/reserved range.
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback ::1
  if (lower === "::1") return true;
  // fc00::/7 (unique local)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 (link-local)
  if (lower.startsWith("fe80")) return true;
  // :: (unspecified)
  if (lower === "::") return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (lower.startsWith("::ffff:")) {
    const ipv4Part = lower.slice(7);
    if (isIPv4(ipv4Part)) return isPrivateIPv4(ipv4Part);
    return true; // fail closed on unparseable mapped address
  }
  // IPv6 multicast ff00::/8
  if (lower.startsWith("ff")) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // fail closed: unknown format = block
}

/** SSRF 防护：验证 URL 安全性（含 DNS 解析防护 DNS rebinding） */
export async function validateUrlSafety(imageUrl: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return { safe: false, reason: "Invalid URL format" };
  }

  // Protocol check
  if (!["http:", "https:"].includes(url.protocol)) {
    return { safe: false, reason: "Only HTTP(S) URLs allowed" };
  }

  const hostname = url.hostname.toLowerCase();

  // Blocked domains (before DNS resolution)
  const blockedDomains = [
    "localhost",
    "metadata.google.internal",
    "metadata.internal",
    "instance-data",
    "169.254.169.254",
    "100.100.102.3",
    "169.254.0.23",
  ];
  if (blockedDomains.includes(hostname)) {
    return { safe: false, reason: "Access to reserved domains forbidden" };
  }

  // If the hostname is already an IP literal, check it directly
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateIP(hostname)) {
      return { safe: false, reason: "Access to private networks forbidden" };
    }
    return { safe: true };
  }

  // DNS resolution check - defend against DNS rebinding by checking ALL resolved IPs
  let resolvedIps: string[];
  try {
    // dns.resolve 返回所有 A/AAAA 记录，防止攻击者通过单条公网 IP 绕过检查
    const [ipv4Results, ipv6Results] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
    resolvedIps = [
      ...(ipv4Results.status === "fulfilled" ? ipv4Results.value : []),
      ...(ipv6Results.status === "fulfilled" ? ipv6Results.value : []),
    ];
  } catch {
    return { safe: false, reason: "DNS resolution failed" };
  }

  if (resolvedIps.length === 0) {
    return { safe: false, reason: "DNS returned no records" };
  }

  // 所有解析结果都必须是公网 IP
  for (const ip of resolvedIps) {
    if (isPrivateIP(ip)) {
      return { safe: false, reason: `Resolved to private IP ${ip}` };
    }
  }

  return { safe: true };
}
