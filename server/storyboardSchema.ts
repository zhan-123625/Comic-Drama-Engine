import { z } from "zod";
import {
  MAX_STORYBOARD_SHOTS,
  MIN_STORYBOARD_SHOTS,
  SHOT_DURATION_SEC_MAX,
  SHOT_DURATION_SEC_MIN,
} from "./pipelineConstants.js";

/**
 * 分镜 Agent 输出的单条结构（LLM JSON 数组元素）
 */
export const storyboardItemSchema = z.object({
  /** 镜头号（可选；最终会按数组顺序重排） */
  shotNo: z.union([z.number().int().min(1), z.string()]).optional(),
  /** 景别 */
  shotSize: z
    .union([z.string().max(200), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  /** 摄法/镜头运动 */
  camera: z
    .union([z.string().max(400), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  /** 画面内容（核心视觉描述） */
  content: z.string().min(1).max(10_000),
  /** 台词/旁白 */
  dialogue: z
    .union([z.string().max(10_000), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  /** 音乐 */
  music: z
    .union([z.string().max(2000), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  /** 音响效果 */
  sfx: z
    .union([z.string().max(2000), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  /**
   * 镜头时长（秒，必填）：仅整秒，与视频模型一致，范围 SHOT_DURATION_SEC_MIN～SHOT_DURATION_SEC_MAX。
   */
  durationSec: z
    .union([z.number(), z.string()])
    .transform((v) => {
      const raw = typeof v === "number" ? v : Number(String(v).trim().replace(/秒|s$/gi, ""));
      if (!Number.isFinite(raw)) return Number.NaN;
      const intSec = Math.round(raw);
      return Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, intSec));
    })
    .refine((n) => !Number.isNaN(n), {
      message: `durationSec 须为整秒数字（${SHOT_DURATION_SEC_MIN}～${SHOT_DURATION_SEC_MAX}）`,
    }),
  /** 剧本场次编号（正整数），须与剧本场次表「场次」列对应 */
  sceneNo: z
    .union([z.number().int().min(1), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : undefined;
      const m = String(v).trim().match(/(\d+)/);
      if (!m) return undefined;
      const n = parseInt(m[1]!, 10);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    }),
  /** 兼容旧字段：prompt/note */
  prompt: z
    .union([z.string().max(10_000), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
  note: z
    .union([z.string().max(10_000), z.null()])
    .optional()
    .transform((v) => (v == null ? "" : v)),
});

export const storyboardArraySchema = z.array(storyboardItemSchema).min(MIN_STORYBOARD_SHOTS).max(MAX_STORYBOARD_SHOTS);

export type StoryboardItemParsed = z.infer<typeof storyboardItemSchema>;

/**
 * 将任意 JSON 解析结果校验为分镜数组；失败抛 ZodError
 */
export function parseStoryboardItems(json: unknown): z.infer<typeof storyboardArraySchema> {
  return storyboardArraySchema.parse(json);
}

/** 单章/单块剧本：条数可少于全剧下限，但至少 2 条镜头 */
export const storyboardChapterChunkSchema = z.array(storyboardItemSchema).min(2).max(MAX_STORYBOARD_SHOTS);

export function parseStoryboardChapterChunk(json: unknown): z.infer<typeof storyboardChapterChunkSchema> {
  return storyboardChapterChunkSchema.parse(json);
}

/**
 * 仅重生成若干场次时的校验：每条须属于 allowedSceneNos，且每个指定场次至少 2 镜。
 */
export function parseStoryboardItemsForScenes(
  json: unknown,
  allowedSceneNos: number[],
): z.infer<typeof storyboardItemSchema>[] {
  const allow = new Set(allowedSceneNos);
  if (!allow.size) throw new Error("parseStoryboardItemsForScenes: allowedSceneNos 为空");
  const minTotal = Math.max(2, allowedSceneNos.length * 2);
  const allowedStr = [...allow].sort((a, b) => a - b).join(",");
  const schema = z
    .array(storyboardItemSchema)
    .min(minTotal)
    .max(MAX_STORYBOARD_SHOTS)
    .refine((arr) => arr.every((it) => it.sceneNo != null && allow.has(it.sceneNo!)), {
      message: `每条 sceneNo 须为指定场次之一：${allowedStr}`,
    })
    .refine((arr) => allowedSceneNos.every((sn) => arr.filter((x) => x.sceneNo === sn).length >= 2), {
      message: "每个待重生成场次至少需 2 条分镜",
    });
  return schema.parse(json);
}
