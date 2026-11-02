import { describe, it, expect, vi } from "vitest";
import { badRequest, notFound, conflict, badGateway, sendError, parseBody } from "./httpResponses.js";
import { z } from "zod";

function mockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue("test-req-id"),
    req: { method: "POST", originalUrl: "/api/test" },
  };
  return res;
}

describe("httpResponses", () => {
  it("badRequest 应返回 400 且包含 code=BadRequest", () => {
    const res = mockRes();
    badRequest(res, { field: "name" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "BadRequest" }));
  });

  it("notFound 应返回 404", () => {
    const res = mockRes();
    notFound(res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NotFound", message: "not found" }));
  });

  it("notFound 自定义消息应生效", () => {
    const res = mockRes();
    notFound(res, "shot not found");
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "shot not found" }));
  });

  it("conflict 应返回 409 且包含 detail", () => {
    const res = mockRes();
    conflict(res, "pipeline running", { pipelineStatus: "running" });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "Conflict",
        message: "pipeline running",
        detail: { pipelineStatus: "running" },
      }),
    );
  });

  it("badGateway 应返回 502", () => {
    const res = mockRes();
    badGateway(res, "upstream timeout");
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "BadGateway", message: "upstream timeout" }));
  });

  it("sendError 应根据 status 设置正确的 code", () => {
    const res = mockRes();
    sendError(res, 429, "rate limited");
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "TooManyRequests" }));
  });

  it("parseBody 验证成功时应返回 data", () => {
    const schema = z.object({ name: z.string() });
    const res = mockRes();
    const result = parseBody(schema, { name: "test" }, res);
    expect(result).toEqual({ name: "test" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("parseBody 验证失败时应调用 badRequest", () => {
    const schema = z.object({ name: z.string() });
    const res = mockRes();
    const result = parseBody(schema, { name: 123 }, res);
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
