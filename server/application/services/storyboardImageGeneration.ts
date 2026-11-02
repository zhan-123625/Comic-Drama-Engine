import { runImageAgentForStoryboardShot } from "../../agents/imageAgent.js";
import { appendImageJobRecord } from "../../jobs.js";
import { tryEasyImageUrlAfterGenerate } from "../../easyImageAfterGenerate.js";
import { bytesFromGenerateImageResult, saveProjectImageFile } from "../../imagePersist.js";
import { readConfig } from "../../config.js";
import { resolveImageConfigForShot } from "../../modelResolve.js";
import { getModelApiCallFromError } from "../../modelCallError.js";
import { buildStoryboardImageGenerationPrompt, shotHasDrawableImageContent } from "../../storyboardImagePrompt.js";
import { toErrorMeta } from "../../logger.js";
import { store } from "../../store.js";

export async function generateStoryboardImage(
  projectId: string,
  shotId: string,
  opts?: { promptOverride?: string; referenceImageUrls?: string[] },
) {
  const p = await store.get(projectId);
  if (!p) return { ok: false as const, status: 404 as const, error: "project not found" };
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return { ok: false as const, status: 404 as const, error: "shot not found" };
  if (!shotHasDrawableImageContent(shot, opts?.promptOverride)) {
    return {
      ok: false as const,
      status: 400 as const,
      error: "分镜缺少可画内容（请填写画面内容、兼容 prompt 或图片提示词）",
    };
  }
  const cfg = await readConfig();
  const imageCfg = resolveImageConfigForShot(shot, cfg);
  if (!imageCfg) {
    return { ok: false as const, status: 400 as const, error: "未配置生图：请先在设置中填写 image provider" };
  }
  const aggregateAssets = cfg.video?.aggregateAssets !== false;
  const textPrompt = buildStoryboardImageGenerationPrompt(p, shot, {
    aggregateAssets,
    imagePromptOverride: opts?.promptOverride,
  });
  try {
    const img = await runImageAgentForStoryboardShot(p, shot, p.storyboardImageSize, {
      imagePromptOverride: opts?.promptOverride,
      referenceImageUrlsOverride: opts?.referenceImageUrls,
      imageCfg,
    });
    const { buf, mime, remoteUrl } = await bytesFromGenerateImageResult(img);
    const localUrl = await saveProjectImageFile(p.id, "shots", shot.id, buf, mime);
    const easyUrl = await tryEasyImageUrlAfterGenerate(buf, shot.id, mime);
    p.storyboards = p.storyboards.map((s) =>
      s.id === shot.id ? { ...s, imageUrl: localUrl, remoteImageUrl: easyUrl ?? remoteUrl ?? undefined } : s,
    );
    await store.save(p);
    try {
      await appendImageJobRecord(projectId, {
        status: "done",
        message: `分镜生图完成：镜头 #${shot.index}`,
        shotIndex: shot.index,
        prompt: textPrompt,
        resultUrl: localUrl,
        modelApiCall: img.modelApiCall,
      });
    } catch {
      /* noop */
    }
    const refreshed = await store.get(projectId);
    return { ok: true as const, project: refreshed ?? p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failedSnap = getModelApiCallFromError(e);
    try {
      await appendImageJobRecord(projectId, {
        status: "failed",
        message: `分镜生图失败：镜头 #${shot.index}：${msg}`.slice(0, 600),
        shotIndex: shot.index,
        prompt: textPrompt,
        modelApiCall: failedSnap,
      });
    } catch {
      /* noop */
    }
    return { ok: false as const, status: 502 as const, error: msg, meta: toErrorMeta(e) };
  }
}
