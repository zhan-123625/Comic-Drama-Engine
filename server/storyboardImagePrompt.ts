import type { AssetItem, Project, StoryboardShot } from "./types.js";
import { IMAGE_PROMPT_MAX } from "./pipelineConstants.js";
import { normalizeHtmlishToPlainText } from "./textNormalize.js";
import {
  parseStoryboardContentLayers,
  plainContentLooksSequential,
  resolveStoryboardImageVisualBody,
  type StoryboardImageVisualTarget,
} from "./storyboardContentVisual.js";
import { orderedAssetsForStoryboardVisual, sceneAssetsForStoryboardSceneNo, scoreAsset } from "./videoContext.js";
import { stripAssetImageRequirement } from "./assetImagePrompt.js";

function clean(s: string): string {
  return String(s ?? "").trim();
}

/** 画面正文里常见「连续叙事」触发词：命中多时提示模型只取首瞬间（不截断用户原文）。 */
const SEQUENTIAL_NARRATIVE_MARKERS =
  /然后|接着|随后|继而|忽然|突然|最后|终于|先是|随即|不一会儿|片刻之后|紧接着|下一秒|此时|与此同时|渐渐|越来越/g;

export type { StoryboardImageVisualTarget };

export function visualSuggestsDynamicSequence(visual: string): boolean {
  const v = String(visual ?? "").trim();
  if (v.length < 24) return false;
  const hits = v.match(SEQUENTIAL_NARRATIVE_MARKERS);
  return (hits?.length ?? 0) >= 2 || ((hits?.length ?? 0) >= 1 && v.length > 160);
}

/** 将「画面正文」与景别/摄法/时长拼成生图用的纯视觉块（无画风、无资产块）。 */
export function formatShotVisualLines(shot: StoryboardShot, visualBody: string): string {
  const content = normalizeHtmlishToPlainText(visualBody);
  const size = normalizeHtmlishToPlainText(clean(shot.shotSize));
  const camera = normalizeHtmlishToPlainText(clean(shot.camera));
  const duration = shot.durationSec != null && Number.isFinite(shot.durationSec) ? `${shot.durationSec}s` : "";
  const shotNo = normalizeHtmlishToPlainText(clean(shot.shotNo) || String(shot.index));

  const lines: string[] = [];
  if (content) lines.push(`镜头 ${shotNo}：${content}`);
  const metaBits = [
    size ? `景别：${size}` : "",
    camera ? `摄法：${camera}` : "",
    duration ? `参考时长：${duration}（仅节奏参考，勿在画面写数字）` : "",
  ].filter(Boolean);
  if (metaBits.length) lines.push(metaBits.join("；"));
  return lines.join("\n").trim();
}

/**
 * 分镜「生图」专用：只保留画面可画信息，不包含台词/旁白/音乐/音效（避免被画进图里）。
 * 正文按本镜 videoRunMode 与分段约定从 content 中取首帧（或尾帧）可画描述。
 */
export function composeStoryboardPromptVisualOnly(
  shot: StoryboardShot,
  opts?: { targetFrame?: StoryboardImageVisualTarget },
): string {
  const target = opts?.targetFrame ?? "first";
  const body = resolveStoryboardImageVisualBody(shot, { targetFrame: target });
  return formatShotVisualLines(shot, body);
}

/**
 * 生图「本镜画面」正文：优先一次性覆盖，其次用户自定义 imagePrompt（仅首帧图），否则从 content 按模式抽取。
 */
export function resolveStoryboardImageVisualBase(
  shot: StoryboardShot,
  promptOverride?: string,
  frameOpts?: { targetFrame?: StoryboardImageVisualTarget },
): string {
  const o = promptOverride?.trim() ?? "";
  if (o) return normalizeHtmlishToPlainText(o);
  const target = frameOpts?.targetFrame ?? "first";
  if (target === "first") {
    const ip = shot.imagePrompt?.trim() ?? "";
    if (ip) return normalizeHtmlishToPlainText(ip);
  }
  const body = resolveStoryboardImageVisualBody(shot, { targetFrame: target });
  return formatShotVisualLines(shot, body);
}

export function shotHasDrawableImageContent(shot: StoryboardShot, promptOverride?: string): boolean {
  const body = resolveStoryboardImageVisualBody(shot, { promptOverride, targetFrame: "first" });
  return body.trim().length > 0;
}

function short(s: string, n: number): string {
  const v = normalizeHtmlishToPlainText(String(s ?? "").trim());
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

function assetTypeLabel(t: AssetItem["type"]): string {
  if (t === "character") return "角色";
  if (t === "scene") return "场景";
  if (t === "prop") return "物品";
  if (t === "costume") return "服装造型";
  if (t === "action_pose") return "动作姿态";
  return "特效";
}

function buildAssetConsistencyBlock(project: Project, shot: StoryboardShot, aggregateAssets: boolean): string {
  if (!aggregateAssets) return "";
  const ordered = orderedAssetsForStoryboardVisual(project, shot);
  if (!ordered.length) return "";

  // 单镜聚焦：
  // 1. 场景：取本镜绑定的空间场景（最多 1 个）
  const scenes = ordered.filter((a) => a.type === "scene").slice(0, 1);
  // 2. 角色：严禁空盲注入！必须在当前镜头正文/台词/提示词中明确提及（score > 0），最多 2 位出镜角色
  const chars = ordered.filter((a) => a.type === "character" && scoreAsset(shot, a) > 0).slice(0, 2);
  // 3. 道具/其它：也必须是当前镜头明确提及的实体，最多 1 个
  const others = ordered
    .filter((a) => a.type !== "scene" && a.type !== "character" && scoreAsset(shot, a) > 0)
    .slice(0, 1);
  const focused = [...scenes, ...chars, ...others];
  if (!focused.length) return "";

  const lines = focused.map(
    (a) => `- [${assetTypeLabel(a.type)}]「${short(a.name, 32)}」：${short(stripAssetImageRequirement(a.prompt), 180)}`,
  );
  return `【本镜核心设定要素】\n${lines.join("\n")}`;
}

/**
 * 组装调用图像模型的完整 prompt：画风约束 + 纯画面描述 + 资产锚点 + 禁字约束。
 */
export function buildStoryboardImageGenerationPrompt(
  project: Project,
  shot: StoryboardShot,
  opts?: {
    directorFeedbackExtra?: string;
    /** 与视频侧「聚合资产」一致；false 时不注入资产块 */
    aggregateAssets?: boolean;
    /** 弹窗未保存时覆盖本镜画面基底（优先级高于 shot.imagePrompt） */
    imagePromptOverride?: string;
    /** 默认首帧关键图；尾帧可单独生图时使用 */
    imageTargetFrame?: StoryboardImageVisualTarget;
  },
): string {
  const aggregateAssets = opts?.aggregateAssets !== false;
  const imageTargetFrame = opts?.imageTargetFrame ?? "first";
  const meta: string[] = [];
  if (project.artStyle?.trim()) {
    meta.push(
      `【项目统一画风】${project.artStyle.trim()}。所有镜头必须统一在该视觉体系内，禁止同片混入冲突的渲染维度（例如未要求时不要混用写实 3D 与扁平二维插画）。`,
    );
  }
  if (project.genreType?.trim()) {
    meta.push(`【题材气质】${project.genreType.trim()}。`);
  }
  if (project.videoAspect?.trim()) {
    meta.push(`【构图/比例倾向】${project.videoAspect.trim()}。`);
  }

  const fullContentRaw = clean(shot.content) || clean(shot.prompt);
  const fullContentNorm = normalizeHtmlishToPlainText(fullContentRaw);
  const layers = parseStoryboardContentLayers(fullContentNorm);

  const visual = resolveStoryboardImageVisualBase(shot, opts?.imagePromptOverride, {
    targetFrame: imageTargetFrame,
  });

  const sn = shot.sceneNo;
  const sceneUnifyHint =
    sn != null && Number.isInteger(sn) && sn >= 1 && sceneAssetsForStoryboardSceneNo(project, sn).length > 0
      ? `【本场次空间统一】当前分镜属剧本第 ${sn} 场：空间、陈设与光影须与参考图中**靠前的场景资产图**一致，同场各镜勿擅自更换为无关场地。`
      : "";

  const assetBlock = buildAssetConsistencyBlock(project, shot, aggregateAssets);

  const mode = shot.videoRunMode;
  let keyframeRole: string;
  if (imageTargetFrame === "last") {
    keyframeRole =
      "【本次生图·尾帧】只生成**镜头结束瞬间**的单一静态画面（可作首尾帧视频的尾图参考）。禁止对白字幕、水印与可读文字；不要分格/多时间点拼贴。";
  } else if (mode === "first_last") {
    keyframeRole =
      "【本次生图·首帧】本镜为**首尾帧视频**模式：当前图只表现**起始关键帧**。正文已从「**首帧**」段提取；若无分段则从动态叙述中截取**时间上最早**的可画瞬间。尾帧由另一张图或「**尾帧**」段描述承担，勿在同一张内同时画清首末两态。";
  } else if (mode === "first_frame") {
    keyframeRole =
      "【本次生图·首帧】本镜为**首帧视频**模式：只画该镜**第一帧**静止画面。正文已从「**首帧**」段或动态描述的首瞬间抽取；勿把整段运动过程叠进一图。";
  } else {
    keyframeRole =
      "【分镜参考图】分镜正文可含动态与神态供视频理解；**生图只取本镜关键静止帧**（默认起始瞬间）。禁止多时间点拼贴、分格漫画式故事板。";
  }

  const dynamicHint =
    imageTargetFrame === "first" &&
    !layers.firstFrame &&
    fullContentNorm &&
    plainContentLooksSequential(fullContentNorm)
      ? "【动态正文提示】分镜正文未分段且含较强时间推进措辞，已尽量截取**最早瞬间**作为「本镜画面」。请只画**一帧**静止影像。"
      : "";

  const hard =
    "【画面约束】禁止出现任何可读文字、对白字幕、旁白条、片名、水印、Logo、二维码、时间码；不要绘制分镜表或说明性排版。只生成**一帧**影视画面（场景、人物、姿态、光影、道具），以影像呈现**这一瞬间**的氛围，不要画出台词内容；不要把多条分镜内容叠进一张图。";

  // 核心优化：高权重区（画面主体、核心资产设定）前置，风格与规则后置
  const parts = [
    visual ? `【画面主体与瞬间】\n${visual}` : "",
    assetBlock,
    meta.length ? meta.join("\n") : "",
    sceneUnifyHint,
    keyframeRole,
    dynamicHint,
    hard,
    opts?.directorFeedbackExtra?.trim() ? `【导演修订】${opts.directorFeedbackExtra.trim()}` : "",
  ].filter(Boolean);

  return parts.join("\n\n").trim().slice(0, IMAGE_PROMPT_MAX);
}
