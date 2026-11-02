/**
 * 阿里云百炼常用接入点与模型预设（对齐阿里云百炼与 DashScope 官方规范）
 * @see https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-api-overview
 * @see https://docs.bailian.console.aliyun.com/zh/model-studio/first-api-call-to-qwen
 */

import type { VideoModelSupportedModes } from "./config.js";

export type BailianOpenAiCompatPreset = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  capabilityLine: string;
};

export type BailianVideoRunMode = "t2v" | "i2v_first" | "i2v_first_last" | "multi_ref";

export type BailianVideoModelPreset = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  modes: BailianVideoRunMode[];
  appNote?: string;
  supportedModes: VideoModelSupportedModes;
};

/** 阿里云百炼 OpenAI 兼容接口标准 Base URL */
export const BAILIAN_DASHSCOPE_OPENAI_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** 阿里云百炼 Managed Agents 默认接入点模板 */
export const BAILIAN_MANAGED_AGENTS_DEFAULT_REGION = "cn-beijing";
export const buildManagedAgentsEndpoint = (workspaceId: string, region = BAILIAN_MANAGED_AGENTS_DEFAULT_REGION) =>
  `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/agentstudio`;

export const BAILIAN_TEXT_MODEL_PRESETS: BailianOpenAiCompatPreset[] = [
  {
    id: "qwen-plus",
    label: "通义千问 Plus (qwen-plus)",
    model: "qwen-plus",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "能力均衡，适合剧本编写、分镜拆解与多智能体长上下文生成。",
  },
  {
    id: "qwen-max",
    label: "通义千问 Max (qwen-max)",
    model: "qwen-max",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "旗舰大模型，擅长复杂长篇小说理解、导演审核与深度润色。",
  },
  {
    id: "qwen-turbo",
    label: "通义千问 Turbo (qwen-turbo)",
    model: "qwen-turbo",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "超低延迟与极高性价比，适合快速测试与初筛。",
  },
  {
    id: "bailian-deepseek-v3",
    label: "DeepSeek V3 (百炼托管)",
    model: "deepseek-v3",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "百炼官方高可用托管，开源顶尖水平，通用创作与分析表现优异。",
  },
  {
    id: "bailian-deepseek-r1",
    label: "DeepSeek R1 (百炼托管推理模型)",
    model: "deepseek-r1",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "强化推理与深度思考模型，适合导演审核中的逻辑与连贯性推敲。",
  },
];

export const BAILIAN_IMAGE_MODEL_PRESETS: BailianOpenAiCompatPreset[] = [
  {
    id: "wanx2.1-t2i-turbo",
    label: "通义万相 2.1 极速版 (wanx2.1-t2i-turbo)",
    model: "wanx2.1-t2i-turbo",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "官方原生异步适配，极速高质量出图，适合分镜与资产制作。",
  },
  {
    id: "wanx2.1-t2i-plus",
    label: "通义万相 2.1 标准版 (wanx2.1-t2i-plus)",
    model: "wanx2.1-t2i-plus",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "官方原生异步适配，质感更细腻逼真。",
  },
  {
    id: "wanx-v1",
    label: "通义万相 1.0 (wanx-v1)",
    model: "wanx-v1",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "文生图标准模型，支持 DashScope 原生适配。",
  },
  {
    id: "qwen-image",
    label: "千问生图 (qwen-image 兼容)",
    model: "qwen-image",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "自动转接至通义万相 2.1 极速版生成。",
  },
];

export const BAILIAN_VIDEO_MODEL_PRESETS: BailianVideoModelPreset[] = [
  {
    id: "wan3-0-video",
    label: "万相 3.0 All-in-One 视频生成",
    model: "wan3.0-video",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/generation",
    modes: ["t2v", "i2v_first", "i2v_first_last", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: true, multiRef: true, omni: true, textOnly: true },
    appNote: "支持最长30秒视频，原生多模态参考（首帧/首尾帧/多素材参考）与音画同步。",
  },
  {
    id: "wan2-7-i2v",
    label: "万相 2.7 图生视频",
    model: "wan2.7-i2v",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/generation",
    modes: ["i2v_first", "i2v_first_last", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: true, multiRef: true, omni: false, textOnly: false },
    appNote: "支持单图与首尾帧生视频，戏剧张力与节奏感出色。",
  },
  {
    id: "wan2-1-i2v-plus",
    label: "万相 2.1 图生视频 Plus",
    model: "wan2.1-i2v-plus",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/generation",
    modes: ["i2v_first", "multi_ref"],
    supportedModes: { firstFrame: true, firstLastFrame: false, multiRef: true, omni: false, textOnly: false },
    appNote: "物理规律还原真实，适合将关键帧转换为动态镜头。",
  },
];

const VIDEO_MODE_LABELS: Record<BailianVideoRunMode, string> = {
  t2v: "文生视频",
  i2v_first: "首帧图生视频",
  i2v_first_last: "首尾帧生视频",
  multi_ref: "多图参考",
};

export function formatBailianVideoModes(modes: BailianVideoRunMode[]): string {
  return modes.map((m) => VIDEO_MODE_LABELS[m]).join("、");
}
