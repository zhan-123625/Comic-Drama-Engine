import { readConfig, type ImageProviderConfig } from "../config.js";
import { readLocalProjectImageUrlAsDataUrl, type GenerateImageResult } from "../imagePersist.js";
import { generateImage } from "../providers/openaiCompat.js";
import { STORYBOARD_MAX_REFERENCE_IMAGES } from "../pipelineConstants.js";
import { isLikelyLocalHostUrl, toPublicAssetUrl } from "../publicUrl.js";
import { buildStoryboardImageGenerationPrompt } from "../storyboardImagePrompt.js";
import type { Project, StoryboardImageSize, StoryboardShot } from "../types.js";
import { orderedAssetsForStoryboardVisual } from "../videoContext.js";

/**
 * 「生图 Agent」：单镜调用图像模型（与主流程配置一致）。
 * @param sizeOverride 项目级分镜图尺寸，优先于全局设置
 */
export async function runImageAgentForShot(
  prompt: string,
  sizeOverride?: StoryboardImageSize,
): Promise<GenerateImageResult> {
  const cfg = await readConfig();
  if (!cfg.image) throw new Error("未配置生图：请先在「设置」页填写 image provider");
  const size = sizeOverride ?? cfg.image.size ?? "1024x1024";
  return generateImage({
    baseUrl: cfg.image.baseUrl,
    apiKey: cfg.image.apiKey,
    model: cfg.image.model,
    size,
    prompt,
  });
}

async function resolveRefPayloadForImageModel(
  project: Project,
  rawUrl: string | undefined,
): Promise<string | undefined> {
  const u = rawUrl?.trim();
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  const pub = toPublicAssetUrl(u);
  if (pub && !isLikelyLocalHostUrl(pub)) return pub;
  if (u.startsWith("/api/files/") || /^\/api\/projects\/[^/]+\/shots\/[^/]+\/image$/i.test(u)) {
    return (await readLocalProjectImageUrlAsDataUrl(project.id, u)) ?? undefined;
  }
  return undefined;
}

export type StoryboardImageRefSlot = {
  role: "asset" | "shot";
  name: string;
  id?: string;
  assetType?: string;
  storageUrl: string;
  /** 可对外 JSON 展示的 URL；内联 data 时不返回原文 */
  resolvedUrl: string | null;
  /** 人类可读；data URL 时为长度提示 */
  resolvedUrlPreview: string | null;
  sendable: boolean;
  inApiPayload: boolean;
};

function previewFieldsForResolved(resolved: string): { resolvedUrl: string | null; resolvedUrlPreview: string } {
  if (resolved.startsWith("data:")) {
    return {
      resolvedUrl: null,
      resolvedUrlPreview: `(内联 data URL，约 ${Math.round(resolved.length / 1024)}KB)`,
    };
  }
  return { resolvedUrl: resolved, resolvedUrlPreview: resolved };
}

function isSendableImageRef(resolved: string): boolean {
  if (/^https?:\/\//i.test(resolved)) return true;
  if (resolved.startsWith("data:")) return true;
  return !isLikelyLocalHostUrl(resolved);
}

/**
 * 与直跑生图一致的参考图解析顺序，附带可观测字段（供预览 API）。
 */
export async function collectStoryboardImageReferenceDetails(
  project: Project,
  shot: StoryboardShot,
): Promise<{ apiImageUrls: string[]; referenceSlots: StoryboardImageRefSlot[] }> {
  const max = STORYBOARD_MAX_REFERENCE_IMAGES;
  const apiImageUrls: string[] = [];
  const referenceSlots: StoryboardImageRefSlot[] = [];

  const tryAdd = (url: string) => {
    if (apiImageUrls.length >= max || apiImageUrls.some((y) => y === url)) return false;
    apiImageUrls.push(url);
    return true;
  };

  const ordered = orderedAssetsForStoryboardVisual(project, shot);
  for (const a of ordered) {
    if (apiImageUrls.length >= max) break;
    const remote = a.remoteImageUrl?.trim();
    let resolved: string | undefined;
    let storageUrl: string;
    if (remote && /^https?:\/\//i.test(remote)) {
      storageUrl = remote;
      resolved = remote;
    } else {
      storageUrl = (a.imageUrl?.trim() || a.remoteImageUrl?.trim() || "").trim() || "(无本地路径)";
      resolved = await resolveRefPayloadForImageModel(project, a.imageUrl?.trim());
    }
    if (!resolved) {
      referenceSlots.push({
        role: "asset",
        name: a.name,
        id: a.id,
        assetType: a.type,
        storageUrl,
        resolvedUrl: null,
        resolvedUrlPreview: null,
        sendable: false,
        inApiPayload: false,
      });
      continue;
    }
    const inApi = tryAdd(resolved);
    const { resolvedUrl, resolvedUrlPreview } = previewFieldsForResolved(resolved);
    referenceSlots.push({
      role: "asset",
      name: a.name,
      id: a.id,
      assetType: a.type,
      storageUrl,
      resolvedUrl,
      resolvedUrlPreview,
      sendable: isSendableImageRef(resolved),
      inApiPayload: inApi,
    });
  }

  if (apiImageUrls.length < max) {
    const sn = shot.sceneNo;
    if (sn != null && Number.isInteger(sn) && sn >= 1) {
      const orderedShots = [...project.storyboards].sort((a, b) => a.index - b.index);
      const i = orderedShots.findIndex((s) => s.id === shot.id);
      if (i > 0) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = orderedShots[j]!;
          if (prev.sceneNo !== sn) break;
          const payload = await resolveRefPayloadForImageModel(project, prev.imageUrl);
          if (payload) {
            const storageUrl = prev.imageUrl?.trim() || `镜头 #${prev.index}`;
            const inApi = tryAdd(payload);
            const { resolvedUrl, resolvedUrlPreview } = previewFieldsForResolved(payload);
            referenceSlots.push({
              role: "shot",
              name: `同场前一镜 #${prev.index}`,
              id: prev.id,
              storageUrl,
              resolvedUrl,
              resolvedUrlPreview,
              sendable: isSendableImageRef(payload),
              inApiPayload: inApi,
            });
            break;
          }
        }
      }
    }
  }

  return { apiImageUrls, referenceSlots };
}

/**
 * 分镜生图参考图顺序：① **场景资产图 → 角色资产图 → 服装 → 其它匹配资产**（https 或内联 data URL）；
 * ② 仍有余量时再附 **同场前一镜**。
 */
async function storyboardReferenceImages(project: Project, shot: StoryboardShot): Promise<string[]> {
  const { apiImageUrls } = await collectStoryboardImageReferenceDetails(project, shot);
  return apiImageUrls;
}

/**
 * 分镜参考图：注入项目画风、剔除台词/音效、资产锚点；可选附带本地资产参考图（见环境变量说明）。
 */
export async function runImageAgentForStoryboardShot(
  project: Project,
  shot: StoryboardShot,
  sizeOverride?: StoryboardImageSize,
  opts?: {
    directorFeedbackExtra?: string;
    imagePromptOverride?: string;
    /** 分镜指定生图方案时覆盖全局 image */
    imageCfg?: ImageProviderConfig;
  },
): Promise<GenerateImageResult> {
  const cfg = await readConfig();
  const img = opts?.imageCfg ?? cfg.image;
  if (!img) throw new Error("未配置生图：请先在「设置」页填写 image provider");
  const size = sizeOverride ?? img.size ?? "1024x1024";
  const aggregateAssets = cfg.video?.aggregateAssets !== false;
  const prompt = buildStoryboardImageGenerationPrompt(project, shot, {
    directorFeedbackExtra: opts?.directorFeedbackExtra,
    aggregateAssets,
    imagePromptOverride: opts?.imagePromptOverride,
  });
  const referenceDataUrls = await storyboardReferenceImages(project, shot);
  return generateImage({
    baseUrl: img.baseUrl,
    apiKey: img.apiKey,
    model: img.model,
    size,
    prompt,
    referenceDataUrls: referenceDataUrls.length ? referenceDataUrls : undefined,
  });
}
