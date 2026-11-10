import { dashScopeUrl, providerErrorMessage } from "./dashscopeCompat.js";
import type { GenerateImageResult } from "../imagePersist.js";
import { redactRequestHeaders, sanitizeModelRequestBody } from "../modelRequestSnapshot.js";
import { sleep } from "../utils/sleep.js";

type ImageResponse = {
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
    results?: { url?: string }[];
    choices?: { message?: { content?: { image?: string }[] } }[];
  };
};
type ImageFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export async function generateDashScopeMultimodalImage(
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    size?: string;
    referenceDataUrls?: string[];
    promptExtend?: boolean;
  },
  httpFetch: ImageFetch,
): Promise<GenerateImageResult> {
  const endpoint = dashScopeUrl(opts.baseUrl, "/api/v1/services/aigc/multimodal-generation/generation");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };
  const body = {
    model: opts.model,
    input: {
      messages: [
        {
          role: "user",
          content: [
            ...(opts.referenceDataUrls ?? []).filter(Boolean).map((image) => ({ image })),
            { text: opts.prompt },
          ],
        },
      ],
    },
    parameters: {
      size: (opts.size ?? "1024x1024").replace(/x/i, "*"),
      n: 1,
      ...(opts.promptExtend !== undefined ? { prompt_extend: opts.promptExtend } : {}),
    },
  };
  async function request(url: string, init: RequestInit): Promise<ImageResponse> {
    const response = await httpFetch(url, init);
    const text = await response.text();
    if (!response.ok)
      throw new Error(`千问生图请求失败: ${response.status} ${providerErrorMessage(text, opts.apiKey)}`);
    let j: ImageResponse;
    try {
      j = JSON.parse(text) as ImageResponse;
    } catch {
      throw new Error("千问生图接口返回的不是 JSON");
    }
    if (j.code) throw new Error(`千问生图失败: ${providerErrorMessage(text, opts.apiKey)}`);
    return j;
  }
  let j = await request(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const taskId = j.output?.task_id;
  if (taskId) {
    for (let i = 0; i < 120; i++) {
      await sleep(2000);
      j = await request(dashScopeUrl(opts.baseUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`), { headers });
      if (["FAILED", "CANCELED", "CANCELLED"].includes(j.output?.task_status ?? "")) {
        throw new Error(`千问生图任务失败: ${providerErrorMessage(JSON.stringify(j), opts.apiKey)}`);
      }
      if (j.output?.task_status === "SUCCEEDED") break;
      if (i === 119) throw new Error("千问生图轮询超时，请到服务商控制台检查任务状态");
    }
  }
  const url =
    j.output?.choices?.flatMap((c) => c.message?.content ?? []).find((c) => c.image)?.image ??
    j.output?.results?.[0]?.url;
  if (!url) throw new Error("千问生图接口未返回图片；请检查模型是否支持当前输入格式");
  const modelApiCall = {
    capturedAt: new Date().toISOString(),
    taskKind: "image" as const,
    routeKind: "dashscope_multimodal_image",
    method: "POST",
    requestUrl: endpoint,
    requestHeaders: redactRequestHeaders(headers),
    requestBody: sanitizeModelRequestBody(body),
  };
  if (url.startsWith("data:")) return { kind: "base64", dataUrl: url, modelApiCall };
  return { kind: "url", url, modelApiCall };
}
