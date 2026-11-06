import type { AssetItem, Project, StoryboardShot } from "./types.js";
import { IMAGE_PROMPT_MAX } from "./pipelineConstants.js";
import { normalizeHtmlishToPlainText } from "./textNormalize.js";
import {
  extractFirstKeyframeHeuristicFromPlain,
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

/**
 * 智能扩写/丰富分镜画面描述（增加光影、景深、微表情与电影级质感）
 */
export function enrichStoryboardImageVisualBase(shot: StoryboardShot, baseVisual?: string): string {
  let raw = normalizeHtmlishToPlainText(baseVisual || shot.content || shot.prompt || "").trim();
  raw = raw.replace(/^镜头\s*\S+[：:]\s*/, "");
  const layers = parseStoryboardContentLayers(raw);
  let visualCore = layers.firstFrame || extractFirstKeyframeHeuristicFromPlain(raw) || raw;
  visualCore = visualCore.replace(/^镜头\s*\S+[：:]\s*/, "").replace(/[。！？\s]+$/u, "");
  const shotNo = normalizeHtmlishToPlainText(shot.shotNo || String(shot.index || 1)).trim();
  const size = normalizeHtmlishToPlainText(shot.shotSize || "").trim();
  const cam = normalizeHtmlishToPlainText(shot.camera || "").trim();

  const detailBits: string[] = [];
  if (size === "特写" || size === "近景") {
    detailBits.push("面部微表情传神细腻，眼眸清澈带有灵动高光，神态生动，睫毛与毛发根根分明，耳尖泛着柔和透光感");
  } else if (size === "全景" || size === "远景") {
    detailBits.push("主体与空间环境比例自然协调，空气透视与纵深层次丰富，展现出浓郁的空间氛围");
  } else {
    detailBits.push("主体姿态生动自然，肢体语言饱满，与随身物件自然交互，地面接触阴影真实细腻");
  }

  detailBits.push("温暖柔和的自然光照斜洒，斑驳丁达尔微光点缀，浅景深电影柔焦虚化，8k壁纸级细腻画质");

  const lines: string[] = [];
  lines.push(`镜头 ${shotNo}：${visualCore}。${detailBits.join("，")}。`);
  const metaBits = [size && !visualCore.includes(`景别：${size}`) ? `景别：${size}` : "", cam && !visualCore.includes(`摄法：${cam}`) ? `摄法：${cam}` : ""].filter(Boolean);
  if (metaBits.length) lines.push(metaBits.join("；"));
  return lines.join("\n").trim();
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
  const shotNo = normalizeHtmlishToPlainText(clean(shot.shotNo) || String(shot.index));

  const lines: string[] = [];
  if (content) {
    if (/^镜头\s*\S+[：:]/.test(content)) {
      lines.push(content);
    } else {
      lines.push(`镜头 ${shotNo}：${content}`);
    }
  }
  const metaBits = [
    size && !content.includes(`景别：${size}`) ? `景别：${size}` : "",
    camera && !content.includes(`摄法：${camera}`) ? `摄法：${camera}` : "",
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
  frameOpts?: { targetFrame?: StoryboardImageVisualTarget; ignoreImagePrompt?: boolean },
): string {
  const o = promptOverride?.trim() ?? "";
  if (o) return formatShotVisualLines(shot, normalizeHtmlishToPlainText(o));
  const target = frameOpts?.targetFrame ?? "first";
  if (target === "first" && !frameOpts?.ignoreImagePrompt) {
    const ip = shot.imagePrompt?.trim() ?? "";
    if (ip) return formatShotVisualLines(shot, normalizeHtmlishToPlainText(ip));
  }
  const body = resolveStoryboardImageVisualBody(shot, {
    targetFrame: target,
    ignoreImagePrompt: frameOpts?.ignoreImagePrompt,
  });
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

/**
 * 清理资产库 prompt 中的「资产生图元要求」（如三视图、纯色背景、单品抠图白底等说明），
 * 仅保留该实体的纯视觉外貌特征，防止分镜生图模型误画成三视图设定表或白底单品拼贴图。
 */
export function cleanAssetPromptForStoryboard(prompt: string): string {
  let t = normalizeHtmlishToPlainText(stripAssetImageRequirement(prompt)).trim();
  t = t.replace(/【资产生图要求】[\s\S]*$/g, "");
  t = t.replace(
    /^(?:角色设定参考图|场景环境参考图|单品道具参考图|服装造型参考图|动作姿态参考图|特效元素参考图)[^。\n\r]*[。\n\r]?/g,
    "",
  );
  t = t.replace(/(?:同一画面中呈现[^\n\r。；;]*三视图[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:(?:或\s*)?turnaround\s*设定表[^\n\r。；;]*[。；\n\r]?)/gi, "");
  t = t.replace(/(?:中性站立、全身可见[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:背景为简洁纯色[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:无具体剧情场景[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:光线均匀柔和[，,、\s]*便于作为角色参考[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:背景须为纯透明或纯白\/纯灰无环境[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:便于抠图与合成[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:除必要接触阴影外不要[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:只表现该物品本身[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:适合作为参考图叠加到其他画面[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:避免画面角落出现与场景无关[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:可作为分镜\/视频的背景与空间依据[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:避免复杂环境抢镜[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:突出动态本身[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/(?:便于后期叠加合成[^\n\r。；;]*[。；\n\r]?)/g, "");
  t = t.replace(/^(?:角色|物品|道具|场景|服装|造型|动作|特效)\s*(?:为|是|：|:)?\s*/g, "");
  return t.trim().replace(/^[，,；;。、\s]+/, "");
}

function buildAssetConsistencyBlock(project: Project, shot: StoryboardShot, aggregateAssets: boolean): string {
  if (!aggregateAssets) return "";
  const ordered = orderedAssetsForStoryboardVisual(project, shot);
  if (!ordered.length) return "";

  const extraIds = new Set((shot.videoExtraAssetIds ?? []).map((x) => String(x).toLowerCase()));

  // 1. 手动附加的资产：优先级最高，全部保留（最多 6 个）
  const manual = ordered.filter((a) => extraIds.has(a.id.toLowerCase())).slice(0, 6);
  const manualIds = new Set(manual.map((a) => a.id.toLowerCase()));
  const hasManualScene = manual.some((a) => a.type === "scene");

  // 2. 自动补充的场景（若已有手动场景则不再额外补场景，避免重复，最多 1 个）
  const autoScenes = hasManualScene
    ? []
    : ordered
        .filter((a) => !manualIds.has(a.id.toLowerCase()) && a.type === "scene")
        .slice(0, 1);

  // 3. 自动匹配的出镜角色（score > 0，最多 2 位）
  const autoChars = ordered
    .filter((a) => !manualIds.has(a.id.toLowerCase()) && a.type === "character" && scoreAsset(shot, a) > 0)
    .slice(0, 2);

  // 4. 自动匹配的道具/服装等（score > 0，最多 1 个）
  const autoOthers = ordered
    .filter(
      (a) =>
        !manualIds.has(a.id.toLowerCase()) &&
        a.type !== "scene" &&
        a.type !== "character" &&
        scoreAsset(shot, a) > 0,
    )
    .slice(0, 1);

  const focused = [...manual, ...autoScenes, ...autoChars, ...autoOthers];
  if (!focused.length) return "";

  const lines = focused.map((a) => {
    const hasImg = Boolean(a.imageUrl?.trim() || a.remoteImageUrl?.trim());
    const cleaned = cleanAssetPromptForStoryboard(a.prompt);
    const textDesc = hasImg
      ? `（视觉严格以所附参考图为准）${short(cleaned, 140)}`
      : short(cleaned, 180);
    return `- [${assetTypeLabel(a.type)}]「${short(a.name, 32)}」：${textDesc}`;
  });
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
    "【画面约束】禁止出现任何可读文字、对白字幕、旁白条、片名、水印、Logo、二维码、时间码；严禁绘制三视图、人物设定表、单品白底陈列、分镜表格或分格拼贴。必须只生成**一帧**真实的影视剧情画面（具体的自然环境/场景、人物、姿态、光影），以影像呈现**这一瞬间**的戏剧氛围，不要把多张图或三视图拼进一张图。";

  // 若用户在分镜表兼容 prompt 字段填写了独立提示词（非自动填充的 content 且未已作为画面主体），予以合并注入
  const extraUserPrompt = clean(shot.prompt);
  const hasDistinctExtraPrompt = Boolean(
    extraUserPrompt &&
      extraUserPrompt !== clean(shot.content) &&
      !visual.includes(extraUserPrompt),
  );
  const extraPromptBlock = hasDistinctExtraPrompt
    ? `【分镜补充提示词】\n${normalizeHtmlishToPlainText(extraUserPrompt)}`
    : "";

  const lightingBlock =
    "【环境光影与空间氛围】电影级自然采光，细腻通透的明暗光影层次，柔和丁达尔微光穿透空间，斑驳明暗光斑与浅景深柔美虚化，前景与背景层次分明，焦点锐利精准锁定画面核心主体。";
  const textureBlock =
    "【画面质感与艺术构图】8K分辨率壁纸级超清精美细节，大师级电影构图，高动态范围光照 HDR，细腻微距材质肌理（毛发蓬松分明、眼神清澈含光），通透自然的电影级色彩分级。";

  const hasReferencedImages = orderedAssetsForStoryboardVisual(project, shot).some(
    (a) => a.imageUrl?.trim() || a.remoteImageUrl?.trim(),
  );
  const visualAnchorBlock = hasReferencedImages
    ? "【参考图视觉锚定（最高准则）】画面中出镜主体（角色/道具）必须严格依照所提供的视觉参考图绘制！完全继承参考图中主体的生物形态、头部五官、体色毛发、关键配饰与造型，严禁擅自改变物种或形象！若文字描述与参考图存在偏差，必须绝对以参考图视觉为最高准则。"
    : "";

  // 核心优化：高权重区（参考图视觉锚定、画面主体、分镜补充提示词、核心资产设定）前置，风格与规则后置
  const parts = [
    visualAnchorBlock,
    visual ? `【画面主体与瞬间】\n${visual}` : "",
    extraPromptBlock,
    assetBlock,
    meta.length ? meta.join("\n") : "",
    lightingBlock,
    textureBlock,
    sceneUnifyHint,
    keyframeRole,
    dynamicHint,
    hard,
    opts?.directorFeedbackExtra?.trim() ? `【导演修订】${opts.directorFeedbackExtra.trim()}` : "",
  ].filter(Boolean);

  return parts.join("\n\n").trim().slice(0, IMAGE_PROMPT_MAX);
}
