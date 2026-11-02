import type { z } from "zod";
import { normalizeHtmlishToPlainText } from "../../textNormalize.js";
import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "../../pipelineConstants.js";
import type { AssetItem, Project } from "../../types.js";
import { projectPatchBody } from "../../http/schemas/apiSchemas.js";

type Patch = z.infer<typeof projectPatchBody>;

/** 将已通过 Zod 校验的补丁合并进内存中的项目（PUT /projects/:id）。 */
export function applyProjectPatch(p: Project, next: Patch) {
  if (next.name !== undefined) p.name = next.name;
  if (next.sourceText !== undefined) p.sourceText = next.sourceText;
  if (next.outline !== undefined) p.outline = next.outline;
  if (next.script !== undefined) p.script = next.script;
  if (next.artStyle !== undefined) p.artStyle = next.artStyle;
  if (next.genreType !== undefined) p.genreType = next.genreType;
  if (next.videoAspect !== undefined) p.videoAspect = next.videoAspect;
  if (next.storyboardImageSize !== undefined) p.storyboardImageSize = next.storyboardImageSize;
  if (next.assets !== undefined) {
    p.assets = (next.assets as AssetItem[]).map((a) => ({
      ...a,
      key: a.key?.trim() || undefined,
      stableId: typeof a.stableId === "number" ? a.stableId : undefined,
      aliases: Array.isArray(a.aliases) ? a.aliases.filter(Boolean).slice(0, 50) : [],
      sceneNos: Array.isArray(a.sceneNos)
        ? [...new Set(a.sceneNos.filter((n) => Number.isInteger(n) && n > 0))].sort((x, y) => x - y)
        : [],
      remoteImageUrl: a.remoteImageUrl,
    }));
  }
  if (next.storyboards !== undefined) {
    p.storyboards = next.storyboards.map((s) => {
      const durationRaw = s.durationSec;
      const durationSec =
        typeof durationRaw === "number" && Number.isFinite(durationRaw)
          ? Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, Math.round(durationRaw)))
          : undefined;
      return {
        ...s,
        shotNo: normalizeHtmlishToPlainText(String((s as { shotNo?: string }).shotNo ?? String(s.index))),
        sceneNo: typeof s.sceneNo === "number" && Number.isInteger(s.sceneNo) && s.sceneNo > 0 ? s.sceneNo : undefined,
        durationSec,
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
          const raw = (s as { videoExtraAssetIds?: string[] }).videoExtraAssetIds;
          if (!Array.isArray(raw)) return undefined;
          const ids = [...new Set(raw.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 24);
          return ids.length ? ids : undefined;
        })(),
        videoExcludedAssetIds: (() => {
          const raw = (s as { videoExcludedAssetIds?: string[] }).videoExcludedAssetIds;
          if (!Array.isArray(raw)) return undefined;
          const ids = [
            ...new Set(
              raw
                .map((x) =>
                  String(x ?? "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          ].slice(0, 100);
          return ids.length ? ids : undefined;
        })(),
        remoteImageUrl: s.remoteImageUrl?.trim() ? s.remoteImageUrl.trim().slice(0, 50_000) : undefined,
        imageModelId: s.imageModelId?.trim() || undefined,
        videoModelId: s.videoModelId?.trim() || undefined,
        videoRunMode: s.videoRunMode,
        lastFrameImageUrl: s.lastFrameImageUrl?.trim() ? s.lastFrameImageUrl.trim().slice(0, 50_000) : undefined,
        lastFrameRemoteUrl: s.lastFrameRemoteUrl?.trim() ? s.lastFrameRemoteUrl.trim().slice(0, 50_000) : undefined,
        videoRefAudioUrl: s.videoRefAudioUrl?.trim() ? s.videoRefAudioUrl.trim().slice(0, 2000) : undefined,
        videoRefVideoUrl: s.videoRefVideoUrl?.trim() ? s.videoRefVideoUrl.trim().slice(0, 2000) : undefined,
      };
    });
  }
  if (next.videoJobs !== undefined) p.videoJobs = next.videoJobs;
}
