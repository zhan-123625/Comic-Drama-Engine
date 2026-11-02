/**
 * 火山方舟常用接入点与模型预设（能力说明对齐官方文档思路，具体以控制台为准）。
 * @see https://www.volcengine.com/docs/82379/1520757?lang=zh 视频生成任务 API
 */

import type { VideoModelSupportedModes } from "./config.js";

/** 视频：文档中的典型能力维度（不同模型子集不同） */
export type VolcVideoRunMode = "t2v" | "i2v_first" | "i2v_first_last" | "multi_ref";

export type VolcVideoModelPreset = {
  /** 稳定键，写入配置 volcVideoPresetId */
  id: string;
  label: string;
  /** 创建视频任务时请求的 model 字段（须与方舟控制台推理接入点一致） */
  model: string;
  /**
   * 创建任务接口路径：多数为 content_generation 或 contents/generations（以控制台为准）
   */
  baseUrl: string;
  modes: VolcVideoRunMode[];
  /** 与当前应用实现的差异说明 */
  appNote?: string;
  /** 与分镜「视频模式」选项联动（全能参考需控制台实际支持） */
  supportedModes: VideoModelSupportedModes;
};

export type VolcOpenAiCompatPreset = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  /** 能力简述（生图/对话） */
  capabilityLine: string;
};

/** 方舟 OpenAI 兼容 Chat / Responses 常用 base（地域以控制台为准） */
export const VOLC_ARK_OPENAI_BASE = "https://ark.cn-beijing.volces.com/api/v3";

/** 视频任务：与官方「创建视频生成任务」示例路径一致（兼容旧版 content_generation） */
export const VOLC_ARK_VIDEO_TASK_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

export const VOLC_VIDEO_MODEL_PRESETS: VolcVideoModelPreset[] = [
  {
    id: "seedance-1-0-lite-i2v",
    label: "Seedance 1.0 Lite（图生视频）",
    model: "doubao-seedance-1-0-lite-i2v-250428",
    baseUrl: VOLC_ARK_VIDEO_TASK_BASE,
    modes: ["t2v", "i2v_first", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: false, multiRef: true, omni: false, textOnly: true },
    appNote: "本应用按方舟多模态 content 传首帧+多参考图；首尾帧需在供应商侧支持第二张「尾帧」时另行扩展。",
  },
  {
    id: "seedance-1-0-pro-i2v",
    label: "Seedance 1.0 Pro（图生视频）",
    model: "doubao-seedance-1-0-pro-i2v-250428",
    baseUrl: VOLC_ARK_VIDEO_TASK_BASE,
    modes: ["t2v", "i2v_first", "i2v_first_last", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: true, multiRef: true, omni: false, textOnly: true },
    appNote: "是否支持首尾帧、多图以控制台该接入点说明为准；本应用默认发送多张参考图 URL。",
  },
  {
    id: "seedance-1-0-lite-t2v",
    label: "Seedance 1.0 Lite（文生视频）",
    model: "doubao-seedance-1-0-lite-t2v-250428",
    baseUrl: VOLC_ARK_VIDEO_TASK_BASE,
    modes: ["t2v", "i2v_first", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: false, multiRef: true, omni: false, textOnly: true },
  },
  {
    id: "seedance-2-0-pro",
    label: "Seedance 2.0 Pro（文档常见多能力）",
    model: "doubao-seedance-2-0-pro-250415",
    baseUrl: VOLC_ARK_VIDEO_TASK_BASE,
    modes: ["t2v", "i2v_first", "i2v_first_last", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: true, multiRef: true, omni: true, textOnly: true },
    appNote: "模型 ID 请以火山方舟控制台「推理接入点」为准；全能参考依赖网关解析 audio_url / reference_video_url。",
  },
];

export const VOLC_TEXT_MODEL_PRESETS: VolcOpenAiCompatPreset[] = [
  {
    id: "doubao-seed-1-6",
    label: "Doubao-Seed 1.6（对话）",
    model: "doubao-seed-1-6-250615",
    baseUrl: VOLC_ARK_OPENAI_BASE,
    capabilityLine: "方舟 OpenAI 兼容 Chat/Responses，适合 Agents 与长文本。",
  },
  {
    id: "deepseek-v3-1",
    label: "DeepSeek V3.1",
    model: "deepseek-v3-1-250821",
    baseUrl: VOLC_ARK_OPENAI_BASE,
    capabilityLine: "对话与推理；model id 以控制台为准。",
  },
];

export const VOLC_IMAGE_MODEL_PRESETS: VolcOpenAiCompatPreset[] = [
  {
    id: "doubao-seedream-4",
    label: "Doubao-Seedream 4.0（生图）",
    model: "doubao-seedream-4-250828",
    baseUrl: VOLC_ARK_OPENAI_BASE,
    capabilityLine: "文生图 / 图生图（多图参考以接口为准），与 OpenAI images 兼容路径。",
  },
  {
    id: "doubao-seedream-3-t2i",
    label: "Doubao-Seedream 3.0 T2I",
    model: "doubao-seedream-3-0-t2i-250415",
    baseUrl: VOLC_ARK_OPENAI_BASE,
    capabilityLine: "文生图；具体参数见方舟图片生成文档。",
  },
];

const VIDEO_MODE_LABELS: Record<VolcVideoRunMode, string> = {
  t2v: "文生视频",
  i2v_first: "首帧图生视频",
  i2v_first_last: "首尾帧生视频",
  multi_ref: "多图参考",
};

export function formatVolcVideoModes(modes: VolcVideoRunMode[]): string {
  return modes.map((m) => VIDEO_MODE_LABELS[m]).join("、");
}

export function findVolcVideoPresetById(id: string | undefined): VolcVideoModelPreset | undefined {
  if (!id?.trim()) return undefined;
  return VOLC_VIDEO_MODEL_PRESETS.find((p) => p.id === id);
}

export function findVolcVideoPresetByModel(model: string | undefined): VolcVideoModelPreset | undefined {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return undefined;
  return VOLC_VIDEO_MODEL_PRESETS.find((p) => p.model.toLowerCase() === m);
}
