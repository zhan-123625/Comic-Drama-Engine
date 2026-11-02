import { agentChat } from "./llmClient.js";
import { SCRIPT_INPUT_MAX_CHARS } from "../pipelineConstants.js";
import { getPromptOverride } from "./promptConfig.js";
import { truncateToSentenceBoundary } from "../utils/textTruncation.js";

/**
 * 章节剧本生成入口：根据章节原文（或上游文本）产出标准场次 Markdown 表。
 */
export async function runScriptAgent(
  input: { chapterTitle: string; chapterContent: string; outlineHint?: string } | string,
  directorFeedback: string | null,
): Promise<string> {
  const isChapterMode = typeof input !== "string";
  const chapterTitle = isChapterMode ? input.chapterTitle : "";

  let revision = "";
  if (directorFeedback) {
    if (isChapterMode) {
      revision = [
        "",
        `【导演修订意见】`,
        `（特别说明：你当前仅负责编写本章【${chapterTitle}】的场次剧本！`,
        `若下方意见中提及了其他章节如补齐结局、其他章节截断等，请只关注与本章直接相关的修改点；`,
        `严禁在本章中输出类似“第X章原文未提供”等无关说明，确保本章自身情节完整、收尾完整）：`,
        directorFeedback,
      ].join("\n");
    } else {
      revision = `\n\n【导演修订意见】必须逐条响应并体现在新版剧本中：\n${directorFeedback}`;
    }
  }

  const systemPrompt =
    (await getPromptOverride("scriptSystem")) ??
    [
      "你是「剧本 Agent」。根据本章「章节原文」改编为短剧剧本，适合 3～8 分钟体量，对白口语化。",
      "",
      "【与原文的关系 — 必须遵守】",
      "1）制作维度要比原文更细：必须拆成多个「场次」（单章通常建议拆解为 4～8 场，保持精炼紧凑，必须完整写到本章收尾）；每场写清内/外景、时间、地点、在场人物、可见动作与走位、可表演的台词或旁白；原文里叙述性、心理描写要改写为可拍、可说的内容。",
      "2）剧情维度不得越界：禁止编造原文没有的关键情节、人物关系转折、结局走向；可删繁就简、合并次要信息，但主干因果必须与原文一致。",
      "3）「剧情与动作」「台词/旁白」两列必须具体到能指导分镜与表演，避免空泛词（如「两人聊天」要写成谁在什么情境下说了什么要点）。",
      "4）若原文某段信息不足，仅在备注中写「（原文未写）可推断…」之类轻量补全，不得当作既定事实写进剧情列。",
      "",
      "【输出格式 — 必须遵守】",
      "1）先可写 0～3 行章前说明（可选）；",
      "2）然后输出且仅输出一个 Markdown 表格，覆盖本章全部情节，一场占一行；必须输出完整闭合的表格，不得在中间截断；",
      "3）表头必须完全一致（含空格与竖线，共七列）：",
      "| 场次 | 内/外景·时间·地点 | 人物 | 剧情与动作 | 台词/旁白 | 备注 | 原文对照 |",
      "4）表头下一行必须是分隔行（七列），例如：|------|------------------|------|------------|----------|------|----------------|；",
      "5）「场次」用阿拉伯数字；「内/外景·时间·地点」写清内景/外景、日/夜、地点；「台词/旁白」写对白或（旁白）说明；「备注」可写镜头调度、道具、情绪提示等。",
      "6）「原文对照」列：每场必须填写与本场对应的「章节原文」摘录（关键句或一小段，尽量照录；可略去无关字句但不得捏造原文没有的内容），便于人工核对场次与原文的对应关系。",
      "7）不要输出第二个表格；不要用 HTML 表格；不要用大段散文替代表格。",
    ].join("\n");
  const userContent =
    typeof input === "string"
      ? `【上游文本】\n${truncateToSentenceBoundary(input, SCRIPT_INPUT_MAX_CHARS)}${revision}`
      : [
          `【当前章节】标题：${input.chapterTitle}`,
          "",
          "【对照要求】请逐句对照下方「章节原文」拆解场次表：制作上要细于原文叙述，剧情上不得胡编关键事实，确保本章全情节完整收束，不留未完截断。",
          "",
          `【章节原文】\n${truncateToSentenceBoundary(input.chapterContent, SCRIPT_INPUT_MAX_CHARS)}`,
          "",
          `【可选补充约束】\n${truncateToSentenceBoundary(String(input.outlineHint ?? ""), 3000) || "（无）"}`,
          revision,
        ].join("\n");
  const raw = await agentChat(
    [
      {
        role: "system",
        content: systemPrompt,
      },
      { role: "user", content: userContent },
    ],
    0.45,
  );
  return raw.trim();
}
