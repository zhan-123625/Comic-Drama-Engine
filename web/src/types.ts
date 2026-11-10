/** 与 server/types 一致：单镜视频生成模式 */
export type VideoRunMode = "first_frame" | "first_last" | "multi_ref" | "omni" | "text_only";

export type VideoModelSupportedModes = {
  firstFrame?: boolean;
  firstLastFrame?: boolean;
  multiRef?: boolean;
  omni?: boolean;
  textOnly?: boolean;
};

/** 与 server/config ArkVideoRatio 一致 */
export type ArkVideoRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive";
export type ArkVideoResolution = "480p" | "720p" | "1080p";

export type StoryboardShot = {
  id: string;
  index: number;
  shotNo: string;
  shotSize: string;
  camera: string;
  content: string;
  dialogue: string;
  music: string;
  sfx: string;
  /** 镜头时长（秒）：与视频模型一致，仅整秒，1～15 */
  durationSec?: number;
  /** 与当前章剧本 Markdown 场次表「场次」列对应（正整数） */
  sceneNo?: number;
  prompt: string;
  note: string;
  /** 自定义视频提示词；空则服务端按分镜字段自动拼接 */
  videoPrompt?: string;
  /** 自定义生图基底（画面主体）；空则服务端按分镜字段自动拼接纯画面描述 */
  imagePrompt?: string;
  /** 视频生成时手动附加的本项目资产 ID（优先于自动匹配） */
  videoExtraAssetIds?: string[];
  videoExcludedAssetIds?: string[];
  imageUrl?: string;
  /** 生图接口返回的原始 URL（常带时效，易过期）；视频参考优先用已落盘的 imageUrl 或稳定图床链 */
  remoteImageUrl?: string;
  imageModelId?: string;
  videoModelId?: string;
  videoRunMode?: VideoRunMode;
  lastFrameImageUrl?: string;
  lastFrameRemoteUrl?: string;
  audioUrl?: string;
  voice?: string;
  speaker?: string;
  videoRefAudioUrl?: string;
  videoRefVideoUrl?: string;
};

export type AssetItem = {
  id: string;
  index: number;
  type: "character" | "scene" | "prop" | "costume" | "action_pose" | "fx";
  name: string;
  key?: string;
  stableId?: number;
  aliases?: string[];
  sceneNos?: number[];
  prompt: string;
  /** 本地可访问展示图（/api/files/...，对外引用优先） */
  imageUrl?: string;
  /** 第三方或生图返回 URL（可能过期）；有本地 imageUrl 时视频侧优先本地 */
  remoteImageUrl?: string;
  note?: string;
  voice?: string;
};

export type AssetLibraryItem = AssetItem & {
  projectId: string;
  projectName: string;
  projectUpdatedAt: string;
};

/** 与 server 一致：单次模型 HTTP 调用快照（Authorization 已脱敏） */
export type ModelApiCallSnapshot = {
  capturedAt: string;
  taskKind: "image" | "video";
  routeKind: string;
  method: string;
  requestUrl: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  notes?: string[];
};

export type VideoJob = {
  id: string;
  kind?: "video" | "image";
  status: "queued" | "running" | "done" | "failed";
  message: string;
  shotId?: string;
  shotIndex?: number;
  prompt?: string;
  imageUrl?: string;
  resultUrl?: string;
  /** Runner 完成后由服务端写入 */
  modelApiCall?: ModelApiCallSnapshot;
};

export type StoryboardImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export type ProjectSummary = Project;

export type Project = {
  id: string;
  name: string;
  sourceText: string;
  outline: string;
  script: string;
  artStyle: string;
  genreType: string;
  videoAspect: string;
  storyboardImageSize: StoryboardImageSize;
  assets: AssetItem[];
  storyboards: StoryboardShot[];
  videoJobs: VideoJob[];
  pipelineStatus: "idle" | "running" | "done" | "error";
  pipelineError?: string;
  pipelineLog: string[];
};

export type MenuKey =
  | "overview"
  | "pipeline"
  | "source"
  | "script"
  | "assets"
  | "assetLibrary"
  | "timeline"
  | "storyboard"
  | "video"
  | "jobs"
  | "settings";
export type SideTabKey = "projects" | "settings" | "profile";

export type MenuItem = { key: MenuKey; label: string; hint: string };
export type SideTabItem = { key: SideTabKey; label: string; hint: string };

export type ArtStylePreset = { key: string; label: string; prompt: string };

export type RemoteSavedTextModel = {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  volcPresetId?: string;
};

export type RemoteSavedImageModel = RemoteSavedTextModel & { size?: string };

export type RemoteSavedVideoModel = {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  referenceMode?: "off" | "auto";
  aggregateAssets?: boolean;
  multiReferenceImages?: boolean;
  volcVideoPresetId?: string;
  supportedModes?: VideoModelSupportedModes;
  arkRatio?: ArkVideoRatio;
  arkResolution?: ArkVideoResolution;
  arkWatermark?: boolean;
  arkGenerateAudio?: boolean;
};

export type RemoteCfg = {
  text?: { provider: string; baseUrl: string; apiKey: string; model: string };
  image?: { provider: string; baseUrl: string; apiKey: string; model: string; size?: string };
  video?: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    referenceMode?: "off" | "auto";
    aggregateAssets?: boolean;
    /** 多参考图：分镜关键帧 + 匹配资产图按序入 API；关闭则仅传第一张 */
    multiReferenceImages?: boolean;
    /** 选中火山视频预设时记录，用于能力说明 */
    volcVideoPresetId?: string;
    supportedModes?: VideoModelSupportedModes;
    arkRatio?: ArkVideoRatio;
    arkResolution?: ArkVideoResolution;
    arkWatermark?: boolean;
    arkGenerateAudio?: boolean;
  };
  textModels?: RemoteSavedTextModel[];
  imageModels?: RemoteSavedImageModel[];
  videoModels?: RemoteSavedVideoModel[];
  tts?: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    voice?: string;
    enabled?: boolean;
    autoMuxVideo?: boolean;
  };
  ui?: { autoSave?: boolean; runnerDelayMs?: number; pipelineAllowPartial?: boolean };
  /** EasyImage 图床：上传分镜图写入 remoteImageUrl，供视频参考图拉取 */
  easyImage?: { apiUrl: string; token: string };
  agentPrompts?: {
    scriptSystem?: string;
    storyboardSystem?: string;
    storyboardRepairSystem?: string;
    assetsSystem?: string;
    directorSystem?: string;
    videoRefineSystem?: string;
    polishSourceSystem?: string;
    polishScriptSystem?: string;
  };
};
