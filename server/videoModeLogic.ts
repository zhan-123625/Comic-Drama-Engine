import type { VideoModelSupportedModes, VideoProviderConfig } from "./config.js";
import type { StoryboardShot, VideoRunMode } from "./types.js";

export type NormalizedVideoSupportedModes = Required<VideoModelSupportedModes>;

export function normalizeVideoSupportedModes(m?: VideoModelSupportedModes): NormalizedVideoSupportedModes {
  if (!m || Object.keys(m).length === 0) {
    return { firstFrame: true, firstLastFrame: false, multiRef: true, omni: false, textOnly: false };
  }
  return {
    firstFrame: m.firstFrame !== false,
    firstLastFrame: Boolean(m.firstLastFrame),
    multiRef: m.multiRef !== false,
    omni: Boolean(m.omni),
    textOnly: Boolean(m.textOnly),
  };
}

export function isRunModeAllowed(mode: VideoRunMode, sm: NormalizedVideoSupportedModes): boolean {
  switch (mode) {
    case "first_frame":
      return sm.firstFrame;
    case "first_last":
      return sm.firstLastFrame && sm.firstFrame;
    case "multi_ref":
      return sm.multiRef;
    case "omni":
      return sm.omni;
    case "text_only":
      return sm.textOnly;
    default:
      return false;
  }
}

export function effectiveVideoRunMode(shot: StoryboardShot, videoCfg: VideoProviderConfig): VideoRunMode {
  const sm = normalizeVideoSupportedModes(videoCfg.supportedModes);
  const req = shot.videoRunMode;
  if (req && isRunModeAllowed(req, sm)) return req;
  /** 未指定分镜模式时优先「仅首帧」单图 i2v，与官方示例一致；需要多图参考时请显式选「多图参考」 */
  if (sm.firstFrame) return "first_frame";
  if (sm.multiRef) return "multi_ref";
  if (sm.firstLastFrame) return "first_last";
  if (sm.omni) return "omni";
  if (sm.textOnly) return "text_only";
  return "multi_ref";
}
