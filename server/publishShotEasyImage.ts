import { readConfig, type VideoProviderConfig } from "./config.js";
import { resolveVideoConfigForShot } from "./modelResolve.js";
import { uploadBufferToEasyImage } from "./easyImageClient.js";
import { readAssetImageBuffer, readStoryboardShotImageBuffer } from "./imagePersist.js";
import { runVideoOnceForShot } from "./runVideoOnceService.js";
import { store } from "./store.js";
import type { Project } from "./types.js";
import {
  assetImageNeedsEasyImagePublish,
  buildVideoInputWithAssets,
  shotBaseImageUrlForVideo,
} from "./videoContext.js";
import { resolveReferencedAssetsForVideo } from "./videoReferencedAssets.js";
import { getVideoBasePromptForShot } from "./videoShotPrompt.js";

const FALLBACK_VIDEO_CFG: VideoProviderConfig = {
  provider: "http-hook",
  baseUrl: "",
  apiKey: "",
  model: "",
  referenceMode: "off",
  aggregateAssets: true,
  multiReferenceImages: true,
};

export type PublishShotEasyImageResult =
  | {
      ok: true;
      publishedUrl: string;
      project: Project;
      publishedAssets?: Array<{ assetId: string; name: string; url: string }>;
      assetPublishNotes?: Array<{ assetId: string; name?: string; reason: string }>;
      videoRun?: { ok: true; resultUrl: string; project: Project } | { ok: false; error: string; project?: Project };
    }
  | { ok: false; status: number; error: string; project?: Project };

/**
 * 分镜图上传 EasyImage；可选顺带上传本镜视频参考资产（默认开，补全旧数据未走「生图自动图床」的 remote）。
 */
export async function publishStoryboardShotToEasyImage(opts: {
  projectId: string;
  shotId: string;
  runVideoAfter: boolean;
  /** 默认 true：与视频参考一致，上传需稳定外链的本项目资产图 */
  publishVideoReferenceAssets?: boolean;
  reqId?: string;
}): Promise<PublishShotEasyImageResult> {
  const cfg = await readConfig();
  const ei = cfg.easyImage;
  if (!ei?.apiUrl?.trim() || !ei?.token?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "未配置 EasyImage：请在「设置」中填写 easyImage.apiUrl 与 easyImage.token",
    };
  }

  const p = await store.get(opts.projectId);
  if (!p) return { ok: false, status: 404, error: "project not found" };
  const shot = p.storyboards.find((s) => s.id === opts.shotId);
  if (!shot) return { ok: false, status: 404, error: "shot not found" };

  const bin = await readStoryboardShotImageBuffer(opts.projectId, shot);
  if (!bin) {
    return {
      ok: false,
      status: 400,
      error: "无法读取分镜图（需已有 imageUrl：本地 /api/files/...、库内 /api/projects/.../image 或 http(s) 图链）",
    };
  }

  let publishedUrl: string;
  try {
    publishedUrl = await uploadBufferToEasyImage(ei.apiUrl.trim(), ei.token.trim(), bin.buf, bin.filename);
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const cleanUrl = publishedUrl.trim().slice(0, 50_000);
  p.storyboards = p.storyboards.map((s) => (s.id === shot.id ? { ...s, remoteImageUrl: cleanUrl } : s));

  const pubAssets = opts.publishVideoReferenceAssets !== false;
  const publishedAssets: Array<{ assetId: string; name: string; url: string }> = [];
  const assetPublishNotes: Array<{ assetId: string; name?: string; reason: string }> = [];

  if (pubAssets) {
    const shotNow = p.storyboards.find((s) => s.id === opts.shotId);
    const projectAssetIds = new Set(p.assets.map((a) => a.id.toLowerCase()));
    if (shotNow) {
      const videoCfg = cfg.video ? (resolveVideoConfigForShot(shotNow, cfg) ?? cfg.video) : FALLBACK_VIDEO_CFG;
      const base = getVideoBasePromptForShot(shotNow);
      const referencedAssets = await resolveReferencedAssetsForVideo(p, shotNow, base);
      const enriched = buildVideoInputWithAssets({
        project: p,
        shot: shotNow,
        basePrompt: base,
        baseImageUrl: shotBaseImageUrlForVideo(shotNow) ?? shotNow.imageUrl,
        videoCfg,
        referencedAssets,
      });

      for (const a of enriched.matchedAssets) {
        if (!projectAssetIds.has(a.id.toLowerCase())) {
          assetPublishNotes.push({
            assetId: a.id,
            name: a.name,
            reason: "不在本项目资产表内（可能仅资产库 @ 引用），未修改项目数据",
          });
          continue;
        }
        if (!assetImageNeedsEasyImagePublish(a)) {
          assetPublishNotes.push({
            assetId: a.id,
            name: a.name,
            reason: "已有稳定公网 remoteImageUrl，跳过",
          });
          continue;
        }
        const abin = await readAssetImageBuffer(opts.projectId, a);
        if (!abin) {
          assetPublishNotes.push({
            assetId: a.id,
            name: a.name,
            reason: "无法读取资产图片（需本地 /api/files/.../assets/ 或可访问的 http 图链）",
          });
          continue;
        }
        try {
          const au = await uploadBufferToEasyImage(ei.apiUrl.trim(), ei.token.trim(), abin.buf, abin.filename);
          const aclean = au.trim().slice(0, 50_000);
          p.assets = p.assets.map((x) => (x.id === a.id ? { ...x, remoteImageUrl: aclean } : x));
          publishedAssets.push({ assetId: a.id, name: a.name, url: aclean });
        } catch (e) {
          assetPublishNotes.push({
            assetId: a.id,
            name: a.name,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  await store.save(p);
  const refreshed = await store.get(opts.projectId);
  const proj = refreshed ?? p;

  const assetExtra = pubAssets ? { publishedAssets, assetPublishNotes } : {};

  if (!opts.runVideoAfter) {
    return { ok: true, publishedUrl: cleanUrl, project: proj, ...assetExtra };
  }

  const v = await runVideoOnceForShot({
    projectId: opts.projectId,
    shotId: opts.shotId,
    reqId: opts.reqId,
  });

  if (v.kind === "ok") {
    return {
      ok: true,
      publishedUrl: cleanUrl,
      project: v.project,
      ...assetExtra,
      videoRun: { ok: true, resultUrl: v.resultUrl, project: v.project },
    };
  }
  if (v.kind === "blocked") {
    return {
      ok: true,
      publishedUrl: cleanUrl,
      project: v.project,
      ...assetExtra,
      videoRun: { ok: false, error: v.error, project: v.project },
    };
  }
  return {
    ok: true,
    publishedUrl: cleanUrl,
    project: v.project ?? proj,
    ...assetExtra,
    videoRun: { ok: false, error: v.error, project: v.project },
  };
}
