import { agentChat } from "./llmClient.js";
import { extractJsonPayload } from "./jsonUtils.js";
import {
  DIRECTOR_OUTPUT_MAX,
  DIRECTOR_PRIOR_CONTEXT_MAX,
  MAX_STORYBOARD_SHOTS,
  MIN_STORYBOARD_SHOTS,
  SHOT_DURATION_SEC_MAX,
} from "../pipelineConstants.js";
import type { DirectorStep } from "../types.js";
import { getPromptOverride } from "./promptConfig.js";

export type DirectorVerdict = { approved: boolean; feedback: string };

const STEP_HINT: Record<DirectorStep, string> = {
  script: "下一环节将拆分为分镜 JSON，需场次/台词/动作完整、节奏适合短剧。",
  assets: "下一环节将用于资产生图并服务分镜/视频，需覆盖核心场景与关键物品。",
  storyboard: `下一环节将逐镜生图。请按「硬约束」判断是否放行（不要因风格偏好轻易否决）：
【硬约束·须全部满足才可通过】
1) 总条数在 ${MIN_STORYBOARD_SHOTS}～${MAX_STORYBOARD_SHOTS} 之间，或与剧本场次数匹配（略少略多若结构合理可过）。
2) 剧本中**每个有实质对白的场次**（或表中有独立场次号的场）对应 sceneNo 在分镜中**至少出现 2 条**；禁止大量「一场一镜」敷衍。纯过场单场允许 1 镜但不得成片如此。
3) 每条均有 durationSec：正整数秒，且在 1～${SHOT_DURATION_SEC_MAX} 之间（禁止小数）。
4) 每条 content 为**单帧**可视描述（空间、主体、光影、关键道具），非整段故事梗概；明显把多场戏挤在一条里则否决。
5) sceneNo 与剧本场次编号大体对应，无明显串场、全场同一镜号等荒谬情况。
【说明】下方「待审核产出」为摘要 JSON（content/dialogue 等已截断），不得以「某字段字数少」为由否决；只看结构与规则。
【通过策略】若上述硬约束已满足，应 approved:true；若有瑕疵仅在 feedback 里写「可选优化建议」。仅当存在明确结构性违规时才 approved:false 并写清修改要点。
【多章剧本】若剧本含多章，分镜中的 sceneNo 可能为**全局顺延编号**（非每章都从 1 开始）；判断时以摘要中的 sceneNo 与结构为准。
【局部重试】若问题集中在个别场次，feedback 中请写清**阿拉伯数字场次号**（例：场次3、第5场、sceneNo 7），以便仅重生成这些场次而非全剧。`,
  image_batch: "下一环节将提交视频生成，需各镜已有可用参考图与明确画面描述。",
  video_plan: "即将入队视频任务，需每镜具备视频 prompt 与参考图信息。",
};

/**
 * 总导演：审核当前 Agent 产出，未通过则不得进入下一 Agent。
 */
export async function directorReview(opts: {
  step: DirectorStep;
  priorContext: string;
  output: string;
}): Promise<DirectorVerdict> {
  const system =
    (await getPromptOverride("directorSystem")) ??
    `你是短剧/漫剧「总导演」，负责质量门禁，判断是否允许进入下一生产环节。
通用标准：结构完整、逻辑自洽、无违法低俗导向；叙事节奏适合短视频。
对环节 **storyboard（分镜）**：必须遵守用户消息里该环节的「硬约束」说明；**硬约束已全部满足时应当 approved:true**，勿因风格偏好、措辞喜好或摘要截断而驳回；不通过时 feedback 必须写出可执行的修改点（如「场3仅1条请拆成2条以上」）。
只输出 JSON，不要其他文字。格式：{"approved":true或false,"feedback":"不超过280字：通过则简短肯定；不通过则写清修改要点"}`;

  const user = `当前环节：${opts.step}
${STEP_HINT[opts.step]}

【上游/背景摘要】
${opts.priorContext.slice(0, DIRECTOR_PRIOR_CONTEXT_MAX)}

【待审核产出】
${opts.output.slice(0, DIRECTOR_OUTPUT_MAX)}`;

  const raw = await agentChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.15,
  );

  try {
    const j = JSON.parse(extractJsonPayload(raw)) as { approved?: boolean; feedback?: string };
    return {
      approved: Boolean(j.approved),
      feedback: String(j.feedback ?? (j.approved ? "导演审核通过" : "导演未通过，未给出原因")),
    };
  } catch {
    return { approved: false, feedback: "导演未返回合法 JSON，视为不通过，请重试" };
  }
}
