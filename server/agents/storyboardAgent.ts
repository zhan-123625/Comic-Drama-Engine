import { agentChat } from "./llmClient.js";
import { extractJsonPayload } from "./jsonUtils.js";
import { getPromptOverride } from "./promptConfig.js";
import { truncateToSentenceBoundary } from "../utils/textTruncation.js";
import {
  parseStoryboardChapterChunk,
  parseStoryboardItems,
  parseStoryboardItemsForScenes,
} from "../storyboardSchema.js";
import {
  MAX_STORYBOARD_SHOTS,
  MIN_STORYBOARD_SHOTS,
  SHOT_DURATION_SEC_MAX,
  SHOT_DURATION_SEC_MIN,
  STORYBOARD_REPAIR_SNIPPET_MAX_CHARS,
  STORYBOARD_SCRIPT_MAX_CHARS,
} from "../pipelineConstants.js";
import type { StoryboardShot } from "../types.js";

function mapToShots(
  items: Array<{
    shotNo?: unknown;
    sceneNo?: number;
    shotSize?: string;
    camera?: string;
    content: string;
    dialogue?: string;
    music?: string;
    sfx?: string;
    durationSec?: number;
    prompt?: string;
    note?: string;
  }>,
): StoryboardShot[] {
  return items.slice(0, MAX_STORYBOARD_SHOTS).map((it, idx) => ({
    id: crypto.randomUUID(),
    index: idx + 1,
    shotNo: String(it.shotNo ?? idx + 1),
    sceneNo: typeof it.sceneNo === "number" && Number.isInteger(it.sceneNo) && it.sceneNo > 0 ? it.sceneNo : undefined,
    shotSize: String(it.shotSize ?? "").slice(0, 200),
    camera: String(it.camera ?? "").slice(0, 400),
    content: String(it.content ?? "").slice(0, 10_000),
    dialogue: String(it.dialogue ?? "").slice(0, 10_000),
    music: String(it.music ?? "").slice(0, 2000),
    sfx: String(it.sfx ?? "").slice(0, 2000),
    durationSec: (() => {
      const d = it.durationSec;
      if (typeof d !== "number" || !Number.isFinite(d)) return undefined;
      const intSec = Math.round(d);
      return Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, intSec));
    })(),
    // 兼容：prompt/note 仍落库，但优先用 content 作为默认 prompt（便于旧逻辑继续工作）
    prompt: String(it.prompt ?? it.content ?? "").slice(0, 10_000),
    note: String(it.note ?? "").slice(0, 10_000),
  }));
}

async function repairStoryboardJson(badRaw: string): Promise<string> {
  const repairSystemPrompt =
    (await getPromptOverride("storyboardRepairSystem")) ??
    `你是 JSON 修复助手。只输出一个 JSON 数组，不要 markdown。
每项必须含：sceneNo（正整数，与剧本场次一致）、durationSec（整秒整数 ${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}）、content、shotSize、camera。
content 须含分段标题：**首帧**：（单帧静景）；**镜内动态与神态**：（动作、神情、与语气关系，勿写出台词汉字）；**尾帧**：（结束瞬间，可写「同首帧」）。
每项 shotSize（景别：远景/全景/中景/近景/特写之一）、camera（摄法：固定/推镜头/拉镜头/摇镜头/移镜头/跟拍 等之一）。
规则：每个 sceneNo 在数组中至少出现 2 次（同场多镜）；总条数 ${MIN_STORYBOARD_SHOTS}～${MAX_STORYBOARD_SHOTS}；禁止一场一镜占多数。`;
  return agentChat(
    [
      {
        role: "system",
        content: repairSystemPrompt,
      },
      {
        role: "user",
        content: `以下内容无法解析为合法 JSON 数组，请修正并仅输出数组：\n${badRaw.slice(0, STORYBOARD_REPAIR_SNIPPET_MAX_CHARS)}`,
      },
    ],
    0.2,
  );
}

/**
 * 全量分镜生成入口：解析 LLM 输出并做结构校验，失败时自动修复重试一次。
 */
export async function runStoryboardAgent(script: string, directorFeedback: string | null): Promise<StoryboardShot[]> {
  const revision = directorFeedback
    ? `\n\n【导演修订意见】须逐项落实后再输出**完整** JSON 数组（补拆场次、改 sceneNo/durationSec、把「一场一镜」拆开等；禁止只改措辞敷衍）：\n${directorFeedback}`
    : "";

  const storyboardSystemPrompt =
    (await getPromptOverride("storyboardSystem")) ??
    `你是「分镜 Agent」，为短剧/漫剧生成可拍、可生图的分镜表。只输出 **一个 JSON 数组**，不要 markdown、不要解释。

【工作流（先想后写）】
1) 通读剧本，列出所有「场次」编号：来自 Markdown 表格「场次」列、或「### 第N场/场N」标题、或连续场号；统一为 **正整数 sceneNo**（与剧本一致，勿自编无关编号）。
2) 对每个场次：至少输出 **2 条** 分镜（同 sceneNo 连续排列），按台词与动作节拍拆：建立镜头→反应→对白特写→走位 等；**禁止**用 1 条镜讲完一场（除非该场仅一句无对白过场）。
3) 再检查总条数是否在 ${MIN_STORYBOARD_SHOTS}～${MAX_STORYBOARD_SHOTS}；不足则给重要场次加镜，超出则合并次要过场。

【硬约束·违反会导致审核失败】
- sceneNo：必填正整数，且每个在剧本中出现的场次编号，在 JSON 里至少对应 **2 条** 镜头。
- durationSec：必填，**整秒**整数，范围 ${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}，禁止小数与 0。
- shotSize：必填，从以下选：**远景、全景、中景、近景、特写**（或等价简体）。
- camera：必填，从以下选：**固定、推镜头、拉镜头、摇镜头、移镜头、跟拍、航拍、手持**（或等价简体）。
- content：必填，须为**三段式**（用小标题，便于系统解析；**不要**删掉标题只留正文）：
  **首帧**：（约 35～100 字）镜头**起始瞬间**的单一静态画面：构图、主体姿态与站位、环境陈设要点、光影色调、关键道具；须是一格静图可画完；**禁止**用「然后/接着/最后」在同段串联多个时间点。
  **镜内动态与神态**：（约 45～200 字）在 durationSec 与 camera 下，镜内**动作与走位过程**、**表情与眼神变化**（如由愣住到躲闪）、与**台词语气/潜台词**的关系（用「咬牙」「欲言又止」等描述，**勿在此段写对白原句汉字**，避免被生图模型画成字幕）；可提氛围，勿写拟声词上屏。
  **尾帧**：（约 25～90 字，建议必填）**镜头结束瞬间**的静态画面；与首帧须空间逻辑一致。若结束与开始仅神态不同请写明。几乎无变化可写「**尾帧**：同首帧构图，神态转为……」。极短过场可「**尾帧**：同首帧」。
- 实体命名规范（必须严格遵守）：在 content（首帧、镜内动态与神态、尾帧）中，提及任何角色或核心道具时，**必须使用标准实体全称（如“林野”、“艾拉”）**，**严禁使用“青年/男子/他/女子”等模糊代词**，确保分镜画面能精准匹配并调用资产设定的视觉外貌。
- dialogue / music / sfx：可空；**台词原文只写在 dialogue**，不要在 content 的「镜内」段粘贴对白全文。

【导演修订】若用户消息含「导演修订意见」，必须 **逐条落实**（补场次、拆镜、改时长、改 sceneNo、改单帧描述等），不要只改空话。

【输出】纯 JSON 数组，元素字段名用英文：sceneNo, durationSec, shotSize, camera, content, dialogue, music, sfx, shotNo（可选）。`;
  const raw = await agentChat(
    [
      {
        role: "system",
        content: storyboardSystemPrompt,
      },
      {
        role: "user",
        content: `【剧本】\n${truncateToSentenceBoundary(script, STORYBOARD_SCRIPT_MAX_CHARS)}${revision}`,
      },
    ],
    0.28,
  );

  const tryParse = (text: string): StoryboardShot[] | null => {
    try {
      const arr = JSON.parse(extractJsonPayload(text)) as unknown;
      const items = parseStoryboardItems(arr);
      return mapToShots(items);
    } catch {
      return null;
    }
  };

  const first = tryParse(raw);
  if (first) return first;

  const repaired = await repairStoryboardJson(raw);
  const second = tryParse(repaired);
  if (second) return second;

  throw new Error("分镜 Agent 未返回可校验的 JSON（已尝试自动修复 1 次仍失败）");
}

async function repairStoryboardChapterJson(badRaw: string): Promise<string> {
  const repairSystemPrompt =
    (await getPromptOverride("storyboardRepairSystem")) ??
    `你是 JSON 修复助手。只输出一个 JSON 数组，不要 markdown。
每项须含 sceneNo（正整数，与**本块**剧本表「场次」列一致）、durationSec（整秒 ${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}）、content、shotSize、camera。
content 须含 **首帧** / **镜内动态与神态**（或 **镜内动态**）/ **尾帧** 分段。
本块内每个 sceneNo 至少出现 2 次；总条数至少 2、至多 ${MAX_STORYBOARD_SHOTS}。`;
  return agentChat(
    [
      { role: "system", content: repairSystemPrompt },
      {
        role: "user",
        content: `以下内容无法解析为合法 JSON 数组，请修正并仅输出数组：\n${badRaw.slice(0, STORYBOARD_REPAIR_SNIPPET_MAX_CHARS)}`,
      },
    ],
    0.2,
  );
}

/**
 * 章节级分镜生成入口：仅对单块剧本（通常一章）输出分镜数组。
 */
export async function runStoryboardChapterAgent(
  scriptChunkWithMeta: string,
  directorFeedback: string | null = null,
): Promise<StoryboardShot[]> {
  const revision = directorFeedback ? `\n\n【导演修订意见】须在本块内逐项落实：\n${directorFeedback}` : "";

  const chapterScopeNote =
    "\n\n【范围】以下为剧本中**一章或一块**：只根据本块内场次表拆镜；sceneNo 用本块表「场次」列数字（局部编号）；总条数至少 2、至多 " +
    `${MAX_STORYBOARD_SHOTS}（单章可少于全剧合计下限 ${MIN_STORYBOARD_SHOTS}）。`;
  const customStoryboard = await getPromptOverride("storyboardSystem");
  const storyboardSystemPrompt = customStoryboard
    ? `${customStoryboard}${chapterScopeNote}`
    : `你是「分镜 Agent」，为短剧/漫剧生成可拍、可生图的分镜表。只输出 **一个 JSON 数组**，不要 markdown、不要解释。

【范围】用户消息中的剧本仅为**一章或一块**，只根据其中的场次表拆镜；**场次号 sceneNo 使用本块表格「场次」列的数字**（局部编号即可，勿引用其它章）。

【工作流】
1) 列出本块表格中所有场次编号；每个场次至少 **2 条** 分镜（同 sceneNo 连续排）。
2) 总条数至少 2、至多 ${MAX_STORYBOARD_SHOTS}（单章可少于全剧常见的 ${MIN_STORYBOARD_SHOTS} 条）。

【硬约束】sceneNo、durationSec（整秒 ${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}）、shotSize、camera、content（须含 **首帧** / **镜内动态与神态**（或 **镜内动态**）/ **尾帧** 三段标题与内容）均须符合主流程分镜规范；角色与关键道具在 content 中必须使用标准全名（严禁使用代词“青年/男子/他/女子”）；dialogue/music/sfx 可空。

【输出】纯 JSON 数组：sceneNo, durationSec, shotSize, camera, content, dialogue, music, sfx, shotNo（可选）。`;

  const raw = await agentChat(
    [
      { role: "system", content: storyboardSystemPrompt },
      {
        role: "user",
        content: `【本章/本块剧本】\n${truncateToSentenceBoundary(scriptChunkWithMeta, STORYBOARD_SCRIPT_MAX_CHARS)}${revision}`,
      },
    ],
    0.28,
  );

  const tryParse = (text: string): StoryboardShot[] | null => {
    try {
      const arr = JSON.parse(extractJsonPayload(text)) as unknown;
      const items = parseStoryboardChapterChunk(arr);
      return mapToShots(items);
    } catch {
      return null;
    }
  };

  const first = tryParse(raw);
  if (first) return first;
  const repaired = await repairStoryboardChapterJson(raw);
  const second = tryParse(repaired);
  if (second) return second;
  throw new Error("分镜（单块）Agent 未返回可校验的 JSON（已尝试自动修复 1 次仍失败）");
}

async function repairStoryboardPartialJson(badRaw: string, globalSceneNos: number[]): Promise<string> {
  const list = [...globalSceneNos].sort((a, b) => a - b).join("、");
  return agentChat(
    [
      {
        role: "system",
        content: `你是 JSON 修复助手。只输出一个 JSON 数组。仅含全局场次号：${list}；每条 sceneNo 必须属于该集合；每个场次至少 2 条分镜；须含 durationSec（整秒）、shotSize、camera、content（含 **首帧**/ **镜内动态与神态**/ **尾帧** 分段）。`,
      },
      {
        role: "user",
        content: `请修正为合法数组：\n${badRaw.slice(0, STORYBOARD_REPAIR_SNIPPET_MAX_CHARS)}`,
      },
    ],
    0.2,
  );
}

/**
 * 分镜局部重生成入口：仅重算指定全局场次号，用于导演打回后的局部修订。
 */
export async function runStoryboardAgentPartial(
  fullScriptWithMeta: string,
  globalSceneNos: number[],
  directorFeedback: string | null,
): Promise<StoryboardShot[]> {
  if (!globalSceneNos.length) throw new Error("runStoryboardAgentPartial: globalSceneNos 为空");
  const sorted = [...globalSceneNos].sort((a, b) => a - b);
  const list = sorted.join("、");

  const partialExtra =
    `\n\n【局部重生成·硬约束】你只输出一个 JSON 数组，且**仅含**全局场次号为 **${list}** 的镜头。\n` +
    `每条 sceneNo 必须是上述数字之一；**每个**上述场次至少 **2 条**分镜；不得输出其它场次。\n` +
    `全局场次说明：多章剧本已按章把局部场次顺延编号；请对照下方全剧剧本中各章表格理解编号。`;

  const revision = directorFeedback ? `\n\n【导演修订意见】仅针对上述场次逐项修改：\n${directorFeedback}` : "";

  const baseSystem =
    (await getPromptOverride("storyboardSystem")) ??
    `你是「分镜 Agent」。只输出 JSON 数组，不要 markdown。字段：sceneNo, durationSec, shotSize, camera, content, dialogue, music, sfx, shotNo（可选）。` +
      ` durationSec 为整秒 ${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}；content 须含 **首帧** / **镜内动态与神态** / **尾帧** 三段（动态与神情写满，首帧为单帧静景）。`;

  const raw = await agentChat(
    [
      { role: "system", content: `${baseSystem}${partialExtra}` },
      {
        role: "user",
        content: `【全剧剧本·供对照场次与台词】\n${truncateToSentenceBoundary(fullScriptWithMeta, STORYBOARD_SCRIPT_MAX_CHARS)}${revision}`,
      },
    ],
    0.28,
  );

  const tryParse = (text: string): StoryboardShot[] | null => {
    try {
      const arr = JSON.parse(extractJsonPayload(text)) as unknown;
      const items = parseStoryboardItemsForScenes(arr, sorted);
      return mapToShots(items);
    } catch {
      return null;
    }
  };

  const first = tryParse(raw);
  if (first) return first;
  const repaired = await repairStoryboardPartialJson(raw, sorted);
  const second = tryParse(repaired);
  if (second) return second;
  throw new Error("分镜局部重生成未返回可校验的 JSON（已尝试自动修复 1 次仍失败）");
}
