import { normalizeHtmlishToPlainText } from "./textNormalize.js";
import type { StoryboardShot } from "./types.js";

/** 与 storyboardImagePrompt 中动态检测类似，用于无分段时的「首瞬间」截断 */
const SEQUENTIAL_MARKERS =
  /然后|接着|随后|继而|忽然|突然|最后|终于|先是|随即|不一会儿|片刻之后|紧接着|下一秒|此时|与此同时|渐渐|越来越/g;

function clean(s: string): string {
  return String(s ?? "").trim();
}

const NEXT_LAYER_START =
  /(?:\*\*|【)?(?:首帧|镜内动态与神态|镜内动态|镜头动态与神态|镜头动态|尾帧)(?:\*\*|】)?\s*[：:]/g;

function extractLayerBody(full: string, headerRe: RegExp): string {
  const m = headerRe.exec(full);
  if (!m) return "";
  const tail = full.slice(m.index + m[0].length);
  NEXT_LAYER_START.lastIndex = 0;
  const n = NEXT_LAYER_START.exec(tail);
  const end = n && n.index > 0 ? n.index : tail.length;
  return tail.slice(0, end).trim();
}

/**
 * 从分镜 content 中解析 Agent 约定的分段（**首帧** / **镜内动态与神态** / **尾帧** 等）。
 * 支持包含 Markdown 粗体 **、全角括号【】或纯文本形式的标签。
 * 无分段时各字段为空字符串。
 */
export function parseStoryboardContentLayers(raw: string): {
  firstFrame: string;
  dynamicAndExpression: string;
  lastFrame: string;
} {
  const full = normalizeHtmlishToPlainText(raw);
  if (!full.trim()) return { firstFrame: "", dynamicAndExpression: "", lastFrame: "" };

  const firstFrame = extractLayerBody(full, /(?:\*\*|【)?首帧(?:\*\*|】)?\s*[：:]/);
  const dynamicAndExpression = extractLayerBody(
    full,
    /(?:\*\*|【)?(?:镜内动态与神态|镜内动态|镜头动态与神态|镜头动态)(?:\*\*|】)?\s*[：:]/,
  );
  const lastFrame = extractLayerBody(full, /(?:\*\*|【)?尾帧(?:\*\*|】)?\s*[：:]/);

  return { firstFrame, dynamicAndExpression, lastFrame };
}

/** 无「首帧」分段时：从一整段叙事里取时间上最早的可画瞬间（截到首个强顺序词前） */
export function extractFirstKeyframeHeuristicFromPlain(text: string): string {
  const t = normalizeHtmlishToPlainText(text).trim();
  if (!t) return "";
  const re = new RegExp(SEQUENTIAL_MARKERS.source, "g");
  const match = re.exec(t);
  if (match && match.index > 10) {
    const head = t
      .slice(0, match.index)
      .trim()
      .replace(/[，,、；;：:]\s*$/u, "");
    return head || t;
  }
  return t;
}

/** 无「尾帧」分段时：取最后一个顺序词之后片段，或最后一句 */
export function extractLastKeyframeHeuristicFromPlain(text: string): string {
  const t = normalizeHtmlishToPlainText(text).trim();
  if (!t) return "";
  const re = new RegExp(SEQUENTIAL_MARKERS.source, "g");
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) lastIdx = m.index + m[0].length;
  if (lastIdx > 0 && lastIdx < t.length - 4) {
    const tail = t.slice(lastIdx).trim();
    const one = tail
      .split(/(?<=[。！？])/u)
      .map((x) => x.trim())
      .filter(Boolean);
    return (one[0] && one[0].length >= 6 ? one[0] : tail) || t;
  }
  const sentences = t
    .split(/(?<=[。！？])/u)
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length > 1) return sentences[sentences.length - 1]! || t;
  return t;
}

export type StoryboardImageVisualTarget = "first" | "last";

/**
 * 根据视频模式与生图目标帧，从 content / imagePrompt / 覆盖文案得到「画面正文」一句（不含画风块）。
 */
export function resolveStoryboardImageVisualBody(
  shot: StoryboardShot,
  opts: { promptOverride?: string; targetFrame: StoryboardImageVisualTarget; ignoreImagePrompt?: boolean },
): string {
  const ov = opts.promptOverride?.trim() ?? "";
  if (ov) return normalizeHtmlishToPlainText(ov);
  if (!opts.ignoreImagePrompt) {
    const ip = shot.imagePrompt?.trim() ?? "";
    if (ip && opts.targetFrame === "first") return normalizeHtmlishToPlainText(ip);
  }

  const raw = clean(shot.content) || clean(shot.prompt);
  const full = normalizeHtmlishToPlainText(raw);
  const layers = parseStoryboardContentLayers(full);

  if (opts.targetFrame === "first") {
    if (layers.firstFrame) return layers.firstFrame;
    return extractFirstKeyframeHeuristicFromPlain(full);
  }

  if (layers.lastFrame) return layers.lastFrame;
  return extractLastKeyframeHeuristicFromPlain(full);
}

/** 正文是否像「未分段的长叙事」，且适合提示模型做首瞬间截取 */
export function plainContentLooksSequential(text: string): boolean {
  const t = normalizeHtmlishToPlainText(text).trim();
  if (t.length < 28) return false;
  const re = new RegExp(SEQUENTIAL_MARKERS.source, "g");
  const hits = t.match(re);
  return (hits?.length ?? 0) >= 2 || ((hits?.length ?? 0) >= 1 && t.length > 140);
}
