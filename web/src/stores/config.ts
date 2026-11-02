import { ref } from "vue";
import { defineStore } from "pinia";
import type { RemoteCfg, RemoteSavedImageModel, VideoModelSupportedModes } from "../types";
import { useUiStore } from "./ui";

export type VolcenginePresetsPayload = {
  docVideoUrl: string;
  video: Array<{
    id: string;
    label: string;
    model: string;
    baseUrl: string;
    modes: string[];
    modesLabel: string;
    appNote?: string;
    supportedModes?: VideoModelSupportedModes;
  }>;
  text: Array<{ id: string; label: string; model: string; baseUrl: string; capabilityLine: string }>;
  image: Array<{ id: string; label: string; model: string; baseUrl: string; capabilityLine: string }>;
};

export type BailianPresetsPayload = {
  docUrl: string;
  video: Array<{
    id: string;
    label: string;
    model: string;
    baseUrl: string;
    modes: string[];
    modesLabel: string;
    appNote?: string;
    supportedModes?: VideoModelSupportedModes;
  }>;
  text: Array<{ id: string; label: string; model: string; baseUrl: string; capabilityLine: string }>;
  image: Array<{ id: string; label: string; model: string; baseUrl: string; capabilityLine: string }>;
};

export const AGENT_PROMPT_DEFAULTS = {
  scriptSystem: [
    "你是「剧本 Agent」。根据本章「章节原文」改编短剧剧本，3～8 分钟体量，对白口语化。",
    "",
    "【与原文】制作上要更细：多场次、写清时空与人物、动作与台词可表演；剧情上不得编造原文没有的关键情节/人物关系/结局。剧情与动作、台词列须具体，能指导分镜。",
    "",
    "【格式】0～3 行章前说明（可选）+ 唯一 Markdown 表；表头七列含「原文对照」：| 场次 | 内/外景·时间·地点 | 人物 | 剧情与动作 | 台词/旁白 | 备注 | 原文对照 |；每场在原文对照列摘录对应原文关键句/小段（勿捏造）。勿第二表、勿 HTML。",
  ].join("\n"),
  storyboardSystem: [
    "你是「分镜 Agent」，只输出 JSON 数组。先列场次再为每场至少 2 镜；总 6～48 条。",
    "必填：sceneNo（正整数，与剧本一致）、durationSec（整秒 1～15）、shotSize（远景/全景/中景/近景/特写）、camera（固定/推镜头/拉镜头等）、content（单帧 25～120 字可画描述，禁止然后/接着串多场）。",
    "导演意见须逐项落实（拆场、改时长等），勿只改空话。字段名：sceneNo, durationSec, shotSize, camera, content, dialogue, music, sfx, shotNo（可选）。",
  ].join("\n"),
  storyboardRepairSystem:
    "你是 JSON 修复助手。只输出 JSON 数组。每项须含 sceneNo、durationSec（整秒 1～15）、content、shotSize、camera；每 sceneNo 至少 2 条；总 6～48 条。",
  assetsSystem:
    "你是资产设计 Agent。请从剧本提取视频制作所需视觉资产，只输出 JSON 数组，不要 markdown。每项字段：type, name, key, aliases, sceneNos, prompt, note。type 仅允许：character（角色）、scene（场景）、prop（物品）、costume（服装造型）、action_pose（动作姿态）、fx（特效）。同一实体跨场次重复出现时必须复用同一个 key；aliases 填同义称呼；sceneNos 填出现的场次号数组。总数控制在 8-30 个，优先高复用资产。\n\n说明：保存后服务端会在默认提示末尾自动附加「各 type 的 prompt 须内嵌的生图取向」（如物品透明底、角色三视图等）；若在此覆盖全文，仍会附加该段。",
  directorSystem:
    '你是短剧/漫剧「总导演」，负责质量门禁。通用：结构完整、无违法低俗。对分镜环节须遵守用户消息中的硬约束；硬约束已满足则应 approved:true，勿因风格偏好驳回。\n只输出 JSON：{"approved":true或false,"feedback":"不超过280字"}',
  videoRefineSystem:
    "你是「视频 Agent」。输入为当前各镜头的视频入队计划（JSON）与导演意见。输出**仅** JSON 数组，每项含 shotIndex（数字）与 prompt（修订后的视频生成提示：镜头运动、动作与氛围等；单镜时长由系统参数控制，勿在 prompt 里写秒数）。不要 markdown。",
  polishSourceSystem:
    "你是「原文润色 Agent」。在保留核心情节与人称的前提下润色小说/故事原文：修正语病、统一文风、增强可读性，勿编造重大新情节。直接输出润色后的全文，不要解释或前言。",
  polishScriptSystem:
    "你是「剧本润色 Agent」。优化节奏、场次清晰度与角色口吻；可增强可拍性与具体度，但不改变已定剧情与人物关系。若含 Markdown 场次表（含原文对照列），须保留全部列与表头，只在单元格内润色；原文对照列勿改成无关内容。勿拆成散文，勿删场次行。直接输出全文。",
} as const;

export const useConfigStore = defineStore("config", () => {
  const cfgMessage = ref("");
  const volcPresets = ref<VolcenginePresetsPayload | null>(null);
  const bailianPresets = ref<BailianPresetsPayload | null>(null);
  const cfgDraft = ref<RemoteCfg>({
    text: { provider: "openai-compatible", baseUrl: "", apiKey: "", model: "" },
    image: { provider: "openai-compatible", baseUrl: "", apiKey: "", model: "", size: "1024x1024" },
    video: {
      provider: "http-hook",
      baseUrl: "",
      apiKey: "",
      model: "",
      referenceMode: "off",
      aggregateAssets: true,
      multiReferenceImages: true,
      volcVideoPresetId: undefined,
      arkWatermark: false,
      arkGenerateAudio: true,
    },
    textModels: [],
    imageModels: [],
    videoModels: [],
    ui: { autoSave: false, runnerDelayMs: 600, pipelineAllowPartial: false },
    easyImage: { apiUrl: "", token: "" },
    agentPrompts: {},
  });

  function ensureCfgSections() {
    if (!cfgDraft.value.text)
      cfgDraft.value.text = { provider: "openai-compatible", baseUrl: "", apiKey: "", model: "" };
    if (!cfgDraft.value.image)
      cfgDraft.value.image = { provider: "openai-compatible", baseUrl: "", apiKey: "", model: "", size: "1024x1024" };
    else if (!cfgDraft.value.image.size) cfgDraft.value.image.size = "1024x1024";
    if (!cfgDraft.value.video)
      cfgDraft.value.video = {
        provider: "http-hook",
        baseUrl: "",
        apiKey: "",
        model: "",
        referenceMode: "off",
        aggregateAssets: true,
        multiReferenceImages: true,
        arkWatermark: false,
        arkGenerateAudio: true,
      };
    else {
      if (!cfgDraft.value.video.referenceMode) cfgDraft.value.video.referenceMode = "off";
      if (cfgDraft.value.video.aggregateAssets == null) cfgDraft.value.video.aggregateAssets = true;
      if (cfgDraft.value.video.multiReferenceImages == null) cfgDraft.value.video.multiReferenceImages = true;
      if (cfgDraft.value.video.arkWatermark == null) cfgDraft.value.video.arkWatermark = false;
      if (cfgDraft.value.video.arkGenerateAudio == null) cfgDraft.value.video.arkGenerateAudio = true;
    }
    if (!cfgDraft.value.ui) cfgDraft.value.ui = { autoSave: false, runnerDelayMs: 600, pipelineAllowPartial: false };
    if (cfgDraft.value.ui.autoSave == null) cfgDraft.value.ui.autoSave = false;
    if (cfgDraft.value.ui.runnerDelayMs == null) cfgDraft.value.ui.runnerDelayMs = 600;
    if (cfgDraft.value.ui.pipelineAllowPartial == null) cfgDraft.value.ui.pipelineAllowPartial = false;
    if (!cfgDraft.value.easyImage) cfgDraft.value.easyImage = { apiUrl: "", token: "" };
    if (!cfgDraft.value.textModels) cfgDraft.value.textModels = [];
    if (!cfgDraft.value.imageModels) cfgDraft.value.imageModels = [];
    if (!cfgDraft.value.videoModels) cfgDraft.value.videoModels = [];
    if (!cfgDraft.value.agentPrompts) cfgDraft.value.agentPrompts = {};
    const ap = cfgDraft.value.agentPrompts;
    for (const k of Object.keys(AGENT_PROMPT_DEFAULTS) as Array<keyof typeof AGENT_PROMPT_DEFAULTS>) {
      if (ap[k] == null) ap[k] = "";
    }
  }

  async function loadVolcenginePresets() {
    try {
      const r = await fetch("/api/config/volcengine-presets");
      if (!r.ok) return;
      volcPresets.value = (await r.json()) as VolcenginePresetsPayload;
    } catch {
      volcPresets.value = null;
    }
  }

  async function loadBailianPresets() {
    try {
      const r = await fetch("/api/config/bailian-presets");
      if (!r.ok) return;
      bailianPresets.value = (await r.json()) as BailianPresetsPayload;
    } catch {
      bailianPresets.value = null;
    }
  }

  async function loadRemoteConfig() {
    cfgMessage.value = "";
    try {
      const r = await fetch("/api/config");
      if (!r.ok) throw new Error("加载配置失败");
      cfgDraft.value = { ...cfgDraft.value, ...(await r.json()) } as RemoteCfg;
      ensureCfgSections();
    } catch (e) {
      cfgMessage.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveRemoteConfig() {
    const ui = useUiStore();
    ui.busy = true;
    cfgMessage.value = "";
    try {
      ensureCfgSections();
      const body = {
        text: cfgDraft.value.text
          ? {
              provider: "openai-compatible" as const,
              baseUrl: cfgDraft.value.text.baseUrl ?? "",
              apiKey: cfgDraft.value.text.apiKey ?? "",
              model: cfgDraft.value.text.model ?? "",
            }
          : undefined,
        image: cfgDraft.value.image
          ? {
              provider: "openai-compatible" as const,
              baseUrl: cfgDraft.value.image.baseUrl ?? "",
              apiKey: cfgDraft.value.image.apiKey ?? "",
              model: cfgDraft.value.image.model ?? "",
              size: cfgDraft.value.image.size as "1024x1024" | "1024x1536" | "1536x1024" | undefined,
            }
          : undefined,
        video: cfgDraft.value.video
          ? {
              provider: "http-hook" as const,
              baseUrl: cfgDraft.value.video.baseUrl ?? "",
              apiKey: cfgDraft.value.video.apiKey ?? "",
              model: cfgDraft.value.video.model ?? "",
              referenceMode: cfgDraft.value.video.referenceMode ?? "off",
              aggregateAssets: Boolean(cfgDraft.value.video.aggregateAssets ?? true),
              multiReferenceImages: Boolean(cfgDraft.value.video.multiReferenceImages ?? true),
              volcVideoPresetId: cfgDraft.value.video.volcVideoPresetId?.trim() || undefined,
              supportedModes: cfgDraft.value.video.supportedModes
                ? { ...cfgDraft.value.video.supportedModes }
                : undefined,
              arkRatio: cfgDraft.value.video.arkRatio ?? null,
              arkResolution: cfgDraft.value.video.arkResolution ?? null,
              arkWatermark: cfgDraft.value.video.arkWatermark,
              arkGenerateAudio: cfgDraft.value.video.arkGenerateAudio,
            }
          : undefined,
        textModels: cfgDraft.value.textModels ?? [],
        imageModels: cfgDraft.value.imageModels ?? [],
        videoModels: cfgDraft.value.videoModels ?? [],
        ui: cfgDraft.value.ui
          ? {
              autoSave: Boolean(cfgDraft.value.ui.autoSave),
              runnerDelayMs: Number(cfgDraft.value.ui.runnerDelayMs ?? 600),
              pipelineAllowPartial: Boolean(cfgDraft.value.ui.pipelineAllowPartial ?? false),
            }
          : undefined,
        agentPrompts: cfgDraft.value.agentPrompts ? { ...cfgDraft.value.agentPrompts } : undefined,
        easyImage: cfgDraft.value.easyImage
          ? {
              apiUrl: cfgDraft.value.easyImage.apiUrl ?? "",
              token: cfgDraft.value.easyImage.token ?? "",
            }
          : undefined,
      };
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("保存配置失败");
      cfgDraft.value = { ...cfgDraft.value, ...(await r.json()) } as RemoteCfg;
      ensureCfgSections();
      cfgMessage.value = "已保存。密钥为掩码显示（含 *** 表示继续使用已保存密钥）。";
    } catch (e) {
      cfgMessage.value = e instanceof Error ? e.message : String(e);
    } finally {
      ui.busy = false;
    }
  }

  // Model profile management
  function saveCurrentTextModelProfile() {
    ensureCfgSections();
    const t = cfgDraft.value.text!;
    const id = crypto.randomUUID();
    const n = (cfgDraft.value.textModels?.length ?? 0) + 1;
    cfgDraft.value.textModels!.push({
      id,
      label: `文字 ${n} · ${t.model || "未命名"}`,
      provider: "openai-compatible",
      baseUrl: t.baseUrl,
      apiKey: t.apiKey,
      model: t.model,
    });
  }

  function loadTextModelProfile(id: string) {
    const p = cfgDraft.value.textModels?.find((x) => x.id === id);
    if (!p || !cfgDraft.value.text) return;
    cfgDraft.value.text = {
      provider: "openai-compatible",
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
    };
  }

  function removeTextModelProfile(id: string) {
    cfgDraft.value.textModels = (cfgDraft.value.textModels ?? []).filter((x) => x.id !== id);
  }

  function saveCurrentImageModelProfile() {
    ensureCfgSections();
    const im = cfgDraft.value.image!;
    const id = crypto.randomUUID();
    const n = (cfgDraft.value.imageModels?.length ?? 0) + 1;
    cfgDraft.value.imageModels!.push({
      id,
      label: `生图 ${n} · ${im.model || "未命名"}`,
      provider: "openai-compatible",
      baseUrl: im.baseUrl,
      apiKey: im.apiKey,
      model: im.model,
      size: im.size,
    });
  }

  function loadImageModelProfile(id: string) {
    const p = cfgDraft.value.imageModels?.find((x) => x.id === id);
    if (!p || !cfgDraft.value.image) return;
    cfgDraft.value.image = {
      provider: "openai-compatible",
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      size: (p.size as RemoteSavedImageModel["size"]) || cfgDraft.value.image.size,
    };
  }

  function removeImageModelProfile(id: string) {
    cfgDraft.value.imageModels = (cfgDraft.value.imageModels ?? []).filter((x) => x.id !== id);
  }

  function saveCurrentVideoModelProfile() {
    ensureCfgSections();
    const v = cfgDraft.value.video!;
    const id = crypto.randomUUID();
    const n = (cfgDraft.value.videoModels?.length ?? 0) + 1;
    cfgDraft.value.videoModels!.push({
      id,
      label: `视频 ${n} · ${v.model || "未命名"}`,
      provider: "http-hook",
      baseUrl: v.baseUrl,
      apiKey: v.apiKey,
      model: v.model,
      referenceMode: v.referenceMode,
      aggregateAssets: v.aggregateAssets,
      multiReferenceImages: v.multiReferenceImages,
      volcVideoPresetId: v.volcVideoPresetId,
      supportedModes: v.supportedModes ? { ...v.supportedModes } : undefined,
      arkRatio: v.arkRatio,
      arkResolution: v.arkResolution,
      arkWatermark: v.arkWatermark,
      arkGenerateAudio: v.arkGenerateAudio,
    });
  }

  function loadVideoModelProfile(id: string) {
    const p = cfgDraft.value.videoModels?.find((x) => x.id === id);
    if (!p || !cfgDraft.value.video) return;
    cfgDraft.value.video = {
      provider: "http-hook",
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      referenceMode: p.referenceMode ?? "off",
      aggregateAssets: p.aggregateAssets ?? true,
      multiReferenceImages: p.multiReferenceImages ?? true,
      volcVideoPresetId: p.volcVideoPresetId,
      supportedModes: p.supportedModes ? { ...p.supportedModes } : undefined,
      arkRatio: p.arkRatio,
      arkResolution: p.arkResolution,
      arkWatermark: p.arkWatermark ?? false,
      arkGenerateAudio: p.arkGenerateAudio ?? true,
    };
  }

  function removeVideoModelProfile(id: string) {
    cfgDraft.value.videoModels = (cfgDraft.value.videoModels ?? []).filter((x) => x.id !== id);
  }

  // Preset application
  function applyVolcVideoPresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    const v = cfgDraft.value.video!;
    if (!id) {
      v.volcVideoPresetId = undefined;
      return;
    }
    const p = volcPresets.value?.video.find((x) => x.id === id);
    if (!p) return;
    v.baseUrl = p.baseUrl;
    v.model = p.model;
    v.volcVideoPresetId = p.id;
    v.supportedModes = p.supportedModes ? { ...p.supportedModes } : undefined;
  }

  function applyVolcTextPresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    if (!id) return;
    const p = volcPresets.value?.text.find((x) => x.id === id);
    if (!p || !cfgDraft.value.text) return;
    cfgDraft.value.text.baseUrl = p.baseUrl;
    cfgDraft.value.text.model = p.model;
  }

  function applyVolcImagePresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    if (!id) return;
    const p = volcPresets.value?.image.find((x) => x.id === id);
    if (!p || !cfgDraft.value.image) return;
    cfgDraft.value.image.baseUrl = p.baseUrl;
    cfgDraft.value.image.model = p.model;
  }

  function applyBailianTextPresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    if (!id) return;
    const p = bailianPresets.value?.text.find((x) => x.id === id);
    if (!p || !cfgDraft.value.text) return;
    cfgDraft.value.text.baseUrl = p.baseUrl;
    cfgDraft.value.text.model = p.model;
  }

  function applyBailianImagePresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    if (!id) return;
    const p = bailianPresets.value?.image.find((x) => x.id === id);
    if (!p || !cfgDraft.value.image) return;
    cfgDraft.value.image.baseUrl = p.baseUrl;
    cfgDraft.value.image.model = p.model;
  }

  function applyBailianVideoPresetFromSelect(ev: Event) {
    const id = String((ev.target as HTMLSelectElement).value || "");
    ensureCfgSections();
    const v = cfgDraft.value.video!;
    if (!id) {
      v.volcVideoPresetId = undefined;
      return;
    }
    const p = bailianPresets.value?.video.find((x) => x.id === id);
    if (!p) return;
    v.baseUrl = p.baseUrl;
    v.model = p.model;
    v.volcVideoPresetId = p.id;
    v.supportedModes = p.supportedModes ? { ...p.supportedModes } : undefined;
  }

  return {
    cfgMessage,
    volcPresets,
    bailianPresets,
    cfgDraft,
    ensureCfgSections,
    loadVolcenginePresets,
    loadBailianPresets,
    loadRemoteConfig,
    saveRemoteConfig,
    saveCurrentTextModelProfile,
    loadTextModelProfile,
    removeTextModelProfile,
    saveCurrentImageModelProfile,
    loadImageModelProfile,
    removeImageModelProfile,
    saveCurrentVideoModelProfile,
    loadVideoModelProfile,
    removeVideoModelProfile,
    applyVolcVideoPresetFromSelect,
    applyVolcTextPresetFromSelect,
    applyVolcImagePresetFromSelect,
    applyBailianTextPresetFromSelect,
    applyBailianImagePresetFromSelect,
    applyBailianVideoPresetFromSelect,
  };
});
