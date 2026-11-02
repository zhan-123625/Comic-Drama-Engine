import type { AppConfig, ImageProviderConfig, VideoProviderConfig } from "./config.js";
import type { StoryboardShot } from "./types.js";

export function resolveImageConfigForShot(shot: StoryboardShot, cfg: AppConfig): ImageProviderConfig | undefined {
  if (!cfg.image) return undefined;
  const id = shot.imageModelId?.trim();
  if (!id) return cfg.image;
  const hit = cfg.imageModels?.find((x) => x.id === id);
  if (!hit) return cfg.image;
  return {
    provider: "openai-compatible",
    baseUrl: hit.baseUrl?.trim() || cfg.image.baseUrl,
    apiKey: hit.apiKey?.trim() ? hit.apiKey : cfg.image.apiKey,
    model: hit.model?.trim() || cfg.image.model,
    size: hit.size ?? cfg.image.size,
  };
}

export function resolveVideoConfigForShot(shot: StoryboardShot, cfg: AppConfig): VideoProviderConfig | undefined {
  if (!cfg.video) return undefined;
  const id = shot.videoModelId?.trim();
  if (!id) return cfg.video;
  const hit = cfg.videoModels?.find((x) => x.id === id);
  if (!hit) return cfg.video;
  return {
    provider: "http-hook",
    baseUrl: hit.baseUrl?.trim() || cfg.video.baseUrl,
    apiKey: hit.apiKey?.trim() ? hit.apiKey : cfg.video.apiKey,
    model: hit.model?.trim() || cfg.video.model,
    referenceMode: hit.referenceMode ?? cfg.video.referenceMode ?? "off",
    aggregateAssets: hit.aggregateAssets ?? cfg.video.aggregateAssets ?? true,
    multiReferenceImages: hit.multiReferenceImages ?? cfg.video.multiReferenceImages ?? true,
    volcVideoPresetId: hit.volcVideoPresetId ?? cfg.video.volcVideoPresetId,
    supportedModes: hit.supportedModes ?? cfg.video.supportedModes,
    arkRatio: hit.arkRatio ?? cfg.video.arkRatio,
    arkResolution: hit.arkResolution ?? cfg.video.arkResolution,
    arkWatermark: hit.arkWatermark ?? cfg.video.arkWatermark,
    arkGenerateAudio: hit.arkGenerateAudio ?? cfg.video.arkGenerateAudio,
  };
}
