import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db.js";
import { store } from "./store.js";
import { logger } from "./logger.js";
import { runFfmpeg } from "./ffmpegHelper.js";
import { tryMuxAudioIntoVideo } from "./ttsService.js";

function resultUrlToFilePath(projectId: string, resultUrl: string): string | null {
  // resultUrl 格式: /api/files/projects/{projectId}/videos/{filename}（滤除 query 缓存参数）
  const cleanUrl = resultUrl.split("?")[0]!;
  const m = cleanUrl.match(/\/api\/files\/projects\/[^/]+\/videos\/(.+)$/);
  if (!m) return null;
  return path.join(dataDir, "files", "projects", projectId, "videos", m[1]!);
}

export async function concatProjectVideos(projectId: string): Promise<{ url: string }> {
  const project = await store.get(projectId);
  if (!project) throw new Error("项目不存在");

  // 关键改进：每个镜头仅取最新生成的一条视频，并确保已融合背景音乐与对白
  const latestJobByShot = new Map<string, (typeof project.videoJobs)[0]>();
  for (const j of project.videoJobs) {
    const isVideo =
      (j.kind === "video" || !j.kind) &&
      j.status === "done" &&
      Boolean(j.resultUrl) &&
      (j.resultUrl!.includes("/videos/") || j.resultUrl!.endsWith(".mp4"));
    if (isVideo) {
      const key = String(j.shotId || j.shotIndex || j.id);
      latestJobByShot.set(key, j);
    }
  }

  const doneJobs = Array.from(latestJobByShot.values()).sort(
    (a, b) => (a.shotIndex ?? 0) - (b.shotIndex ?? 0),
  );

  if (doneJobs.length === 0) throw new Error("没有已完成的视频可拼接");

  const filePaths: string[] = [];
  for (const job of doneJobs) {
    const shot = project.storyboards.find(
      (s) => (job.shotId && s.id === job.shotId) || (job.shotIndex && s.index === job.shotIndex),
    );
    // 确保该分镜视频已完成配乐与对白多轨合流
    if (shot && job.resultUrl) {
      try {
        await tryMuxAudioIntoVideo(projectId, shot.id, job.resultUrl);
      } catch (muxErr) {
        logger.warn("拼接前自动重融音频跳过", { shotId: shot.id, err: String(muxErr) });
      }
    }
    const fp = resultUrlToFilePath(projectId, job.resultUrl!);
    if (!fp) {
      logger.warn("无法解析视频路径，跳过", { jobId: job.id, resultUrl: job.resultUrl });
      continue;
    }
    filePaths.push(fp);
  }

  if (filePaths.length === 0) throw new Error("无法解析任何视频文件路径");

  const exportDir = path.join(dataDir, "files", "projects", projectId, "exports");
  await mkdir(exportDir, { recursive: true });

  const timestamp = Date.now();
  const outputFilename = `merged_${timestamp}.mp4`;
  const outputPath = path.join(exportDir, outputFilename);

  // 写入 concat 文件列表
  const listPath = path.join(exportDir, `list_${timestamp}.txt`);
  const listContent = filePaths.map((fp) => `file '${fp.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listContent, "utf-8");

  try {
    // 先尝试 stream copy（快，不重编码）
    try {
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
      logger.info("视频拼接完成 (stream copy)", { projectId, count: filePaths.length, output: outputPath });
    } catch (copyErr) {
      logger.warn("stream copy 失败，回退重编码", { projectId, error: String(copyErr) });
      // 回退：重编码为统一格式
      await runFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
      logger.info("视频拼接完成 (re-encode)", { projectId, count: filePaths.length, output: outputPath });
    }

    return { url: `/api/files/projects/${projectId}/exports/${outputFilename}` };
  } finally {
    // 清理临时文件列表
    await unlink(listPath).catch(() => {});
  }
}
