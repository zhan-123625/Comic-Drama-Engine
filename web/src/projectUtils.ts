import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "./constants";
import type { Project } from "./types";
import { normalizeHtmlishToPlainText } from "./textNormalize";

export function normalizeProject(p: Project): Project {
  return {
    ...p,
    artStyle: p.artStyle ?? "",
    genreType: p.genreType ?? "",
    videoAspect: p.videoAspect ?? "16:9",
    storyboardImageSize: p.storyboardImageSize ?? "1024x1024",
    assets: (p.assets ?? []).map((a) => ({
      ...a,
      aliases: a.aliases ?? [],
      sceneNos: a.sceneNos ?? [],
    })),
    storyboards: (p.storyboards ?? []).map((s) => ({
      ...s,
      shotNo: normalizeHtmlishToPlainText(s.shotNo ?? String(s.index)),
      sceneNo: typeof s.sceneNo === "number" && Number.isInteger(s.sceneNo) && s.sceneNo > 0 ? s.sceneNo : undefined,
      durationSec:
        typeof s.durationSec === "number" && Number.isFinite(s.durationSec)
          ? Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, Math.round(s.durationSec)))
          : undefined,
      shotSize: normalizeHtmlishToPlainText(s.shotSize ?? ""),
      camera: normalizeHtmlishToPlainText(s.camera ?? ""),
      content: normalizeHtmlishToPlainText(s.content ?? s.prompt ?? ""),
      dialogue: normalizeHtmlishToPlainText(s.dialogue ?? ""),
      music: normalizeHtmlishToPlainText(s.music ?? ""),
      sfx: normalizeHtmlishToPlainText(s.sfx ?? ""),
      prompt: normalizeHtmlishToPlainText(s.prompt ?? s.content ?? ""),
      note: normalizeHtmlishToPlainText(s.note ?? ""),
      videoPrompt: s.videoPrompt?.trim() ? normalizeHtmlishToPlainText(s.videoPrompt) : undefined,
      imagePrompt: s.imagePrompt?.trim() ? normalizeHtmlishToPlainText(s.imagePrompt) : undefined,
      videoExtraAssetIds: (() => {
        if (!Array.isArray(s.videoExtraAssetIds)) return undefined;
        const ids = [...new Set(s.videoExtraAssetIds.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 24);
        return ids.length ? ids : undefined;
      })(),
      remoteImageUrl: s.remoteImageUrl?.trim() ? s.remoteImageUrl.trim().slice(0, 50_000) : undefined,
      imageModelId: s.imageModelId?.trim() || undefined,
      videoModelId: s.videoModelId?.trim() || undefined,
      videoRunMode:
        s.videoRunMode === "first_frame" ||
        s.videoRunMode === "first_last" ||
        s.videoRunMode === "multi_ref" ||
        s.videoRunMode === "omni" ||
        s.videoRunMode === "text_only"
          ? s.videoRunMode
          : undefined,
      lastFrameImageUrl: s.lastFrameImageUrl?.trim() ? s.lastFrameImageUrl.trim().slice(0, 50_000) : undefined,
      lastFrameRemoteUrl: s.lastFrameRemoteUrl?.trim() ? s.lastFrameRemoteUrl.trim().slice(0, 50_000) : undefined,
      videoRefAudioUrl: s.videoRefAudioUrl?.trim() ? s.videoRefAudioUrl.trim().slice(0, 2000) : undefined,
      videoRefVideoUrl: s.videoRefVideoUrl?.trim() ? s.videoRefVideoUrl.trim().slice(0, 2000) : undefined,
    })),
  };
}

export function buildEditorPatch(p: Project) {
  return {
    name: p.name,
    sourceText: p.sourceText,
    outline: p.outline,
    script: p.script,
    artStyle: p.artStyle,
    genreType: p.genreType,
    videoAspect: p.videoAspect,
    storyboardImageSize: p.storyboardImageSize,
  } as const;
}
