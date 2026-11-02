import type { VideoProviderConfig } from "./config.js";
import { toPublicAssetUrl } from "./publicUrl.js";
import type { StoryboardShot, VideoRunMode } from "./types.js";
import { bestVideoReferenceUrl, isArkInlineResolvableImageUrl, resolveUrlForVideoApi } from "./videoContext.js";
import { effectiveVideoRunMode } from "./videoModeLogic.js";

export type { VideoRunMode };
export { effectiveVideoRunMode, isRunModeAllowed, normalizeVideoSupportedModes } from "./videoModeLogic.js";

/**
 * 按当前分镜的视频模式检查是否可发起视频任务（在关键帧检查之后补充）。
 */
export function shotVideoRunModeBlockingReason(shot: StoryboardShot, videoCfg: VideoProviderConfig): string | null {
  const mode = effectiveVideoRunMode(shot, videoCfg);
  if (mode === "first_last") {
    const last = bestVideoReferenceUrl(shot.lastFrameImageUrl, shot.lastFrameRemoteUrl);
    if (!last?.trim()) {
      return `镜头 #${shot.index}：首尾帧模式需要「尾帧」图（请填写尾帧本地路径或外链）。`;
    }
    const resolved = last.trim() ? (toPublicAssetUrl(last.trim()) ?? last.trim()) : "";
    if (!resolveUrlForVideoApi(last) && !isArkInlineResolvableImageUrl(resolved)) {
      return `镜头 #${shot.index}：尾帧需为公网 URL、data:image;base64、或本应用可读路径（/api/files/...、分镜 /api/projects/.../shots/.../image）。`;
    }
  }
  return null;
}
