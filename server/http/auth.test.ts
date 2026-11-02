import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyAuth } from "./auth.js";

function mockReq(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method: "POST",
    originalUrl: "/api/test",
  } as any;
}

function mockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue("req-1"),
  };
  return res;
}

describe("verifyAuth", () => {
  const origToken = process.env.API_TOKEN;

  afterEach(() => {
    if (origToken !== undefined) process.env.API_TOKEN = origToken;
    else delete process.env.API_TOKEN;
  });

  it("未设置 API_TOKEN 时回退到 dev-token，无 token 请求返回 401", () => {
    delete process.env.API_TOKEN;
    const res = mockRes();
    const result = verifyAuth(mockReq(), res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("未设置 API_TOKEN 时提供 dev-token 可通过", () => {
    delete process.env.API_TOKEN;
    const res = mockRes();
    const result = verifyAuth(mockReq("dev-token"), res);
    expect(result).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("API_TOKEN 已设置但请求无 token 时应返回 401", () => {
    process.env.API_TOKEN = "my-secret";
    const res = mockRes();
    const result = verifyAuth(mockReq(), res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "Unauthorized" }));
  });

  it("token 匹配时应通过", () => {
    process.env.API_TOKEN = "my-secret";
    const res = mockRes();
    const result = verifyAuth(mockReq("my-secret"), res);
    expect(result).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("token 不匹配时应返回 401", () => {
    process.env.API_TOKEN = "my-secret";
    const res = mockRes();
    const result = verifyAuth(mockReq("wrong-token"), res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("错误格式的 Authorization 头应返回 401", () => {
    process.env.API_TOKEN = "my-secret";
    const res = mockRes();
    const req = { headers: { authorization: "Basic abc" }, method: "POST", originalUrl: "/api/test" } as any;
    const result = verifyAuth(req, res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
