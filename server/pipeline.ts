import { store } from "./store.js";
import { dedupeAssets, normalizeToken } from "./assetUtils.js";
import { tryEasyImageUrlAfterGenerate } from "./easyImageAfterGenerate.js";
import { bytesFromGenerateImageResult, saveProjectImageFile } from "./imagePersist.js";
import { sseClearRecent, sseSend } from "./sse.js";
import { readConfig } from "./config.js";
import { directorReview, type DirectorVerdict } from "./agents/directorAgent.js";
import { runScriptAgent } from "./agents/scriptAgent.js";
import { runStoryboardAgent, runStoryboardAgentPartial, runStoryboardChapterAgent } from "./agents/storyboardAgent.js";
import { runImageAgentForShot, runImageAgentForStoryboardShot } from "./agents/imageAgent.js";
import { runAssetsAgent } from "./agents/assetsAgent.js";
import { composeAssetImagePrompt } from "./assetImagePrompt.js";
import { buildVideoJobPlan, refineVideoJobPlan, serializeVideoPlanForDirector } from "./agents/videoAgent.js";
import { appendImageJobRecord, enqueueJob, runJobQueue } from "./jobs.js";
import { getModelApiCallFromError } from "./modelCallError.js";
import { buildStoryboardImageGenerationPrompt } from "./storyboardImagePrompt.js";
import { shotKeyframeBlockingVideoReason } from "./videoContext.js";
import {
  DIRECTOR_FEEDBACK_IN_PROMPT_MAX,
  MAX_DIRECTOR_ATTEMPTS,
  MIN_STORYBOARD_SHOTS,
  PIPELINE_STAGE_ORDER,
  PRIOR_IMAGE_BATCH_SCRIPT,
  PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR,
  PRIOR_STORYBOARD_SCRIPT,
  PRIOR_VIDEO_PLAN_SCRIPT,
  SHOT_IMAGE_MAX_ATTEMPTS,
} from "./pipelineConstants.js";
import type { DirectorStep, PipelineStage, Project, StoryboardShot } from "./types.js";
import { formatErrorMessage } from "./errorFormat.js";
import { logger } from "./logger.js";
import { formatProjectMeta } from "./projectMeta.js";
import { splitSourceToChapters } from "./sourceChapters.js";
import { regenerateScriptChapter } from "./regenerateChapterScript.js";
import {
  allGlobalSceneNosForStoryboard,
  extractSceneNosFromMarkdownTable,
  getScriptBlocksForStoryboard,
  mergeStoryboardByScenes,
  pickStoryboardRetrySceneNos,
  reindexStoryboardIndices,
} from "./storyboardSceneUtils.js";

const debugLlm = process.env.MY_APP_DEBUG_LLM === "1" || process.env.MY_APP_DEBUG_LLM === "true";
const runningPipelines = new Set<string>(); // projectId
const projectWriteQueue = new Map<string, Promise<unknown>>(); // projectId -> tail promise
const cancelRequested = new Set<string>(); // projectId

export function isPipelineRunning(projectId: string): boolean {
  return runningPipelines.has(projectId);
}

/** 当内存锁与 DB 状态不一致时，用于纠偏释放锁 */
export function releasePipelineLock(projectId: string): void {
  runningPipelines.delete(projectId);
}

export function requestCancelPipeline(projectId: string): void {
  cancelRequested.add(projectId);
}

function assertNotCancelled(projectId: string, stage: PipelineStage) {
  if (cancelRequested.has(projectId)) throw new PipelineStageError(stage, "管线已取消");
}

async function withProjectWriteLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const prev = projectWriteQueue.get(projectId) ?? Promise.resolve();
  const next = prev.then(task, task);
  // 防止队列因 reject 卡死
  projectWriteQueue.set(
    projectId,
    next.catch(() => undefined),
  );
  return next;
}

async function saveMergedProject(projectId: string, mutate: (p: Project) => void | Promise<void>): Promise<Project> {
  return withProjectWriteLock(projectId, async () => {
    const fresh = await store.get(projectId);
    if (!fresh) throw new Error("项目不存在");
    await mutate(fresh);
    await store.save(fresh);
    return (await store.get(projectId)) ?? fresh;
  });
}

/**
 * 并行管线下避免“写库覆盖”：
 * store.save 会重建 storyboard_shots / video_jobs，因此保存前必须把其它分支写入的最新数据同步进来。
 */
/**
 * 按 ID 合并数组元素，避免并发修改时数据丢失（辅助函数）
 */
function mergeArraysById<T extends { id: string }>(latest: T[], current: T[]): T[] {
  const latestMap = new Map(latest.map((item) => [item.id, item]));
  const currentMap = new Map(current.map((item) => [item.id, item]));
  // 合并：保留 latest 的所有项，但用 current 中的项覆盖相同 ID
  for (const [id, item] of currentMap) {
    latestMap.set(id, item);
  }
  return Array.from(latestMap.values());
}

async function safeSaveProject(
  project: Project,
  opts?: { keepAssets?: boolean; keepStoryboards?: boolean; keepVideoJobs?: boolean },
) {
  return withProjectWriteLock(project.id, async () => {
    const latest = await store.get(project.id);
    if (latest) {
      // ✅ 改进：对数组字段使用 ID 级别的合并，而不是简单覆盖
      if (opts?.keepAssets !== true) {
        project.assets = dedupeAssets(mergeArraysById(latest.assets, project.assets));
      }
      if (opts?.keepStoryboards !== true) {
        project.storyboards = mergeArraysById(latest.storyboards, project.storyboards);
      }
      if (opts?.keepVideoJobs !== true) {
        project.videoJobs = mergeArraysById(latest.videoJobs, project.videoJobs);
      }
      // 合并 pipelineLog，避免并行分支互相覆盖日志
      if (Array.isArray(latest.pipelineLog) && latest.pipelineLog.length) {
        const seen = new Set(latest.pipelineLog);
        const merged = [...latest.pipelineLog];
        for (const line of project.pipelineLog ?? []) {
          if (!seen.has(line)) {
            merged.push(line);
            seen.add(line);
          }
        }
        project.pipelineLog = merged;
      }
    }
    await store.save(project);
  });
}

async function commitProject(
  project: Project,
  opts?: { keepAssets?: boolean; keepStoryboards?: boolean; keepVideoJobs?: boolean; keepPipelineLog?: boolean },
) {
  return safeSaveProject(project, {
    keepAssets: opts?.keepAssets,
    keepStoryboards: opts?.keepStoryboards,
    keepVideoJobs: opts?.keepVideoJobs,
  });
}

class PipelineStageError extends Error {
  stage: PipelineStage;
  constructor(stage: PipelineStage, message: string) {
    super(message);
    this.name = "PipelineStageError";
    this.stage = stage;
  }
}

async function runAsStage<T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PipelineStageError(stage, msg);
  }
}

function log(project: Project, message: string) {
  project.pipelineLog.push(`${new Date().toISOString()} ${message}`);
  sseSend(project.id, { type: "log", message });
}

/** 写入 pipelineLog 的可解析阶段标记，供前端重连/刷新后与阶段条对齐；并发送 stage SSE */
function emitPipelineStage(
  project: Project,
  stage: PipelineStage,
  status: "start" | "done" | "error",
  detail?: string,
) {
  const detailPart = status === "error" && detail?.trim() ? ` ${detail.trim().slice(0, 400)}` : "";
  project.pipelineLog.push(`${new Date().toISOString()} [pipeline-stage] ${stage} ${status}${detailPart}`);
  sseSend(project.id, {
    type: "stage",
    stage,
    status,
    ...(status === "error" && detail ? { detail } : {}),
  });
}

function shortUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "(empty)";
  try {
    const u = new URL(v);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return v.slice(0, 80);
  }
}

function pipelineStageIndex(s: PipelineStage): number {
  const i = PIPELINE_STAGE_ORDER.indexOf(s);
  if (i < 0) throw new Error(`invalid pipeline stage: ${s}`);
  return i;
}

function pipelineRangeCovers(from: PipelineStage, to: PipelineStage, stage: PipelineStage): boolean {
  const a = pipelineStageIndex(from);
  const b = pipelineStageIndex(to);
  const x = pipelineStageIndex(stage);
  return a <= x && x <= b;
}

function assertPipelineRangeOrder(from: PipelineStage, to: PipelineStage) {
  if (pipelineStageIndex(from) > pipelineStageIndex(to)) {
    throw new Error("管线区间无效：起始阶段不能晚于结束阶段");
  }
}

/** 从某阶段开始时，要求上游产物已存在 */
function assertUpstreamInputs(project: Project, from: PipelineStage) {
  if (from === "script" && !project.sourceText.trim()) {
    throw new Error("请先填写小说/原文");
  }
  if ((from === "assets" || from === "storyboard" || from === "video") && !project.script.trim()) {
    throw new Error("从当前阶段开始需要已有剧本文本");
  }
  if (from === "video" && !project.storyboards.length) {
    throw new Error("从视频阶段开始需要已有分镜数据");
  }
}

async function preflightModelConfigForRange(
  project: Project,
  from: PipelineStage,
  to: PipelineStage,
  opts: { assetImages: boolean; storyboardImages: boolean },
) {
  const cfg = await readConfig();
  const missing: string[] = [];
  const coversAssets = pipelineRangeCovers(from, to, "assets");
  const coversStoryboard = pipelineRangeCovers(from, to, "storyboard");
  const needImage = (coversAssets && opts.assetImages) || (coversStoryboard && opts.storyboardImages);
  const needVideo = pipelineRangeCovers(from, to, "video");

  if (!cfg.text?.baseUrl) missing.push("text.baseUrl");
  if (!cfg.text?.apiKey) missing.push("text.apiKey");
  if (!cfg.text?.model) missing.push("text.model");
  if (needImage) {
    if (!cfg.image?.baseUrl) missing.push("image.baseUrl");
    if (!cfg.image?.apiKey) missing.push("image.apiKey");
    if (!cfg.image?.model) missing.push("image.model");
  }
  if (needVideo) {
    if (!cfg.video?.baseUrl) missing.push("video.baseUrl");
    if (!cfg.video?.apiKey) missing.push("video.apiKey");
    if (!cfg.video?.model) missing.push("video.model");
  }
  if (missing.length) {
    throw new Error(`配置不完整，无法调用真实模型：${missing.join(", ")}`);
  }

  const textCfg = cfg.text!;
  const parts = [`text=${textCfg.model} @ ${shortUrl(textCfg.baseUrl)}`];
  if (needImage) {
    const imageCfg = cfg.image!;
    parts.push(`image=${imageCfg.model} @ ${shortUrl(imageCfg.baseUrl)}`);
  }
  if (needVideo) {
    const videoCfg = cfg.video!;
    parts.push(`videoBase=${shortUrl(videoCfg.baseUrl)}；videoModel=${videoCfg.model}`);
  }
  log(project, `模型调用预检通过（区间 ${from}→${to}）：${parts.join("；")}`);
}

const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  script: "剧本",
  assets: "资产",
  storyboard: "分镜/生图",
  video: "视频",
};

function formatPipelineRangeLog(from: PipelineStage, to: PipelineStage): string {
  return `${PIPELINE_STAGE_LABEL[from]} → ${PIPELINE_STAGE_LABEL[to]}`;
}

function emitDirector(project: Project, step: DirectorStep, verdict: DirectorVerdict, attempt: number) {
  log(project, `导演 · ${step} · 第${attempt}轮：${verdict.approved ? "通过" : "退回"} — ${verdict.feedback}`);
  sseSend(project.id, { type: "director", step, approved: verdict.approved, feedback: verdict.feedback, attempt });
}

function normalizeAssetPromptForReuse(v: string | undefined): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function reuseAssetImagesByIdentity(
  prev: Project["assets"],
  next: Project["assets"],
): {
  merged: Project["assets"];
  reusedCount: number;
  regeneratedCount: number;
} {
  const byStable = new Map<number, Project["assets"][number]>();
  const byKey = new Map<string, Project["assets"][number]>();
  const byName = new Map<string, Project["assets"][number]>();
  for (const a of prev) {
    if (typeof a.stableId === "number") byStable.set(a.stableId, a);
    if (a.key?.trim()) byKey.set(a.key.trim().toLowerCase(), a);
    if (a.name?.trim()) byName.set(normalizeToken(a.name), a);
  }
  let reusedCount = 0;
  let regeneratedCount = 0;
  const merged = next.map((a) => {
    const hit =
      (typeof a.stableId === "number" ? byStable.get(a.stableId) : undefined) ??
      (a.key?.trim() ? byKey.get(a.key.trim().toLowerCase()) : undefined) ??
      (a.name?.trim() ? byName.get(normalizeToken(a.name)) : undefined);
    if (!hit) {
      regeneratedCount += 1;
      return { ...a, imageUrl: undefined };
    }
    const samePrompt = normalizeAssetPromptForReuse(hit.prompt) === normalizeAssetPromptForReuse(a.prompt);
    if (samePrompt && hit.imageUrl) {
      reusedCount += 1;
      return { ...a, id: hit.id, imageUrl: hit.imageUrl, remoteImageUrl: hit.remoteImageUrl || a.remoteImageUrl };
    }
    regeneratedCount += 1;
    return { ...a, id: hit.id, imageUrl: undefined };
  });
  return { merged: dedupeAssets(merged), reusedCount, regeneratedCount };
}

function normalizeLabel(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[：:·\-—_]/g, "")
    .toLowerCase();
}

function toCnNumber(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 10) return digits[n]!;
  if (n < 20) return `十${n % 10 === 0 ? "" : digits[n % 10]}`;
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return `${digits[ten]}十${one === 0 ? "" : digits[one]}`;
  }
  return String(n);
}

function pickScriptRetryChapterIndexes(feedback: string, chapterTitles: string[]): number[] {
  const f = normalizeLabel(feedback);
  if (!f) return [];
  const set = new Set<number>();
  for (let i = 0; i < chapterTitles.length; i++) {
    const idx = i + 1;
    const titleNorm = normalizeLabel(chapterTitles[i] ?? "");
    const arabic = `第${idx}章`;
    const chinese = `第${toCnNumber(idx)}章`;
    if (f.includes(normalizeLabel(arabic)) || f.includes(normalizeLabel(chinese))) set.add(i);
    if (titleNorm && (f.includes(titleNorm) || titleNorm.includes(f))) set.add(i);
    if (idx === 1 && (f.includes("序章") || f.includes("序幕"))) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

async function runScriptWithGate(project: Project, opts?: { chapterIndex?: number }): Promise<void> {
  const chapterIndex = opts?.chapterIndex;
  if (typeof chapterIndex === "number") {
    emitPipelineStage(project, "script", "start");
    assertNotCancelled(project.id, "script");
    const chapters = splitSourceToChapters(project.sourceText).filter((c) => c.content.trim());
    if (!chapters.length) throw new Error("未解析到有效章节，无法按章生成剧本");
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= chapters.length) {
      throw new Error(`chapterIndex 超出范围：${chapterIndex}（有效范围 0~${chapters.length - 1}）`);
    }
    const title = chapters[chapterIndex]!.title?.trim() || `第${chapterIndex + 1}章`;
    log(project, `剧本阶段（章节模式）：仅重生第 ${chapterIndex + 1}/${chapters.length} 章「${title}」`);
    const refreshed = await regenerateScriptChapter(project.id, chapterIndex);
    project.script = refreshed.script;
    await commitProject(project);
    emitPipelineStage(project, "script", "done");
    return;
  }
  emitPipelineStage(project, "script", "start");
  const prior = `【小说原文摘要】\n${project.sourceText.slice(0, PRIOR_SOURCE_FOR_SCRIPT_DIRECTOR)}`;
  let directorFeedback: string | null = null;
  const chapters = splitSourceToChapters(project.sourceText).filter((c) => c.content.trim());
  if (!chapters.length) throw new Error("未解析到有效章节，无法按章节生成剧本");
  const chapterTitles = chapters.map((c, i) => c.title?.trim() || `第${i + 1}章`);
  const chapterChunks: string[] = new Array(chapters.length).fill("");
  let retryIndexes: number[] = chapters.map((_, i) => i);

  for (let attempt = 1; attempt <= MAX_DIRECTOR_ATTEMPTS; attempt++) {
    assertNotCancelled(project.id, "script");
    log(project, `剧本 Agent 第 ${attempt} 次生成（按章节：本轮重写 ${retryIndexes.length}/${chapters.length} 章）`);
    for (const i of retryIndexes) {
      assertNotCancelled(project.id, "script");
      const ch = chapters[i]!;
      const title = chapterTitles[i]!;
      log(project, `剧本生成：第 ${i + 1}/${chapters.length} 章「${title.slice(0, 30)}」`);
      const part = await runScriptAgent(
        {
          chapterTitle: title,
          chapterContent: `${formatProjectMeta(project)}${ch.content}`,
          outlineHint: "",
        },
        directorFeedback,
      );
      chapterChunks[i] = `### ${title}\n${part}`.trim();
    }
    if (chapterChunks.some((v) => !v.trim())) throw new Error("章节剧本生成不完整，请重试");
    project.script = chapterChunks.join("\n\n");
    await commitProject(project);

    const verdict = await directorReview({
      step: "script",
      priorContext: prior,
      output: project.script,
    });
    emitDirector(project, "script", verdict, attempt);
    await commitProject(project);
    if (verdict.approved) {
      emitPipelineStage(project, "script", "done");
      return;
    }
    directorFeedback = verdict.feedback;
    const targeted = pickScriptRetryChapterIndexes(verdict.feedback, chapterTitles);
    retryIndexes = targeted.length > 0 ? targeted : chapters.map((_, i) => i);
    log(
      project,
      targeted.length > 0
        ? `导演按章节打回：下轮仅重写 ${targeted.length} 章（${targeted.map((i) => i + 1).join(", ")}）`
        : "导演意见未定位到具体章节：下轮将全量重写",
    );
  }
  throw new Error(`剧本经 ${MAX_DIRECTOR_ATTEMPTS} 轮仍未通过导演审核`);
}

/** 首次生成分镜：多 `### 章` 块时按块调用 Agent 并合并为全局 sceneNo；否则整剧一次生成 */
async function generateStoryboardInitial(
  project: Project,
  meta: string,
  scriptBody: string,
): Promise<StoryboardShot[]> {
  const blocks = getScriptBlocksForStoryboard(scriptBody);
  if (blocks.length <= 1) {
    return runStoryboardAgent(`${meta}${scriptBody}`, null);
  }
  log(project, `分镜：检测到 ${blocks.length} 个剧本块（多为章），按块依次生成并合并全局场次号`);
  const all: StoryboardShot[] = [];
  let offset = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    log(project, `分镜：块 ${i + 1}/${blocks.length}「${b.title.slice(0, 40)}」`);
    const chunk = `${meta}### ${b.title}\n${b.body}`;
    const shots = await runStoryboardChapterAgent(chunk, null);
    const locals = shots.map((s) => s.sceneNo ?? 0).filter((n) => n > 0);
    const m = locals.length ? Math.max(...locals) : 0;
    for (const s of shots) {
      if (s.sceneNo != null) s.sceneNo += offset;
    }
    all.push(...shots);
    offset += m;
  }
  const merged = reindexStoryboardIndices(all);
  if (merged.length < MIN_STORYBOARD_SHOTS) {
    log(project, `分镜：分块合计 ${merged.length} 条，低于全剧下限 ${MIN_STORYBOARD_SHOTS}，改为整剧一次生成`);
    return runStoryboardAgent(`${meta}${scriptBody}`, null);
  }
  return merged;
}

type PipelineChapterScope = {
  chapterIndex: number;
  chapterTitle: string;
  chapterBody: string;
  sceneOffset: number;
  globalSceneNos: number[];
};

function resolvePipelineChapterScope(
  script: string,
  chapterIndex: number,
  opts?: { fallbackSourceText?: string; requireSceneNos?: boolean },
): PipelineChapterScope {
  const fromScript = getScriptBlocksForStoryboard(script);
  const fromSource = splitSourceToChapters(opts?.fallbackSourceText ?? "").filter((c) => c.content.trim());
  const blocks =
    fromScript.length > 0
      ? fromScript
      : fromSource.map((c) => ({
          title: c.title?.trim() || "正文",
          body: c.content,
        }));
  if (!blocks.length) throw new Error("当前剧本与原文章节均为空，无法按章节运行");
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= blocks.length) {
    throw new Error(`章节索引无效：${chapterIndex}（有效范围 0~${blocks.length - 1}）`);
  }
  let offset = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const local = extractSceneNosFromMarkdownTable(b.body);
    const maxLocal = local.length ? Math.max(...local) : 0;
    if (i === chapterIndex) {
      if (opts?.requireSceneNos && !local.length) {
        throw new Error(`所选章节「${b.title}」未解析到场次表，无法按章节运行分镜/视频管线`);
      }
      return {
        chapterIndex,
        chapterTitle: b.title,
        chapterBody: b.body,
        sceneOffset: offset,
        globalSceneNos: local.map((n) => n + offset).sort((a, b) => a - b),
      };
    }
    offset += maxLocal;
  }
  throw new Error(`未找到章节：${chapterIndex}`);
}

async function runStoryboardWithGate(
  project: Project,
  opts?: { chapterScope?: PipelineChapterScope },
): Promise<StoryboardShot[]> {
  const chapterScope = opts?.chapterScope;
  const prior = chapterScope
    ? `【章节】第 ${chapterScope.chapterIndex + 1} 章「${chapterScope.chapterTitle}」\n【章节剧本摘要】\n${chapterScope.chapterBody.slice(0, PRIOR_STORYBOARD_SCRIPT)}`
    : `【剧本摘要】\n${project.script.slice(0, PRIOR_STORYBOARD_SCRIPT)}`;
  let directorFeedback: string | null = null;
  let shots: StoryboardShot[] = [];

  for (let attempt = 1; attempt <= MAX_DIRECTOR_ATTEMPTS; attempt++) {
    log(
      project,
      chapterScope
        ? `分镜 Agent 第 ${attempt} 次生成（章节 ${chapterScope.chapterIndex + 1}：${chapterScope.chapterTitle}）`
        : `分镜 Agent 第 ${attempt} 次生成`,
    );
    const meta = formatProjectMeta(project);
    const scriptBody = project.script;
    const scriptFull = `${meta}${scriptBody}`;

    if (attempt === 1) {
      if (chapterScope) {
        const chunk = `${meta}### ${chapterScope.chapterTitle}\n${chapterScope.chapterBody}`;
        shots = await runStoryboardChapterAgent(chunk, null);
        shots = shots.map((s) => ({
          ...s,
          sceneNo: s.sceneNo != null ? s.sceneNo + chapterScope.sceneOffset : s.sceneNo,
        }));
      } else {
        shots = await generateStoryboardInitial(project, meta, scriptBody);
      }
    } else {
      const allGlobal = allGlobalSceneNosForStoryboard(scriptBody, shots);
      let retryScenes = pickStoryboardRetrySceneNos(directorFeedback ?? "", scriptBody, shots);
      if (chapterScope) {
        const chapterSet = new Set(chapterScope.globalSceneNos);
        retryScenes = retryScenes.filter((sn) => chapterSet.has(sn));
      }
      const canPartial = retryScenes.length > 0 && allGlobal.length > 0 && retryScenes.length < allGlobal.length;
      if (canPartial) {
        try {
          log(
            project,
            `分镜：本轮仅重生成全局场次 ${retryScenes.join("、")}（共 ${retryScenes.length}/${allGlobal.length}）`,
          );
          const partial = await runStoryboardAgentPartial(scriptFull, retryScenes, directorFeedback);
          shots = mergeStoryboardByScenes(shots, partial, new Set(retryScenes));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(project, `分镜：部分场次重生成失败，改为${chapterScope ? "章节" : "全剧"}重生成：${msg.slice(0, 200)}`);
          if (chapterScope) {
            const chunk = `${meta}### ${chapterScope.chapterTitle}\n${chapterScope.chapterBody}`;
            shots = await runStoryboardChapterAgent(chunk, directorFeedback);
            shots = shots.map((s) => ({
              ...s,
              sceneNo: s.sceneNo != null ? s.sceneNo + chapterScope.sceneOffset : s.sceneNo,
            }));
          } else {
            shots = await runStoryboardAgent(scriptFull, directorFeedback);
          }
        }
      } else {
        if (chapterScope) {
          const chunk = `${meta}### ${chapterScope.chapterTitle}\n${chapterScope.chapterBody}`;
          shots = await runStoryboardChapterAgent(chunk, directorFeedback);
          shots = shots.map((s) => ({
            ...s,
            sceneNo: s.sceneNo != null ? s.sceneNo + chapterScope.sceneOffset : s.sceneNo,
          }));
        } else {
          shots = await runStoryboardAgent(scriptFull, directorFeedback);
        }
      }
    }

    const output = JSON.stringify(
      shots.map((s) => ({
        index: s.index,
        sceneNo: s.sceneNo ?? null,
        shotNo: s.shotNo,
        shotSize: s.shotSize,
        camera: s.camera,
        content: s.content.slice(0, 240),
        dialogue: s.dialogue.slice(0, 120),
        music: s.music.slice(0, 120),
        sfx: s.sfx.slice(0, 120),
        durationSec: s.durationSec ?? null,
      })),
      null,
      2,
    );

    const verdict = await directorReview({
      step: "storyboard",
      priorContext: prior,
      output,
    });
    emitDirector(project, "storyboard", verdict, attempt);
    await commitProject(project);
    if (verdict.approved) return shots;
    directorFeedback = verdict.feedback;
  }
  throw new Error(`分镜经 ${MAX_DIRECTOR_ATTEMPTS} 轮仍未通过导演审核`);
}

async function runAssetsWithGate(project: Project, opts?: { entriesOnly?: boolean }): Promise<void> {
  const entriesOnly = Boolean(opts?.entriesOnly);
  emitPipelineStage(project, "assets", "start");
  const prior = `【剧本摘要】\n${project.script.slice(0, PRIOR_IMAGE_BATCH_SCRIPT)}`;
  let directorFeedback: string | null = null;

  for (let attempt = 1; attempt <= MAX_DIRECTOR_ATTEMPTS; attempt++) {
    assertNotCancelled(project.id, "assets");
    log(project, `资产 Agent 第 ${attempt} 次生成`);
    let assets: Awaited<ReturnType<typeof runAssetsAgent>>;
    try {
      assets = await runAssetsAgent(`${formatProjectMeta(project)}${project.script}`, directorFeedback);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(project, `资产抽取失败（第 ${attempt} 轮）：${msg.slice(0, 220)}`);
      if (attempt >= MAX_DIRECTOR_ATTEMPTS) throw new Error(`资产抽取失败：${msg}`);
      directorFeedback = `请修复资产抽取失败问题并输出合法 JSON：${msg.slice(0, 200)}`;
      continue;
    }
    const prevAssets = [...project.assets];
    const reused = reuseAssetImagesByIdentity(prevAssets, assets);
    project.assets = reused.merged;
    await commitProject(project, { keepAssets: true });
    if (entriesOnly) {
      if (reused.reusedCount > 0) {
        log(
          project,
          `资产复用：沿用旧图 ${reused.reusedCount} 条；其余 ${reused.regeneratedCount} 条仅保存条目与提示词（本轮不生图）`,
        );
      } else {
        log(project, `资产复用：无可复用旧图；${reused.regeneratedCount} 条条目已写入，本轮不生图`);
      }
      log(project, "资产阶段：已跳过自动资产生图，可在资产页批量生成或逐条生图");
    } else if (reused.reusedCount > 0) {
      log(project, `资产复用：沿用旧图 ${reused.reusedCount} 条；需重生 ${reused.regeneratedCount} 条`);
    } else {
      log(project, `资产复用：无可复用旧图，本轮需重生 ${reused.regeneratedCount} 条`);
    }

    let imageFailCount = 0;
    if (!entriesOnly) {
      for (const a of project.assets) {
        assertNotCancelled(project.id, "assets");
        if (a.imageUrl) continue;
        if (!a.prompt.trim()) continue;
        let imgOk = false;
        let lastMsg = "";
        const fullPrompt = composeAssetImagePrompt(a.prompt, a.type);
        for (let i = 1; i <= SHOT_IMAGE_MAX_ATTEMPTS; i++) {
          try {
            const img = await runImageAgentForShot(fullPrompt, project.storyboardImageSize);
            const { buf, mime, remoteUrl } = await bytesFromGenerateImageResult(img);
            const localUrl = await saveProjectImageFile(project.id, "assets", a.id, buf, mime);
            const easyUrl = await tryEasyImageUrlAfterGenerate(buf, a.id, mime);
            a.imageUrl = localUrl;
            a.remoteImageUrl = easyUrl ?? remoteUrl ?? a.remoteImageUrl;
            try {
              await appendImageJobRecord(project.id, {
                status: "done",
                message: `资产生图完成（管线）：${a.name}（#${a.index}）`,
                prompt: fullPrompt,
                resultUrl: localUrl,
                modelApiCall: img.modelApiCall,
              });
            } catch {
              /* noop */
            }
            imgOk = true;
            break;
          } catch (e) {
            lastMsg = e instanceof Error ? e.message : String(e);
            log(
              project,
              `资产生图失败 #${a.index} ${a.name}（${i}/${SHOT_IMAGE_MAX_ATTEMPTS}）：${lastMsg.slice(0, 180)}`,
            );
          }
        }
        if (!imgOk) {
          imageFailCount += 1;
          // 资产图失败时不阻断整条管线，后续可在资产 Tab 单独重试
          a.note = `${a.note ?? ""}\n[生图失败] ${lastMsg}`.trim();
          try {
            await appendImageJobRecord(project.id, {
              status: "failed",
              message: `资产生图失败（管线）：${a.name}（#${a.index}）：${lastMsg.slice(0, 400)}`,
              prompt: fullPrompt,
            });
          } catch {
            /* noop */
          }
        }
      }
    }
    await commitProject(project, { keepAssets: true });
    if (!entriesOnly && imageFailCount > 0) {
      log(project, `资产阶段完成但有 ${imageFailCount} 条资产生图失败，可在资产页单独重试`);
    }

    const output = JSON.stringify(
      project.assets.map((a) => ({
        index: a.index,
        type: a.type,
        name: a.name,
        hasImage: Boolean(a.imageUrl),
      })),
      null,
      2,
    );
    const verdict = await directorReview({
      step: "assets",
      priorContext: prior,
      output,
    });
    emitDirector(project, "assets", verdict, attempt);
    await commitProject(project, { keepAssets: true });
    if (verdict.approved) {
      emitPipelineStage(project, "assets", "done");
      return;
    }
    directorFeedback = verdict.feedback;
  }
  throw new Error(`资产经 ${MAX_DIRECTOR_ATTEMPTS} 轮仍未通过导演审核`);
}

async function runImageBatchWithGate(
  project: Project,
  shots: StoryboardShot[],
  opts?: { mergeInto?: StoryboardShot[] },
): Promise<StoryboardShot[]> {
  const current = shots.map((s) => ({ ...s }));
  let directorFeedback: string | null = null;

  for (let attempt = 1; attempt <= MAX_DIRECTOR_ATTEMPTS; attempt++) {
    assertNotCancelled(project.id, "storyboard");
    log(project, `生图 Agent 批次 第 ${attempt} 次（共 ${current.length} 镜）`);
    const appCfg = await readConfig();
    const aggregateAssets = appCfg.video?.aggregateAssets !== false;
    for (let i = 0; i < current.length; i++) {
      const s = current[i]!;
      assertNotCancelled(project.id, "storyboard");
      const directorExtra = directorFeedback ? directorFeedback.slice(0, DIRECTOR_FEEDBACK_IN_PROMPT_MAX) : undefined;
      const textPrompt = buildStoryboardImageGenerationPrompt(project, s, {
        directorFeedbackExtra: directorExtra,
        aggregateAssets,
      });

      let lastErr: unknown;
      for (let imgTry = 1; imgTry <= SHOT_IMAGE_MAX_ATTEMPTS; imgTry++) {
        try {
          const t0 = debugLlm ? performance.now() : 0;
          const img = await runImageAgentForStoryboardShot(project, s, project.storyboardImageSize, {
            directorFeedbackExtra: directorExtra,
          });
          if (debugLlm) {
            logger.debug("shot image generation", {
              projectId: project.id,
              shotIndex: s.index,
              shotId: s.id,
              imageTry: `${imgTry}/${SHOT_IMAGE_MAX_ATTEMPTS}`,
              durationMs: Math.round(performance.now() - t0),
            });
          }
          const { buf, mime, remoteUrl } = await bytesFromGenerateImageResult(img);
          const localUrl = await saveProjectImageFile(project.id, "shots", s.id, buf, mime);
          const easyUrl = await tryEasyImageUrlAfterGenerate(buf, s.id, mime);
          current[i] = { ...s, imageUrl: localUrl, remoteImageUrl: easyUrl ?? remoteUrl ?? undefined };
          const mergedCurrent = opts?.mergeInto
            ? opts.mergeInto.map((base) => current.find((x) => x.id === base.id) ?? base)
            : [...current];
          project.storyboards = mergedCurrent;
          await commitProject(project, { keepStoryboards: true });
          try {
            await appendImageJobRecord(project.id, {
              status: "done",
              message: `分镜生图完成（管线）：镜头 #${s.index}`,
              shotIndex: s.index,
              prompt: textPrompt,
              resultUrl: localUrl,
              modelApiCall: img.modelApiCall,
            });
          } catch {
            /* noop */
          }
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          log(
            project,
            `镜头 #${s.index}（${s.id.slice(0, 8)}…）生图第 ${imgTry}/${SHOT_IMAGE_MAX_ATTEMPTS} 次失败：${msg.slice(0, 200)}`,
          );
        }
      }
      if (lastErr !== undefined) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        const failedSnap = getModelApiCallFromError(lastErr);
        try {
          await appendImageJobRecord(project.id, {
            status: "failed",
            message: `分镜生图失败（管线）：镜头 #${s.index}：${msg}`.slice(0, 600),
            shotIndex: s.index,
            prompt: textPrompt,
            modelApiCall: failedSnap,
          });
        } catch {
          /* noop */
        }
        throw new Error(`镜头 #${s.index}（${s.id}）生图在 ${SHOT_IMAGE_MAX_ATTEMPTS} 次尝试后仍失败：${msg}`);
      }
    }

    const output = JSON.stringify(
      current.map((o) => ({
        index: o.index,
        promptPreview: o.prompt.slice(0, 240),
        hasImage: Boolean(o.imageUrl),
        imagePrefix: o.imageUrl?.slice(0, 64) ?? "",
      })),
      null,
      2,
    );

    const verdict = await directorReview({
      step: "image_batch",
      priorContext: project.script.slice(0, PRIOR_IMAGE_BATCH_SCRIPT),
      output,
    });
    emitDirector(project, "image_batch", verdict, attempt);
    await commitProject(project);
    if (verdict.approved) return current;
    directorFeedback = verdict.feedback;
  }
  throw new Error(`生图批次经 ${MAX_DIRECTOR_ATTEMPTS} 轮仍未通过导演审核`);
}

async function runVideoPlanWithGate(
  project: Project,
  shots: StoryboardShot[],
  opts?: { clearExistingJobs?: boolean; allowedShotIndexes?: Set<number> },
): Promise<void> {
  let plan = buildVideoJobPlan(shots);
  const prior = `【剧本摘要】\n${project.script.slice(0, PRIOR_VIDEO_PLAN_SCRIPT)}\n\n【分镜数】${shots.length}`;
  let lastFeedback = "";

  for (let attempt = 1; attempt <= MAX_DIRECTOR_ATTEMPTS; attempt++) {
    if (attempt > 1 && lastFeedback) {
      log(project, "视频 Agent：按导演意见修订入队计划");
      plan = await refineVideoJobPlan(plan, lastFeedback);
      project.storyboards = project.storyboards.map((s) => {
        const p = plan.find((x) => x.shotIndex === s.index);
        return p ? { ...s, prompt: p.prompt } : s;
      });
      await commitProject(project, { keepStoryboards: true });
      const nextShots = opts?.allowedShotIndexes
        ? project.storyboards.filter((s) => opts.allowedShotIndexes!.has(s.index))
        : project.storyboards;
      plan = buildVideoJobPlan(nextShots);
    }

    const output = serializeVideoPlanForDirector(plan);
    const verdict = await directorReview({
      step: "video_plan",
      priorContext: prior,
      output,
    });
    emitDirector(project, "video_plan", verdict, attempt);
    await commitProject(project);

    if (verdict.approved) {
      if (opts?.clearExistingJobs !== false) {
        project.videoJobs = [];
        await commitProject(project, { keepVideoJobs: true });
      }
      const planIdx = new Set(plan.map((x) => x.shotIndex));
      const blockers = project.storyboards
        .filter((s) => planIdx.has(s.index))
        .map((s) => shotKeyframeBlockingVideoReason(s))
        .filter(Boolean) as string[];
      if (blockers.length) {
        throw new Error(`分镜关键帧对视频服务不可达，已中止入队：\n${[...new Set(blockers)].join("\n")}`);
      }
      for (const item of plan) {
        await enqueueJob(project.id, {
          message: `镜头 #${item.shotIndex} 视频（queued：待本机 Runner）`,
          shotIndex: item.shotIndex,
          prompt: item.prompt,
          imageUrl: item.imageUrl,
        });
      }
      return;
    }
    lastFeedback = verdict.feedback;
  }
  throw new Error(`视频入队计划经 ${MAX_DIRECTOR_ATTEMPTS} 轮仍未通过导演审核`);
}

export type PipelineRunRange = {
  from: PipelineStage;
  to: PipelineStage;
  /** 仅运行指定章节（0-based，按剧本 `###` 章节顺序） */
  chapterIndex?: number;
  /** @deprecated 请使用 assetsGenerateImages:false */
  assetsEntriesOnly?: boolean;
  /** 资产阶段是否在管线内自动生图，默认 true；assetsEntriesOnly:true 时强制不生图（兼容旧客户端） */
  assetsGenerateImages?: boolean;
  /** 分镜阶段是否在管线内逐镜生图，默认 true；为 false 时仅保留分镜 JSON/prompt，图在分镜页再生成 */
  storyboardGenerateImages?: boolean;
};

/** 解析资产阶段是否执行生图，兼容旧客户端字段。 */
function resolveAssetsGenImages(range?: PipelineRunRange): boolean {
  if (range?.assetsEntriesOnly === true) return false;
  if (range?.assetsGenerateImages === false) return false;
  return true;
}

/** 解析分镜阶段是否执行批量生图。 */
function resolveStoryboardGenImages(range?: PipelineRunRange): boolean {
  return range?.storyboardGenerateImages !== false;
}

/**
 * 管线主入口：按区间执行 script/assets/storyboard/video，并通过 SSE 持续回传阶段与日志。
 * @param range 省略或等价于 script→video 时跑全链路；否则只执行区间内阶段（含起止）。
 */
export async function runPipeline(projectId: string, range?: PipelineRunRange) {
  if (runningPipelines.has(projectId)) {
    sseSend(projectId, { type: "error", message: "管线已在运行中" });
    return;
  }
  runningPipelines.add(projectId);
  // 本次启动前清除历史取消标记
  cancelRequested.delete(projectId);

  const from = range?.from ?? "script";
  const to = range?.to ?? "video";
  const chapterIndex = typeof range?.chapterIndex === "number" ? range.chapterIndex : undefined;

  try {
    assertPipelineRangeOrder(from, to);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sseSend(projectId, { type: "error", message });
    runningPipelines.delete(projectId);
    return;
  }

  try {
    const project = await store.get(projectId);
    if (!project) {
      sseSend(projectId, { type: "error", message: "项目不存在" });
      return;
    }
    if (project.pipelineStatus === "running") {
      sseSend(projectId, { type: "error", message: "管线已在运行中" });
      return;
    }

    try {
      assertUpstreamInputs(project, from);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sseSend(projectId, { type: "error", message });
      return;
    }

    project.pipelineStatus = "running";
    project.pipelineError = undefined;
    project.pipelineLog = [];
    sseClearRecent(project.id);
    await commitProject(project);

    /** 失败时 SSE 上报对应 stage（与 docs 对齐，避免一律写 video） */
    let errorStage: PipelineStage = from;

    const runScript = pipelineRangeCovers(from, to, "script");
    let runAssets = pipelineRangeCovers(from, to, "assets");
    const runStoryboardBlock = pipelineRangeCovers(from, to, "storyboard");
    const runVideo = pipelineRangeCovers(from, to, "video");
    const fullChain = from === "script" && to === "video";
    const assetsGenImages = resolveAssetsGenImages(range);
    const storyboardGenImages = resolveStoryboardGenImages(range);
    const assetsEntriesOnly = !assetsGenImages;
    let chapterScope: PipelineChapterScope | undefined;

    try {
      log(project, fullChain ? "开始运行全链路管线" : `开始运行局部管线：${formatPipelineRangeLog(from, to)}`);
      if (chapterIndex != null) {
        chapterScope = resolvePipelineChapterScope(project.script, chapterIndex, {
          fallbackSourceText: project.sourceText,
          requireSceneNos: runStoryboardBlock || runVideo,
        });
      }
      if (chapterScope) {
        if (runAssets) {
          log(project, "章节模式：资产阶段不按章运行，已自动跳过 assets");
          runAssets = false;
        }
        if (!runScript && !runStoryboardBlock && !runVideo) {
          throw new Error("章节模式区间必须包含「剧本 / 分镜 / 视频」中的至少一个阶段");
        }
        log(
          project,
          `章节模式：第 ${chapterScope.chapterIndex + 1} 章「${chapterScope.chapterTitle}」，场次 ${chapterScope.globalSceneNos.join("、")}`,
        );
      }
      const cfg = await readConfig();
      await preflightModelConfigForRange(project, from, to, {
        assetImages: assetsGenImages,
        storyboardImages: storyboardGenImages,
      });
      const allowPartial = Boolean(cfg.ui?.pipelineAllowPartial);

      if (runScript) {
        errorStage = "script";
        await runScriptWithGate(project, chapterScope ? { chapterIndex: chapterScope.chapterIndex } : undefined);
      }
      if (runAssets && runStoryboardBlock) {
        const scriptSnapshot = project.script;
        const metaSnapshot = formatProjectMeta(project);
        const assetsScriptSnapshot = `${metaSnapshot}${scriptSnapshot}`;
        const storyboardScriptSnapshot = `${metaSnapshot}${scriptSnapshot}`;
        const tParallel0 = performance.now();
        log(
          project,
          `并行阶段开始：资产${assetsGenImages ? "+生图" : "（仅条目）"} 与 分镜${storyboardGenImages ? "+生图" : "（仅条目）"}`,
        );
        const results = await Promise.allSettled([
          (async () => {
            const t0 = performance.now();
            try {
              await runAsStage("assets", async () => {
                // 资产 Agent 只依赖剧本输入快照，避免并行中用户编辑剧本导致两条线不一致
                const p = { ...project, script: assetsScriptSnapshot, pipelineLog: project.pipelineLog } as Project;
                await runAssetsWithGate(p, { entriesOnly: assetsEntriesOnly });
              });
              log(project, `并行阶段：资产线完成（耗时 ${Math.round(performance.now() - t0)}ms）`);
              return { ok: true as const };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log(
                project,
                `并行阶段：资产线失败（耗时 ${Math.round(performance.now() - t0)}ms）：${msg.slice(0, 220)}`,
              );
              throw e;
            }
          })(),
          (async () => {
            const t0 = performance.now();
            emitPipelineStage(project, "storyboard", "start");
            try {
              await runAsStage("storyboard", async () => {
                const p = { ...project, script: storyboardScriptSnapshot, pipelineLog: project.pipelineLog } as Project;
                const shots = await runStoryboardWithGate(p);
                await saveMergedProject(project.id, (p) => {
                  p.storyboards = shots;
                });

                if (storyboardGenImages) {
                  log(project, "分镜已通过导演审核，进入生图");
                  const withImages = await runImageBatchWithGate(project, shots);
                  await saveMergedProject(project.id, (p) => {
                    p.storyboards = withImages;
                  });
                } else {
                  log(project, "分镜阶段已跳过管线内生图，仅保留分镜条目与 prompt，可在分镜页再逐镜生图");
                }
                emitPipelineStage(project, "storyboard", "done");
              });
              log(project, `并行阶段：分镜线完成（耗时 ${Math.round(performance.now() - t0)}ms）`);
              return { ok: true as const };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log(
                project,
                `并行阶段：分镜线失败（耗时 ${Math.round(performance.now() - t0)}ms）：${msg.slice(0, 220)}`,
              );
              throw e;
            }
          })(),
        ]);
        const okCount = results.filter((r) => r.status === "fulfilled").length;
        const fail = results.find((r) => r.status === "rejected");
        log(project, `并行阶段结束：成功 ${okCount}/2（总耗时 ${Math.round(performance.now() - tParallel0)}ms）`);
        if (fail && fail.status === "rejected") {
          const r0 = results[0]!;
          const r1 = results[1]!;
          if (allowPartial) {
            if (r0.status === "rejected") {
              const m = r0.reason instanceof Error ? r0.reason.message : String(r0.reason);
              emitPipelineStage(project, "assets", "error", m);
            }
            if (r1.status === "rejected") {
              const m = r1.reason instanceof Error ? r1.reason.message : String(r1.reason);
              emitPipelineStage(project, "storyboard", "error", m);
            }
          }
          if (!allowPartial) throw fail.reason;
          const msg = fail.reason instanceof Error ? fail.reason.message : String(fail.reason);
          log(project, `并行阶段进入“部分成功”模式：已忽略失败并继续后续阶段（失败原因：${msg.slice(0, 220)}）`);
          // 如果分镜线失败且后续需要 video，则无法继续
          if (runVideo) {
            const hasStoryboards = (await store.get(project.id))?.storyboards?.length ?? 0;
            if (!hasStoryboards) {
              throw new PipelineStageError("storyboard", `分镜生成失败且无法部分成功进入视频阶段：${msg}`);
            }
          }
        }
        // 并行段结束后，刷新内存 project（后续 video 需用最新分镜）
        const refreshed = await store.get(project.id);
        if (refreshed) {
          project.assets = refreshed.assets;
          project.storyboards = refreshed.storyboards;
        }
      } else {
        if (runAssets) {
          errorStage = "assets";
          await runAssetsWithGate(project, { entriesOnly: assetsEntriesOnly });
        }
        if (runStoryboardBlock) {
          errorStage = "storyboard";
          emitPipelineStage(project, "storyboard", "start");
          const shots = await runStoryboardWithGate(project, chapterScope ? { chapterScope } : undefined);
          if (chapterScope) {
            const replaced = new Set(chapterScope.globalSceneNos);
            const base = project.storyboards.length ? project.storyboards : shots;
            project.storyboards = mergeStoryboardByScenes(base, shots, replaced);
          } else {
            project.storyboards = shots;
          }
          await commitProject(project, { keepStoryboards: true });

          if (storyboardGenImages) {
            log(project, "分镜已通过导演审核，进入生图");
            if (chapterScope) {
              const scope = chapterScope;
              const picked = project.storyboards.filter(
                (s) => typeof s.sceneNo === "number" && scope.globalSceneNos.includes(s.sceneNo),
              );
              await runImageBatchWithGate(project, picked, { mergeInto: project.storyboards });
              await commitProject(project, { keepStoryboards: true });
            } else {
              project.storyboards = await runImageBatchWithGate(project, project.storyboards);
              await commitProject(project, { keepStoryboards: true });
            }
          } else {
            log(project, "分镜阶段已跳过管线内生图，仅保留分镜条目与 prompt，可在分镜页再逐镜生图");
          }
          emitPipelineStage(project, "storyboard", "done");
        }
      }
      if (runVideo) {
        errorStage = "video";
        emitPipelineStage(project, "video", "start");
        log(project, "视频阶段：导演审核入队计划");
        if (chapterScope) {
          const scope = chapterScope;
          const picked = project.storyboards.filter(
            (s) => typeof s.sceneNo === "number" && scope.globalSceneNos.includes(s.sceneNo),
          );
          if (!picked.length) throw new Error("章节模式下未找到可入队的视频分镜，请先运行该章节分镜阶段");
          await runVideoPlanWithGate(project, picked, {
            clearExistingJobs: false,
            allowedShotIndexes: new Set(picked.map((s) => s.index)),
          });
        } else {
          await runVideoPlanWithGate(project, project.storyboards);
        }
        emitPipelineStage(project, "video", "done");
      }

      project.pipelineStatus = "done";
      await commitProject(project);

      if (runVideo) {
        log(
          project,
          fullChain
            ? "管线主流程完成，已自动启动视频生成 runner"
            : "局部管线完成（含视频入队），已自动启动视频生成 runner",
        );
        sseSend(project.id, { type: "complete" });
        void runJobQueue(project.id, { delayMs: 500 });
      } else {
        log(
          project,
          `局部管线完成：${formatPipelineRangeLog(from, to)}（未执行视频入队，可稍后单独运行视频阶段或全链路）`,
        );
        sseSend(project.id, { type: "complete" });
      }
    } catch (e) {
      const message = formatErrorMessage(e);
      if (e instanceof PipelineStageError) errorStage = e.stage;
      project.pipelineStatus = "error";
      project.pipelineError = message;
      logger.warn("pipeline failed", { projectId, scope: "pipeline", stage: errorStage, error: message });
      log(project, `管线失败［${errorStage}］：${message}`);
      await commitProject(project);
      emitPipelineStage(project, errorStage, "error", message);
      sseSend(projectId, { type: "error", message });
    }
  } finally {
    runningPipelines.delete(projectId);
    cancelRequested.delete(projectId);
  }
}
