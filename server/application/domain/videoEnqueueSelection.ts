import type { Project } from "../../types.js";

export type VideoEnqueueMode = "all" | "missing" | "selected" | "failed";

export function latestShotJobStatusMap(project: Project | null | undefined) {
  const map = new Map<number, "queued" | "running" | "done" | "failed">();
  if (!project) return map;
  for (let i = project.videoJobs.length - 1; i >= 0; i--) {
    const j = project.videoJobs[i]!;
    if ((j.kind ?? "video") !== "video") continue;
    if (typeof j.shotIndex !== "number") continue;
    if (!map.has(j.shotIndex)) map.set(j.shotIndex, j.status);
  }
  return map;
}

export function pickShotsByMode(project: Project, mode: VideoEnqueueMode, shotIds?: string[]) {
  if (mode === "selected") {
    const set = new Set(shotIds ?? []);
    return project.storyboards.filter((s) => set.has(s.id));
  }
  if (mode === "failed") {
    const failedIndices = new Set(
      project.videoJobs
        .filter((j) => (j.kind ?? "video") === "video" && j.status === "failed" && typeof j.shotIndex === "number")
        .map((j) => j.shotIndex as number),
    );
    return project.storyboards.filter((s) => failedIndices.has(s.index));
  }
  if (mode === "missing") {
    const latest = latestShotJobStatusMap(project);
    return project.storyboards.filter((s) => latest.get(s.index) !== "done");
  }
  return project.storyboards;
}
