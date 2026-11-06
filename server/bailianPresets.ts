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
    label: "通义万相 2.1 极速版 (wanx2.1-t2i-turbo) · 推荐分镜生图",
    model: "wanx2.1-t2i-turbo",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "官方推荐影视分镜生图；质感细腻现代，由高精结构化 Prompt 注入角色五官与服饰细节。",
  },
  {
    id: "wanx2.1-t2i-plus",
    label: "通义万相 2.1 标准版 (wanx2.1-t2i-plus) · 高精影视级",
    model: "wanx2.1-t2i-plus",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "高精影视级生图，画质更细腻，配合单体立绘垫图完美还原角色设定与镜头光影。",
  },
  {
    id: "wanx2.1-imageedit",
    label: "通义万相 2.1 图像编辑/图生图 (wanx2.1-imageedit)",
    model: "wanx2.1-imageedit",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "官方图生图与指令重绘模型，基于输入底图进行场景扩展、主体编辑与背景替换。",
  },
  {
    id: "wanx-v1",
    label: "通义万相 1.0 (wanx-v1) · 图生图重绘",
    model: "wanx-v1",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "支持单图重绘变体（ref_img）。注意：若输入为三视图，将生成三视图重绘变体。",
  },
  {
    id: "qwen-image",
    label: "千问生图 (qwen-image 兼容)",
    model: "qwen-image",
    baseUrl: BAILIAN_DASHSCOPE_OPENAI_BASE,
    capabilityLine: "默认采用万相 2.1 高精影视分镜生图。",
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

export type BailianTtsModelPreset = {
  id: string;
  label: string;
  model: string;
  voiceName: string;
  gender: "female" | "male";
  appNote: string;
};

export const BAILIAN_TTS_MODEL_PRESETS: BailianTtsModelPreset[] = [
  {
    id: "cosyvoice-v2:longxiaochun_v2",
    label: "龙小春 · 灵动萌系女童（团团首选·大模型情感语音）",
    model: "cosyvoice-v2:longxiaochun_v2",
    voiceName: "龙小春",
    gender: "female",
    appNote: "通义 CosyVoice-v2 大模型生成式语音，萌系可爱、情绪饱满、起伏自然生动，绝不机械，团团天选配音！",
  },
  {
    id: "cosyvoice-v2:longshuo_v2",
    label: "龙硕 · 阳光风趣少年（滚滚首选·大模型情感语音）",
    model: "cosyvoice-v2:longshuo_v2",
    voiceName: "龙硕",
    gender: "male",
    appNote: "通义 CosyVoice-v2 大模型生成式语音，活泼幽默、富有感情起伏与呼吸感，滚滚天选配音！",
  },
  {
    id: "cosyvoice-v2:longjielidou_v2",
    label: "杰力豆 · 卡通幽默搞怪（滚滚卡通风·大模型情感语音）",
    model: "cosyvoice-v2:longjielidou_v2",
    voiceName: "杰力豆",
    gender: "male",
    appNote: "通义 CosyVoice-v2 搞怪喜感卡通童声，极度适合喜剧日常与调皮憨厚的胖达滚滚！",
  },
  {
    id: "cosyvoice-v2:longwan_v2",
    label: "龙婉 · 温润知性抒情（旁白首选·大模型情感语音）",
    model: "cosyvoice-v2:longwan_v2",
    voiceName: "龙婉",
    gender: "female",
    appNote: "通义 CosyVoice-v2 温柔知性叙事女声，极度细腻、情感丰富，适合电影级旁白解说。",
  },
  {
    id: "cosyvoice-v2:longmiao_v2",
    label: "龙喵 · 软萌可爱萝莉（女配萌宠·大模型情感语音）",
    model: "cosyvoice-v2:longmiao_v2",
    voiceName: "龙喵",
    gender: "female",
    appNote: "奶萌萝莉音色，甜美可爱，适合软萌女角色与小动物配音。",
  },
  {
    id: "cosyvoice-v2:longcheng_v2",
    label: "龙橙 · 磁性沉稳解说（沉稳男声·大模型情感语音）",
    model: "cosyvoice-v2:longcheng_v2",
    voiceName: "龙橙",
    gender: "male",
    appNote: "磁性稳重，咬字清晰，适合大叔、长辈角色或纪录片感旁白。",
  },
  {
    id: "cosyvoice-v2:longfeifei_v2",
    label: "龙菲菲 · 傲娇元气少女（大模型情感语音）",
    model: "cosyvoice-v2:longfeifei_v2",
    voiceName: "龙菲菲",
    gender: "female",
    appNote: "元气满满，情绪张力强，适合活泼任性或傲娇少女角色。",
  },
  {
    id: "cosyvoice-v2:longlaotie_v2",
    label: "龙老铁 · 幽默东北大叔（大模型情感语音）",
    model: "cosyvoice-v2:longlaotie_v2",
    voiceName: "龙老铁",
    gender: "male",
    appNote: "热情豪爽，极具感染力与幽默感，适合喜剧角色。",
  },
  {
    id: "sambert-zhiwei-v1",
    label: "知薇 · 纯真可爱萝莉（Sambert备选）",
    model: "sambert-zhiwei-v1",
    voiceName: "知薇",
    gender: "female",
    appNote: "纯真萝莉童声，适合儿童角色与可爱少女。",
  },
  {
    id: "sambert-zhiming-v1",
    label: "知明 · 幽默风趣男声（Sambert备选）",
    model: "sambert-zhiming-v1",
    voiceName: "知明",
    gender: "male",
    appNote: "略带幽默口吻，适合轻松喜剧或日常戏剧角色。",
  },
  {
    id: "sambert-zhiting-v1",
    label: "知婷 · 温柔知性叙事（Sambert备选）",
    model: "sambert-zhiting-v1",
    voiceName: "知婷",
    gender: "female",
    appNote: "温柔舒缓，情感充沛，适合抒情对白与叙事旁白。",
  },
  {
    id: "sambert-zhixiao-v1",
    label: "知澖 · 活泼亲切女声（传统标准）",
    model: "sambert-zhixiao-v1",
    voiceName: "知澖",
    gender: "female",
    appNote: "传统神经语音，音色明亮亲切。",
  },
  {
    id: "sambert-zhichu-v1",
    label: "知厨 · 沉稳自然男声（传统标准）",
    model: "sambert-zhichu-v1",
    voiceName: "知厨",
    gender: "male",
    appNote: "成熟男声，咬字沉稳有力。",
  },
];
