import { describe, it, expect } from "vitest";
import { sleep } from "./sleep";

describe("sleep", () => {
  it("应导出 sleep 函数", () => {
    expect(typeof sleep).toBe("function");
  });

  it("应返回 Promise", () => {
    const result = sleep(0);
    expect(result).toBeInstanceOf(Promise);
  });

  it("应在指定时间后 resolve", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // 允许少量误差
  });

  it("sleep(0) 应立即完成", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
