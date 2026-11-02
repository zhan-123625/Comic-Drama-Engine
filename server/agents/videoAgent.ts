import type { StoryboardShot } from "../types.js";
import { z } from "zod";
import { VIDEO_REFINE_FEEDBACK_MAX } from "../pipelineConstants.js";
import { agentChat } from "./llmClient.js";
import { extractJsonPayload } from "./jsonUtils.js";
import { getPromptOverride } from "./promptConfig.js";
import { composeStoryboardPrompt } from "../storyboardPrompt.js";

export type VideoJobPlanItem = {
  shotIndex: number;
  prompt: string;
  imageUrl?: string;
  note?: string;
};

const refinedVideoPlanItemSchema = z.object({
  shotIndex: z.coerce.number().int().positive(),
  prompt: z.string().min(1),
});

const refinedVideoPlanArraySchema = z.array(refinedVideoPlanItemSchema);

/**
 * 「视频 Agent」：根据已通过审核的分镜，整理入队计划（供导演终审后再真正 enqueue）。
 */
export function buildVideoJobPlan(shots: StoryboardShot[]): VideoJobPlanItem[] {
  return shots.map((s) => ({
    shotIndex: s.index,
    prompt: composeStoryboardPrompt(s, { omitDuration: true }),
    imageUrl: s.imageUrl,
    note: s.note,
  }));
}

export function serializeVideoPlanForDirector(plan: VideoJobPlanItem[]): string {
  return JSON.stringify(
    plan.map((p) => ({
      shotIndex: p.shotIndex,
      prompt: p.prompt.slice(0, 500),
      hasImage: Boolean(p.imageUrl),
      note: (p.note ?? "").slice(0, 200),
    })),
    null,
    2,
  );
}

/**
 * 导演退回视频计划时，按意见修订各镜「视频侧」可用的画面/运动描述（仍用于 Hook 的 prompt）。
 */
export async function refineVideoJobPlan(
  plan: VideoJobPlanItem[],
  directorFeedback: string,
): Promise<VideoJobPlanItem[]> {
  const videoRefineSystemPrompt =
    (await getPromptOverride("videoRefineSystem")) ??
    "你是「视频 Agent」。输入为当前各镜头的视频入队计划（JSON）与导演意见。输出**仅** JSON 数组，每项含 shotIndex（数字）与 prompt（修订后的视频生成提示：镜头运动、动作与氛围等；**单镜时长由系统参数 duration 决定，勿在 prompt 里写秒数/时长**）。不要 markdown。";
  const raw = await agentChat(
    [
      {
        role: "system",
        content: videoRefineSystemPrompt,
      },
      {
        role: "user",
        content: `【当前计划】\n${JSON.stringify(plan.map((p) => ({ shotIndex: p.shotIndex, prompt: p.prompt, note: p.note })))}\n\n【导演意见】\n${directorFeedback.slice(0, VIDEO_REFINE_FEEDBACK_MAX)}`,
      },
    ],
    0.35,
  );

  try {
    const parsed = refinedVideoPlanArraySchema.safeParse(JSON.parse(extractJsonPayload(raw)));
    if (!parsed.success) throw new Error("invalid refine payload");
    const map = new Map(parsed.data.map((x) => [x.shotIndex, x.prompt]));
    return plan.map((p) => ({
      ...p,
      prompt: map.get(p.shotIndex)?.trim() || p.prompt,
    }));
  } catch {
    return plan;
  }
}
