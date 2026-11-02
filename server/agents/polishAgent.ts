import { agentChat } from "./llmClient.js";
import type { PolishField, Project } from "../types.js";
import { getPromptOverride } from "./promptConfig.js";

const POLISH_ASSET_PROMPT_DEFAULT =
  "你是「资产生图提示词润色 Agent」。在保留资产名称、类型与关键视觉设定（含 key/别名所指实体）的前提下，将 prompt 改写得更有利于稳定出图：可补充光影、材质、构图与视角、与项目画风一致的表述；勿编造与资产无关的新实体或新剧情。直接输出润色后的提示词正文，不要解释或前言。";

const SYSTEM: Record<PolishField, string> = {
  source:
    "你是「原文润色 Agent」。在保留核心情节与人称的前提下润色小说/故事原文：修正语病、统一文风、增强可读性，勿编造重大新情节。直接输出润色后的全文，不要解释或前言。",
  script:
    "你是「剧本润色 Agent」。优化剧本：节奏更紧凑、场次信息更清晰、角色口吻更鲜明；在不改变已定剧情与人物关系的前提下，可适当强化「剧情与动作」「台词」的可拍性与具体度（仍须保留 Markdown 场次表结构）。若输入含 Markdown「场次」表（表头含：场次、内/外景·时间·地点、人物、剧情与动作、台词/旁白、备注、原文对照），必须保留全部列与表头，只在单元格内润色；「原文对照」列仅可微调标点或删冗，不得改成与原作无关的句子。不要拆成散文，不要删减应有场次行。直接输出润色后的全文。",
};

export async function runPolishAgent(
  field: PolishField,
  text: string,
  meta: Pick<Project, "artStyle" | "genreType" | "videoAspect">,
): Promise<string> {
  const bits: string[] = [];
  if (meta.artStyle?.trim()) bits.push(`画风/视觉：${meta.artStyle.trim()}`);
  if (meta.genreType?.trim()) bits.push(`类型/题材：${meta.genreType.trim()}`);
  if (meta.videoAspect?.trim()) bits.push(`目标视频比例：${meta.videoAspect.trim()}`);
  const hint = bits.length ? `【项目设定】${bits.join("；")}\n\n` : "";

  const systemPrompt =
    (await getPromptOverride(field === "source" ? "polishSourceSystem" : "polishScriptSystem")) ?? SYSTEM[field];
  const raw = await agentChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${hint}【待润色】\n${text.slice(0, 120_000)}` },
    ],
    0.35,
  );
  return raw.trim();
}

export type PolishAssetPromptMeta = Pick<Project, "artStyle" | "genreType" | "videoAspect"> & {
  assetName?: string;
  assetType?: string;
};

export async function runPolishAssetPrompt(text: string, meta: PolishAssetPromptMeta): Promise<string> {
  const bits: string[] = [];
  if (meta.artStyle?.trim()) bits.push(`画风/视觉：${meta.artStyle.trim()}`);
  if (meta.genreType?.trim()) bits.push(`类型/题材：${meta.genreType.trim()}`);
  if (meta.videoAspect?.trim()) bits.push(`目标视频比例：${meta.videoAspect.trim()}`);
  if (meta.assetType?.trim()) bits.push(`资产类型：${meta.assetType.trim()}`);
  if (meta.assetName?.trim()) bits.push(`资产名称：${meta.assetName.trim()}`);
  const hint = bits.length ? `【项目与资产】${bits.join("；")}\n\n` : "";

  const systemPrompt = (await getPromptOverride("polishAssetPromptSystem")) ?? POLISH_ASSET_PROMPT_DEFAULT;
  const raw = await agentChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${hint}【待润色的生图提示词】\n${text.slice(0, 16_000)}` },
    ],
    0.35,
  );
  return raw.trim();
}
