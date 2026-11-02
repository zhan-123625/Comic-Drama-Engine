import { getDb } from "./db.js";

export type TextProviderConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ImageProviderConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
};

/** 该视频模型实际支持的能力（分镜可选模式须为子集） */
export type VideoModelSupportedModes = {
  firstFrame?: boolean;
  firstLastFrame?: boolean;
  multiRef?: boolean;
  omni?: boolean;
  /** 分镜可选「纯文本生视频」（不传参考图） */
  textOnly?: boolean;
};

/** 方舟 Seedance 创建任务 `ratio`，与官方文档一致 */
export type ArkVideoRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive";

/** 方舟视频分辨率（部分模型不支持 1080p，见文档） */
export type ArkVideoResolution = "480p" | "720p" | "1080p";

export type VideoProviderConfig = {
  provider: "http-hook";
  baseUrl: string;
  apiKey: string;
  model: string;
  referenceMode?: "off" | "auto";
  aggregateAssets?: boolean;
  /** 为 true 时按序附带多张参考图（分镜关键帧 + 匹配资产图）；为 false 时仅传第一张 */
  multiReferenceImages?: boolean;
  /** 选中火山视频预设时记录，用于前端展示文档能力；不参与请求 */
  volcVideoPresetId?: string;
  /** 本模型支持的分镜视频模式；未填则默认首帧+多图参考 */
  supportedModes?: VideoModelSupportedModes;
  /**
   * 方舟专用：与项目「视频比例」独立时可覆盖请求体 `ratio`；未填则用项目 videoAspect 映射。
   */
  arkRatio?: ArkVideoRatio;
  /** 方舟 `resolution`；未填则由接入点默认（如 720p / 1080p） */
  arkResolution?: ArkVideoResolution;
  /** true = 生成视频含水印；默认 false（去水印） */
  arkWatermark?: boolean;
  /** 方舟 `generate_audio`；默认 true（有声） */
  arkGenerateAudio?: boolean;
};

/** 已保存的模型方案（可多条；当前生效仍用顶层 text/image/video） */
export type SavedTextModel = {
  id: string;
  label: string;
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  volcPresetId?: string;
};

export type SavedImageModel = {
  id: string;
  label: string;
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  volcPresetId?: string;
};

export type SavedVideoModel = {
  id: string;
  label: string;
  provider: "http-hook";
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

export type UiConfig = {
  /** 文本编辑：输入时自动保存原文 */
  autoSave?: boolean;
  /** Runner 间隔延时（ms） */
  runnerDelayMs?: number;
  /**
   * 并行管线策略：剧本后 assets 与 storyboard 并行时，是否允许部分成功。
   * - true：某一分支失败不阻断另一分支；最终仍可继续后续阶段（如 video 需 storyboards）。
   * - false：任一分支失败则整段失败（默认）。
   */
  pipelineAllowPartial?: boolean;
};

/** EasyImage 2.0：apiUrl 为完整地址，如 http://host:10001/api/index.php */
export type EasyImageConfig = {
  apiUrl: string;
  token: string;
};

export type AgentPromptsConfig = {
  scriptSystem?: string;
  storyboardSystem?: string;
  storyboardRepairSystem?: string;
  assetsSystem?: string;
  directorSystem?: string;
  videoRefineSystem?: string;
  polishSourceSystem?: string;
  polishScriptSystem?: string;
  polishAssetPromptSystem?: string;
};

export type AppConfig = {
  text?: TextProviderConfig;
  image?: ImageProviderConfig;
  video?: VideoProviderConfig;
  ui?: UiConfig;
  agentPrompts?: AgentPromptsConfig;
  easyImage?: EasyImageConfig;
  /** 多组文字模型方案；载入某条时写入顶层 text 再保存 */
  textModels?: SavedTextModel[];
  /** 多组生图模型方案 */
  imageModels?: SavedImageModel[];
  /** 多组视频模型方案 */
  videoModels?: SavedVideoModel[];
};

export async function readConfig(): Promise<AppConfig> {
  try {
    const row = getDb().prepare("SELECT config_json FROM app_settings WHERE id = 1").get() as {
      config_json: string;
    };
    const parsed = JSON.parse(row?.config_json || "{}") as AppConfig & {
      video?: { hookUrl?: string; baseUrl?: string; apiKey?: string; model?: string };
    };
    if (parsed?.video && !parsed.video.baseUrl && parsed.video.hookUrl) {
      parsed.video.baseUrl = parsed.video.hookUrl;
    }
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function writeConfig(cfg: AppConfig) {
  getDb().prepare("UPDATE app_settings SET config_json = ? WHERE id = 1").run(JSON.stringify(cfg));
}

/** 前端回传掩码 apiKey（含 ***）时不覆盖本地已保存的密钥 */
function pickApiKey(incoming: string | undefined, prev: string | undefined): string | undefined {
  if (incoming === undefined || incoming === "") return prev;
  if (incoming.includes("***")) return prev;
  return incoming;
}

function pickField(incoming: string | undefined, prev: string | undefined): string {
  if (incoming === undefined) return prev ?? "";
  if (incoming === "" && prev !== undefined && prev !== "") return prev;
  return incoming;
}

function mergeSavedModelList<T extends { id: string; apiKey?: string }>(
  prev: T[] | undefined,
  patch: T[] | undefined,
): T[] | undefined {
  if (patch === undefined) return prev;
  const prevMap = new Map((prev ?? []).map((x) => [x.id, x]));
  return patch.map((row) => ({
    ...row,
    apiKey: pickApiKey(row.apiKey, prevMap.get(row.id)?.apiKey) ?? row.apiKey ?? "",
  }));
}

export function mergeAppConfig(prev: AppConfig, patch: AppConfig): AppConfig {
  const next: AppConfig = { ...prev };
  if (patch.text) {
    next.text = {
      provider: "openai-compatible",
      baseUrl: pickField(patch.text.baseUrl, prev.text?.baseUrl),
      model: pickField(patch.text.model, prev.text?.model),
      apiKey: pickApiKey(patch.text.apiKey, prev.text?.apiKey) ?? "",
    };
  }
  if (patch.image) {
    next.image = {
      provider: "openai-compatible",
      baseUrl: pickField(patch.image.baseUrl, prev.image?.baseUrl),
      model: pickField(patch.image.model, prev.image?.model),
      apiKey: pickApiKey(patch.image.apiKey, prev.image?.apiKey) ?? "",
      size: patch.image.size ?? prev.image?.size,
    };
  }
  if (patch.video) {
    next.video = {
      provider: "http-hook",
      baseUrl: pickField(patch.video.baseUrl, prev.video?.baseUrl),
      apiKey: pickApiKey(patch.video.apiKey, prev.video?.apiKey) ?? "",
      model: pickField(patch.video.model, prev.video?.model),
      referenceMode: patch.video.referenceMode ?? prev.video?.referenceMode ?? "off",
      aggregateAssets: patch.video.aggregateAssets ?? prev.video?.aggregateAssets ?? true,
      multiReferenceImages: patch.video.multiReferenceImages ?? prev.video?.multiReferenceImages ?? true,
      volcVideoPresetId:
        patch.video.volcVideoPresetId !== undefined
          ? patch.video.volcVideoPresetId || undefined
          : prev.video?.volcVideoPresetId,
      supportedModes:
        patch.video.supportedModes !== undefined ? patch.video.supportedModes : prev.video?.supportedModes,
      arkRatio:
        patch.video.arkRatio === null
          ? undefined
          : patch.video.arkRatio !== undefined
            ? patch.video.arkRatio
            : prev.video?.arkRatio,
      arkResolution:
        patch.video.arkResolution === null
          ? undefined
          : patch.video.arkResolution !== undefined
            ? patch.video.arkResolution
            : prev.video?.arkResolution,
      arkWatermark: patch.video.arkWatermark !== undefined ? patch.video.arkWatermark : prev.video?.arkWatermark,
      arkGenerateAudio:
        patch.video.arkGenerateAudio !== undefined ? patch.video.arkGenerateAudio : prev.video?.arkGenerateAudio,
    };
  }
  if (patch.textModels !== undefined) {
    next.textModels = mergeSavedModelList(prev.textModels, patch.textModels);
  }
  if (patch.imageModels !== undefined) {
    next.imageModels = mergeSavedModelList(prev.imageModels, patch.imageModels);
  }
  if (patch.videoModels !== undefined) {
    next.videoModels = mergeSavedModelList(prev.videoModels, patch.videoModels);
  }
  if (patch.ui) {
    next.ui = {
      autoSave: patch.ui.autoSave ?? prev.ui?.autoSave ?? false,
      runnerDelayMs: patch.ui.runnerDelayMs ?? prev.ui?.runnerDelayMs ?? 600,
    };
  }
  if (patch.agentPrompts) {
    next.agentPrompts = {
      ...(prev.agentPrompts ?? {}),
      ...patch.agentPrompts,
    };
  }
  if (patch.easyImage) {
    next.easyImage = {
      apiUrl: pickField(patch.easyImage.apiUrl, prev.easyImage?.apiUrl),
      token: pickApiKey(patch.easyImage.token, prev.easyImage?.token) ?? "",
    };
  }
  return next;
}

export function maskConfig(cfg: AppConfig): AppConfig {
  const maskKey = (k: string) => (k ? `${k.slice(0, 3)}***${k.slice(-3)}` : "");
  return {
    text: cfg.text ? { ...cfg.text, apiKey: cfg.text.apiKey ? maskKey(cfg.text.apiKey) : "" } : undefined,
    image: cfg.image ? { ...cfg.image, apiKey: cfg.image.apiKey ? maskKey(cfg.image.apiKey) : "" } : undefined,
    video: cfg.video
      ? {
          ...cfg.video,
          apiKey: cfg.video.apiKey ? maskKey(cfg.video.apiKey) : "",
        }
      : undefined,
    textModels: cfg.textModels?.map((t) => ({ ...t, apiKey: t.apiKey ? maskKey(t.apiKey) : "" })),
    imageModels: cfg.imageModels?.map((t) => ({ ...t, apiKey: t.apiKey ? maskKey(t.apiKey) : "" })),
    videoModels: cfg.videoModels?.map((t) => ({ ...t, apiKey: t.apiKey ? maskKey(t.apiKey) : "" })),
    ui: cfg.ui ? { ...cfg.ui } : undefined,
    agentPrompts: cfg.agentPrompts ? { ...cfg.agentPrompts } : undefined,
    easyImage: cfg.easyImage
      ? {
          apiUrl: cfg.easyImage.apiUrl,
          token: cfg.easyImage.token ? maskKey(cfg.easyImage.token) : "",
        }
      : undefined,
  };
}
