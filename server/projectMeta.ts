import type { Project } from "./types.js";

/** 注入剧本/分镜等 Agent 的项目设定前缀 */
export function formatProjectMeta(project: Project): string {
  const bits: string[] = [];
  if (project.artStyle?.trim()) bits.push(`画风/视觉：${project.artStyle.trim()}`);
  if (project.genreType?.trim()) bits.push(`类型/题材：${project.genreType.trim()}`);
  if (project.videoAspect?.trim()) bits.push(`目标视频比例：${project.videoAspect.trim()}`);
  if (!bits.length) return "";
  return `【项目设定】${bits.join("；")}\n\n`;
}
