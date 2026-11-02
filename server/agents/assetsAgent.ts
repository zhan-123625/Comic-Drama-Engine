import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { agentChat } from "./llmClient.js";
import { extractJsonPayload, parseJsonArrayLenient } from "./jsonUtils.js";
import { getPromptOverride } from "./promptConfig.js";
import { buildAssetImageConstraintsForAgentSystemPrompt } from "../assetImagePrompt.js";
import { truncateToSentenceBoundary } from "../utils/textTruncation.js";
import type { AssetItem } from "../types.js";

const ASSET_SCRIPT_MAX_CHARS = 14_000;
const ASSET_MAX_ITEMS = 20;

type RawAsset = {
  type?: string;
  name?: string;
  key?: string;
  aliases?: string[];
  sceneNos?: number[];
  prompt?: string;
  note?: string;
};

const rawAssetSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
    key: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    sceneNos: z.array(z.number()).optional(),
    prompt: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const rawAssetArraySchema = z.array(rawAssetSchema);

function normalizeToken(v: string): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\s\-_.:/\\|]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStableId(type: AssetItem["type"], key: string): number {
  const hash = createHash("sha1").update(`${type}|${key}`).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) >>> 0;
}

function normalizeAssets(items: RawAsset[]): AssetItem[] {
  const normalizeType = (t: unknown): AssetItem["type"] => {
    const s = String(t ?? "");
    if (s === "character" || s === "scene" || s === "prop" || s === "costume" || s === "action_pose" || s === "fx")
      return s;
    return "scene";
  };

  const merged = new Map<string, AssetItem>();
  for (const x of items.slice(0, ASSET_MAX_ITEMS * 3)) {
    const type = normalizeType(x.type);
    const name = String(x.name ?? "")
      .slice(0, 200)
      .trim();
    const prompt = String(x.prompt ?? "")
      .slice(0, 10_000)
      .trim();
    if (!prompt) continue;
    const aliases = Array.isArray(x.aliases)
      ? x.aliases
          .map((a) => String(a ?? "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const rawKey = String(x.key ?? "").trim();
    const keyMaterial =
      normalizeToken(rawKey) ||
      normalizeToken(name) ||
      normalizeToken(aliases[0] ?? "") ||
      normalizeToken(prompt).slice(0, 80) ||
      `${type}-asset`;
    const key = `${type}:${keyMaterial}`;
    const stableId = buildStableId(type, keyMaterial);
    const mergeKey = `${type}#${stableId}`;
    const note = x.note ? String(x.note).slice(0, 2_000).trim() : "";
    const sceneNos = Array.isArray(x.sceneNos)
      ? [...new Set(x.sceneNos.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
      : [];

    const prev = merged.get(mergeKey);
    if (!prev) {
      merged.set(mergeKey, {
        id: randomUUID(),
        index: 0,
        type,
        name: name || `资产`,
        key,
        stableId,
        aliases,
        sceneNos,
        prompt,
        note,
      });
      continue;
    }

    if ((name.length > prev.name.length || !prev.name.trim()) && name) prev.name = name;
    if (prompt.length > prev.prompt.length) prev.prompt = prompt;
    if (note) {
      const mergedNote = [prev.note ?? "", note].filter(Boolean).join("；");
      prev.note = mergedNote.slice(0, 2_000);
    }
    prev.aliases = [...new Set([...(prev.aliases ?? []), ...aliases])].slice(0, 20);
    prev.sceneNos = [...new Set([...(prev.sceneNos ?? []), ...sceneNos])].sort((a, b) => a - b);
  }

  return [...merged.values()].slice(0, ASSET_MAX_ITEMS).map((x, i) => ({
    ...x,
    index: i + 1,
    name: x.name || `资产 ${i + 1}`,
  }));
}

const ASSETS_SYSTEM_BASE = `你是资产设计 Agent。请从剧本提取视频制作所需核心视觉资产，必须只输出合法 JSON 数组，不要 markdown。每项字段：type, name, key, aliases, sceneNos, prompt, note。

【类型定义】type 仅允许：character（角色）、scene（场景）、prop（物品）、costume（服装造型）、action_pose（动作姿态）、fx（特效）。

【实体去重与别名要求】
- 同一实体在不同场次出现时，必须复用同一个 key 与标准全名（例如 name 为“林野”）；
- aliases 数组必须详尽包含该实体在剧本中的所有代称、简称（如林野的别名包含“青年”、“拾荒者”、“小野”等），以便分镜生成与生图时能自动精准对齐；
- sceneNos 必须列出该资产出现的所有正整数场次号。

【prompt 视觉锚点规范（核心）】
prompt 是供文生图模型使用的客观物理特征描述，必须写成具体的【物理视觉标签（Physical Visual Tags）】：
- 角色：必须具体写出发型发色、面部五官轮廓、标志性服装款式/材质与配色、机械义肢/伤疤/关键配饰等客观可画特征。严禁写“心怀复仇/眼神冷酷/命运多舛”等心理文学描写。
- 场景：明确空间结构透视、标志性建筑与陈设、光影氛围、材质与主色调。
- 物品/道具：明确外形轮廓、核心材质、发光/科技细节与色彩。

优先提取 8-16 个核心高复用资产（必须覆盖主要主角、核心关键场景、关键道具），避免过度琐碎。`;

export async function runAssetsAgent(script: string, directorFeedback: string | null): Promise<AssetItem[]> {
  const revision = directorFeedback ? `\n\n【导演修订意见】\n${directorFeedback}` : "";
  const override = await getPromptOverride("assetsSystem");
  const base = override?.trim() ? override : ASSETS_SYSTEM_BASE;
  const assetsSystemPrompt = `${base}\n\n${buildAssetImageConstraintsForAgentSystemPrompt()}`;
  const raw = await agentChat(
    [
      {
        role: "system",
        content: assetsSystemPrompt,
      },
      {
        role: "user",
        content: `【剧本】\n${truncateToSentenceBoundary(script, ASSET_SCRIPT_MAX_CHARS)}${revision}`,
      },
    ],
    0.35,
  );

  let candidate: unknown = parseJsonArrayLenient(raw);

  if (!candidate) {
    try {
      const parsedDirect = JSON.parse(extractJsonPayload(raw));
      if (Array.isArray(parsedDirect)) {
        candidate = parsedDirect;
      } else if (parsedDirect && typeof parsedDirect === "object") {
        const record = parsedDirect as Record<string, unknown>;
        candidate =
          record.assets ||
          record.visual_assets ||
          record.items ||
          record.data ||
          record.list ||
          Object.values(record).find(Array.isArray) ||
          null;
      }
    } catch {
      /* ignore */
    }
  }

  const parsed = rawAssetArraySchema.safeParse(candidate);
  if (!parsed.success) throw new Error("资产 Agent 返回格式不合法（应为数组 JSON）");
  const normalized = normalizeAssets(parsed.data as RawAsset[]).filter((x) => x.prompt.trim());
  if (!normalized.length) throw new Error("资产 Agent 未返回有效资产（prompt 为空）");
  return normalized;
}
