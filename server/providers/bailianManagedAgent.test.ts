import { describe, it, expect } from "vitest";
import { BailianAgentStudioClient } from "./bailianManagedAgent.js";
import {
  BAILIAN_TEXT_MODEL_PRESETS,
  BAILIAN_IMAGE_MODEL_PRESETS,
  BAILIAN_VIDEO_MODEL_PRESETS,
  BAILIAN_DASHSCOPE_OPENAI_BASE,
  buildManagedAgentsEndpoint,
} from "../bailianPresets.js";
import { createBailianOpenApiClient } from "../bailian/index.js";

describe("BailianAgentStudioClient", () => {
  it("缺少 apiKey 时应抛出异常", () => {
    expect(() => new BailianAgentStudioClient({ apiKey: "", workspaceId: "ws_123" })).toThrow("apiKey 为必填项");
  });

  it("缺少 workspaceId 时应抛出异常", () => {
    expect(() => new BailianAgentStudioClient({ apiKey: "sk-test", workspaceId: "" })).toThrow("workspaceId 为必填项");
  });

  it("默认 endpoint 拼装应正确包含 workspace 与 region", () => {
    const client = new BailianAgentStudioClient({
      apiKey: "sk-test",
      workspaceId: "ws_myworkspace",
      region: "cn-beijing",
    });
    expect(client.endpoint).toBe("https://ws_myworkspace.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio");
  });

  it("支持自定义 endpoint", () => {
    const client = new BailianAgentStudioClient({
      apiKey: "sk-test",
      workspaceId: "ws_custom",
      customEndpoint: "https://my-proxy.example.com/api/v1/agentstudio/",
    });
    expect(client.endpoint).toBe("https://my-proxy.example.com/api/v1/agentstudio");
  });
});

describe("bailianPresets", () => {
  it("OpenAI 兼容 Base URL 应正确指向 DashScope", () => {
    expect(BAILIAN_DASHSCOPE_OPENAI_BASE).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("文本预设应包含 qwen-plus, qwen-max, qwen-turbo 和 deepseek 模型", () => {
    const models = BAILIAN_TEXT_MODEL_PRESETS.map((p) => p.model);
    expect(models).toContain("qwen-plus");
    expect(models).toContain("qwen-max");
    expect(models).toContain("qwen-turbo");
    expect(models).toContain("deepseek-v3");
    expect(models).toContain("deepseek-r1");
  });

  it("生图预设应包含 wanx-v1 与 qwen-image", () => {
    const models = BAILIAN_IMAGE_MODEL_PRESETS.map((p) => p.model);
    expect(models).toContain("wanx-v1");
    expect(models).toContain("qwen-image");
  });

  it("视频预设应包含万相系列", () => {
    const ids = BAILIAN_VIDEO_MODEL_PRESETS.map((p) => p.id);
    expect(ids).toContain("wan3-0-video");
    expect(ids).toContain("wan2-7-i2v");
  });

  it("buildManagedAgentsEndpoint 拼接应符合官方格式", () => {
    const ep = buildManagedAgentsEndpoint("ws_test123", "cn-beijing");
    expect(ep).toBe("https://ws_test123.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio");
  });
});

describe("Bailian OpenAPI Client Factory", () => {
  it("创建官方 OpenAPI Client 应生成有效实例", () => {
    const client = createBailianOpenApiClient({
      accessKeyId: "test-ak",
      accessKeySecret: "test-sk",
    });
    expect(client).toBeDefined();
    expect(typeof client.createAndPulishAgent).toBe("function");
  });
});
