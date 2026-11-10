// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("undici", () => ({ Agent: class {}, fetch: fetchMock }));
vi.mock("../utils/sleep.js", () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));
import { chatComplete, generateImage } from "./openaiCompat.js";
import { generateVideoByHook, isDashScopeVideoProvider } from "./videoHook.js";
import { dashScopeUrl, resolveDashScopeTextUrl } from "./dashscopeCompat.js";
const base = "https://cn-beijing.maas.qianwenaiapi.com";
const key = "private-test-credential";
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const body = (index = 0) => JSON.parse(fetchMock.mock.calls[index]![1].body);
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("Aliyun model compatibility", () => {
  it("repairs the configured Qwen API root and preserves custom domains and regions", async () => {
    fetchMock.mockResolvedValueOnce(response({ choices: [{ message: { content: "OK" } }] }));
    expect(
      await chatComplete({
        baseUrl: base + "/api/v1",
        apiKey: key,
        model: "qwen3.8-max",
        messages: [{ role: "user", content: "test" }],
      }),
    ).toBe("OK");
    expect(fetchMock.mock.calls[0]![0]).toBe(base + "/compatible-mode/v1/chat/completions");
    expect(body().model).toBe("qwen3.8-max");
    expect(body().enable_thinking).toBe(false);
    expect(resolveDashScopeTextUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(dashScopeUrl(base + "/api/v1", "/api/v1/tasks/a")).toBe(base + "/api/v1/tasks/a");
  });
  it("leaves unrelated OpenAI-compatible text requests free of vendor-specific parameters", async () => {
    fetchMock.mockResolvedValueOnce(response({ choices: [{ message: { content: "OK" } }] }));
    await chatComplete({ baseUrl: "https://example.com/v1", apiKey: key, model: "custom", messages: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.com/v1/chat/completions");
    expect(body()).not.toHaveProperty("enable_thinking");
  });
  it("redacts credentials echoed by text and image errors", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: "invalid token " + key } }, 401));
    let message = "";
    try {
      await chatComplete({ baseUrl: base + "/api/v1", apiKey: key, model: "qwen3.8-max", messages: [] });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("401");
    expect(message).not.toContain(key);
    fetchMock.mockResolvedValueOnce(response({ code: "InvalidParameter", message: key }, 400));
    await expect(
      generateImage({ baseUrl: base + "/api/v1", apiKey: key, model: "qwen-image-3.0", prompt: "test" }),
    ).rejects.toThrow("[REDACTED]");
  });
  it("uses the Qwen Image native messages schema and reads synchronous image content", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ output: { choices: [{ message: { content: [{ image: "https://cdn.example/image.png" }] } }] } }),
    );
    const result = await generateImage({
      baseUrl: base + "/api/v1/services/aigc/multimodal-generation/generation",
      apiKey: key,
      model: "qwen-image-3.0",
      prompt: "scene",
      referenceDataUrls: ["https://cdn.example/ref.png"],
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(base + "/api/v1/services/aigc/multimodal-generation/generation");
    expect(body().model).toBe("qwen-image-3.0");
    expect(body().input.messages[0].content).toEqual([{ image: "https://cdn.example/ref.png" }, { text: "scene" }]);
    expect(result).toMatchObject({ kind: "url", url: "https://cdn.example/image.png" });
    expect(JSON.stringify(result.modelApiCall)).not.toContain(key);
  });
  it("supports asynchronous Qwen images and polls the configured domain", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ output: { task_id: "q-image" } }))
      .mockResolvedValueOnce(
        response({ output: { task_status: "SUCCEEDED", results: [{ url: "https://cdn.example/generated.png" }] } }),
      );
    const result = await generateImage({
      baseUrl: base + "/api/v1",
      apiKey: key,
      model: "qwen-image",
      prompt: "scene",
    });
    expect(fetchMock.mock.calls[1]![0]).toBe(base + "/api/v1/tasks/q-image");
    expect(result.kind).toBe("url");
    expect(body().model).toBe("qwen-image");
  });
  it("retains the legacy WAN image protocol without changing the endpoint origin", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ output: { task_id: "wan-image" } }))
      .mockResolvedValueOnce(
        response({ output: { task_status: "SUCCEEDED", results: [{ url: "https://cdn.example/wan.png" }] } }),
      );
    await generateImage({
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKey: key,
      model: "wanx2.1-t2i-plus",
      prompt: "scene",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    );
    expect(body().input.prompt).toBe("scene");
  });
  it("submits Wan 3.0 asynchronously, preserves the model, and polls its configured region", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ output: { task_id: "video-1" } }))
      .mockResolvedValueOnce(
        response({ output: { task_status: "SUCCEEDED", video_url: "https://cdn.example/video.mp4" } }),
      );
    const result = await generateVideoByHook(
      {
        provider: "http-hook",
        baseUrl: base + "/api/v1/services/aigc/video-generation/video-synthesis",
        apiKey: key,
        model: "wan3.0-video",
      },
      { prompt: "scene", runMode: "text_only", durationSeconds: 5 },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe(base + "/api/v1/services/aigc/video-generation/video-synthesis");
    expect(fetchMock.mock.calls[0]![1].headers["X-DashScope-Async"]).toBe("enable");
    expect(body().model).toBe("wan3.0-video");
    expect(fetchMock.mock.calls[1]![0]).toBe(base + "/api/v1/tasks/video-1");
    expect(result.url).toBe("https://cdn.example/video.mp4");
    expect(JSON.stringify(result.modelApiCall)).not.toContain(key);
    expect(
      isDashScopeVideoProvider({
        provider: "http-hook",
        baseUrl: "https://example.com/video",
        apiKey: key,
        model: "wan3.0-video",
      }),
    ).toBe(false);
  });
  it("reports failed video polling immediately and does not leak echoed credentials", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ output: { task_id: "video-2" } }))
      .mockResolvedValueOnce(response({ message: "bad " + key }, 403));
    await expect(
      generateVideoByHook(
        { provider: "http-hook", baseUrl: base, apiKey: key, model: "wan3.0-video" },
        { prompt: "scene", runMode: "text_only" },
      ),
    ).rejects.toThrow("[REDACTED]");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
