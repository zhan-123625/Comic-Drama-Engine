import fs from "node:fs";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { dashScopeUrl, isDashScopeEndpoint, providerErrorMessage, redactProviderText } from "./dashscopeCompat.js";
import { dataDir, getDb } from "../db.js";

const undiciAgent = new Agent({ connectTimeout: 60_000, headersTimeout: 600_000 });
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;
import type { ArkVideoRatio, VideoProviderConfig } from "../config.js";
import {
  dataImageUrlDecodedApproxBytes,
  MAX_ARK_INLINE_IMAGE_BYTES,
  tryResolveUrlToArkInlineImageDataUrl,
} from "../imagePersist.js";
import { logger } from "../logger.js";
import { ModelCallFailedError } from "../modelCallError.js";
import { redactRequestHeaders, sanitizeModelRequestBody } from "../modelRequestSnapshot.js";
import { isLikelyLocalHostUrl, isLikelyPrivateLanUrl } from "../publicUrl.js";
import { stripVideoRefAttachmentNoteSuffix } from "../videoContext.js";
import type { ModelApiCallSnapshot } from "../types.js";
import { sleep } from "../utils/sleep.js";

/** A JSON-serialisable value that may be an object with nested unknown fields. */
type JsonRecord = Record<string, unknown>;

/**
 * Shape returned by video-hook provider APIs (Ark, etc.).
 * Only the fields we actually read are typed; everything else is tolerated via index signatures.
 */
type VideoHookApiResponse = JsonRecord & {
  id?: unknown;
  task_id?: unknown;
  taskId?: unknown;
  status?: unknown;
  state?: unknown;
  task_status?: unknown;
  url?: unknown;
  video_url?: unknown;
  videoUrl?: unknown;
  query_url?: unknown;
  queryUrl?: unknown;
  status_url?: unknown;
  statusUrl?: unknown;
  data?: JsonRecord & {
    status?: unknown;
    state?: unknown;
    url?: unknown;
    video_url?: unknown;
    videoUrl?: unknown;
    result?: JsonRecord & { url?: unknown; videoUrl?: unknown; video_url?: unknown };
  };
  output?: JsonRecord & { url?: unknown; video_url?: unknown; videoUrl?: unknown };
  result?: JsonRecord & { url?: unknown; video_url?: unknown; videoUrl?: unknown; status?: unknown };
  task_result?: JsonRecord & { url?: unknown; videoUrl?: unknown; video_url?: unknown; status?: unknown };
  content?: JsonRecord & { video_url?: unknown; videoUrl?: unknown };
};

const ARK_MAX_REFERENCE_IMAGES = 8;

function joinUrl(baseUrl: string, path: string) {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function resolvePostUrl(baseUrl: string): string {
  const u = baseUrl.trim();
  try {
    const parsed = new URL(u);
    if (parsed.pathname && parsed.pathname !== "/") return u.replace(/\/+$/, "");
  } catch {
    /* 非绝对 URL 时按 base + /generate */
  }
  return joinUrl(u, "/generate");
}

export function isDashScopeVideoProvider(cfg: VideoProviderConfig): boolean {
  // Model names alone must not redirect third-party gateways to Aliyun.
  return isDashScopeEndpoint(cfg.baseUrl);
}

async function resolveLocalImageBuffer(url: string): Promise<{ buf: Buffer; filename: string; mime: string } | null> {
  const u = url.trim();
  if (!u) return null;

  // 1. Data URL
  if (/^data:([^;]+);base64,/i.test(u)) {
    const m = u.match(/^data:([^;]+);base64,([\s\S]+)$/i);
    if (m) {
      const mime = m[1] || "image/png";
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
      return { buf: Buffer.from(m[2]!, "base64"), filename: `image.${ext}`, mime };
    }
  }

  // 2. Extract pathname if it's an HTTP/HTTPS URL
  let pathPart = u;
  try {
    if (/^https?:\/\//i.test(u)) {
      pathPart = new URL(u).pathname;
    }
  } catch {
    // keep pathPart
  }
  pathPart = pathPart.replace(/\/+/g, "/");

  // 3. /api/files/projects/:id/(assets|shots)/:filename
  if (pathPart.startsWith("/api/files/")) {
    const m = pathPart.match(/^\/api\/files\/projects\/([^/]+)\/(assets|shots)\/([^/]+)$/);
    if (m) {
      const abs = path.join(dataDir, "files", "projects", m[1]!, m[2]!, m[3]!);
      if (fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        const ext = path.extname(abs).replace(/^\./, "").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        return { buf, filename: path.basename(abs), mime };
      }
    }
  }

  // 4. /api/projects/:id/shots/:shotId/image (SQLite BLOB)
  const mShot = pathPart.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/image$/i);
  if (mShot) {
    const [, projectId, shotId] = mShot;
    try {
      const row = getDb()
        .prepare(`SELECT image_blob, image_mime FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`)
        .get(projectId, shotId) as { image_blob: Buffer | Uint8Array | null; image_mime: string | null } | undefined;
      if (row?.image_blob) {
        const buf = Buffer.isBuffer(row.image_blob) ? row.image_blob : Buffer.from(row.image_blob);
        if (buf.length > 0) {
          const mime = row.image_mime?.split(";")[0]?.trim() || "image/png";
          const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
          return { buf, filename: `${shotId}.${ext}`, mime };
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Direct file path on disk
  if (fs.existsSync(u)) {
    const buf = fs.readFileSync(u);
    const ext = path.extname(u).replace(/^\./, "").toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return { buf, filename: path.basename(u), mime };
  }

  return null;
}

async function uploadDashScopeOss(
  cfg: VideoProviderConfig,
  model: string,
  fileInfo: { buf: Buffer; filename: string; mime: string },
): Promise<string> {
  const apiKey = cfg.apiKey.trim();
  // 1. Try DashScope native upload policy HTTP API
  try {
    const certUrl = `${dashScopeUrl(cfg.baseUrl, "/api/v1/uploads")}?action=getPolicy&model=${encodeURIComponent(model)}`;
    const certRes = await undiciFetch(certUrl, {
      method: "GET",
      dispatcher: undiciAgent,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (certRes.ok) {
      const certJson = (await certRes.json()) as any;
      const cert = certJson?.data;
      if (cert && cert.upload_host && cert.upload_dir) {
        const ossKey = `${cert.upload_dir}/${fileInfo.filename}`;
        const form = new FormData();
        form.append("OSSAccessKeyId", cert.oss_access_key_id);
        form.append("Signature", cert.signature);
        form.append("policy", cert.policy);
        form.append("key", ossKey);
        form.append("x-oss-object-acl", cert.x_oss_object_acl);
        form.append("x-oss-forbid-overwrite", cert.x_oss_forbid_overwrite);
        form.append("success_action_status", "200");
        form.append("x-oss-content-type", fileInfo.mime || "image/png");
        form.append(
          "file",
          new Blob([new Uint8Array(fileInfo.buf)], { type: fileInfo.mime || "image/png" }),
          fileInfo.filename,
        );

        const upRes = await fetch(cert.upload_host, {
          method: "POST",
          body: form,
        });
        if (upRes.ok) {
          const ossUrl = `oss://${ossKey}`;
          logger.info("dashscope reference image uploaded to oss via native api", { ossUrl });
          return ossUrl;
        } else {
          const errText = await upRes.text().catch(() => "");
          logger.warn("dashscope native oss upload post failed", {
            status: upRes.status,
            errText: errText.slice(0, 200),
          });
        }
      }
    } else {
      logger.warn("dashscope get upload certificate failed", { status: certRes.status });
    }
  } catch (e) {
    logger.warn("dashscope native oss upload error", {
      error: redactProviderText(e instanceof Error ? e.message : String(e), apiKey),
    });
  }

  throw new Error("无法上传本地参考图至通义万相临时 OSS，请检查网络或配置图床 / MY_APP_PUBLIC_URL。");
}

async function resolveDashScopeReferenceImageUrl(
  cfg: VideoProviderConfig,
  url: string | undefined,
): Promise<string | undefined> {
  const u = (url || "").trim();
  if (!u) return undefined;
  if (u.startsWith("oss://")) return u;
  if (/^https?:\/\//i.test(u)) {
    if (!isLikelyLocalHostUrl(u) && !isLikelyPrivateLanUrl(u)) {
      return u;
    }
  }

  const model = cfg.model?.trim() || "wanx2.1-i2v-turbo";
  const fileInfo = await resolveLocalImageBuffer(u);
  if (fileInfo) {
    return await uploadDashScopeOss(cfg, model, fileInfo);
  }

  if (isLikelyLocalHostUrl(u) || isLikelyPrivateLanUrl(u) || u.startsWith("/")) {
    throw new Error(
      `参考图为本地地址（${u}），但未能找到对应的本地图片文件以自动上传至通义万相 OSS。请检查分镜图文件是否存在或配置可公网访问的图床 / MY_APP_PUBLIC_URL。`,
    );
  }

  return u;
}

async function createDashScopeVideoTask(
  cfg: VideoProviderConfig,
  input: {
    prompt: string;
    imageUrl?: string;
    imageUrls?: string[];
    aspectRatio?: string;
    durationSeconds?: number;
    audioUrl?: string;
    referenceVideoUrl?: string;
    runMode?: string;
  },
): Promise<{ id: string; modelApiCall: ModelApiCallSnapshot }> {
  const endpoint = dashScopeUrl(cfg.baseUrl, "/api/v1/services/aigc/video-generation/video-synthesis");
  const apiKey = cfg.apiKey.trim();

  const runMode = (input.runMode ?? "").trim();
  if (["multi_ref", "omni"].includes(runMode)) {
    throw new Error(
      "当前万相适配支持纯文本、首帧及首尾帧。多图/全能参考需要该模型对应的专用协议，不能静默丢弃参考素材。",
    );
  }

  const rawImage = input.imageUrl || (input.imageUrls && input.imageUrls[0]);
  let imgUrl: string | undefined;
  let lastFrameUrl: string | undefined;

  if (runMode !== "text_only") {
    if (rawImage) {
      imgUrl = await resolveDashScopeReferenceImageUrl(cfg, rawImage);
    }
    if (runMode === "first_last" && input.imageUrls && input.imageUrls.length >= 2) {
      lastFrameUrl = await resolveDashScopeReferenceImageUrl(cfg, input.imageUrls[1]);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-DashScope-Async": "enable",
  };
  if (imgUrl?.startsWith("oss://") || lastFrameUrl?.startsWith("oss://")) {
    headers["X-DashScope-OssResourceResolve"] = "enable";
  }

  const model = cfg.model.trim();

  function clampDashScopeDuration(durationSeconds?: number): number {
    const d = Math.round(Number(durationSeconds || 5));
    if (!Number.isFinite(d) || d < 1 || d > 15) throw new Error("万相视频时长必须是 1～15 秒；可用时长以具体模型为准");
    if (!/^wanx?2\.1/i.test(model)) return d;
    // Legacy 2.1 supports fixed durations; newer models receive the requested duration.
    if (d >= 8) return 10;
    return 5;
  }
  const duration = clampDashScopeDuration(input.durationSeconds);

  const body: Record<string, unknown> = {
    model,
    input: {
      prompt: input.prompt.trim(),
      ...(imgUrl ? { img_url: imgUrl } : {}),
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
    },
    parameters: {
      duration,
      ...(runMode === "text_only" || !imgUrl
        ? { size: input.aspectRatio === "9:16" ? "720*1280" : input.aspectRatio === "1:1" ? "960*960" : "1280*720" }
        : {}),
    },
  };

  logger.info("dashscope creating video task", { model, promptLen: input.prompt.length, hasImgUrl: Boolean(imgUrl) });

  const res = await undiciFetch(endpoint, {
    method: "POST",
    dispatcher: undiciAgent,
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    j = {};
  }

  const taskId = j?.output?.task_id || j?.task_id || j?.id;
  if (!res.ok || !taskId) {
    const errorMsg = providerErrorMessage(text, apiKey) || `HTTP ${res.status}`;
    const snap: ModelApiCallSnapshot = {
      capturedAt: new Date().toISOString(),
      taskKind: "video",
      routeKind: "dashscope_video_synthesis",
      method: "POST",
      requestUrl: endpoint,
      requestHeaders: redactRequestHeaders(headers),
      requestBody: sanitizeModelRequestBody(body),
      notes: [`创建任务失败: HTTP ${res.status}`, errorMsg],
    };
    throw new ModelCallFailedError(`DashScope视频任务创建失败: ${errorMsg}`, snap);
  }

  const snap: ModelApiCallSnapshot = {
    capturedAt: new Date().toISOString(),
    taskKind: "video",
    routeKind: "dashscope_video_synthesis",
    method: "POST",
    requestUrl: endpoint,
    requestHeaders: redactRequestHeaders(headers),
    requestBody: sanitizeModelRequestBody(body),
    notes: [`taskId=${String(taskId)}`, `model=${model}`, `duration=${duration}`],
  };

  return { id: String(taskId), modelApiCall: snap };
}

async function pollDashScopeVideoTask(cfg: VideoProviderConfig, taskId: string): Promise<string | null> {
  const url = dashScopeUrl(cfg.baseUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  const headers = {
    Authorization: `Bearer ${cfg.apiKey.trim()}`,
  };
  const maxRounds = 120;
  const intervalMs = 3000;

  for (let round = 1; round <= maxRounds; round++) {
    try {
      const res = await undiciFetch(url, {
        method: "GET",
        dispatcher: undiciAgent,
        headers,
      });
      if (!res.ok && [400, 401, 403, 404].includes(res.status)) {
        throw new Error(`视频生成任务失败: HTTP ${res.status} ${providerErrorMessage(await res.text(), cfg.apiKey)}`);
      }
      if (res.ok) {
        const j = (await res.json()) as any;
        const taskStatus = String(j?.output?.task_status || "").toUpperCase();
        if (taskStatus === "SUCCEEDED") {
          const videoUrl = j?.output?.video_url;
          if (videoUrl) {
            logger.info("dashscope video task succeeded", { taskId, round });
            return String(videoUrl);
          }
        }
        if (taskStatus === "FAILED" || taskStatus === "CANCELED") {
          const msg = redactProviderText(j?.output?.message || j?.message || "Task failed", cfg.apiKey);
          logger.warn("dashscope video task failed", { taskId, taskStatus, msg });
          throw new Error(`视频生成任务失败: [${taskStatus}] ${msg}`);
        }
        logger.info("dashscope video task polling", { taskId, round, taskStatus, maxRounds });
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("视频生成任务失败")) throw e;
      logger.warn("dashscope video poll transient error", {
        taskId,
        round,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (round < maxRounds) await sleep(intervalMs);
  }
  logger.warn("dashscope video task poll timeout", { taskId, maxRounds });
  return null;
}

function isArkVideoProvider(cfg: VideoProviderConfig): boolean {
  const b = (cfg.baseUrl || "").toLowerCase();
  const m = (cfg.model || "").toLowerCase();
  return b.includes("ark.") || m.includes("doubao-seedance") || m.includes("seedance");
}

/**
 * 与火山方舟「创建视频生成任务」多模态 content 约定对齐：首帧/参考图走 image_url，文本需写清
 * 「在参考画面前提下的运动、镜头与氛围」，避免模型忽略附图或乱改构图。
 * @see https://www.volcengine.com/docs/82379/1520757?lang=zh
 * 单镜时长请用请求体字段 `duration`（秒），勿依赖提示词内的「--dur」或「时长」描述。
 */
const ARK_VIDEO_REF_IMAGE_TEXT_PREFIX =
  "【首帧参考图】以下附图为本镜头起始画面（图生视频）。请严格保持画面中主体外观、服装、场景布局与整体画风一致；" +
  "在无额外说明时不要替换主体或大幅改变构图。请主要依据下方文字描述镜头运动、主体动作、表情与光影/氛围随时间的变化。";

function arkVideoPromptWithReferenceImage(prompt: string): string {
  const p = prompt.trim();
  const hint = ARK_VIDEO_REF_IMAGE_TEXT_PREFIX;
  if (!p) return hint;
  if (p.includes("【首帧参考图】")) return p;
  return `${hint}\n\n${p}`;
}

/**
 * 与 `createArkTask` 在「附带公网可拉取的参考图」时写入的 text 段一致；无可用公网图时不加此前缀。
 * 供视频提示词预览等展示最终送 Ark 的文案。
 */
export function applyArkReferenceImagePromptHint(
  cfg: VideoProviderConfig,
  prompt: string,
  imageUrlPassedToHook: string | undefined | null,
): string {
  if (!isArkVideoProvider(cfg)) return prompt;
  const u = (imageUrlPassedToHook || "").trim();
  if (!u) return prompt;
  if (/^data:image\//i.test(u) && /;base64,/i.test(u)) return arkVideoPromptWithReferenceImage(prompt);
  if (isLikelyLocalHostUrl(u)) return prompt;
  return arkVideoPromptWithReferenceImage(prompt);
}

/** 合并 imageUrls 与单张 imageUrl，去重保序，截断为方舟常见上限 */
export function mergeVideoReferenceImageUrls(input: { imageUrl?: string; imageUrls?: string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of input.imageUrls ?? []) {
    const t = (u || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  const one = (input.imageUrl || "").trim();
  if (one && !seen.has(one)) out.push(one);
  return out.slice(0, ARK_MAX_REFERENCE_IMAGES);
}

const ARK_RATIO_WHITELIST = new Set<string>(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]);

function effectiveArkRatio(cfg: VideoProviderConfig, projectAspect: string | undefined): ArkVideoRatio {
  const cfgR = cfg.arkRatio?.trim() as ArkVideoRatio | undefined;
  if (cfgR && ARK_RATIO_WHITELIST.has(cfgR)) return cfgR;
  const compact = (projectAspect ?? "").trim().replace(/\s/g, "");
  if (ARK_RATIO_WHITELIST.has(compact)) return compact as ArkVideoRatio;
  return "16:9";
}

/**
 * 仅 Seedance 1.5 Pro / 2.x 等支持「有声」；1.0 Pro/Lite 开 generate_audio 时网关易判为 r2v，与模型不兼容。
 * @see 文档与报错 task_type r2v does not support model doubao-seedance-1-0-pro
 */
function arkModelSupportsGenerateAudio(model: string | undefined): boolean {
  const m = (model ?? "").toLowerCase().replace(/_/g, "-");
  if (m.includes("seedance-2") || m.includes("seedance2")) return true;
  if (m.includes("seedance-1-5") || m.includes("seedance1-5") || m.includes("1-5-pro")) return true;
  if (/\b251215\b/.test(m) || /\b260128\b/.test(m)) return true;
  return false;
}

/** 全能参考里带 reference_video / reference_audio 时需 r2v，仅高端模型支持 */
function arkModelSupportsR2v(model: string | undefined): boolean {
  return arkModelSupportsGenerateAudio(model);
}

function inferArkTaskType(
  model: string | undefined,
  runMode: string | undefined,
  usableImageCount: number,
  input: { audioUrl?: string; referenceVideoUrl?: string },
): "t2v" | "i2v" | "r2v" {
  const rm = (runMode ?? "").trim();
  if (rm === "text_only") return "t2v";

  const hasAv = Boolean(input.referenceVideoUrl?.trim() || input.audioUrl?.trim());
  if (rm === "omni" && hasAv) {
    if (!arkModelSupportsR2v(model)) {
      throw new Error(
        "当前模型不支持全能参考中的参考视频/音频（方舟 task_type=r2v）。请改用 Seedance 1.5 Pro、2.0 等接入点，或清空该分镜的参考音/视频 URL。",
      );
    }
    return "r2v";
  }
  if (usableImageCount === 0) return "t2v";
  return "i2v";
}

/** 方舟创建任务与 `content` 同级的官方字段（task_type / ratio / duration / watermark / generate_audio / resolution） */
function buildArkSiblingFields(
  cfg: VideoProviderConfig,
  durationSeconds: number | undefined,
  ratio: ArkVideoRatio,
  opts: { taskType: "t2v" | "i2v" | "r2v"; generateAudio: boolean },
): Record<string, unknown> {
  const o: Record<string, unknown> = {
    task_type: opts.taskType,
    ratio,
    watermark: cfg.arkWatermark === true,
  };
  /** 未开启有声时不传 generate_audio（与官方 curl 一致，避免网关误判） */
  if (opts.generateAudio) o.generate_audio = true;
  if (durationSeconds != null && Number.isFinite(durationSeconds)) {
    const d = Math.round(Number(durationSeconds));
    o.duration = d >= 8 ? 10 : 5;
  }
  if (cfg.arkResolution) o.resolution = cfg.arkResolution;
  return o;
}

/** 仅「单首帧」示例带系统前缀；多图参考 / 首尾帧 / 全能与官方一致用用户文案 */
function arkTaskTextPrompt(
  cfg: VideoProviderConfig,
  basePrompt: string,
  runModeNorm: string,
  usable: string[],
): string {
  if (runModeNorm === "first_frame" && usable.length === 1) {
    return applyArkReferenceImagePromptHint(cfg, basePrompt, usable[0]);
  }
  return stripVideoRefAttachmentNoteSuffix(basePrompt);
}

/**
 * 按官方示例组装 `content`：text 无 role；仅首帧单图 image 无 role；首尾帧 first/last；
 * 多图与全能参考图为 reference_image；全能另含 video_url / audio_url 及对应 role。
 */
function buildArkMultimodalContent(
  cfg: VideoProviderConfig,
  input: {
    prompt: string;
    runMode?: string;
    audioUrl?: string;
    referenceVideoUrl?: string;
  },
  usable: string[],
): Record<string, unknown>[] {
  const runModeNorm = (input.runMode ?? "").trim();
  if (runModeNorm === "text_only") {
    return [{ type: "text", text: stripVideoRefAttachmentNoteSuffix(input.prompt) }];
  }

  const textVal = arkTaskTextPrompt(cfg, input.prompt, runModeNorm, usable);
  const content: Record<string, unknown>[] = [{ type: "text", text: textVal }];

  if (runModeNorm === "first_last") {
    if (usable.length >= 2) {
      content.push(
        { type: "image_url", image_url: { url: usable[0]! }, role: "first_frame" },
        { type: "image_url", image_url: { url: usable[1]! }, role: "last_frame" },
      );
      for (let i = 2; i < usable.length; i++) {
        content.push({ type: "image_url", image_url: { url: usable[i]! }, role: "reference_image" });
      }
    } else if (usable.length === 1) {
      content.push({ type: "image_url", image_url: { url: usable[0]! } });
    }
  } else if (runModeNorm === "first_frame") {
    /** 官方单图 i2v：仅一张分镜参考图，且不带 role */
    const u0 = usable[0];
    if (u0) content.push({ type: "image_url", image_url: { url: u0 } });
  } else {
    for (const url of usable) {
      content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
  }

  if (runModeNorm === "omni") {
    if (input.referenceVideoUrl?.trim()) {
      content.push({
        type: "video_url",
        video_url: { url: input.referenceVideoUrl.trim() },
        role: "reference_video",
      });
    }
    if (input.audioUrl?.trim()) {
      content.push({
        type: "audio_url",
        audio_url: { url: input.audioUrl.trim() },
        role: "reference_audio",
      });
    }
  }

  return content;
}

/**
 * 解析为方舟 `content[].image_url.url` 可用值：公网 URL、官方支持的 data:image/...;base64,...，
 * 或将本应用 `/api/files/...`、`/api/projects/.../shots/.../image`（及同路径的 localhost URL）读盘转为 base64。
 */
async function resolveArkReferenceImageContentUrls(rawUrls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of rawUrls.slice(0, ARK_MAX_REFERENCE_IMAGES)) {
    const u = raw.trim();
    if (!u) continue;
    if (/^data:image\//i.test(u) && /;base64,/i.test(u)) {
      if (dataImageUrlDecodedApproxBytes(u) <= MAX_ARK_INLINE_IMAGE_BYTES) out.push(u);
      continue;
    }
    if (/^https?:\/\//i.test(u)) {
      if (!isLikelyLocalHostUrl(u) && !isLikelyPrivateLanUrl(u)) {
        out.push(u);
        continue;
      }
    }
    const inlined = await tryResolveUrlToArkInlineImageDataUrl(u);
    if (inlined) out.push(inlined);
  }
  return out;
}

function resolveArkCreateUrls(baseUrl: string): string[] {
  const b = baseUrl.trim().replace(/\/+$/, "");
  const lower = b.toLowerCase();
  const hasCreatePath = lower.includes("/content_generation/tasks") || lower.includes("/contents/generations/tasks");
  if (hasCreatePath) {
    return [b];
  }
  return [
    joinUrl(b, "/contents/generations/tasks"),
    joinUrl(b, "/content_generation/tasks"),
    joinUrl(b, "/content_generation/tasks/create"),
    joinUrl(b, "/content_generation/tasks/create/"),
  ];
}

function resolveArkGetUrls(baseUrl: string, taskId: string): string[] {
  const b = baseUrl.trim().replace(/\/+$/, "");
  const lower = b.toLowerCase();
  const hasCreatePath = lower.includes("/content_generation/tasks") || lower.includes("/contents/generations/tasks");
  if (hasCreatePath) {
    const direct = `${b}/${encodeURIComponent(taskId)}`.replace(/([^:]\/)\/+/g, "$1");
    return [direct, `${b}?task_id=${encodeURIComponent(taskId)}`, `${b}?taskId=${encodeURIComponent(taskId)}`];
  }
  return [
    joinUrl(b, `/contents/generations/tasks/${encodeURIComponent(taskId)}`),
    joinUrl(b, `/content_generation/tasks/${encodeURIComponent(taskId)}`),
    joinUrl(b, `/content_generation/tasks/get?task_id=${encodeURIComponent(taskId)}`),
    joinUrl(b, `/content_generation/tasks/get?taskId=${encodeURIComponent(taskId)}`),
  ];
}

function buildArkCreateTaskSnapshot(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  requestUrl: string,
  ratio: ArkVideoRatio,
  sibling: Record<string, unknown>,
  content: Record<string, unknown>[],
  cfg: VideoProviderConfig,
  extraNotes: string[],
): ModelApiCallSnapshot {
  const notes: string[] = [...extraNotes];
  const gaNote = sibling.generate_audio === true ? "true" : "omit";
  notes.push(
    `task_type=${String(sibling.task_type)} ratio=${ratio} watermark=${String(sibling.watermark)} generate_audio=${gaNote}`,
  );
  if (cfg.arkResolution) notes.push(`resolution=${cfg.arkResolution}`);
  const imgCount = content.filter((c) => (c as { type?: string }).type === "image_url").length;
  if (imgCount)
    notes.push(`content 中含 ${imgCount} 条 image_url（仅首帧单图无 role；多图/首尾帧/全能见各模式约定）。`);
  return {
    capturedAt: new Date().toISOString(),
    taskKind: "video",
    routeKind: "ark_contents_generations_tasks",
    method: "POST",
    requestUrl,
    requestHeaders: redactRequestHeaders(headers),
    requestBody: sanitizeModelRequestBody(body),
    notes,
  };
}

async function createArkTask(
  cfg: VideoProviderConfig,
  input: {
    prompt: string;
    imageUrl?: string;
    imageUrls?: string[];
    /** 项目「视频比例」，用于方舟 `ratio`（可被 video.arkRatio 覆盖） */
    aspectRatio?: string;
    durationSeconds?: number;
    audioUrl?: string;
    referenceVideoUrl?: string;
    runMode?: string;
  },
): Promise<{ id: string; modelApiCall: ModelApiCallSnapshot }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  const runModeNorm = (input.runMode ?? "").trim();
  const mergedRaw = mergeVideoReferenceImageUrls(input);
  /** 仅首帧：与官方 i2v 一致只取第一张参考图，忽略多余 URL */
  const rawUrls = runModeNorm === "first_frame" ? mergedRaw.slice(0, 1) : mergedRaw;
  const usable = await resolveArkReferenceImageContentUrls(rawUrls);
  const anyRawButAllLocal = rawUrls.length > 0 && usable.length === 0;

  if (runModeNorm === "first_frame" && usable.length === 0) {
    throw new Error(
      "当前为「仅首帧参考」模式：需要至少一张可用参考图（公网 HTTPS URL、`data:image/...;base64,...` 或由本应用将本地分镜/资产图内联为 base64）。请配置图床、MY_APP_PUBLIC_URL，或改用「纯文本」模式。",
    );
  }
  if (rawUrls.length > 0 && usable.length === 0 && runModeNorm !== "text_only") {
    throw new Error(
      `已提供参考图地址但无法用于方舟请求（非公网 URL、非合法 data URL，且无法从本应用读盘转为 base64；单张解码后体积上限 ${Math.round(MAX_ARK_INLINE_IMAGE_BYTES / (1024 * 1024))}MB）。请检查路径、图床 HTTPS 直链，或改用「纯文本」模式。示例：${rawUrls[0] ?? ""}`,
    );
  }

  const ratio = effectiveArkRatio(cfg, input.aspectRatio);
  const taskType = inferArkTaskType(cfg.model, runModeNorm, usable.length, input);
  const audioCapable = arkModelSupportsGenerateAudio(cfg.model);
  const wantAudio = cfg.arkGenerateAudio !== false;
  const effectiveGenerateAudio = audioCapable && wantAudio;
  if (!audioCapable && wantAudio) {
    logger.info("ark video: model does not support generate_audio; forcing false to avoid r2v mismatch", {
      model: cfg.model,
    });
  }
  const sibling = buildArkSiblingFields(cfg, input.durationSeconds ?? undefined, ratio, {
    taskType,
    generateAudio: effectiveGenerateAudio,
  });
  const content = buildArkMultimodalContent(cfg, input, usable);
  const body: Record<string, unknown> = {
    model: cfg.model,
    content,
    ...sibling,
  };

  let lastStatus = 0;
  let lastText = "";
  let lastTriedUrl = "";
  for (const url of resolveArkCreateUrls(cfg.baseUrl)) {
    lastTriedUrl = url;
    try {
      const r = await undiciFetch(url, {
        dispatcher: undiciAgent,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        lastStatus = r.status;
        lastText = await r.text().catch(() => "");
        const imageDownloadFailed =
          /content\[\d+\]\.image_url|image_url/i.test(lastText) && /resource download failed/i.test(lastText);
        if (imageDownloadFailed) {
          const snap = buildArkCreateTaskSnapshot(body, headers, url, ratio, sibling, content, cfg, [
            "创建失败：方舟无法拉取参考图（resource download failed）。",
            `HTTP ${lastStatus}，响应摘要：${lastText.slice(0, 400)}`,
          ]);
          throw new ModelCallFailedError(
            `方舟无法下载参考图（HTTP ${lastStatus}），已中止，不会改为纯文本创建。请检查图床公网可达性、URL 是否需鉴权或临时链已过期，或配置 MY_APP_PUBLIC_URL。响应摘要：${lastText.slice(0, 400)}`,
            snap,
          );
        }
        continue;
      }
      const j = (await r.json()) as Record<string, unknown>;
      const id = j?.id ?? j?.task_id ?? j?.taskId;
      if (!id) {
        lastStatus = r.status;
        lastText = JSON.stringify(j);
        continue;
      }
      const tid = String(id);
      logger.info("ark video task created", {
        taskId: tid,
        model: cfg.model,
        hint: "随后按「查询视频生成任务」轮询直至 succeeded / 超时",
      });
      const gaOk = sibling.generate_audio === true ? "true" : "omit";
      const notes: string[] = [
        `taskId=${tid}`,
        "创建任务成功后由服务端轮询「查询视频生成任务」直至返回视频 URL；轮询请求的 URL/参数未单独记入本快照。",
        `task_type=${String(sibling.task_type)} ratio=${ratio} watermark=${String(sibling.watermark)} generate_audio=${gaOk}`,
      ];
      if (cfg.arkResolution) notes.push(`resolution=${cfg.arkResolution}`);
      const imgCount = content.filter((c) => (c as { type?: string }).type === "image_url").length;
      if (imgCount)
        notes.push(`content 中含 ${imgCount} 条 image_url（仅首帧单图无 role；多图/首尾帧/全能见各模式约定）。`);
      const modelApiCall: ModelApiCallSnapshot = {
        capturedAt: new Date().toISOString(),
        taskKind: "video",
        routeKind: "ark_contents_generations_tasks",
        method: "POST",
        requestUrl: url,
        requestHeaders: redactRequestHeaders(headers),
        requestBody: sanitizeModelRequestBody(body),
        notes,
      };
      return { id: tid, modelApiCall };
    } catch (e) {
      if (e instanceof ModelCallFailedError) throw e;
      lastText = e instanceof Error ? e.message : String(e);
    }
  }
  const localHint = anyRawButAllLocal && runModeNorm === "text_only" ? `（参考图 URL 不可用，本次为纯文本请求。）` : "";
  const failSnap = buildArkCreateTaskSnapshot(
    body,
    headers,
    lastTriedUrl || (cfg.baseUrl || "").trim(),
    ratio,
    sibling,
    content,
    cfg,
    [
      "创建任务失败（已尝试全部候选 URL）。",
      `末次 HTTP ${lastStatus || "(无响应)"}`,
      lastText ? `网关/客户端信息：${lastText.slice(0, 500)}` : "",
    ].filter(Boolean),
  );
  throw new ModelCallFailedError(`视频任务创建失败: ${lastStatus} ${lastText}${localHint}`.slice(0, 600), failSnap);
}

async function pollArkTask(cfg: VideoProviderConfig, taskId: string): Promise<string | null> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  const maxRounds = 40;
  const intervalMs = 3000;

  for (let round = 1; round <= maxRounds; round++) {
    let roundStatus = "";
    for (const url of resolveArkGetUrls(cfg.baseUrl, taskId)) {
      const tries: Array<() => Promise<UndiciResponse>> = [
        () => undiciFetch(url, { dispatcher: undiciAgent, method: "GET", headers, signal: AbortSignal.timeout(5000) }),
        () =>
          undiciFetch(url, {
            dispatcher: undiciAgent,
            method: "POST",
            headers,
            body: JSON.stringify({ task_id: taskId, taskId }),
            signal: AbortSignal.timeout(5000),
          }),
      ];
      for (const go of tries) {
        try {
          const r = await go();
          if (!r.ok) continue;
          const j = (await r.json().catch(() => ({}))) as VideoHookApiResponse;
          const status = String(j?.status ?? j?.data?.status ?? "").toLowerCase();
          if (status) roundStatus = status;
          const videoUrl =
            j?.url ??
            j?.video_url ??
            j?.videoUrl ??
            j?.data?.url ??
            j?.data?.video_url ??
            j?.data?.videoUrl ??
            j?.output?.url ??
            j?.output?.video_url ??
            j?.result?.url ??
            j?.result?.video_url ??
            j?.content?.video_url ??
            j?.content?.videoUrl;
          if (videoUrl) {
            logger.info("ark video task succeeded", { taskId, round, status: roundStatus || "ok" });
            return String(videoUrl);
          }
          if (status === "failed") {
            logger.warn("ark video task failed", {
              taskId,
              round,
              snippet: JSON.stringify(j).slice(0, 400),
            });
            return null;
          }
          if (status === "succeeded" && !videoUrl) return null;
        } catch {
          // ignore single probe failure
        }
      }
    }
    logger.info("ark video task polling", {
      taskId,
      round,
      maxRounds,
      status: roundStatus || "(未解析到 status，可能仍在排队/网关路径未命中)",
      waitSec: intervalMs / 1000,
      doc: "https://www.volcengine.com/docs/82379/1521309?lang=zh",
    });
    if (round < maxRounds) await sleep(intervalMs);
  }
  logger.warn("ark video task poll timeout", { taskId, maxRounds, intervalMs });
  return null;
}

function toResultPollUrls(baseUrl: string, taskId: string, hintedUrls?: string[]): string[] {
  const b = baseUrl.trim().replace(/\/+$/, "");
  const urls = new Set<string>();
  for (const h of hintedUrls ?? []) {
    const v = String(h || "").trim();
    if (v) urls.add(v);
  }
  urls.add(`${b}?task_id=${encodeURIComponent(taskId)}`);
  urls.add(`${b}?taskId=${encodeURIComponent(taskId)}`);
  urls.add(joinUrl(b, `/tasks/${encodeURIComponent(taskId)}`));
  urls.add(joinUrl(b, `/tasks/${encodeURIComponent(taskId)}/result`));
  urls.add(joinUrl(b, `/result/${encodeURIComponent(taskId)}`));
  urls.add(joinUrl(b, `/query/${encodeURIComponent(taskId)}`));
  urls.add(joinUrl(b, `/result?task_id=${encodeURIComponent(taskId)}`));
  urls.add(joinUrl(b, `/query?task_id=${encodeURIComponent(taskId)}`));
  urls.add(joinUrl(b, `/status/${encodeURIComponent(taskId)}`));
  return Array.from(urls);
}

function pickVideoUrl(j: any): string | undefined {
  return (
    j?.url ??
    j?.videoUrl ??
    j?.video_url ??
    j?.data?.url ??
    j?.data?.videoUrl ??
    j?.data?.video_url ??
    j?.output?.url ??
    j?.output?.videoUrl ??
    j?.output?.video_url ??
    j?.result?.url ??
    j?.result?.videoUrl ??
    j?.result?.video_url ??
    j?.task_result?.url ??
    j?.task_result?.videoUrl ??
    j?.task_result?.video_url ??
    j?.data?.result?.url ??
    j?.data?.result?.videoUrl ??
    j?.data?.result?.video_url
  );
}

function pickTaskState(j: any): string {
  return String(
    j?.status ??
      j?.state ??
      j?.task_status ??
      j?.data?.status ??
      j?.data?.state ??
      j?.result?.status ??
      j?.task_result?.status ??
      "",
  ).toLowerCase();
}

async function pollVideoByTaskId(
  cfg: VideoProviderConfig,
  taskId: string,
  hintedUrls?: string[],
): Promise<string | null> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  const urls = toResultPollUrls(cfg.baseUrl, taskId, hintedUrls);
  const maxRounds = 20; // ~30s，避免单镜头阻塞过久
  const intervalMs = 1500;
  const probeTimeoutMs = 2500;

  for (let round = 1; round <= maxRounds; round++) {
    let roundState = "";
    for (const u of urls) {
      // 兼容有的接口 GET，有的接口 POST 查询
      const tries: Array<() => Promise<UndiciResponse>> = [
        () =>
          undiciFetch(u, {
            dispatcher: undiciAgent,
            method: "GET",
            headers,
            signal: AbortSignal.timeout(probeTimeoutMs),
          }),
        () =>
          undiciFetch(u, {
            dispatcher: undiciAgent,
            method: "POST",
            headers,
            body: JSON.stringify({ task_id: taskId, taskId }),
            signal: AbortSignal.timeout(probeTimeoutMs),
          }),
        () =>
          undiciFetch(u, {
            dispatcher: undiciAgent,
            method: "POST",
            headers,
            body: JSON.stringify({ id: taskId }),
            signal: AbortSignal.timeout(probeTimeoutMs),
          }),
        () =>
          undiciFetch(u, {
            dispatcher: undiciAgent,
            method: "POST",
            headers,
            body: JSON.stringify({ taskId: taskId, action: "query" }),
            signal: AbortSignal.timeout(probeTimeoutMs),
          }),
        () =>
          undiciFetch(u, {
            dispatcher: undiciAgent,
            method: "POST",
            headers,
            body: JSON.stringify({ task_id: taskId, action: "query" }),
            signal: AbortSignal.timeout(probeTimeoutMs),
          }),
      ];
      for (const go of tries) {
        try {
          const r = await go();
          if (!r.ok) continue;
          const j = (await r.json().catch(() => ({}))) as VideoHookApiResponse;
          const url = pickVideoUrl(j);
          if (url) {
            logger.info("video hook async task succeeded", { taskId, round, state: roundState || pickTaskState(j) });
            return String(url);
          }
          const state = pickTaskState(j);
          if (state) roundState = state;
          if (state === "failed" || state === "error" || state === "canceled" || state === "cancelled") {
            logger.warn("video hook async task terminal", { taskId, round, state });
            return null;
          }
        } catch {
          // ignore single probe error
        }
      }
    }
    logger.info("video hook async task polling", {
      taskId,
      round,
      maxRounds,
      state: roundState || "(无明确 state)",
      waitSec: intervalMs / 1000,
    });
    if (round < maxRounds) await sleep(intervalMs);
  }
  logger.warn("video hook async task poll timeout", { taskId, maxRounds, intervalMs });
  return null;
}

/**
 * 最小化视频 provider（HTTP Hook）：
 * - 由你部署/选择的网关负责把 prompt + image 变成视频。
 * - baseUrl 可为 **完整接口地址**（含路径），或仅为 origin（将自动请求 `/generate`）。
 * - 期望返回 JSON: { url: string } 或 { videoUrl: string }
 * - 可选透传 cfg.model 到 Hook（用于指定视频生成大模型）
 * - durationSeconds：单镜时长（整秒），写入 JSON 的 `duration` / `duration_seconds` 等，与 prompt 分离（符合 Seedance 等文档）
 */
export async function generateVideoByHook(
  cfg: VideoProviderConfig,
  input: {
    prompt: string;
    imageUrl?: string;
    imageUrls?: string[];
    aspectRatio?: string;
    durationSeconds?: number;
    /** 全能参考等：参考音频 URL（由网关解析） */
    audioUrl?: string;
    /** 全能参考等：参考视频 URL */
    referenceVideoUrl?: string;
    /** 本镜模式，便于网关分支 */
    runMode?: string;
  },
): Promise<{ url: string; modelApiCall: ModelApiCallSnapshot }> {
  if (!cfg.baseUrl) throw new Error("video.baseUrl 未配置");
  if (!cfg.apiKey) throw new Error("video.apiKey 未配置");
  if (!cfg.model) throw new Error("video.model 未配置");

  const mergedUrls = mergeVideoReferenceImageUrls(input);
  const firstUrl = mergedUrls[0];
  const runModeStr = (input.runMode ?? "").trim();
  if (runModeStr === "first_frame" && mergedUrls.length === 0) {
    throw new Error(
      "「仅首帧参考」模式需要至少一张公网可拉取的参考图；当前无可用 URL。请配置 MY_APP_PUBLIC_URL / 图床，或改用「纯文本」等模式。",
    );
  }

  if (isDashScopeVideoProvider(cfg)) {
    const task = await createDashScopeVideoTask(cfg, {
      ...input,
      imageUrls: mergedUrls,
      imageUrl: firstUrl,
      durationSeconds: input.durationSeconds,
    });
    const polled = await pollDashScopeVideoTask(cfg, task.id);
    if (polled) return { url: polled, modelApiCall: task.modelApiCall };
    throw new ModelCallFailedError(`DashScope视频任务轮询超时或未返回 URL：taskId=${task.id}`.slice(0, 600), {
      ...task.modelApiCall,
      notes: [...(task.modelApiCall.notes ?? []), "轮询结束：未在时限内拿到成品视频 URL。"],
    });
  }

  if (isArkVideoProvider(cfg)) {
    const task = await createArkTask(cfg, {
      ...input,
      imageUrls: mergedUrls,
      imageUrl: undefined,
      durationSeconds: input.durationSeconds,
    });
    const polled = await pollArkTask(cfg, task.id);
    if (polled) return { url: polled, modelApiCall: task.modelApiCall };
    throw new ModelCallFailedError(`视频任务轮询超时或未返回 URL：taskId=${task.id}`.slice(0, 600), {
      ...task.modelApiCall,
      notes: [...(task.modelApiCall.notes ?? []), "轮询结束：未在时限内拿到成品视频 URL。"],
    });
  }

  const audio = input.audioUrl?.trim();
  const refVid = input.referenceVideoUrl?.trim();
  /** 有参考图 URL 时只发带图请求，不因 content 形态不兼容而改试纯文本 */
  const forbidTextFallback = mergedUrls.length > 0;

  const basePayload: Record<string, unknown> = {
    prompt: input.prompt,
    imageUrl: firstUrl,
    image_url: firstUrl,
    ...(mergedUrls.length > 1
      ? {
          imageUrls: mergedUrls,
          image_urls: mergedUrls,
          reference_image_urls: mergedUrls,
        }
      : {}),
    ...(cfg.model?.trim() ? { model: cfg.model.trim() } : {}),
    ...(input.aspectRatio?.trim()
      ? { aspectRatio: input.aspectRatio.trim(), aspect_ratio: input.aspectRatio.trim() }
      : {}),
    ...(input.durationSeconds != null && Number.isFinite(input.durationSeconds)
      ? {
          duration: Math.round(Number(input.durationSeconds)),
          duration_seconds: Math.round(Number(input.durationSeconds)),
        }
      : {}),
    ...(audio ? { audioUrl: audio, audio_url: audio, reference_audio_url: audio } : {}),
    ...(refVid ? { referenceVideoUrl: refVid, reference_video_url: refVid, video_url: refVid } : {}),
    ...(input.runMode ? { runMode: input.runMode, video_run_mode: input.runMode } : {}),
  };

  const postUrl = resolvePostUrl(cfg.baseUrl);
  const hookHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  async function post(payload: Record<string, unknown>) {
    return undiciFetch(postUrl, {
      dispatcher: undiciAgent,
      method: "POST",
      headers: hookHeaders,
      body: JSON.stringify(payload),
    });
  }

  const structuredImageContent = [
    { type: "text", text: input.prompt },
    ...mergedUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  let attemptPayloads: Array<Record<string, unknown>>;
  if (runModeStr === "text_only") {
    const p = stripVideoRefAttachmentNoteSuffix(input.prompt);
    const textBase: Record<string, unknown> = {
      prompt: p,
      ...(cfg.model?.trim() ? { model: cfg.model.trim() } : {}),
      ...(input.aspectRatio?.trim()
        ? { aspectRatio: input.aspectRatio.trim(), aspect_ratio: input.aspectRatio.trim() }
        : {}),
      ...(input.durationSeconds != null && Number.isFinite(input.durationSeconds)
        ? {
            duration: Math.round(Number(input.durationSeconds)),
            duration_seconds: Math.round(Number(input.durationSeconds)),
          }
        : {}),
      ...(input.runMode ? { runMode: input.runMode, video_run_mode: input.runMode } : {}),
    };
    attemptPayloads = [
      { ...textBase, content: p },
      { ...textBase, content: [{ type: "text", text: p }] },
    ];
  } else if (forbidTextFallback) {
    attemptPayloads = [{ ...basePayload, content: structuredImageContent }];
  } else {
    attemptPayloads = [
      { ...basePayload, content: input.prompt },
      ...(mergedUrls.length > 0 ? [{ ...basePayload, content: structuredImageContent }] : []),
      { ...basePayload, content: [{ type: "text", text: input.prompt }] },
    ];
  }

  let r: UndiciResponse | null = null;
  let lastText = "";
  let successPayload: Record<string, unknown> | null = null;
  let lastHookFailSnap: ModelApiCallSnapshot | undefined;
  for (let i = 0; i < attemptPayloads.length; i++) {
    const payload = attemptPayloads[i]!;
    const resp = await post(payload);
    r = resp;
    if (resp.ok) {
      successPayload = payload;
      break;
    }
    lastText = await resp.text().catch(() => "");
    lastHookFailSnap = {
      capturedAt: new Date().toISOString(),
      taskKind: "video",
      routeKind: "video_hook_generate",
      method: "POST",
      requestUrl: postUrl,
      requestHeaders: redactRequestHeaders(hookHeaders),
      requestBody: sanitizeModelRequestBody(payload),
      notes: [
        `尝试 ${i + 1}/${attemptPayloads.length}`,
        `HTTP ${resp.status}`,
        lastText ? lastText.slice(0, 500) : "(无响应体)",
      ],
    };
    const contentRelated = /"param"\s*:\s*"content"|`content`|content/i.test(lastText);
    if (!contentRelated) break;
  }
  if (!r || !r.ok) {
    throw new ModelCallFailedError(`视频大模型调用失败: ${r?.status ?? 0} ${lastText}`.slice(0, 600), lastHookFailSnap);
  }

  const hookModelApiCall = (extraNotes?: string[]): ModelApiCallSnapshot => ({
    capturedAt: new Date().toISOString(),
    taskKind: "video",
    routeKind: "video_hook_generate",
    method: "POST",
    requestUrl: postUrl,
    requestHeaders: redactRequestHeaders(hookHeaders),
    requestBody: sanitizeModelRequestBody(successPayload ?? basePayload),
    notes: extraNotes,
  });

  const j = (await r.json()) as VideoHookApiResponse;
  const url = pickVideoUrl(j);
  if (!url) {
    const taskId = j?.task_id ?? j?.taskId ?? j?.id;
    if (taskId) {
      logger.info("video hook async task id received", { taskId: String(taskId) });
      const hintedUrls = [
        j?.query_url,
        j?.queryUrl,
        j?.status_url,
        j?.statusUrl,
        j?.poll_url,
        j?.pollUrl,
        j?.result_url,
        j?.resultUrl,
      ].filter(Boolean) as string[];
      const polled = await pollVideoByTaskId(cfg, String(taskId), hintedUrls);
      const asyncSnap = hookModelApiCall([
        `taskId=${String(taskId)}`,
        "同步响应未含视频 URL，已按返回的 task id 轮询；轮询 URL 未单独记入。",
      ]);
      if (polled) return { url: polled, modelApiCall: asyncSnap };
      throw new ModelCallFailedError(`视频任务轮询超时或未返回 URL：taskId=${String(taskId)}`.slice(0, 600), {
        ...asyncSnap,
        notes: [...(asyncSnap.notes ?? []), "轮询结束：未在时限内拿到成品视频 URL。"],
      });
    }
    const summary = JSON.stringify(j).slice(0, 400);
    throw new ModelCallFailedError(
      `视频大模型未返回 url/videoUrl，响应摘要: ${summary}`.slice(0, 600),
      hookModelApiCall([`同步 JSON 摘要: ${summary}`]),
    );
  }
  return {
    url: String(url),
    modelApiCall: hookModelApiCall(["网关同步返回了成品视频 URL；若网关内部还有二次调用，请以网关日志为准。"]),
  };
}
