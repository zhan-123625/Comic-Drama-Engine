import crypto from "node:crypto";
import { readConfig } from "./config.js";
import { resolveVideoConfigForShot } from "./modelResolve.js";
import { persistGeneratedVideoUrl } from "./imagePersist.js";
import { generateVideoByHook } from "./providers/videoHook.js";
import { getModelApiCallFromError } from "./modelCallError.js";
import { logger, toErrorMeta } from "./logger.js";
import { sseSend } from "./sse.js";
import { store } from "./store.js";
import {
  buildVideoInputWithAssets,
  shotBaseImageUrlForVideo,
  shotKeyframeBlockingVideoReason,
} from "./videoContext.js";
import { getVideoBasePromptForShot } from "./videoShotPrompt.js";
import { resolveReferencedAssetsForVideo } from "./videoReferencedAssets.js";
import { shotVideoRunModeBlockingReason } from "./videoRunMode.js";
import type { Project } from "./types.js";

export type RunVideoOnceResult =
  | { kind: "blocked"; error: string; project: Project }
  | { kind: "ok"; project: Project; resultUrl: string }
  | { kind: "fail"; status: number; error: string; project?: Project };

/**
 * 与 HTTP `/videos/run-once` 一致：写 videoJobs、调视频 Hook、更新状态并 SSE。
 */
export async function runVideoOnceForShot(params: {
  projectId: string;
  shotId: string;
  promptOverride?: string;
  reqId?: string;
}): Promise<RunVideoOnceResult> {
  const { projectId: id, shotId, promptOverride, reqId } = params;
  const p = await store.get(id);
  if (!p) return { kind: "fail", status: 404, error: "project not found" };
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return { kind: "fail", status: 404, error: "shot not found" };

  logger.info("video run-once requested", {
    reqId,
    projectId: id,
    shotId: shot.id,
    shotIndex: shot.index,
  });

  const cfgEarly = await readConfig();
  const videoCfgEarly = cfgEarly.video ? (resolveVideoConfigForShot(shot, cfgEarly) ?? cfgEarly.video) : null;
  const block = shotKeyframeBlockingVideoReason(shot);
  const blockMode = videoCfgEarly ? shotVideoRunModeBlockingReason(shot, videoCfgEarly) : null;
  if (block || blockMode) {
    const msg = block ?? blockMode ?? "无法生成视频";
    const baseForVideo = promptOverride?.trim() || getVideoBasePromptForShot(shot);
    const blockJobId = crypto.randomUUID();
    p.videoJobs.push({
      id: blockJobId,
      kind: "video",
      status: "failed",
      message: msg.slice(0, 600),
      shotIndex: shot.index,
      prompt: baseForVideo,
      imageUrl: shot.imageUrl,
    });
    const blockJobIdx = p.videoJobs.length - 1;
    await store.save(p);
    sseSend(id, { type: "log", message: `单镜头直执行未启动：#${shot.index}` });
    sseSend(id, { type: "job", job: p.videoJobs[blockJobIdx]!, index: blockJobIdx });
    const refreshedBlock = await store.get(id);
    return { kind: "blocked", error: msg, project: refreshedBlock ?? p };
  }

  const baseForVideo = promptOverride?.trim() || getVideoBasePromptForShot(shot);
  const jobId = crypto.randomUUID();
  p.videoJobs.push({
    id: jobId,
    kind: "video",
    status: "running",
    message: `镜头 #${shot.index} 视频生成中`,
    shotIndex: shot.index,
    prompt: baseForVideo,
    imageUrl: shot.imageUrl,
  });
  const runOnceJobIndex = p.videoJobs.length - 1;
  await store.save(p);
  sseSend(id, { type: "log", message: `单镜头直执行开始：#${shot.index}` });
  sseSend(id, { type: "job", job: p.videoJobs[runOnceJobIndex]!, index: runOnceJobIndex });

  const cfg = cfgEarly;
  if (!cfg.video) {
    const latest = await store.get(id);
    if (latest) {
      const idx = latest.videoJobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) {
        latest.videoJobs[idx] = {
          ...latest.videoJobs[idx]!,
          status: "failed",
          message: "未配置视频大模型（baseUrl/model/apiKey）",
        };
        await store.save(latest);
        sseSend(id, { type: "job", job: latest.videoJobs[idx]!, index: idx });
      }
      return {
        kind: "fail",
        status: 400,
        error: "未配置视频大模型（baseUrl/model/apiKey）",
        project: latest,
      };
    }
    return { kind: "fail", status: 400, error: "未配置视频大模型（baseUrl/model/apiKey）" };
  }

  try {
    const videoCfg = resolveVideoConfigForShot(shot, cfg) ?? cfg.video;
    const referencedAssets = await resolveReferencedAssetsForVideo(p, shot, baseForVideo);
    const enriched = buildVideoInputWithAssets({
      project: p,
      shot,
      basePrompt: baseForVideo,
      baseImageUrl: shotBaseImageUrlForVideo(shot) ?? shot.imageUrl,
      videoCfg,
      referencedAssets,
    });
    sseSend(id, {
      type: "log",
      message: `${new Date().toISOString()} 镜头 #${shot.index}：调用视频 API，模式 ${enriched.runMode ?? "?"}，参考图 ${enriched.apiImageUrls.length} 张（异步任务见服务端日志 taskId / 轮询 status）`,
    });
    logger.info("video run-once invoking provider", {
      projectId: id,
      shotIndex: shot.index,
      referenceImageCount: enriched.apiImageUrls.length,
      promptLen: enriched.prompt.length,
      durationSeconds: enriched.durationSeconds ?? null,
      runMode: enriched.runMode,
    });
    const { url, modelApiCall } = await generateVideoByHook(videoCfg, {
      prompt: enriched.prompt,
      imageUrls: enriched.apiImageUrls,
      aspectRatio: p.videoAspect,
      durationSeconds: enriched.durationSeconds,
      audioUrl: enriched.omniAudioUrl,
      referenceVideoUrl: enriched.omniVideoUrl,
      runMode: enriched.runMode,
    });
    const storedVideoUrl = await persistGeneratedVideoUrl(id, jobId, url);
    const latest = await store.get(id);
    if (latest) {
      const idx = latest.videoJobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) {
        latest.videoJobs[idx] = {
          ...latest.videoJobs[idx]!,
          status: "done",
          message: "视频生成完成",
          resultUrl: storedVideoUrl,
          modelApiCall,
        };
        await store.save(latest);
        sseSend(id, { type: "job", job: latest.videoJobs[idx]!, index: idx });
      }
      sseSend(id, { type: "log", message: `单镜头直执行完成：#${shot.index}` });
      logger.info("video run-once finished", {
        reqId,
        projectId: id,
        shotId: shot.id,
        shotIndex: shot.index,
        matchedAssets: enriched.matchedAssets.length,
        resultUrl: storedVideoUrl.slice(0, 180),
      });
      return { kind: "ok", project: latest, resultUrl: storedVideoUrl };
    }
    return { kind: "fail", status: 500, error: "project not found after run-once" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failedSnap = getModelApiCallFromError(e);
    const latest = await store.get(id);
    if (latest) {
      const idx = latest.videoJobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) {
        latest.videoJobs[idx] = {
          ...latest.videoJobs[idx]!,
          status: "failed",
          message: `视频生成失败: ${msg}`.slice(0, 600),
          ...(failedSnap ? { modelApiCall: failedSnap } : {}),
        };
        await store.save(latest);
        sseSend(id, { type: "job", job: latest.videoJobs[idx]!, index: idx });
      }
    }
    sseSend(id, { type: "log", message: `单镜头直执行失败：#${shot.index} ${msg.slice(0, 200)}` });
    logger.error("video run-once failed", {
      reqId,
      projectId: id,
      shotId: shot.id,
      shotIndex: shot.index,
      ...toErrorMeta(e),
    });
    const latest502 = await store.get(id);
    return {
      kind: "fail",
      status: 502,
      error: msg.slice(0, 800),
      ...(latest502 ? { project: latest502 } : {}),
    };
  }
}
