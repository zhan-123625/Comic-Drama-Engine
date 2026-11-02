import type { VideoJob } from "./types";

export type PipelineSseData = {
  type: string;
  message?: string;
  stage?: string;
  status?: string;
  /** stage 为 error 时后端附带的详细原因 */
  detail?: string;
  step?: string;
  approved?: boolean;
  feedback?: string;
  attempt?: number;
  job?: VideoJob;
  index?: number;
};

export function parseSseData(raw: string): PipelineSseData | null {
  try {
    return JSON.parse(raw) as PipelineSseData;
  } catch {
    return null;
  }
}

export function formatSseLogLine(data: PipelineSseData): string | null {
  if (data.type === "log" && data.message) return data.message;
  if (data.type === "director" && data.step !== undefined && data.approved !== undefined) {
    return `导演 [${data.step}] 第${data.attempt ?? "?"}轮 ${data.approved ? "通过" : "退回"}：${data.feedback ?? ""}`;
  }
  if (data.type === "stage" && data.stage && data.status) {
    const head = `${data.stage} · ${data.status}`;
    if (data.status === "error" && data.detail) return `${head}：${data.detail}`;
    return head;
  }
  if (data.type === "job" && data.job) return `job · ${data.job.status} · ${data.job.message}`;
  if (data.type === "complete") return "管线执行完成";
  if (data.type === "error" && data.message) return `错误: ${data.message}`;
  return null;
}
