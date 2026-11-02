import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "./pipelineConstants.js";
import type { StoryboardShot } from "./types.js";

/**
 * 分镜「镜头时长」整秒，用于视频 API（如火山方舟 Seedance 请求体 `duration`）。
 * 与提示词解耦：勿依赖模型从文案里读秒数。
 */
export function shotVideoDurationSeconds(shot: StoryboardShot | undefined): number | undefined {
  if (!shot) return undefined;
  const d = shot.durationSec;
  if (d == null || !Number.isFinite(d)) return undefined;
  return Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, Math.round(Number(d))));
}
