import { describe, it, expect } from "vitest";
import {
  MAX_DIRECTOR_ATTEMPTS,
  SHOT_IMAGE_MAX_ATTEMPTS,
  SCRIPT_INPUT_MAX_CHARS,
  STORYBOARD_SCRIPT_MAX_CHARS,
  STORYBOARD_REPAIR_SNIPPET_MAX_CHARS,
  PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR,
  PRIOR_STORYBOARD_SCRIPT,
  PRIOR_IMAGE_BATCH_SCRIPT,
  PRIOR_VIDEO_PLAN_SCRIPT,
  DIRECTOR_PRIOR_CONTEXT_MAX,
  DIRECTOR_OUTPUT_MAX,
  MIN_STORYBOARD_SHOTS,
  MAX_STORYBOARD_SHOTS,
  SHOT_DURATION_SEC_MIN,
  SHOT_DURATION_SEC_MAX,
  IMAGE_PROMPT_MAX,
  DIRECTOR_FEEDBACK_IN_PROMPT_MAX,
  STORYBOARD_MAX_REFERENCE_IMAGES,
  VIDEO_REFINE_FEEDBACK_MAX,
  PIPELINE_STAGE_ORDER,
} from "./pipelineConstants.js";

describe("pipelineConstants", () => {
  it("导演门禁应大于等于 3", () => {
    expect(MAX_DIRECTOR_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });

  it("单镜生图最大尝试次数应为 3", () => {
    expect(SHOT_IMAGE_MAX_ATTEMPTS).toBe(3);
  });

  it("文本输入上限应为 80_000", () => {
    expect(SCRIPT_INPUT_MAX_CHARS).toBe(80_000);
    expect(STORYBOARD_SCRIPT_MAX_CHARS).toBe(80_000);
  });

  it("修复片段长度上限应为 12_000", () => {
    expect(STORYBOARD_REPAIR_SNIPPET_MAX_CHARS).toBe(12_000);
  });

  it("priorContext 截断值应为正整数", () => {
    expect(PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR).toBeGreaterThanOrEqual(14_000);
    expect(PRIOR_STORYBOARD_SCRIPT).toBeGreaterThanOrEqual(10_000);
    expect(PRIOR_IMAGE_BATCH_SCRIPT).toBeGreaterThanOrEqual(10_000);
    expect(PRIOR_VIDEO_PLAN_SCRIPT).toBeGreaterThanOrEqual(8_000);
  });

  it("导演输入/输出截断应为正整数且足以容纳完整剧本", () => {
    expect(DIRECTOR_PRIOR_CONTEXT_MAX).toBeGreaterThanOrEqual(14_000);
    expect(DIRECTOR_OUTPUT_MAX).toBeGreaterThanOrEqual(28_000);
  });

  it("分镜条数范围应合理（min < max）", () => {
    expect(MIN_STORYBOARD_SHOTS).toBe(6);
    expect(MAX_STORYBOARD_SHOTS).toBe(48);
    expect(MIN_STORYBOARD_SHOTS).toBeLessThan(MAX_STORYBOARD_SHOTS);
  });

  it("单镜时长范围应为 1-15 秒", () => {
    expect(SHOT_DURATION_SEC_MIN).toBe(1);
    expect(SHOT_DURATION_SEC_MAX).toBe(15);
  });

  it("生图相关常量应为正整数", () => {
    expect(IMAGE_PROMPT_MAX).toBe(4_000);
    expect(DIRECTOR_FEEDBACK_IN_PROMPT_MAX).toBe(500);
    expect(STORYBOARD_MAX_REFERENCE_IMAGES).toBe(10);
    expect(VIDEO_REFINE_FEEDBACK_MAX).toBe(2_000);
  });

  it("管线阶段顺序应包含四个阶段", () => {
    expect(PIPELINE_STAGE_ORDER).toEqual(["script", "assets", "storyboard", "video"]);
  });
});
