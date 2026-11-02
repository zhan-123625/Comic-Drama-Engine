import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetItem, ModelApiCallSnapshot, StoryboardShot } from "./types.js";
import { dataDir, getDb } from "./db.js";
import { logger } from "./logger.js";
import { backoffDelay, isRetryableHttpStatus, sleep } from "./utils/retry.js";
import { validateUrlSafety } from "./utils/ssrfCheck.js";

export type GenerateImageResult =
  | { kind: "url"; url: string; modelApiCall?: ModelApiCallSnapshot }
  | { kind: "base64"; dataUrl: string; modelApiCall?: ModelApiCallSnapshot };

function extByMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "bin";
}

async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<Response> {
  const retries = Math.max(0, Math.floor(opts?.retries ?? 2));
  const timeoutMs = Math.max(1000, Math.floor(opts?.timeoutMs ?? 15000));
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetch(input, { ...(init || {}), signal });
      if (!isRetryableHttpStatus(res.status) || attempt >= retries) return res;
      await sleep(backoffDelay(attempt, { baseDelayMs: 300, maxDelayMs: 4000, jitterRatio: 0.3 }));
      continue;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      await sleep(backoffDelay(attempt, { baseDelayMs: 300, maxDelayMs: 4000, jitterRatio: 0.3 }));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("fetchWithRetry failed");
}

/** 与 `saveProjectImageFile` 落盘文件名一致：`{id}.{ext}` */
export function projectStoredImageFilename(id: string, mime: string): string {
  return `${id}.${extByMime(mime)}`;
}

function fileRoot(): string {
  return path.join(dataDir, "files", "projects");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SHOT_FILE_EXT_RE = "\\.(?:png|jpe?g|webp|gif)$";

/** 将磁盘上该镜头的历史文件（主文件 uuid.ext 与 uuid-<时间戳>.ext）解析为可访问 URL，按修改时间新→旧 */
export async function listShotImageFileUrlsFromDisk(projectId: string, shotId: string): Promise<string[]> {
  const dir = path.join(fileRoot(), projectId, "shots");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${escapeRegExp(shotId)}(?:-\\d+)?${SHOT_FILE_EXT_RE}`, "i");
  const matched = names.filter((n) => re.test(n));
  if (!matched.length) return [];
  const withStats = await Promise.all(
    matched.map(async (filename) => {
      const abs = path.join(dir, filename);
      try {
        const st = await stat(abs);
        return { filename, mtime: st.mtimeMs, url: `/api/files/projects/${projectId}/shots/${filename}` };
      } catch {
        return null;
      }
    }),
  );
  const rows = withStats.filter((x): x is NonNullable<typeof x> => x != null);
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.map((r) => r.url);
}

/** 多次生图前：若已有主文件 uuid.<ext>，先改名为 uuid-<时间戳>.<ext>，避免覆盖丢失历史 */
async function archiveExistingShotPrimaryFiles(projectId: string, shotId: string): Promise<void> {
  const dir = path.join(fileRoot(), projectId, "shots");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const primaryRe = new RegExp(`^${escapeRegExp(shotId)}${SHOT_FILE_EXT_RE}`, "i");
  const primary = names.find((n) => primaryRe.test(n));
  if (!primary) return;
  const from = path.join(dir, primary);
  const ext = path.extname(primary);
  const archived = path.join(dir, `${shotId}-${Date.now()}${ext}`);
  try {
    await rename(from, archived);
  } catch {
    /* ignore */
  }
}

/** 将 `/api/files/projects/{id}/assets|shots/文件名` 读成 data URL，供部分支持参考图的生图接口使用 */
export async function readProjectPublicFileAsDataUrl(projectId: string, publicUrl: string): Promise<string | null> {
  const u = publicUrl.trim().replace(/\/+/g, "/");
  const m = u.match(/^\/api\/files\/projects\/([^/]+)\/(assets|shots)\/([^/]+)$/);
  if (!m || m[1] !== projectId) return null;
  const kind = m[2] as "assets" | "shots";
  const filename = m[3]!;
  const abs = path.join(fileRoot(), projectId, kind, filename);
  try {
    const buf = await readFile(abs);
    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * 将项目内可访问的图片 URL 读成 data URL，供生图参考图等多模态请求内联提交。
 * 支持：`/api/files/projects/{id}/assets|shots/...`、`/api/projects/{id}/shots/{shotId}/image`（库内 BLOB）。
 */
export async function readLocalProjectImageUrlAsDataUrl(projectId: string, publicUrl: string): Promise<string | null> {
  const u = publicUrl.trim().replace(/\/+/g, "/");
  if (u.startsWith("/api/files/")) {
    return readProjectPublicFileAsDataUrl(projectId, u);
  }
  const m = u.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/image$/);
  if (!m || m[1] !== projectId) return null;
  const shotId = m[2]!;
  const row = getDb()
    .prepare(`SELECT image_blob, image_mime FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`)
    .get(projectId, shotId) as { image_blob: Buffer | Uint8Array | null; image_mime: string | null } | undefined;
  if (!row?.image_blob) return null;
  const buf = Buffer.isBuffer(row.image_blob) ? row.image_blob : Buffer.from(row.image_blob);
  if (!buf.length) return null;
  const mime = row.image_mime?.split(";")[0]?.trim() || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** 方舟等接口内联 `data:image/...;base64,...` 时，解码后体积上限（避免 JSON 过大） */
export const MAX_ARK_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

/** 估算 data URL 中 base64 解码后字节数（用于体积校验） */
export function dataImageUrlDecodedApproxBytes(dataUrl: string): number {
  const s = dataUrl.trim();
  const idx = s.indexOf(";base64,");
  if (idx < 0) return Number.POSITIVE_INFINITY;
  const b64 = s.slice(idx + 8).replace(/\s/g, "");
  if (!b64.length) return 0;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * 将应用内可解析的本地图片 URL（`/api/files/...`、`/api/projects/.../shots/.../image` 或同路径的 http(s) 绝对地址）
 * 转为官方支持的 `data:image/...;base64,...`，供方舟「创建视频任务」内联传图（无需公网拉图）。
 */
export async function tryResolveUrlToArkInlineImageDataUrl(rawUrl: string): Promise<string | null> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let pathPart = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      pathPart = new URL(trimmed).pathname;
    }
  } catch {
    return null;
  }
  pathPart = pathPart.replace(/\/+/g, "/");
  if (!pathPart.startsWith("/api/")) return null;

  const pidFiles = pathPart.match(/^\/api\/files\/projects\/([^/]+)\//);
  const pidShot = pathPart.match(/^\/api\/projects\/([^/]+)\/shots\/[^/]+\/image$/i);
  const projectId = pidFiles?.[1] ?? pidShot?.[1];
  if (!projectId) return null;

  const dataUrl = await readLocalProjectImageUrlAsDataUrl(projectId, pathPart);
  if (!dataUrl) return null;
  if (dataImageUrlDecodedApproxBytes(dataUrl) > MAX_ARK_INLINE_IMAGE_BYTES) return null;
  return dataUrl;
}

/**
 * 读取当前分镜展示图原始字节，供上传图床等使用。
 * 支持：`/api/files/.../shots/...`、`/api/projects/.../shots/{id}/image`、http(s) 外链。
 */
export async function readStoryboardShotImageBuffer(
  projectId: string,
  shot: StoryboardShot,
): Promise<{ buf: Buffer; filename: string } | null> {
  const u = shot.imageUrl?.trim().replace(/\/+/g, "/") || "";
  if (!u) return null;

  if (u.startsWith("/api/files/")) {
    const m = u.match(/^\/api\/files\/projects\/([^/]+)\/(assets|shots)\/([^/]+)$/);
    if (!m || m[1] !== projectId) return null;
    const kind = m[2] as "assets" | "shots";
    const filename = m[3]!;
    const abs = path.join(fileRoot(), projectId, kind, filename);
    try {
      const buf = await readFile(abs);
      return { buf, filename };
    } catch {
      return null;
    }
  }

  const mImg = u.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/image$/i);
  if (mImg && mImg[1] === projectId && mImg[2] === shot.id) {
    const row = getDb()
      .prepare(`SELECT image_blob, image_mime FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`)
      .get(projectId, shot.id) as { image_blob: Buffer | Uint8Array | null; image_mime: string | null } | undefined;
    if (!row?.image_blob) return null;
    const buf = Buffer.isBuffer(row.image_blob) ? row.image_blob : Buffer.from(row.image_blob);
    if (!buf.length) return null;
    const mime = (row.image_mime?.split(";")[0]?.trim().toLowerCase() || "image/png").replace(/\s/g, "");
    const ext =
      mime.includes("jpeg") || mime.includes("jpg")
        ? "jpg"
        : mime.includes("webp")
          ? "webp"
          : mime.includes("gif")
            ? "gif"
            : "png";
    return { buf, filename: `${shot.id}.${ext}` };
  }

  if (/^https?:\/\//i.test(u)) {
    try {
      const r = await fetchWithRetry(u, undefined, { retries: 2, timeoutMs: 15000 });
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const mime = r.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
      const ext =
        mime.includes("jpeg") || mime.includes("jpg")
          ? "jpg"
          : mime.includes("webp")
            ? "webp"
            : mime.includes("gif")
              ? "gif"
              : "png";
      return { buf: Buffer.from(ab), filename: `shot-${shot.id}.${ext}` };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 读取资产展示图字节（上传图床用）。顺序：本地 `/api/files/.../assets/...` → imageUrl 外链 → remoteImageUrl 外链。
 */
export async function readAssetImageBuffer(
  projectId: string,
  asset: AssetItem,
): Promise<{ buf: Buffer; filename: string } | null> {
  const tryHttp = async (url: string): Promise<{ buf: Buffer; filename: string } | null> => {
    try {
      const r = await fetchWithRetry(url, undefined, { retries: 2, timeoutMs: 15000 });
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const mime = r.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
      const ext =
        mime.includes("jpeg") || mime.includes("jpg")
          ? "jpg"
          : mime.includes("webp")
            ? "webp"
            : mime.includes("gif")
              ? "gif"
              : "png";
      return { buf: Buffer.from(ab), filename: `${asset.id}.${ext}` };
    } catch {
      return null;
    }
  };

  const local = asset.imageUrl?.trim().replace(/\/+/g, "/") || "";
  if (local.startsWith("/api/files/")) {
    const m = local.match(/^\/api\/files\/projects\/([^/]+)\/(assets|shots)\/([^/]+)$/);
    if (!m || m[1] !== projectId || m[2] !== "assets") return null;
    const filename = m[3]!;
    const abs = path.join(fileRoot(), projectId, "assets", filename);
    try {
      const buf = await readFile(abs);
      return { buf, filename };
    } catch {
      /* fall through */
    }
  }
  if (/^https?:\/\//i.test(local)) {
    const got = await tryHttp(local);
    if (got) return got;
  }
  const remote = asset.remoteImageUrl?.trim();
  if (remote && /^https?:\/\//i.test(remote)) {
    const got = await tryHttp(remote);
    if (got) return got;
  }
  return null;
}

export async function saveProjectImageFile(
  projectId: string,
  kind: "assets" | "shots",
  id: string,
  buf: Buffer,
  mime: string,
): Promise<string> {
  const ext = extByMime(mime);
  const dir = path.join(fileRoot(), projectId, kind);
  await mkdir(dir, { recursive: true });
  if (kind === "shots") {
    await archiveExistingShotPrimaryFiles(projectId, id);
  }
  const filename = `${id}.${ext}`;
  const abs = path.join(dir, filename);
  await writeFile(abs, buf);
  return `/api/files/projects/${projectId}/${kind}/${filename}`;
}

export async function bytesFromGenerateImageResult(
  img: GenerateImageResult,
): Promise<{ buf: Buffer; mime: string; remoteUrl: string | null }> {
  if (img.kind === "base64") {
    const m = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!m) throw new Error("无法解析 data URL 图片");
    return {
      buf: Buffer.from(m[2]!, "base64"),
      mime: m[1]!,
      remoteUrl: null,
    };
  }
  // ✅ SSRF 防护：模型返回的 URL 也需校验（含 DNS rebinding 防护）
  const ssrfCheck = await validateUrlSafety(img.url);
  if (!ssrfCheck.safe) {
    throw new Error(`生图 URL 安全校验失败: ${ssrfCheck.reason}`);
  }
  const r = await fetchWithRetry(img.url, undefined, { retries: 2, timeoutMs: 15000 });
  if (!r.ok) throw new Error(`拉取生图 URL 失败: ${r.status}`);
  const ab = await r.arrayBuffer();
  const mime = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  return { buf: Buffer.from(ab), mime, remoteUrl: img.url };
}

/** SSRF 防护已迁移至 server/utils/ssrfCheck.ts（含 DNS rebinding 防护） */

/** 从 UI 保存的分镜 URL 尽量落入 BLOB（data URL / http） */
export async function bytesFromStoryboardImageUrl(
  imageUrl: string,
): Promise<{ buf: Buffer; mime: string; remoteUrl: string | null } | null> {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("/api/")) return null;
  if (imageUrl.startsWith("data:")) {
    const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!m) return null;
    return {
      buf: Buffer.from(m[2]!, "base64"),
      mime: m[1]!,
      remoteUrl: null,
    };
  }
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    // ✅ 添加 SSRF 防护（含 DNS rebinding 防护）
    const validation = await validateUrlSafety(imageUrl);
    if (!validation.safe) {
      console.warn("URL validation failed", { imageUrl, reason: validation.reason });
      return null;
    }

    // ✅ 添加请求超时和大小限制
    const r = await fetchWithRetry(
      imageUrl,
      {
        headers: {
          "User-Agent": "Toonflow/1.0",
        },
      },
      { retries: 2, timeoutMs: 10000 },
    );

    if (!r.ok) return null;

    // ✅ 检查响应大小限制
    const contentLength = parseInt(r.headers.get("content-length") || "0");
    const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
    if (contentLength > MAX_IMAGE_SIZE) {
      console.warn("Image exceeds size limit", { imageUrl, size: contentLength });
      return null;
    }

    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_IMAGE_SIZE) {
      console.warn("Image exceeds size limit after fetch", { imageUrl, size: ab.byteLength });
      return null;
    }

    const mime = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { buf: Buffer.from(ab), mime, remoteUrl: imageUrl };
  }
  return null;
}

/** 单条视频任务落盘体积上限（约 280MB） */
const MAX_PROJECT_VIDEO_BYTES = 280 * 1024 * 1024;

function extByVideoMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  return "mp4";
}

/**
 * 将生成的视频写入 `files/projects/{projectId}/videos/{jobId}.{ext}`，返回 `/api/files/...`。
 */
export async function saveProjectVideoFile(
  projectId: string,
  jobId: string,
  buf: Buffer,
  mime?: string,
): Promise<string> {
  const ext = mime ? extByVideoMime(mime) : "mp4";
  const dir = path.join(fileRoot(), projectId, "videos");
  await mkdir(dir, { recursive: true });
  const filename = `${jobId}.${ext}`;
  const abs = path.join(dir, filename);
  await writeFile(abs, buf);
  return `/api/files/projects/${projectId}/videos/${filename}`;
}

function isLocalProjectFilesUrl(projectId: string, url: string): boolean {
  const u = url.trim().replace(/\/+/g, "/");
  return u.startsWith(`/api/files/projects/${projectId}/`);
}

/**
 * 远程/临时视频 URL 拉取后落盘，避免链接过期后无法播放。
 * 已是本项目 ` /api/files/projects/{id}/...` 的地址则跳过；失败时记录日志并返回原始 URL。
 */
export async function persistGeneratedVideoUrl(projectId: string, jobId: string, url: string): Promise<string> {
  const t = (url || "").trim();
  if (!t) return t;
  if (isLocalProjectFilesUrl(projectId, t)) return t;

  try {
    if (t.startsWith("data:")) {
      const m = t.match(/^data:([^;]+);base64,([\s\S]+)$/i);
      if (!m) throw new Error("无法解析视频的 data URL");
      const buf = Buffer.from(m[2]!.replace(/\s/g, ""), "base64");
      if (buf.length > MAX_PROJECT_VIDEO_BYTES) throw new Error("视频体积超过上限");
      const local = await saveProjectVideoFile(projectId, jobId, buf, m[1]!);
      logger.info("video persisted from data URL", { projectId, jobId, bytes: buf.length });
      return local;
    }

    if (!/^https?:\/\//i.test(t)) {
      logger.warn("video persist skipped: unsupported URL scheme", { projectId, jobId, hint: t.slice(0, 120) });
      return t;
    }

    const r = await fetchWithRetry(t, { redirect: "follow" }, { retries: 2, timeoutMs: 300_000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cl = r.headers.get("content-length");
    if (cl && Number(cl) > MAX_PROJECT_VIDEO_BYTES) throw new Error("Content-Length 超过上限");
    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_PROJECT_VIDEO_BYTES) throw new Error("视频体积超过上限");
    const mime = r.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
    const local = await saveProjectVideoFile(projectId, jobId, Buffer.from(ab), mime);
    logger.info("video persisted from remote URL", { projectId, jobId, bytes: ab.byteLength });
    return local;
  } catch (e) {
    logger.warn("video local persist failed, keeping remote URL", {
      projectId,
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
    return t;
  }
}

export function publicShotImagePath(projectId: string, shotId: string): string {
  return `/api/projects/${projectId}/shots/${shotId}/image`;
}

export function stripInternalStoryboardFields(shots: StoryboardShot[]): StoryboardShot[] {
  return shots.map(
    ({
      id,
      index,
      shotNo,
      sceneNo,
      shotSize,
      camera,
      content,
      dialogue,
      music,
      sfx,
      durationSec,
      prompt,
      note,
      videoPrompt,
      imagePrompt,
      videoExtraAssetIds,
      imageUrl,
    }) => ({
      id,
      index,
      shotNo,
      sceneNo,
      shotSize,
      camera,
      content,
      dialogue,
      music,
      sfx,
      durationSec,
      prompt,
      note,
      videoPrompt,
      imagePrompt,
      videoExtraAssetIds,
      imageUrl,
    }),
  );
}
