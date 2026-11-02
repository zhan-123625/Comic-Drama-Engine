import { store } from "./store.js";
import { sseSend } from "./sse.js";
import { readConfig } from "./config.js";
import { resolveImageConfigForShot, resolveVideoConfigForShot } from "./modelResolve.js";
import { generateVideoByHook } from "./providers/videoHook.js";
import {
  buildVideoInputWithAssets,
  shotBaseImageUrlForVideo,
  shotKeyframeBlockingVideoReason,
} from "./videoContext.js";
import { shotVideoRunModeBlockingReason } from "./videoRunMode.js";
import { getVideoBasePromptForShot } from "./videoShotPrompt.js";
import { resolveReferencedAssetsForVideo } from "./videoReferencedAssets.js";
import type { ModelApiCallSnapshot, Project, VideoJob } from "./types.js";
import { getModelApiCallFromError } from "./modelCallError.js";
import { logger, runInLogContext, toErrorMeta } from "./logger.js";
import { buildStoryboardImageGenerationPrompt, shotHasDrawableImageContent } from "./storyboardImagePrompt.js";
import { runImageAgentForStoryboardShot } from "./agents/imageAgent.js";
import { tryEasyImageUrlAfterGenerate } from "./easyImageAfterGenerate.js";
import { bytesFromGenerateImageResult, persistGeneratedVideoUrl, saveProjectImageFile } from "./imagePersist.js";
import { sleep } from "./utils/sleep.js";

const running = new Set<string>(); // projectId

function log(project: Project, message: string) {
  project.pipelineLog.push(`${new Date().toISOString()} ${message}`);
  sseSend(project.id, { type: "log", message });
}

export type EnqueueInput = {
  kind?: "video" | "image";
  message: string;
  shotIndex?: number;
  prompt?: string;
  imageUrl?: string;
};

export type AppendImageJobRecordInput = {
  status: "done" | "failed";
  message: string;
  shotIndex?: number;
  prompt?: string;
  imageUrl?: string;
  resultUrl?: string;
  modelApiCall?: ModelApiCallSnapshot;
};

/** 将已完成的生图（管线/直调 API 等）追加到任务列表，便于任务页与 SSE 观测。 */
export async function appendImageJobRecord(projectId: string, input: AppendImageJobRecordInput): Promise<VideoJob> {
  const project = await store.get(projectId);
  if (!project) throw new Error("not found");
  const job: VideoJob = {
    id: crypto.randomUUID(),
    kind: "image",
    status: input.status,
    message: input.message,
    shotIndex: input.shotIndex,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    resultUrl: input.resultUrl,
    modelApiCall: input.modelApiCall,
  };
  project.videoJobs.push(job);
  const index = project.videoJobs.length - 1;
  await store.save(project);
  sseSend(projectId, { type: "job", job, index });
  logger.info("image job record appended", {
    projectId,
    jobId: job.id,
    index,
    shotIndex: job.shotIndex,
    status: job.status,
  });
  return job;
}

/** 将视频/生图任务加入队列，必要时为生图任务补全与当前分镜一致的提示词。 */
export async function enqueueJob(projectId: string, input: string | EnqueueInput) {
  const project = await store.get(projectId);
  if (!project) throw new Error("not found");
  const payload = typeof input === "string" ? { message: input } : input;
  let jobPrompt = payload.prompt ?? payload.message;
  if (payload.kind === "image" && typeof payload.shotIndex === "number") {
    const shot = project.storyboards.find((s) => s.index === payload.shotIndex);
    if (shot && shotHasDrawableImageContent(shot)) {
      const cfg = await readConfig();
      const aggregateAssets = cfg.video?.aggregateAssets !== false;
      jobPrompt = buildStoryboardImageGenerationPrompt(project, shot, { aggregateAssets });
    }
  }
  const job: VideoJob = {
    id: crypto.randomUUID(),
    kind: payload.kind === "image" ? "image" : "video",
    status: "queued",
    message: payload.message,
    shotIndex: payload.shotIndex,
    prompt: jobPrompt,
    imageUrl: payload.imageUrl,
  };
  project.videoJobs.push(job);
  const index = project.videoJobs.length - 1;
  await store.save(project);
  sseSend(project.id, { type: "job", job, index });
  logger.info("job enqueued", {
    projectId,
    jobId: job.id,
    kind: job.kind,
    index,
    shotIndex: job.shotIndex,
    hasImageUrl: Boolean(job.imageUrl),
  });
  return job;
}

/** 顺序处理 queued 任务，推进状态并通过 SSE 广播。 */
export async function runJobQueue(projectId: string, opts?: { delayMs?: number }) {
  if (running.has(projectId)) {
    logger.warn("video runner skipped because already running", { projectId });
    return;
  }
  running.add(projectId);
  const delayMs = Math.max(100, Math.floor(opts?.delayMs ?? 600));

  try {
    await runInLogContext({ projectId, scope: "job-runner" }, async () => {
      logger.info("video runner started", { projectId, delayMs });

      while (true) {
        const project = await store.get(projectId);
        if (!project) {
          logger.warn("video runner stopped because project missing", { projectId });
          return;
        }

        const idx = project.videoJobs.findIndex((j) => j.status === "queued");
        if (idx === -1) {
          logger.info("video runner drained queue", { projectId });
          return;
        }

        const job = project.videoJobs[idx]!;
        const kind = job.kind === "image" ? "image" : "video";
        const t0 = Date.now();
        job.status = "running";
        job.message = job.message || (kind === "image" ? "生图任务" : "视频生成任务");
        await store.save(project);
        sseSend(project.id, { type: "job", job, index: idx });
        log(project, `任务开始：${job.id}`);
        logger.info("job started", {
          projectId,
          jobId: job.id,
          kind,
          index: idx,
          shotIndex: job.shotIndex,
        });

        await runInLogContext(
          {
            jobId: job.id,
            shotIndex: typeof job.shotIndex === "number" ? job.shotIndex : undefined,
          },
          async () => {
            await sleep(delayMs);

            const cfg = await readConfig();
            try {
              const shot =
                typeof job.shotIndex === "number"
                  ? project.storyboards.find((s) => s.index === job.shotIndex)
                  : undefined;
              if (kind === "image") {
                if (!shot) throw new Error("生图任务缺少有效 shotIndex");
                if (!shotHasDrawableImageContent(shot))
                  throw new Error("分镜缺少可画内容（画面内容、兼容 prompt 或图片提示词）");
                const imageCfg = resolveImageConfigForShot(shot, cfg);
                if (!imageCfg) throw new Error("未配置生图");
                const img = await runImageAgentForStoryboardShot(project, shot, project.storyboardImageSize, {
                  imageCfg,
                });
                const { buf, mime, remoteUrl } = await bytesFromGenerateImageResult(img);
                const localUrl = await saveProjectImageFile(project.id, "shots", shot.id, buf, mime);
                const easyUrl = await tryEasyImageUrlAfterGenerate(buf, shot.id, mime);
                project.storyboards = project.storyboards.map((s) =>
                  s.id === shot.id
                    ? { ...s, imageUrl: localUrl, remoteImageUrl: easyUrl ?? remoteUrl ?? undefined }
                    : s,
                );
                job.status = "done";
                job.resultUrl = localUrl;
                if (img.modelApiCall) job.modelApiCall = img.modelApiCall;
                job.message = `生图完成：镜头 #${shot.index}`;
                logger.info("image job succeeded", {
                  projectId,
                  jobId: job.id,
                  index: idx,
                  shotIndex: shot.index,
                  durationMs: Date.now() - t0,
                });
              } else {
                if (!cfg.video) throw new Error("未配置视频大模型（baseUrl/model/apiKey）");
                const videoCfg = shot ? (resolveVideoConfigForShot(shot, cfg) ?? cfg.video) : cfg.video;
                if (shot) {
                  const block = shotKeyframeBlockingVideoReason(shot);
                  if (block) throw new Error(block);
                  const blockMode = shotVideoRunModeBlockingReason(shot, videoCfg);
                  if (blockMode) throw new Error(blockMode);
                }
                const basePrompt = shot ? getVideoBasePromptForShot(shot) : job.prompt?.trim() || job.message || "";
                const referencedAssets = shot ? await resolveReferencedAssetsForVideo(project, shot, basePrompt) : [];
                const rawImageUrl = shot ? (shotBaseImageUrlForVideo(shot) ?? shot.imageUrl) : job.imageUrl;
                const enriched = buildVideoInputWithAssets({
                  project,
                  shot,
                  basePrompt,
                  baseImageUrl: rawImageUrl,
                  videoCfg,
                  referencedAssets,
                });
                log(
                  project,
                  `视频生成：镜头 #${shot?.index ?? job.shotIndex ?? "?"}，模式 ${enriched.runMode ?? "?"}，参考图 ${enriched.apiImageUrls.length} 张（方舟等异步 API 将在服务端轮询「查询任务」直至完成）`,
                );
                logger.info("video job invoking provider", {
                  projectId,
                  jobId: job.id,
                  shotIndex: job.shotIndex,
                  referenceImageCount: enriched.apiImageUrls.length,
                  promptLen: enriched.prompt.length,
                  runMode: enriched.runMode,
                });
                const { url: videoUrl, modelApiCall: videoModelApiCall } = await generateVideoByHook(videoCfg, {
                  prompt: enriched.prompt,
                  imageUrls: enriched.apiImageUrls,
                  aspectRatio: project.videoAspect,
                  durationSeconds: enriched.durationSeconds,
                  audioUrl: enriched.omniAudioUrl,
                  referenceVideoUrl: enriched.omniVideoUrl,
                  runMode: enriched.runMode,
                });
                job.status = "done";
                job.resultUrl = await persistGeneratedVideoUrl(project.id, job.id, videoUrl);
                job.modelApiCall = videoModelApiCall;
                job.message = "视频生成完成";
                logger.info("video job succeeded", {
                  projectId,
                  jobId: job.id,
                  index: idx,
                  shotIndex: job.shotIndex,
                  durationMs: Date.now() - t0,
                  matchedAssets: enriched.matchedAssets.length,
                });
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const failedSnap = getModelApiCallFromError(e);
              job.status = "failed";
              job.message = `${kind === "image" ? "生图" : "视频生成"}失败: ${msg}`.slice(0, 600);
              if (failedSnap) job.modelApiCall = failedSnap;
              logger.error("job failed", {
                projectId,
                jobId: job.id,
                kind,
                index: idx,
                shotIndex: job.shotIndex,
                durationMs: Date.now() - t0,
                ...toErrorMeta(e),
              });
            }
            await store.save(project);
            sseSend(project.id, { type: "job", job, index: idx });
            log(project, `任务结束：${job.id} -> ${job.status}`);
          },
        );
      }
    });
  } finally {
    running.delete(projectId);
    logger.info("video runner stopped", { projectId });
  }
}
