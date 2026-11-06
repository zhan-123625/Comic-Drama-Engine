type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
import { Agent, fetch as undiciFetch } from "undici";
import { formatErrorMessage } from "../errorFormat.js";
import { logger } from "../logger.js";
import { redactRequestHeaders, sanitizeModelRequestBody } from "../modelRequestSnapshot.js";
import type { ModelApiCallSnapshot } from "../types.js";
import type { GenerateImageResult } from "../imagePersist.js";
import { sleep } from "../utils/sleep.js";
import { compositeReferenceImages } from "../utils/compositeImages.js";

function parseTimeoutMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function isTransientNetworkError(detail: string): boolean {
  const s = detail.toUpperCase();
  return (
    s.includes("ECONNRESET") ||
    s.includes("ETIMEDOUT") ||
    s.includes("ECONNREFUSED") ||
    s.includes("EHOSTUNREACH") ||
    s.includes("ENETUNREACH") ||
    s.includes("UND_ERR_HEADERS_TIMEOUT") ||
    s.includes("UND_ERR_CONNECT_TIMEOUT")
  );
}

/** 全局 HTTP 调度器：拉长 headers/body 超时，缓解方舟等接口首包慢导致的 UND_ERR_HEADERS_TIMEOUT */
let llmHttpDispatcher: Agent | undefined;
function getLlmHttpDispatcher(): Agent {
  if (!llmHttpDispatcher) {
    const connectTimeout = parseTimeoutMs("MY_APP_HTTP_CONNECT_TIMEOUT_MS", 60_000);
    const headersTimeout = parseTimeoutMs("MY_APP_HTTP_HEADERS_TIMEOUT_MS", 600_000);
    const bodyMs = parseTimeoutMs("MY_APP_HTTP_BODY_TIMEOUT_MS", 0);
    llmHttpDispatcher = new Agent({
      connectTimeout,
      headersTimeout,
      ...(bodyMs > 0 ? { bodyTimeout: bodyMs } : { bodyTimeout: 0 }),
    });
  }
  return llmHttpDispatcher;
}

async function httpFetch(input: string | URL, init?: RequestInit) {
  const dispatcher = getLlmHttpDispatcher();
  return undiciFetch(input, { ...(init as Record<string, unknown>), dispatcher });
}

type UndiciHttpResponse = Awaited<ReturnType<typeof undiciFetch>>;

function must(v: string | undefined, name: string): string {
  if (!v) throw new Error(`${name} 未配置`);
  return v;
}

function joinUrl(baseUrl: string, path: string) {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function normalizePathname(v: string): string {
  return v.replace(/\/+$/, "").toLowerCase();
}

/**
 * 兼容三种 baseUrl 写法：
 * 1) 仅域名: https://host
 * 2) API 前缀: https://host/v1
 * 3) 完整 endpoint: https://host/v1/images/generations
 */
function resolveEndpointUrl(baseUrl: string, endpointPath: string): string {
  const trimmed = baseUrl.trim();
  const ep = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  const epNorm = normalizePathname(ep);
  try {
    const u = new URL(trimmed);
    const pn = normalizePathname(u.pathname || "/");
    if (pn === epNorm || pn.endsWith(epNorm)) return trimmed.replace(/\/+$/, "");
  } catch {
    // 非绝对 URL 时退化为拼接
  }
  return joinUrl(trimmed, ep);
}

function shortEndpointHint(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || "/";
    const p = path.length > 56 ? `${path.slice(0, 56)}…` : path;
    return `${u.origin}${p}`;
  } catch {
    return "（Base URL 无效）";
  }
}

export async function chatComplete(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  _continuationDepth?: number;
}) {
  const baseUrl = must(opts.baseUrl, "text.baseUrl");
  const apiKey = must(opts.apiKey, "text.apiKey");
  const model = must(opts.model, "text.model");
  const retryTimes = parseTimeoutMs("MY_APP_HTTP_RETRY_TIMES", 2);
  const retryBaseDelayMs = parseTimeoutMs("MY_APP_HTTP_RETRY_BASE_DELAY_MS", 800);
  const maxTokens = opts.max_tokens ?? parseTimeoutMs("MY_APP_LLM_MAX_TOKENS", 8192);

  const endpointUrl = resolveEndpointUrl(baseUrl, "/chat/completions");
  let r: UndiciHttpResponse;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await httpFetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: maxTokens,
          enable_thinking: process.env.MY_APP_ENABLE_THINKING === "1" || process.env.MY_APP_ENABLE_THINKING === "true",
        }),
      });
      break;
    } catch (e) {
      const detail = formatErrorMessage(e, 800);
      const canRetry = isTransientNetworkError(detail) && attempt < retryTimes;
      logger.warn("text model fetch failed", {
        model,
        baseUrl,
        endpoint: shortEndpointHint(endpointUrl),
        detail,
        attempt: attempt + 1,
        retryTimes,
        willRetry: canRetry,
      });
      if (!canRetry) {
        throw new Error(
          `文本模型连接失败（${shortEndpointHint(endpointUrl)}）：${detail}。请检查「设置」里 text Base URL 是否可达、是否需代理（HTTP(S)_PROXY）、防火墙与 DNS；若首包很慢可用环境变量 MY_APP_HTTP_HEADERS_TIMEOUT_MS 加大等待（默认 600000ms）。`.slice(
            0,
            1200,
          ),
        );
      }
      const waitMs = Math.max(100, retryBaseDelayMs * (attempt + 1));
      await sleep(waitMs);
    }
  }

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    logger.warn("text model request failed", { status: r.status, model, baseUrl });
    throw new Error(`文本模型请求失败: ${r.status} ${t}`.slice(0, 600));
  }
  const j = (await r.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };
  const choice = j?.choices?.[0];
  let text = choice?.message?.content;
  if (!text) {
    const reasoning = (choice?.message as { reasoning_content?: string })?.reasoning_content;
    if (reasoning && reasoning.trim()) {
      logger.warn("文本模型 content 为空但包含 reasoning_content，降级使用推理结果", { model });
      text = reasoning;
    } else {
      throw new Error("文本模型未返回 content");
    }
  }

  let fullText = String(text);
  const depth = opts._continuationDepth ?? 0;
  if (choice?.finish_reason === "length" && depth < 2) {
    logger.warn("文本模型输出触顶截断，正在自动续接未完内容...", {
      model,
      maxTokens,
      currentLength: fullText.length,
      depth,
    });
    try {
      const continuation = await chatComplete({
        ...opts,
        messages: [
          ...opts.messages,
          { role: "assistant", content: fullText },
          { role: "user", content: "请紧接上文继续输出未完成的内容，不要重复已输出的内容，直接从截断处继续输出：" },
        ],
        _continuationDepth: depth + 1,
      });
      if (continuation) {
        fullText += continuation;
        logger.info("文本模型自动续接成功", {
          model,
          newTotalLength: fullText.length,
        });
      }
    } catch (contErr) {
      logger.warn("自动续写失败，使用截断前内容", { error: String(contErr) });
    }
  }

  return fullText;
}

const debugLlm = process.env.MY_APP_DEBUG_LLM === "1" || process.env.MY_APP_DEBUG_LLM === "true";

/**
 * 参考图写入规则：
 * - 默认写入字段名 `image`（火山方舟 Seedream / 豆包等多模态生图常见约定，见文档）。
 * - 设 `MY_APP_IMAGE_REFERENCE_FIELD` 可覆盖字段名；设 `MY_APP_IMAGE_REFERENCE_MODE=off`（或 `false`/`0`）则即使有参考图也不写入请求体。
 */
function mergeReferenceImagesIntoBody(body: Record<string, unknown>, referenceDataUrls?: string[]) {
  if (!referenceDataUrls?.length) return;
  const mode = process.env.MY_APP_IMAGE_REFERENCE_MODE?.trim().toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") return;
  const explicitField = process.env.MY_APP_IMAGE_REFERENCE_FIELD?.trim();
  const refField = explicitField || "image";
  body[refField] = referenceDataUrls.length === 1 ? referenceDataUrls[0]! : referenceDataUrls;
  if (!explicitField && referenceDataUrls.length > 1) {
    body["images"] = referenceDataUrls;
  }
}

function buildImageGenerationBody(
  model: string,
  prompt: string,
  size: string,
  referenceDataUrls?: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt, size };
  mergeReferenceImagesIntoBody(body, referenceDataUrls);
  return body;
}

function snapshotImageCall(
  requestUrl: string,
  body: Record<string, unknown>,
  rawHeaders: Record<string, string>,
): ModelApiCallSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    taskKind: "image",
    routeKind: "openai_images_generations",
    method: "POST",
    requestUrl,
    requestHeaders: redactRequestHeaders(rawHeaders),
    requestBody: sanitizeModelRequestBody(body),
  };
}

export function toDashScopeImageSize(size: string | undefined): string {
  if (!size) return "1024*1024";
  const s = size.trim().replace(/[xX]/g, "*");
  const [wStr, hStr] = s.split("*");
  const w = parseInt(wStr, 10);
  const h = parseInt(hStr, 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "1024*1024";

  if (w >= 512 && w <= 1440 && h >= 512 && h <= 1440) {
    return `${w}*${h}`;
  }

  const ratio = w / h;
  if (ratio > 1.2) {
    return "1280*720";
  } else if (ratio < 0.8) {
    return "720*1280";
  } else {
    return "1024*1024";
  }
}

function isDashScopeImage(baseUrl: string): boolean {
  return baseUrl.includes("dashscope.aliyuncs.com");
}

export async function uploadDashScopeImageOss(
  apiKey: string,
  model: string,
  buffer: Buffer,
  filename = "ref.png",
  mime = "image/png",
): Promise<string> {
  const cleanKey = apiKey.trim();
  // 1. Try native DashScope upload policy HTTP API
  try {
    const certUrl = `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`;
    const certRes = await httpFetch(certUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });
    if (certRes.ok) {
      const certJson = (await certRes.json()) as any;
      const cert = certJson?.data;
      if (cert && cert.upload_host && cert.upload_dir) {
        const ossKey = `${cert.upload_dir}/${filename}`;
        const form = new FormData();
        form.append("OSSAccessKeyId", cert.oss_access_key_id);
        form.append("Signature", cert.signature);
        form.append("policy", cert.policy);
        form.append("key", ossKey);
        form.append("x-oss-object-acl", cert.x_oss_object_acl);
        form.append("x-oss-forbid-overwrite", cert.x_oss_forbid_overwrite);
        form.append("success_action_status", "200");
        form.append("Content-Type", mime);
        form.append("x-oss-content-type", mime);
        form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);

        const upRes = await fetch(cert.upload_host, {
          method: "POST",
          body: form,
        });
        if (upRes.ok) {
          const ossUrl = `oss://${ossKey}`;
          logger.info("dashscope image reference uploaded to oss via native api", { ossUrl });
          return ossUrl;
        }
      }
    }
  } catch (e) {
    logger.warn("dashscope native image oss upload failed", { err: String(e) });
  }

  // 2. Fallback to python check_and_upload_local if available
  try {
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const tmpFile = path.join(os.tmpdir(), `ds_img_ref_${Date.now()}_${filename}`);
    fs.writeFileSync(tmpFile, buffer);
    try {
      const pyScript =
        "import sys\nfrom dashscope.utils.oss_utils import check_and_upload_local\nis_up, url, cert = check_and_upload_local(sys.argv[1], sys.argv[2], sys.argv[3])\nprint(url)\n";
      const { stdout } = await execFileAsync("python", ["-c", pyScript, model, tmpFile, cleanKey]);
      const ossUrl = stdout.trim();
      if (ossUrl.startsWith("oss://")) {
        logger.info("dashscope image reference uploaded to oss via python", { ossUrl });
        return ossUrl;
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }
  } catch (pyErr) {
    logger.warn("dashscope python oss upload for image failed", { err: String(pyErr) });
  }

  return "";
}

async function generateImageDashScope(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  referenceDataUrls?: string[];
  refStrength?: number;
  promptExtend?: boolean;
}): Promise<GenerateImageResult> {
  let model = opts.model.trim();
  if (model === "qwen-image") {
    model = "wanx2.1-t2i-plus";
  }

  const dsSize = toDashScopeImageSize(opts.size);
  const createEndpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
    "X-DashScope-Async": "enable",
  };

  let resolvedPrompt = opts.prompt;
  let refImg: string | undefined;

  // 无论模型是 wanx2.1 系列还是 wanx-v1，只要有参考图均通过 DashScope OSS 上传作为 ref_img 垫图注入
  if (opts.referenceDataUrls?.length) {
    const composited = await compositeReferenceImages(opts.referenceDataUrls);
    if (composited) {
      if (composited.startsWith("data:")) {
        const m = composited.match(/^data:([^;]+);base64,(.+)$/i);
        if (m && m[2]) {
          const buf = Buffer.from(m[2], "base64");
          const ossUrl = await uploadDashScopeImageOss(opts.apiKey, model, buf, "ref_composite.png", m[1] || "image/png");
          if (ossUrl) {
            refImg = ossUrl;
          }
        }
      } else if (
        composited.startsWith("http://") ||
        composited.startsWith("https://") ||
        composited.startsWith("oss://")
      ) {
        refImg = composited;
      }

      if (refImg) {
        logger.info("attached reference image to DashScope image synthesis", {
          model,
          inputImageCount: opts.referenceDataUrls.length,
          refImg: refImg.startsWith("oss://") ? refImg : refImg.slice(0, 80),
        });
        resolvedPrompt =
          "【参考图视觉锚定】：已提供出镜主体视觉参考图。请依据参考图保持角色的五官相貌、体态服饰、发型与关键道具特征一致。严禁照抄参考图的三视图（正面/侧面/背面）排版、纯色白底背景或多图拼贴！必须严格绘制出具体的自然环境背景与生动的剧情画面！\n\n" +
          resolvedPrompt;
      }
    }
  }

  const input: Record<string, unknown> = {
    prompt: resolvedPrompt,
  };
  if (refImg) {
    input.ref_img = refImg;
    if (refImg.startsWith("oss://")) {
      reqHeaders["X-DashScope-OssResourceResolve"] = "enable";
    }
  }

  const parameters: Record<string, unknown> = {
    size: dsSize,
    n: 1,
  };
  if (refImg) {
    const envStrength = Number(process.env.MY_APP_WANX_REF_STRENGTH);
    const resolvedStrength =
      typeof opts.refStrength === "number" && Number.isFinite(opts.refStrength)
        ? Math.min(Math.max(opts.refStrength, 0), 1)
        : Number.isFinite(envStrength) && envStrength >= 0 && envStrength <= 1
          ? envStrength
          : 1.0;
    parameters.ref_strength = resolvedStrength;
    parameters.ref_mode = "refonly";

    const envExtend = process.env.MY_APP_WANX_PROMPT_EXTEND;
    const resolvedExtend =
      typeof opts.promptExtend === "boolean"
        ? opts.promptExtend
        : envExtend !== undefined
          ? envExtend === "true" || envExtend === "1"
          : false;
    parameters.prompt_extend = resolvedExtend;
  }

  const bodyUsed = {
    model,
    input,
    parameters,
  };

  logger.info("submitting DashScope image synthesis task", { model, size: dsSize, hasRefImg: Boolean(refImg) });
  let r: UndiciHttpResponse;
  try {
    r = await httpFetch(createEndpoint, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(bodyUsed),
    });
  } catch (e) {
    const detail = formatErrorMessage(e, 800);
    logger.warn("DashScope image task submission failed", { model, detail });
    throw new Error(`通义万相生图任务提交失败：${detail}`);
  }

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    logger.warn("DashScope image request rejected", { status: r.status, model, detail: t });
    throw new Error(`通义万相生图接口拒绝: ${r.status} ${t}`.slice(0, 600));
  }

  const createJson = (await r.json()) as { output?: { task_id?: string; message?: string } };
  const taskId = createJson?.output?.task_id;
  if (!taskId) {
    throw new Error(`通义万相生图未返回 task_id: ${JSON.stringify(createJson)}`.slice(0, 400));
  }

  const pollUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  const pollHeaders = { Authorization: `Bearer ${opts.apiKey}` };
  const maxPolls = 45;

  for (let poll = 1; poll <= maxPolls; poll++) {
    await sleep(2000);
    let pollRes: UndiciHttpResponse;
    try {
      pollRes = await httpFetch(pollUrl, { headers: pollHeaders });
    } catch {
      logger.warn("DashScope image poll connection error, will retry", { poll, taskId });
      continue;
    }

    if (!pollRes.ok) continue;

    const pollJson = (await pollRes.json()) as {
      output?: {
        task_status?: string;
        results?: Array<{ url?: string }>;
        message?: string;
        code?: string;
      };
    };

    const status = pollJson?.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = pollJson.output?.results?.[0]?.url;
      if (!url) throw new Error("通义万相任务已完成，但未返回图片 URL");
      logger.info("DashScope image synthesis succeeded", { model, taskId, durationPolls: poll });
      const modelApiCall = snapshotImageCall(createEndpoint, bodyUsed, reqHeaders);
      return { kind: "url" as const, url, modelApiCall };
    }

    if (status === "FAILED") {
      const errMsg = pollJson.output?.message || pollJson.output?.code || "未知错误";
      logger.warn("DashScope image synthesis task failed", { model, taskId, errMsg });
      throw new Error(`通义万相生图任务执行失败: ${errMsg}`);
    }
  }

  throw new Error("通义万相生图超时（等待超过 90 秒）");
}

export async function generateImage(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  /**
   * 参考图：data URL（`data:image/...;base64,...`）或 https URL。
   * 有参考图时默认写入请求体字段 `image`（可用 `MY_APP_IMAGE_REFERENCE_FIELD` 覆盖；`MY_APP_IMAGE_REFERENCE_MODE=off` 关闭写入）。
   * 分镜生图会将匹配资产的本地 `/api/files/...`、分镜图 `/api/projects/.../shots/.../image` 读成 data URL 一并提交。
   */
  referenceDataUrls?: string[];
  refStrength?: number;
  promptExtend?: boolean;
}) {
  const baseUrl = must(opts.baseUrl, "image.baseUrl");
  const apiKey = must(opts.apiKey, "image.apiKey");
  const model = must(opts.model, "image.model");
  const minPixels = 3_686_400;
  const requestedSize = opts.size ?? "1024x1024";

  if (isDashScopeImage(baseUrl)) {
    return generateImageDashScope({
      apiKey,
      model,
      prompt: opts.prompt,
      size: requestedSize,
      referenceDataUrls: opts.referenceDataUrls,
      refStrength: opts.refStrength,
      promptExtend: opts.promptExtend,
    });
  }

  function parseSize(size: string): { w: number; h: number } | null {
    const m = size.match(/^(\d+)x(\d+)$/i);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  }

  function upscaleToMinPixels(size: string): string {
    const p = parseSize(size);
    if (!p) return size;
    const pixels = p.w * p.h;
    if (pixels >= minPixels) return size;
    const scale = Math.sqrt(minPixels / pixels);
    const w = Math.max(64, Math.ceil((p.w * scale) / 64) * 64);
    const h = Math.max(64, Math.ceil((p.h * scale) / 64) * 64);
    return `${w}x${h}`;
  }

  function isMinPixelsError(msg: string): boolean {
    return /at least\s+3686400\s+pixels/i.test(msg);
  }

  let referenceDataUrls = opts.referenceDataUrls;
  if (referenceDataUrls && referenceDataUrls.length > 1) {
    try {
      const composited = await compositeReferenceImages(referenceDataUrls);
      if (composited) {
        referenceDataUrls = [composited];
      }
    } catch (compErr) {
      logger.warn("failed to composite reference images for openai-compat image model", { err: String(compErr) });
    }
  }

  const t0 = debugLlm ? performance.now() : 0;
  let size: string = requestedSize;
  const imageEndpoint = resolveEndpointUrl(baseUrl, "/images/generations");
  const reqHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  let resolvedPrompt = opts.prompt;
  if (referenceDataUrls?.length && !resolvedPrompt.includes("【参考图视觉锚定")) {
    resolvedPrompt =
      "【参考图视觉锚定（最高准则）】：已提供出镜主体视觉参考图。请依据参考图保持角色的物种外形、五官相貌、体态服饰与关键道具特征完全一致，严禁擅自改变主体形象！\n\n" +
      resolvedPrompt;
  }
  let bodyUsed = buildImageGenerationBody(model, resolvedPrompt, size, referenceDataUrls);
  let r: UndiciHttpResponse;
  try {
    r = await httpFetch(imageEndpoint, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(bodyUsed),
    });
  } catch (e) {
    const detail = formatErrorMessage(e, 800);
    logger.warn("image model fetch failed", { model, baseUrl, endpoint: shortEndpointHint(imageEndpoint), detail });
    throw new Error(
      `生图接口连接失败（${shortEndpointHint(imageEndpoint)}）：${detail}。请检查 image Base URL 与网络。`.slice(
        0,
        1200,
      ),
    );
  }

  if (!r.ok) {
    let t = await r.text().catch(() => "");
    if (r.status === 400 && isMinPixelsError(t)) {
      const upgraded = upscaleToMinPixels(size);
      if (upgraded !== size) {
        logger.warn("image size too small, retry with upgraded size", {
          model,
          oldSize: size,
          newSize: upgraded,
        });
        size = upgraded;
        bodyUsed = buildImageGenerationBody(model, opts.prompt, size, referenceDataUrls);
        try {
          r = await httpFetch(imageEndpoint, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify(bodyUsed),
          });
        } catch (e) {
          const detail = formatErrorMessage(e, 800);
          logger.warn("image model fetch failed (retry)", {
            model,
            baseUrl,
            endpoint: shortEndpointHint(imageEndpoint),
            detail,
          });
          throw new Error(
            `生图接口连接失败（${shortEndpointHint(imageEndpoint)}）：${detail}。请检查 image Base URL 与网络。`.slice(
              0,
              1200,
            ),
          );
        }
        if (!r.ok) t = await r.text().catch(() => "");
      }
    }
    if (!r.ok) {
      if (debugLlm)
        logger.debug("image model request", {
          model,
          status: r.status,
          durationMs: Math.round(performance.now() - t0),
          size,
        });
      let hint = "";
      if (r.status === 404) {
        if (imageEndpoint.includes("dashscope.aliyuncs.com")) {
          hint =
            "【排查提示：阿里云百炼 DashScope 仅提供 /chat/completions 对话兼容，官方未开放兼容模式的 /images/generations 生图端点。请在「设置」页为生图配置支持 OpenAI /images/generations 规范的生图提供商（如火山方舟 Seedream、硅基流动 SiliconFlow 或智谱 BigModel）】";
        } else {
          hint = `【排查提示：生图接口 ${shortEndpointHint(imageEndpoint)} 返回 404，请确认服务商是否支持 /images/generations】`;
        }
      }
      throw new Error(`生图请求失败: ${r.status} ${hint} ${t}`.slice(0, 800));
    }
  }
  if (debugLlm)
    logger.debug("image model request", {
      model,
      status: r.status,
      durationMs: Math.round(performance.now() - t0),
      size,
    });
  const j = (await r.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const url = j?.data?.[0]?.url;
  const b64 = j?.data?.[0]?.b64_json;
  const modelApiCall = snapshotImageCall(imageEndpoint, bodyUsed, reqHeaders);
  if (url) return { kind: "url" as const, url: String(url), modelApiCall };
  if (b64) return { kind: "base64" as const, dataUrl: `data:image/png;base64,${String(b64)}`, modelApiCall };
  throw new Error("生图接口未返回 url/b64_json");
}
