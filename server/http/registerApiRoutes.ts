import fs from "node:fs";
import path from "node:path";
import express from "express";
import { store } from "../store.js";
import { listPortfolioExports } from "../portfolio.js";
import {
  isPipelineRunning,
  releasePipelineLock,
  requestCancelPipeline,
  runPipeline,
  type PipelineRunRange,
} from "../pipeline.js";
import { regenerateScriptChapter } from "../regenerateChapterScript.js";
import { runPolishAgent } from "../agents/polishAgent.js";
import { collectStoryboardImageReferenceDetails } from "../agents/imageAgent.js";
import { enqueueJob, runJobQueue, appendImageJobRecord } from "../jobs.js";
import { sseAddClient, sseRemoveClient, sseSend } from "../sse.js";
import { listShotImageFileUrlsFromDisk, deleteShotImageFiles, saveProjectImageFile } from "../imagePersist.js";
import { publishStoryboardShotToEasyImage } from "../publishShotEasyImage.js";
import { runVideoOnceForShot } from "../runVideoOnceService.js";
import { generateShotAudio, tryMuxAudioIntoVideo } from "../ttsService.js";
import { concatProjectVideos } from "../videoConcat.js";
import { maskConfig, mergeAppConfig, readConfig, writeConfig, type AppConfig } from "../config.js";
import { resolveVideoConfigForShot } from "../modelResolve.js";
import { logger, toErrorMeta } from "../logger.js";
import { applyArkReferenceImagePromptHint } from "../providers/videoHook.js";
import {
  buildVideoInputWithAssets,
  orderedAssetsForStoryboardVisual,
  shotBaseImageUrlForVideo,
  shotKeyframeBlockingVideoReason,
} from "../videoContext.js";
import { getVideoBasePromptForShot, enrichStoryboardVideoPromptBase } from "../videoShotPrompt.js";
import { resolveReferencedAssetsForVideo } from "../videoReferencedAssets.js";
import { shotVideoRunModeBlockingReason } from "../videoRunMode.js";
import type { VideoProviderConfig } from "../config.js";
import {
  formatVolcVideoModes,
  VOLC_IMAGE_MODEL_PRESETS,
  VOLC_TEXT_MODEL_PRESETS,
  VOLC_VIDEO_MODEL_PRESETS,
} from "../volcenginePresets.js";
import {
  BAILIAN_TEXT_MODEL_PRESETS,
  BAILIAN_IMAGE_MODEL_PRESETS,
  BAILIAN_VIDEO_MODEL_PRESETS,
  BAILIAN_TTS_MODEL_PRESETS,
  formatBailianVideoModes,
} from "../bailianPresets.js";
import { BGM_PRESETS, getBgmFilePath, saveProjectBgmFile, listProjectBgms } from "../bgmService.js";
import {
  buildStoryboardImageGenerationPrompt,
  enrichStoryboardImageVisualBase,
  resolveStoryboardImageVisualBase,
} from "../storyboardImagePrompt.js";
import { generateAssetImage } from "../application/services/assetImageGeneration.js";
import { generateStoryboardImage as runStoryboardImageGeneration } from "../application/services/storyboardImageGeneration.js";
import { applyProjectPatch } from "../application/services/projectMutation.js";
import { mergeStoryboardImageVariantUrls } from "../application/domain/storyboardImageVariants.js";
import { pickShotsByMode } from "../application/domain/videoEnqueueSelection.js";
import { PIPELINE_STAGE_ORDER } from "../pipelineConstants.js";
import { verifyAuth } from "./auth.js";
import { notFound, parseBody, badRequest, conflict, badGateway, sendError } from "./httpResponses.js";
import { getProjectOr404 } from "./projectAccess.js";
import {
  cfgBody,
  createBody,
  sourceBody,
  projectPatchBody,
  assetGenerateBody,
  assetGenerateBatchBody,
  generateImagesBody,
  storyboardGenerateImageBody,
  videoEnqueueBody,
  videoRunOnceBody,
  videoPromptPreviewBody,
  imagePromptPreviewBody,
  publishEasyImageBody,
  polishBody,
  regenerateChapterBody,
  pipelineRunBody,
  jobEnqueueBody,
  jobRunBody,
  shotTtsBody,
  uploadAssetImageBody,
} from "./schemas/apiSchemas.js";

export function registerApiRoutes(app: express.Application): void {
  app.get("/api/projects/:projectId/shot-image-variants", async (req, res) => {
    const p = await getProjectOr404(req.params.projectId, res);
    if (!p) return;
    const variants: Record<string, string[]> = {};
    for (const s of p.storyboards) {
      const disk = await listShotImageFileUrlsFromDisk(p.id, s.id);
      variants[s.id] = mergeStoryboardImageVariantUrls(s.imageUrl, disk);
    }
    res.json({ variants });
  });

  app.delete("/api/projects/:projectId/shots/:shotId/image", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const p = await getProjectOr404(req.params.projectId, res);
    if (!p) return;
    const shot = p.storyboards.find((s) => s.id === req.params.shotId);
    if (!shot) {
      notFound(res, "shot not found");
      return;
    }
    const targetUrl = typeof req.query.url === "string" ? req.query.url.trim() : undefined;
    const { remainingUrls } = await deleteShotImageFiles(p.id, shot.id, targetUrl);

    // 如果未指定具体 targetUrl，或者删除的就是当前主图，或者主图已经不在剩余列表中
    const currentNorm = (shot.imageUrl ?? "").split("?")[0].trim();
    const targetNorm = (targetUrl ?? "").split("?")[0].trim();
    const currentWasTarget = !targetUrl || (currentNorm && targetNorm && currentNorm.endsWith(targetNorm));
    const currentStillRemains = currentNorm && remainingUrls.some((u) => u.split("?")[0].trim().endsWith(currentNorm));

    if (currentWasTarget || !currentStillRemains) {
      if (remainingUrls.length > 0) {
        shot.imageUrl = remainingUrls[0];
      } else {
        shot.imageUrl = undefined;
        shot.remoteImageUrl = undefined;
      }
    }

    await store.save(p);
    res.json({
      success: true,
      project: p,
      remainingUrls,
    });
  });

  app.get("/api/health", (_, res) => {
    res.json({ ok: true, service: "comic-drama-engine" });
  });

  app.get("/api/config", async (_req, res) => {
    const cfg = await readConfig();
    res.json(maskConfig(cfg));
  });

  app.get("/api/config/volcengine-presets", (_req, res) => {
    res.json({
      docVideoUrl: "https://www.volcengine.com/docs/82379/1520757?lang=zh",
      video: VOLC_VIDEO_MODEL_PRESETS.map((p) => ({
        ...p,
        modesLabel: formatVolcVideoModes(p.modes),
      })),
      text: VOLC_TEXT_MODEL_PRESETS,
      image: VOLC_IMAGE_MODEL_PRESETS,
    });
  });

  app.get("/api/config/bailian-presets", (_req, res) => {
    res.json({
      docUrl: "https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-api-overview",
      text: BAILIAN_TEXT_MODEL_PRESETS,
      image: BAILIAN_IMAGE_MODEL_PRESETS,
      video: BAILIAN_VIDEO_MODEL_PRESETS.map((p) => ({
        ...p,
        modesLabel: formatBailianVideoModes(p.modes),
      })),
      tts: BAILIAN_TTS_MODEL_PRESETS,
      bgmPresets: BGM_PRESETS.map((b) => ({
        ...b,
        url: `/api/files/bgm/${b.filename}`,
      })),
    });
  });

  app.get("/api/bgm/presets", (_req, res) => {
    res.json({
      presets: BGM_PRESETS.map((b) => ({
        ...b,
        url: `/api/files/bgm/${b.filename}`,
      })),
    });
  });

  app.get("/api/files/bgm/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = getBgmFilePath(filename);
    if (!filePath || !fs.existsSync(filePath)) {
      notFound(res, "bgm file not found");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path.resolve(filePath));
  });

  app.put("/api/config", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const data = parseBody(cfgBody, req.body, res);
    if (!data) return;
    const prev = await readConfig();
    const next = mergeAppConfig(prev, data as AppConfig);
    await writeConfig(next);
    res.json(maskConfig(next));
  });

  app.get("/api/portfolio/exports", async (_req, res) => {
    res.json({ items: await listPortfolioExports(await store.list()) });
  });

  app.get("/api/projects", async (_req, res) => {
    const projects = await store.list();
    res.json(projects);
  });

  app.get("/api/assets/library", async (_req, res) => {
    const rows = await store.listAssetLibrary();
    res.json({
      items: rows.map((r) => ({
        projectId: r.projectId,
        projectName: r.projectName,
        projectUpdatedAt: r.projectUpdatedAt,
        ...r.asset,
      })),
    });
  });

  app.post("/api/projects", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const d = parseBody(createBody, req.body, res);
    if (!d) return;
    const name = (d.name ?? "").trim() || `未命名项目-${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
    const p = await store.create({
      name,
      genreType: d.genreType,
      artStyle: d.artStyle,
      videoAspect: d.videoAspect,
      storyboardImageSize: d.storyboardImageSize,
    });
    res.status(201).json(p);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const ok = await store.delete(req.params.id);
    if (!ok) {
      notFound(res);
      return;
    }
    res.status(204).end();
  });

  app.get("/api/projects/:id", async (req, res) => {
    const p = await getProjectOr404(req.params.id, res);
    if (!p) return;
    res.json(p);
  });

  app.get("/api/projects/:projectId/shots/:shotId/image", (req, res) => {
    const row = store.getStoryboardShotImagePayload(req.params.projectId, req.params.shotId);
    if (!row) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", row.mime);
    /** 分镜图会原地覆盖同路径，禁止长缓存以免界面仍显示旧图 */
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.send(row.body);
  });

  app.put("/api/projects/:id/source", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const data = parseBody(sourceBody, req.body, res);
    if (!data) return;
    try {
      const p = await store.updateSource(req.params.id, data.sourceText);
      res.json(p);
    } catch {
      notFound(res);
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const next = parseBody(projectPatchBody, req.body, res);
    if (!next) return;
    const p = await getProjectOr404(req.params.id, res);
    if (!p) return;
    applyProjectPatch(p, next);
    await store.save(p);
    res.json(p);
  });

  app.post("/api/projects/:id/assets/generate", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const d = parseBody(assetGenerateBody, req.body ?? {}, res);
    if (!d) return;
    const result = await generateAssetImage(req.params.id, d.assetId).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("generateAssetImage threw", {
        reqId: res.getHeader("x-request-id"),
        projectId: req.params.id,
        assetId: d.assetId,
        error: msg,
        ...toErrorMeta(e),
      });
      return { ok: false as const, status: 502 as const, error: msg };
    });
    if (!result.ok) {
      sendError(res, result.status, result.error);
      return;
    }
    res.json(result.project);
  });

  app.post("/api/projects/:id/assets/generate-batch", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const p = await getProjectOr404(req.params.id, res);
    if (!p) return;
    const d = parseBody(assetGenerateBatchBody, req.body ?? {}, res);
    if (!d) return;
    const ids = d.assetIds?.length ? new Set(d.assetIds) : null;
    let targets = ids ? p.assets.filter((a) => ids.has(a.id)) : p.assets;
    if (d.onlyMissing) targets = targets.filter((a) => !a.imageUrl);
    const failures: Array<{ assetId: string; index: number; error: string }> = [];
    for (const a of targets) {
      const result = await generateAssetImage(p.id, a.id).catch((e) => ({
        ok: false as const,
        status: 502 as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!result.ok) failures.push({ assetId: a.id, index: a.index, error: result.error });
    }
    const refreshed = await store.get(p.id);
    res.json({
      project: refreshed ?? p,
      failures,
      successCount: targets.length - failures.length,
      total: targets.length,
    });
  });

  app.post("/api/projects/:id/assets/:assetId/upload", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const { id, assetId } = req.params;
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const asset = p.assets.find((a) => a.id === assetId);
    if (!asset) {
      notFound(res, "asset not found");
      return;
    }
    const body = parseBody(uploadAssetImageBody, req.body ?? {}, res);
    if (!body) return;

    try {
      const m = body.dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      const mime = m ? m[1]! : "image/png";
      const base64Data = m ? m[2]! : body.dataUrl;
      const buffer = Buffer.from(base64Data, "base64");
      if (!buffer.length) {
        badRequest(res, "图片数据为空");
        return;
      }

      const localUrl = await saveProjectImageFile(p.id, "assets", asset.id, buffer, mime);
      const cacheBustUrl = `${localUrl.split("?")[0]}?t=${Date.now()}`;
      asset.imageUrl = cacheBustUrl;
      asset.remoteImageUrl = cacheBustUrl;
      await store.save(p);

      try {
        await appendImageJobRecord(p.id, {
          status: "done",
          message: `本地上传资产图片：${asset.name}（#${asset.index}）`,
          prompt: "用户本地上传",
          resultUrl: cacheBustUrl,
        });
      } catch {
        /* ignore */
      }

      const refreshed = await store.get(p.id);
      res.json({
        ok: true,
        imageUrl: cacheBustUrl,
        project: refreshed ?? p,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("upload asset image threw", {
        reqId: res.getHeader("x-request-id"),
        projectId: id,
        assetId,
        error: msg,
      });
      sendError(res, 500, `上传资产图片失败: ${msg}`);
    }
  });

  app.post("/api/projects/:id/storyboards/:shotId/generate-image", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const body = parseBody(storyboardGenerateImageBody, req.body ?? {}, res);
    if (!body) return;
    const promptOverride = body.promptOverride?.trim() || body.imagePrompt?.trim();
    const result = await runStoryboardImageGeneration(req.params.id, req.params.shotId, {
      promptOverride: promptOverride || undefined,
      referenceImageUrls: body.referenceImageUrls,
      refStrength: body.refStrength,
      promptExtend: body.promptExtend,
    }).catch((e) => ({
      ok: false as const,
      status: 502 as const,
      error: e instanceof Error ? e.message : String(e),
      meta: toErrorMeta(e),
    }));
    if (!result.ok) {
      logger.error("single storyboard image generation failed", {
        reqId: res.getHeader("x-request-id"),
        projectId: req.params.id,
        shotId: req.params.shotId,
        status: result.status,
        error: result.error,
        ...("meta" in result ? (result.meta ?? {}) : {}),
      });
      sendError(res, result.status, result.error);
      return;
    }
    logger.info("single storyboard image generated", {
      reqId: res.getHeader("x-request-id"),
      projectId: req.params.id,
      shotId: req.params.shotId,
    });
    res.json(result.project);
  });

  app.post("/api/projects/:id/storyboards/generate-images", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const body = parseBody(generateImagesBody, req.body ?? {}, res);
    if (!body) return;
    const p = await getProjectOr404(req.params.id, res);
    if (!p) return;
    const allowedIds = body.shotIds?.length ? new Set(body.shotIds) : null;
    let targets = allowedIds ? p.storyboards.filter((s) => allowedIds.has(s.id)) : p.storyboards;
    if (body.onlyMissing) targets = targets.filter((s) => !s.imageUrl);
    if (!targets.length) {
      res.json({ project: p, failures: [], successCount: 0, total: 0 });
      return;
    }
    const failures: Array<{ shotId: string; index: number; error: string }> = [];
    for (const s of targets) {
      const result = await runStoryboardImageGeneration(p.id, s.id).catch((e) => ({
        ok: false as const,
        status: 502 as const,
        error: e instanceof Error ? e.message : String(e),
        meta: toErrorMeta(e),
      }));
      if (!result.ok) {
        logger.error("batch storyboard image generation item failed", {
          reqId: res.getHeader("x-request-id"),
          projectId: p.id,
          shotId: s.id,
          shotIndex: s.index,
          status: result.status,
          error: result.error,
          ...("meta" in result ? (result.meta ?? {}) : {}),
        });
        failures.push({ shotId: s.id, index: s.index, error: result.error });
      }
    }
    const refreshed = await store.get(p.id);
    logger.info("batch storyboard image generation finished", {
      reqId: res.getHeader("x-request-id"),
      projectId: p.id,
      total: targets.length,
      failed: failures.length,
      success: targets.length - failures.length,
    });
    res.json({
      project: refreshed ?? p,
      failures,
      successCount: targets.length - failures.length,
      total: targets.length,
    });
  });

  app.post("/api/projects/:id/videos/enqueue", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    logger.info("video enqueue requested", {
      reqId: res.getHeader("x-request-id"),
      projectId: id,
      body: req.body,
    });
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const body = parseBody(videoEnqueueBody, req.body ?? {}, res);
    if (!body) return;
    const shots = pickShotsByMode(p, body.mode, body.shotIds);
    const appCfg = await readConfig();
    const blockers = shots.flatMap((s) => {
      const out: string[] = [];
      const k = shotKeyframeBlockingVideoReason(s);
      if (k) out.push(k);
      if (appCfg.video) {
        const vc = resolveVideoConfigForShot(s, appCfg) ?? appCfg.video;
        const m = shotVideoRunModeBlockingReason(s, vc);
        if (m) out.push(m);
      }
      return out;
    });
    if (blockers.length) {
      badRequest(res, { blockers, message: "以下镜头不满足视频生成条件，已取消入队" });
      return;
    }
    let enqueued = 0;
    for (const s of shots) {
      await enqueueJob(id, {
        message: `镜头 #${s.index} 视频（queued：待本机 Runner，请点击「启动 Runner」）`,
        shotIndex: s.index,
        prompt: getVideoBasePromptForShot(s),
        imageUrl: s.imageUrl,
      });
      enqueued++;
    }
    logger.info("video enqueue finished", {
      reqId: res.getHeader("x-request-id"),
      projectId: id,
      mode: body.mode,
      requested: shots.length,
      enqueued,
    });
    const refreshed = await store.get(id);
    if (refreshed) {
      const message = `视频入队：mode=${body.mode}，入队 ${enqueued}/${shots.length} 条`;
      refreshed.pipelineLog.push(`${new Date().toISOString()} ${message}`);
      await store.save(refreshed);
      sseSend(id, { type: "log", message });
    }
    res.json({ project: refreshed ?? p, enqueued });
  });

  app.post("/api/projects/:id/videos/retry-failed", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    logger.info("video retry failed requested", {
      reqId: res.getHeader("x-request-id"),
      projectId: id,
    });
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const failed = p.videoJobs.filter((j) => j.status === "failed" && (j.kind ?? "video") === "video");
    const appCfgRetry = await readConfig();
    const blockers = failed.flatMap((job) => {
      if (typeof job.shotIndex !== "number") return [];
      const shot = p.storyboards.find((s) => s.index === job.shotIndex);
      if (!shot) return [];
      const out: string[] = [];
      const k = shotKeyframeBlockingVideoReason(shot);
      if (k) out.push(k);
      if (appCfgRetry.video) {
        const vc = resolveVideoConfigForShot(shot, appCfgRetry) ?? appCfgRetry.video;
        const m = shotVideoRunModeBlockingReason(shot, vc);
        if (m) out.push(m);
      }
      return out;
    });
    if (blockers.length) {
      badRequest(res, { blockers: [...new Set(blockers)], message: "以下镜头不满足视频生成条件，已取消重试入队" });
      return;
    }
    let enqueued = 0;
    for (const job of failed) {
      await enqueueJob(id, {
        message: job.shotIndex != null ? `镜头 #${job.shotIndex} 视频重试` : "视频重试",
        shotIndex: job.shotIndex,
        prompt: job.prompt,
        imageUrl: job.imageUrl,
      });
      enqueued++;
    }
    logger.info("video retry failed finished", {
      reqId: res.getHeader("x-request-id"),
      projectId: id,
      failedCount: failed.length,
      enqueued,
    });
    const refreshed = await store.get(id);
    if (refreshed) {
      const message = `视频失败重试：失败任务 ${failed.length}，重新入队 ${enqueued}`;
      refreshed.pipelineLog.push(`${new Date().toISOString()} ${message}`);
      await store.save(refreshed);
      sseSend(id, { type: "log", message });
    }
    res.json({ project: refreshed ?? p, enqueued, failedCount: failed.length });
  });

  app.post("/api/projects/:id/videos/concat", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    try {
      const result = await concatProjectVideos(id);
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      badRequest(res, msg);
    }
  });

  const fallbackVideoCfgForPreview: VideoProviderConfig = {
    provider: "http-hook",
    baseUrl: "",
    apiKey: "",
    model: "",
    referenceMode: "off",
    aggregateAssets: true,
    multiReferenceImages: true,
  };

  app.post("/api/projects/:id/storyboards/:shotId/video-prompt-preview", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const shot = p.storyboards.find((s) => s.id === req.params.shotId);
    if (!shot) {
      notFound(res, "shot not found");
      return;
    }
    const body = parseBody(videoPromptPreviewBody, req.body ?? {}, res);
    if (!body) return;
    const cfg = await readConfig();
    const videoCfg = cfg.video ? (resolveVideoConfigForShot(shot, cfg) ?? cfg.video) : fallbackVideoCfgForPreview;
    const promptOverride = body.promptOverride?.trim() || body.videoPrompt?.trim();
    const shotForPreview =
      body.durationSec != null && Number.isFinite(body.durationSec)
        ? { ...shot, durationSec: body.durationSec }
        : shot;
    const defaultBase = getVideoBasePromptForShot(shotForPreview, { ignoreVideoPrompt: true });
    const base = promptOverride || getVideoBasePromptForShot(shotForPreview);
    const enrichedBasePrompt = enrichStoryboardVideoPromptBase(shotForPreview, base);
    const referencedAssets = await resolveReferencedAssetsForVideo(p, shotForPreview, base);
    const enriched = buildVideoInputWithAssets({
      project: p,
      shot: shotForPreview,
      basePrompt: base,
      baseImageUrl: shotBaseImageUrlForVideo(shotForPreview) ?? shotForPreview.imageUrl,
      videoCfg,
      referencedAssets,
    });
    const firstApi = enriched.apiImageUrls[0] ?? null;
    const enrichedPrompt = applyArkReferenceImagePromptHint(videoCfg, enriched.prompt, firstApi);
    const matchedList = enriched.matchedAssets.map((a) => ({ id: a.id, name: a.name, type: a.type }));
    const formattedVideoSlots = enriched.referenceSlots.map((s) => ({
      role: s.role,
      name: s.name,
      id: s.id,
      assetType: s.assetType,
      storageUrl: s.storageUrl,
      resolvedUrl: s.resolvedUrl,
      sendable: s.sendable,
      inApiPayload: !!(s.resolvedUrl && enriched.apiImageUrls.includes(s.resolvedUrl)),
    }));
    res.json({
      defaultBasePrompt: defaultBase,
      basePrompt: base,
      enrichedBasePrompt,
      /** 含【参考图附件】短说明，不含方舟「首帧参考图」系统前缀 */
      textPayload: enriched.prompt,
      /** 方舟等路径下 content 中 text 段最终值；非方舟时与 textPayload 相同 */
      enrichedPrompt,
      enrichedText: enrichedPrompt,
      matchedAssets: matchedList,
      matched: matchedList,
      referenceSlots: formattedVideoSlots,
      slots: formattedVideoSlots,
      apiImageUrls: enriched.apiImageUrls,
      apiUrls: enriched.apiImageUrls,
      videoAspect: p.videoAspect,
      /** 将随视频 API 请求体发送的整秒时长（与 textPayload 分离） */
      durationSeconds: enriched.durationSeconds ?? null,
      runMode: enriched.runMode ?? null,
      omniAudioUrl: enriched.omniAudioUrl ?? null,
      omniVideoUrl: enriched.omniVideoUrl ?? null,
    });
  });

  app.post("/api/projects/:id/storyboards/:shotId/image-prompt-preview", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const shot = p.storyboards.find((s) => s.id === req.params.shotId);
    if (!shot) {
      notFound(res, "shot not found");
      return;
    }
    const body = parseBody(imagePromptPreviewBody, req.body ?? {}, res);
    if (!body) return;
    const cfg = await readConfig();
    const aggregateAssets = cfg.video?.aggregateAssets !== false;
    const promptOverride = body.promptOverride?.trim() || body.imagePrompt?.trim();
    const basePrompt = resolveStoryboardImageVisualBase(shot, promptOverride);
    const defaultBasePrompt = resolveStoryboardImageVisualBase(shot, undefined, { ignoreImagePrompt: true });
    const enrichedBasePrompt = enrichStoryboardImageVisualBase(shot, promptOverride || defaultBasePrompt);
    const fullPrompt = buildStoryboardImageGenerationPrompt(p, shot, {
      aggregateAssets,
      imagePromptOverride: promptOverride,
    });
    const ordered = orderedAssetsForStoryboardVisual(p, shot);
    const matchedAssets = ordered.map((a) => ({ id: a.id, name: a.name, type: a.type }));
    const { apiImageUrls, referenceSlots } = await collectStoryboardImageReferenceDetails(p, shot);
    const formattedSlots = referenceSlots.map((s) => ({
      role: s.role,
      name: s.name,
      id: s.id,
      assetType: s.assetType,
      storageUrl: s.storageUrl,
      resolvedUrl: s.resolvedUrl,
      resolvedUrlPreview: s.resolvedUrlPreview,
      sendable: s.sendable,
      inApiPayload: s.inApiPayload,
    }));
    res.json({
      defaultBasePrompt,
      basePrompt,
      enrichedBasePrompt,
      fullPrompt,
      matchedAssets,
      matched: matchedAssets,
      referenceSlots: formattedSlots,
      slots: formattedSlots,
      apiImageUrls,
      apiUrls: apiImageUrls,
      storyboardImageSize: p.storyboardImageSize,
    });
  });

  app.post("/api/projects/:id/videos/run-once", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const body = parseBody(videoRunOnceBody, req.body ?? {}, res);
    if (!body) return;
    if (!p.storyboards.some((s) => s.id === body.shotId)) {
      notFound(res, "shot not found");
      return;
    }
    const reqId = String(res.getHeader("x-request-id") ?? "");
    const out = await runVideoOnceForShot({
      projectId: id,
      shotId: body.shotId,
      promptOverride: body.promptOverride,
      reqId,
    });
    if (out.kind === "blocked") {
      sendError(res, 400, out.error, { project: out.project });
      return;
    }
    if (out.kind === "fail") {
      sendError(res, out.status, out.error, out.project ? { project: out.project } : undefined);
      return;
    }
    res.json({ project: out.project, resultUrl: out.resultUrl });
  });

  app.post("/api/projects/:id/storyboards/:shotId/publish-easyimage", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const body = parseBody(publishEasyImageBody, req.body ?? {}, res);
    if (!body) return;
    const reqId = String(res.getHeader("x-request-id") ?? "");
    const result = await publishStoryboardShotToEasyImage({
      projectId: req.params.id,
      shotId: req.params.shotId,
      runVideoAfter: body.runVideoAfter === true,
      publishVideoReferenceAssets: body.publishVideoReferenceAssets !== false,
      reqId,
    });
    if (!result.ok) {
      sendError(res, result.status, result.error, result.project ? { project: result.project } : undefined);
      return;
    }
    res.json({
      publishedUrl: result.publishedUrl,
      project: result.project,
      ...(result.publishedAssets != null ? { publishedAssets: result.publishedAssets } : {}),
      ...(result.assetPublishNotes != null ? { assetPublishNotes: result.assetPublishNotes } : {}),
      videoRun: result.videoRun,
    });
  });

  app.post(["/api/projects/:id/shots/:shotId/tts", "/api/projects/:id/storyboards/:shotId/tts"], async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const shotId = String(req.params.shotId);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const body = parseBody(shotTtsBody, req.body ?? {}, res);
    if (!body) return;
    try {
      const result = await generateShotAudio(id, shotId, {
        text: body.text,
        model: body.model,
        voice: body.voice,
      });
      const refreshed = await store.get(id);
      res.json({ ok: true, audioUrl: result.audioUrl, project: refreshed ?? p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendError(res, 500, msg);
    }
  });

  app.post(["/api/projects/:id/shots/:shotId/remux-video", "/api/projects/:id/storyboards/:shotId/remux-video"], async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const shotId = String(req.params.shotId);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const shot = p.storyboards.find((s) => s.id === shotId);
    if (!shot) {
      notFound(res, "shot not found");
      return;
    }

    // 寻找本镜最新的已完成视频任务（过滤掉生图任务，确保是 .mp4 视频）
    const job = [...p.videoJobs].reverse().find((j) =>
      (j.shotId === shot.id || j.shotIndex === shot.index) &&
      j.status === "done" &&
      Boolean(j.resultUrl) &&
      (j.resultUrl!.includes("/videos/") || j.resultUrl!.endsWith(".mp4"))
    );
    if (!job || !job.resultUrl) {
      sendError(res, 400, "本镜尚未生成可用视频，请先生成视频后再融合配乐与对白");
      return;
    }

    try {
      const cleanUrl = job.resultUrl.split("?")[0]!;
      const muxRes = await tryMuxAudioIntoVideo(id, shot.id, cleanUrl);
      const cacheBustUrl = `${muxRes.videoUrl.split("?")[0]}?t=${Date.now()}`;
      job.resultUrl = cacheBustUrl;
      await store.save(p);
      const refreshed = await store.get(id);
      res.json({ ok: true, videoUrl: cacheBustUrl, muxed: muxRes.muxed, project: refreshed ?? p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendError(res, 500, `融合音画失败: ${msg}`);
    }
  });

  app.post("/api/projects/:id/remux-all-videos", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;

    let remuxedCount = 0;
    const now = Date.now();
    for (const shot of p.storyboards) {
      const job = [...p.videoJobs].reverse().find((j) =>
        (j.shotId === shot.id || j.shotIndex === shot.index) &&
        j.status === "done" &&
        Boolean(j.resultUrl) &&
        (j.resultUrl!.includes("/videos/") || j.resultUrl!.endsWith(".mp4"))
      );
      if (job && job.resultUrl) {
        try {
          const cleanUrl = job.resultUrl.split("?")[0]!;
          const muxRes = await tryMuxAudioIntoVideo(id, shot.id, cleanUrl);
          if (muxRes.muxed) {
            job.resultUrl = `${muxRes.videoUrl.split("?")[0]}?t=${now}`;
            remuxedCount++;
          }
        } catch (err) {
          logger.warn("全镜重融单个视频跳过异常", { shotId: shot.id, error: String(err) });
        }
      }
    }
    await store.save(p);
    const refreshed = await store.get(id);
    res.json({ ok: true, remuxedCount, project: refreshed ?? p });
  });

  app.get("/api/projects/:id/bgm", async (req, res) => {
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    res.json({
      presets: BGM_PRESETS.map((b) => ({
        ...b,
        url: `/api/files/bgm/${b.filename}`,
      })),
      custom: listProjectBgms(id),
    });
  });

  app.post("/api/projects/:id/bgm/upload", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const { filename, dataUrl } = req.body ?? {};
    if (!filename || !dataUrl || typeof dataUrl !== "string") {
      badRequest(res, "filename and dataUrl are required");
      return;
    }
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const base64Data = m ? m[2]! : dataUrl;
    const buffer = Buffer.from(base64Data, "base64");
    if (!buffer.length) {
      badRequest(res, "empty audio payload");
      return;
    }
    const saved = saveProjectBgmFile(id, filename, buffer);
    res.json({ ok: true, file: saved });
  });

  app.post("/api/projects/:id/polish", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const data = parseBody(polishBody, req.body ?? {}, res);
    if (!data) return;
    const p = await getProjectOr404(req.params.id, res);
    if (!p) return;
    const { field } = data;
    const text = field === "source" ? p.sourceText : p.script;
    if (!text.trim()) {
      badRequest(res);
      return;
    }
    try {
      const polished = await runPolishAgent(field, text, p);
      if (field === "source") p.sourceText = polished;
      else p.script = polished;
      await store.save(p);
      res.json(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      badGateway(res, msg.slice(0, 800));
    }
  });

  app.post("/api/projects/:id/script/regenerate-chapter", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const data = parseBody(regenerateChapterBody, req.body ?? {}, res);
    if (!data) return;
    const id = String(req.params.id);
    if (isPipelineRunning(id)) {
      const p = await store.get(id);
      conflict(res, "pipeline running", {
        pipelineStatus: p?.pipelineStatus,
        logTail: (p?.pipelineLog ?? []).slice(-12),
      });
      return;
    }
    try {
      sseSend(id, { type: "stage", stage: "script", status: "start" });
      sseSend(id, { type: "log", message: `开始单章重生：chapterIndex=${data.chapterIndex}` });
      const p = await regenerateScriptChapter(id, data.chapterIndex);
      sseSend(id, { type: "stage", stage: "script", status: "done" });
      sseSend(id, { type: "log", message: "单章重生完成" });
      res.json(p);
    } catch (e) {
      const status = typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 502;
      const msg = e instanceof Error ? e.message : String(e);
      sseSend(id, { type: "stage", stage: "script", status: "error", detail: msg.slice(0, 800) });
      sseSend(id, { type: "log", message: `单章重生失败：${msg.slice(0, 220)}` });
      if (status === 404) {
        notFound(res);
        return;
      }
      sendError(res, status, msg.slice(0, 800));
    }
  });

  app.post("/api/projects/:id/pipeline/run", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    // 以内存真实运行态为准；DB 若遗留 running，则先自动纠偏后再启动
    if (isPipelineRunning(id)) {
      // 纠偏：若 DB 不是 running，说明内存锁已“脏”，释放并允许重启
      if (p.pipelineStatus !== "running") {
        releasePipelineLock(id);
      } else {
        conflict(res, "pipeline already running", {
          pipelineStatus: p.pipelineStatus,
          pipelineError: p.pipelineError,
          logTail: (p.pipelineLog ?? []).slice(-12),
        });
        return;
      }
    }
    if (p.pipelineStatus === "running") {
      p.pipelineStatus = "error";
      p.pipelineError = "检测到历史残留 running 状态，已自动纠偏，请重新运行";
      await store.save(p);
    }
    const parsed = pipelineRunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      badRequest(res, parsed.error.flatten());
      return;
    }
    const body = parsed.data;
    const from = body.from ?? "script";
    const to = body.to ?? "video";
    if (PIPELINE_STAGE_ORDER.indexOf(from) > PIPELINE_STAGE_ORDER.indexOf(to)) {
      badRequest(res);
      return;
    }
    const range: PipelineRunRange = {
      from,
      to,
      ...(typeof body.chapterIndex === "number" ? { chapterIndex: body.chapterIndex } : {}),
      ...(body.assetsEntriesOnly === true ? { assetsEntriesOnly: true } : {}),
      ...(typeof body.assetsGenerateImages === "boolean" ? { assetsGenerateImages: body.assetsGenerateImages } : {}),
      ...(typeof body.storyboardGenerateImages === "boolean"
        ? { storyboardGenerateImages: body.storyboardGenerateImages }
        : {}),
    };
    res.status(202).json({ accepted: true, range });
    void runPipeline(id, range);
  });

  app.post("/api/projects/:id/pipeline/cancel", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    requestCancelPipeline(id);
    res.status(202).json({ accepted: true });
  });

  app.post("/api/projects/:id/jobs", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const data = parseBody(jobEnqueueBody, req.body ?? {}, res);
    if (!data) return;
    const msg = data.message ?? "手工入队任务";
    const job = await enqueueJob(
      id,
      data.kind !== undefined || data.shotIndex !== undefined || data.prompt || data.imageUrl
        ? {
            kind: data.kind,
            message: msg,
            shotIndex: data.shotIndex,
            prompt: data.prompt,
            imageUrl: data.imageUrl,
          }
        : msg,
    );
    res.status(201).json(job);
  });

  app.post("/api/projects/:id/jobs/run", async (req, res) => {
    if (!verifyAuth(req, res)) return;
    const id = String(req.params.id);
    const p = await getProjectOr404(id, res);
    if (!p) return;
    const data = parseBody(jobRunBody, req.body ?? {}, res);
    if (!data) return;
    logger.info("video runner trigger requested", {
      reqId: res.getHeader("x-request-id"),
      projectId: id,
      delayMs: data.delayMs,
    });
    res.status(202).json({ accepted: true });
    void runJobQueue(id, data);
  });

  app.get("/api/projects/:id/events", async (req, res) => {
    const id = String(req.params.id);
    const p = await store.get(id);
    if (!p) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }
    sseAddClient(id, res);
    try {
      res.write(": sse\n\n");
    } catch {
      sseRemoveClient(id, res);
      return;
    }
    req.on("close", () => {
      sseRemoveClient(id, res);
    });
  });
}
