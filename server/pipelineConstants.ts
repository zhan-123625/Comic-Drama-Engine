/**
 * 管线魔法数字集中定义（与 docs/detailed-design.md §2、§14 对齐）
 */

function parsePositiveIntEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** 导演门禁：每步最多生成/审核轮数 */
export const MAX_DIRECTOR_ATTEMPTS = parsePositiveIntEnv("MY_APP_MAX_DIRECTOR_ATTEMPTS", 5);

/** 单镜生图：同一镜头连续调用失败时的最大尝试次数（含第 1 次） */
export const SHOT_IMAGE_MAX_ATTEMPTS = 3;

/** 剧本 Agent：单章与上游文本输入上限 */
export const SCRIPT_INPUT_MAX_CHARS = 80_000;

/** 分镜 Agent：剧本文本输入上限 */
export const STORYBOARD_SCRIPT_MAX_CHARS = 80_000;

/** 分镜 JSON 修复：附带坏片段长度上限 */
export const STORYBOARD_REPAIR_SNIPPET_MAX_CHARS = 12_000;

/** 管线内 priorContext 截断 */
/** 剧本阶段导演：小说原文摘要长度上限 */
export const PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR = parsePositiveIntEnv("MY_APP_PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR", 60_000);
export const PRIOR_STORYBOARD_SCRIPT = parsePositiveIntEnv("MY_APP_PRIOR_STORYBOARD_SCRIPT", 30_000);
export const PRIOR_IMAGE_BATCH_SCRIPT = parsePositiveIntEnv("MY_APP_PRIOR_IMAGE_BATCH_SCRIPT", 30_000);
export const PRIOR_VIDEO_PLAN_SCRIPT = parsePositiveIntEnv("MY_APP_PRIOR_VIDEO_PLAN_SCRIPT", 20_000);

/** 导演 Agent 输入截断（防止多章节短剧剧本及上下文被硬截断） */
export const DIRECTOR_PRIOR_CONTEXT_MAX = parsePositiveIntEnv("MY_APP_DIRECTOR_PRIOR_CONTEXT_MAX", 60_000);
export const DIRECTOR_OUTPUT_MAX = parsePositiveIntEnv("MY_APP_DIRECTOR_OUTPUT_MAX", 150_000);

/** 分镜列表条数（每场应多镜；总条数随场次数上升，上限放宽） */
export const MIN_STORYBOARD_SHOTS = 6;
export const MAX_STORYBOARD_SHOTS = 48;

/** 与当前视频生成模型一致：单镜时长仅允许整秒，且不超过此上限 */
export const SHOT_DURATION_SEC_MIN = 1;
export const SHOT_DURATION_SEC_MAX = 15;

/** 生图：单条 prompt 上限与导演意见注入上限 */
export const IMAGE_PROMPT_MAX = 4_000;
export const DIRECTOR_FEEDBACK_IN_PROMPT_MAX = 500;

/** 分镜生图：参考图张数上限（优先场景+角色资产图；Seedream 等常见 ≤10） */
export const STORYBOARD_MAX_REFERENCE_IMAGES = 10;

/** 视频计划修订：导演意见长度 */
export const VIDEO_REFINE_FEEDBACK_MAX = 2_000;

/** 与前端 stageOrder 一致，用于局部管线起止判定 */
export const PIPELINE_STAGE_ORDER = ["script", "assets", "storyboard", "video"] as const;
