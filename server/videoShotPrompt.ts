import { composeStoryboardPrompt } from "./storyboardPrompt.js";
import type { StoryboardShot } from "./types.js";

const STRUCTURED_CONTENT_HINT =
  "\n\n【分镜正文结构】若 content 中含「**首帧** / **镜内动态与神态**（或 **镜内动态**）/ **尾帧**」分段：请按 durationSec、camera 与摄法，在视频中展开**镜内动态与神态**（走位、表情、眼神、与台词语气关系）；**不要生成可读对白字幕**。**首尾帧**模式时，影像应从首帧氛围收束到**尾帧**段所描述的结束画面（若尾帧写「同首帧」则保持构图仅微调神态）。";

/** 视频生成用的「基底」提示词：优先用户自定义，否则用分镜结构化字段拼接（含台词等，供视频理解）。 */
export function getVideoBasePromptForShot(shot: StoryboardShot): string {
  const custom = shot.videoPrompt?.trim();
  if (custom) return custom;
  const base = composeStoryboardPrompt(shot, { omitDuration: true });
  const c = shot.content ?? "";
  if (/\*\*首帧\*\*\s*[：:]|【首帧】/.test(c)) {
    return `${base}${STRUCTURED_CONTENT_HINT}`;
  }
  return base;
}
