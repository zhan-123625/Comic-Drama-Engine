import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db.js";
import { store } from "./store.js";
import { logger } from "./logger.js";

const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { timeout: 300_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg 失败: ${err.message}\n${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}

function resultUrlToFilePath(projectId: string, resultUrl: string): string | null {
  // resultUrl 格式: /api/files/projects/{projectId}/videos/{filename}
  const m = resultUrl.match(/\/api\/files\/projects\/[^/]+\/videos\/(.+)$/);
  if (!m) return null;
  return path.join(dataDir, "files", "projects", projectId, "videos", m[1]!);
}

export async function concatProjectVideos(projectId: string): Promise<{ url: string }> {
  const project = await store.get(projectId);
  if (!project) throw new Error("项目不存在");

  const doneJobs = project.videoJobs
    .filter((j) => j.kind === "video" && j.status === "done" && j.resultUrl)
    .sort((a, b) => (a.shotIndex ?? 0) - (b.shotIndex ?? 0));

  if (doneJobs.length === 0) throw new Error("没有已完成的视频可拼接");

  const filePaths: string[] = [];
  for (const job of doneJobs) {
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
        "128k",
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
