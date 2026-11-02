import { z } from "zod";
import { LONG_TEXT_MAX, SOURCE_TEXT_MAX } from "../serverConfig.js";
import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "../../pipelineConstants.js";

export const savedTextModelZ = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(200),
  provider: z.literal("openai-compatible"),
  baseUrl: z.string().max(2000).optional(),
  apiKey: z.string().max(2000).optional(),
  model: z.string().max(500).optional(),
  volcPresetId: z.string().max(120).optional(),
});

export const savedImageModelZ = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(200),
  provider: z.literal("openai-compatible"),
  baseUrl: z.string().max(2000).optional(),
  apiKey: z.string().max(2000).optional(),
  model: z.string().max(500).optional(),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
  volcPresetId: z.string().max(120).optional(),
});

export const videoSupportedModesZ = z.object({
  firstFrame: z.boolean().optional(),
  firstLastFrame: z.boolean().optional(),
  multiRef: z.boolean().optional(),
  omni: z.boolean().optional(),
  textOnly: z.boolean().optional(),
});

export const arkRatioZ = z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]);
export const arkResolutionZ = z.enum(["480p", "720p", "1080p"]);

export const savedVideoModelZ = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(200),
  provider: z.literal("http-hook"),
  baseUrl: z.string().max(2000).optional(),
  apiKey: z.string().max(2000).optional(),
  model: z.string().max(500).optional(),
  referenceMode: z.enum(["off", "auto"]).optional(),
  aggregateAssets: z.boolean().optional(),
  multiReferenceImages: z.boolean().optional(),
  volcVideoPresetId: z.string().max(120).optional(),
  supportedModes: videoSupportedModesZ.optional(),
  arkRatio: z.union([arkRatioZ, z.null()]).optional(),
  arkResolution: z.union([arkResolutionZ, z.null()]).optional(),
  arkWatermark: z.boolean().optional(),
  arkGenerateAudio: z.boolean().optional(),
});

export const cfgBody = z.object({
  text: z
    .object({
      provider: z.literal("openai-compatible"),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  image: z
    .object({
      provider: z.literal("openai-compatible"),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
    })
    .optional(),
  video: z
    .object({
      provider: z.literal("http-hook"),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      referenceMode: z.enum(["off", "auto"]).optional(),
      aggregateAssets: z.boolean().optional(),
      multiReferenceImages: z.boolean().optional(),
      volcVideoPresetId: z.string().max(120).optional(),
      supportedModes: videoSupportedModesZ.optional(),
      arkRatio: z.union([arkRatioZ, z.null()]).optional(),
      arkResolution: z.union([arkResolutionZ, z.null()]).optional(),
      arkWatermark: z.boolean().optional(),
      arkGenerateAudio: z.boolean().optional(),
    })
    .optional(),
  textModels: z.array(savedTextModelZ).max(40).optional(),
  imageModels: z.array(savedImageModelZ).max(40).optional(),
  videoModels: z.array(savedVideoModelZ).max(40).optional(),
  ui: z
    .object({
      autoSave: z.boolean().optional(),
      runnerDelayMs: z.number().int().min(100).max(60_000).optional(),
    })
    .optional(),
  agentPrompts: z
    .object({
      scriptSystem: z.string().max(20_000).optional(),
      storyboardSystem: z.string().max(20_000).optional(),
      storyboardRepairSystem: z.string().max(20_000).optional(),
      assetsSystem: z.string().max(20_000).optional(),
      directorSystem: z.string().max(20_000).optional(),
      videoRefineSystem: z.string().max(20_000).optional(),
      polishSourceSystem: z.string().max(20_000).optional(),
      polishScriptSystem: z.string().max(20_000).optional(),
    })
    .optional(),
  easyImage: z
    .object({
      apiUrl: z.string().max(2000).optional(),
      token: z.string().max(500).optional(),
    })
    .optional(),
});

export const createBody = z.object({
  name: z.string().max(200).optional(),
  genreType: z.string().max(200).optional(),
  artStyle: z.string().max(4000).optional(),
  videoAspect: z.string().max(32).optional(),
  storyboardImageSize: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
});

export const sourceBody = z.object({
  sourceText: z.string().max(SOURCE_TEXT_MAX),
});

export const shotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(1),
  shotNo: z.string().max(40).optional().default(""),
  shotSize: z.string().max(200).optional().default(""),
  camera: z.string().max(400).optional().default(""),
  content: z.string().max(10_000).optional().default(""),
  dialogue: z.string().max(10_000).optional().default(""),
  music: z.string().max(2000).optional().default(""),
  sfx: z.string().max(2000).optional().default(""),
  durationSec: z.number().int().min(SHOT_DURATION_SEC_MIN).max(SHOT_DURATION_SEC_MAX).optional(),
  sceneNo: z.number().int().min(1).optional(),
  prompt: z.string().max(10_000).optional().default(""),
  note: z.string().max(10_000).optional().default(""),
  videoPrompt: z.string().max(12_000).optional(),
  imagePrompt: z.string().max(12_000).optional(),
  videoExtraAssetIds: z.array(z.string().min(1)).max(24).optional(),
  videoExcludedAssetIds: z.array(z.string().min(1)).max(100).optional(),
  imageUrl: z.string().max(50_000).optional(),
  remoteImageUrl: z.string().max(50_000).optional(),
  imageModelId: z.string().max(80).optional(),
  videoModelId: z.string().max(80).optional(),
  videoRunMode: z.enum(["first_frame", "first_last", "multi_ref", "omni", "text_only"]).optional(),
  lastFrameImageUrl: z.string().max(50_000).optional(),
  lastFrameRemoteUrl: z.string().max(50_000).optional(),
  videoRefAudioUrl: z.string().max(2000).optional(),
  videoRefVideoUrl: z.string().max(2000).optional(),
});

export const modelApiCallSchema = z.object({
  capturedAt: z.string().max(48),
  taskKind: z.enum(["image", "video"]),
  routeKind: z.string().max(200),
  method: z.string().max(16),
  requestUrl: z.string().max(8000),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.unknown().optional(),
  notes: z.array(z.string().max(4000)).max(40).optional(),
});

export const jobSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "image"]).optional(),
  status: z.enum(["queued", "running", "done", "failed"]),
  message: z.string().max(10_000),
  shotIndex: z.number().int().min(1).optional(),
  prompt: z.string().max(10_000).optional(),
  imageUrl: z.string().max(50_000).optional(),
  resultUrl: z.string().max(50_000).optional(),
  modelApiCall: modelApiCallSchema.optional(),
});

export const projectPatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceText: z.string().max(LONG_TEXT_MAX).optional(),
  outline: z.string().max(LONG_TEXT_MAX).optional(),
  script: z.string().max(LONG_TEXT_MAX).optional(),
  artStyle: z.string().max(4000).optional(),
  genreType: z.string().max(500).optional(),
  videoAspect: z.string().max(32).optional(),
  storyboardImageSize: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
  assets: z
    .array(
      z.object({
        id: z.string().min(1),
        index: z.number().int().min(1),
        type: z.enum(["character", "scene", "prop", "costume", "action_pose", "fx"]),
        name: z.string().max(500),
        key: z.string().max(500).optional(),
        stableId: z.number().int().nonnegative().optional(),
        aliases: z.array(z.string().max(200)).max(50).optional(),
        sceneNos: z.array(z.number().int().min(1)).max(500).optional(),
        prompt: z.string().max(10_000),
        imageUrl: z.string().max(50_000).optional(),
        remoteImageUrl: z.string().max(50_000).optional(),
        note: z.string().max(5000).optional(),
      }),
    )
    .max(2000)
    .optional(),
  storyboards: z.array(shotSchema).max(2000).optional(),
  videoJobs: z.array(jobSchema).max(2000).optional(),
});

export const assetGenerateBody = z.object({
  assetId: z.string().min(1),
});

export const assetGenerateBatchBody = z.object({
  onlyMissing: z.boolean().optional(),
  assetIds: z.array(z.string().min(1)).optional(),
});

export const storyboardGenerateImageBody = z.object({
  promptOverride: z.string().max(12_000).optional(),
});

export const generateImagesBody = z.object({
  onlyMissing: z.boolean().optional(),
  shotIds: z.array(z.string().min(1)).optional(),
});

export const videoEnqueueBody = z.object({
  mode: z.enum(["all", "missing", "selected", "failed"]),
  shotIds: z.array(z.string().min(1)).optional(),
});

export const videoRunOnceBody = z.object({
  shotId: z.string().min(1),
  promptOverride: z.string().max(12_000).optional(),
});

export const videoPromptPreviewBody = z.object({
  promptOverride: z.string().max(12_000).optional(),
});

export const imagePromptPreviewBody = z.object({
  promptOverride: z.string().max(12_000).optional(),
});

export const publishEasyImageBody = z.object({
  runVideoAfter: z.boolean().optional(),
  publishVideoReferenceAssets: z.boolean().optional(),
});

export const polishBody = z.object({
  field: z.enum(["source", "script"]),
});

export const regenerateChapterBody = z.object({
  chapterIndex: z.number().int().min(0),
});

export const pipelineStageEnum = z.enum(["script", "assets", "storyboard", "video"]);
export const pipelineRunBody = z.object({
  from: pipelineStageEnum.optional(),
  to: pipelineStageEnum.optional(),
  chapterIndex: z.number().int().min(0).optional(),
  assetsEntriesOnly: z.boolean().optional(),
  assetsGenerateImages: z.boolean().optional(),
  storyboardGenerateImages: z.boolean().optional(),
});

export const jobEnqueueBody = z.object({
  kind: z.enum(["video", "image"]).optional(),
  message: z.string().max(10_000).optional(),
  shotIndex: z.number().int().min(1).optional(),
  prompt: z.string().max(10_000).optional(),
  imageUrl: z.string().max(50_000).optional(),
});

export const jobRunBody = z.object({
  delayMs: z.number().int().min(100).max(60_000).optional(),
});
