import { describe, it, expect } from "vitest";
import { validateUrlSafety } from "./ssrfCheck.js";

describe("validateUrlSafety", () => {
  it("无效 URL 应返回不安全", async () => {
    const result = await validateUrlSafety("not-a-url");
    expect(result.safe).toBe(false);
  });

  it("非 HTTP(S) 协议应返回不安全", async () => {
    const result = await validateUrlSafety("ftp://example.com/file");
    expect(result.safe).toBe(false);
  });

  it("localhost 应被阻止", async () => {
    const result = await validateUrlSafety("http://localhost/image.png");
    expect(result.safe).toBe(false);
  });

  it("127.0.0.1 直连应被阻止", async () => {
    const result = await validateUrlSafety("http://127.0.0.1/image.png");
    expect(result.safe).toBe(false);
  });

  it("10.x.x.x 私有地址应被阻止", async () => {
    const result = await validateUrlSafety("http://10.0.0.1/image.png");
    expect(result.safe).toBe(false);
  });

  it("192.168.x.x 私有地址应被阻止", async () => {
    const result = await validateUrlSafety("http://192.168.1.1/image.png");
    expect(result.safe).toBe(false);
  });

  it("169.254.169.254 云元数据地址应被阻止", async () => {
    const result = await validateUrlSafety("http://169.254.169.254/latest/meta-data");
    expect(result.safe).toBe(false);
  });

  it("metadata.google.internal 应被阻止", async () => {
    const result = await validateUrlSafety("http://metadata.google.internal/");
    expect(result.safe).toBe(false);
  });

  it("::1 IPv6 回环应被阻止", async () => {
    const result = await validateUrlSafety("http://[::1]/image.png");
    expect(result.safe).toBe(false);
  });
});
