import type { StoryboardShot } from "./types.js";

function clean(s: string): string {
  return String(s ?? "").trim();
}

export type ComposeStoryboardPromptOpts = {
  /**
   * 为 true 时不把「时长：Xs」写入文本。
   * 视频侧时长应由 API 参数（如方舟 Seedance 的 `duration`）控制，而非提示词。
   */
  omitDuration?: boolean;
};

/**
 * 将结构化分镜字段合成为“可用于生图/视频”的 prompt 文本。
 * 兼容：若新字段为空，则回退到旧的 prompt/note。
 */
export function composeStoryboardPrompt(shot: StoryboardShot, opts?: ComposeStoryboardPromptOpts): string {
  const content = clean(shot.content) || clean(shot.prompt);
  const size = clean(shot.shotSize);
  const camera = clean(shot.camera);
  const dialogue = clean(shot.dialogue);
  const music = clean(shot.music);
  const sfx = clean(shot.sfx);
  const omitDuration = opts?.omitDuration === true;
  const duration =
    !omitDuration && shot.durationSec != null && Number.isFinite(shot.durationSec) ? `${shot.durationSec}s` : "";
  const legacyNote = clean(shot.note);

  const lines: string[] = [];
  const shotNo = clean(shot.shotNo) || String(shot.index);
  if (content) lines.push(`镜头 ${shotNo}：${content}`);
  const metaBits = [
    size ? `景别：${size}` : "",
    camera ? `摄法：${camera}` : "",
    duration ? `时长：${duration}` : "",
  ].filter(Boolean);
  if (metaBits.length) lines.push(metaBits.join("；"));
  if (dialogue) lines.push(`台词/旁白：${dialogue}`);
  if (music) lines.push(`音乐：${music}`);
  if (sfx) lines.push(`音效：${sfx}`);
  if (legacyNote && !lines.join("\n").includes(legacyNote)) lines.push(`备注：${legacyNote}`);
  return lines.join("\n").trim();
}
