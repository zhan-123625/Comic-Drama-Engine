import type { StoryboardShot } from "./types.js";
import { splitScriptBlocks, type ScriptBlock } from "./scriptBlocks.js";

/** 无 ### 标题时视为单块正文，便于与「按章剧本」一致处理 */
export function getScriptBlocksForStoryboard(script: string): ScriptBlock[] {
  const blocks = splitScriptBlocks(script);
  if (blocks.length) return blocks;
  const flat = String(script ?? "").trim();
  return flat ? [{ title: "正文", body: flat }] : [];
}

function normalizeLabel(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[：:·\-—_]/g, "")
    .toLowerCase();
}

/** 从 Markdown 表格行中抓取「首列纯数字」作为场次号（与剧本表「场次」列对齐） */
export function extractSceneNosFromMarkdownTable(text: string): number[] {
  const set = new Set<number>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|\s*:?-+:?\s*\|/.test(t)) continue;
    const m = t.match(/^\|\s*(\d+)\s*\|/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > 0 && n < 10_000) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 多章剧本中各章表格常从场次 1 递增；合并为全局场次：第 2 章局部 1,2 → 接在上章 max 之后。
 */
export function extractGlobalSceneNosFromScript(script: string): number[] {
  const blocks = splitScriptBlocks(script);
  if (!blocks.length) {
    const flat = String(script ?? "").trim();
    return flat ? extractSceneNosFromMarkdownTable(flat) : [];
  }
  const globalSet = new Set<number>();
  let offset = 0;
  for (const b of blocks) {
    const local = extractSceneNosFromMarkdownTable(b.body);
    const m = local.length ? Math.max(...local) : 0;
    for (const sn of local) globalSet.add(sn + offset);
    offset += m;
  }
  return [...globalSet].sort((a, b) => a - b);
}

export function allGlobalSceneNosForStoryboard(script: string, shots: StoryboardShot[]): number[] {
  const fromScript = extractGlobalSceneNosFromScript(script);
  if (fromScript.length) return fromScript;
  const fromShots = [...new Set(shots.map((s) => s.sceneNo).filter((n): n is number => n != null && n > 0))].sort(
    (a, b) => a - b,
  );
  return fromShots;
}

/**
 * 从导演 feedback 中解析要重试的全局场次号；解析不到则返回 []（调用方走全量重生成）。
 */
export function pickStoryboardRetrySceneNos(feedback: string, script: string, lastShots: StoryboardShot[]): number[] {
  const valid = new Set(allGlobalSceneNosForStoryboard(script, lastShots));
  if (!valid.size) return [];
  const found = new Set<number>();
  const patterns = [
    /场次\s*[:：]?\s*(\d+)/gi,
    /第\s*(\d+)\s*场/gi,
    /场\s*次\s*(\d+)/gi,
    /scene\s*no\.?\s*[:：]?\s*(\d+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(feedback)) !== null) {
      const n = parseInt(m[1]!, 10);
      if (valid.has(n)) found.add(n);
    }
  }
  const f = normalizeLabel(feedback);
  for (const n of valid) {
    if (
      f.includes(normalizeLabel(`场${n}`)) ||
      f.includes(normalizeLabel(`场次${n}`)) ||
      f.includes(normalizeLabel(`第${n}场`))
    ) {
      found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function reindexStoryboardIndices(shots: StoryboardShot[]): StoryboardShot[] {
  return shots.map((s, i) => ({ ...s, index: i + 1 }));
}

/** 用 replacement 中指定 sceneNo 的镜头替换 previous 中同场次镜头，再按场次顺序拼回 */
export function mergeStoryboardByScenes(
  previous: StoryboardShot[],
  replacement: StoryboardShot[],
  replacedSceneNos: Set<number>,
): StoryboardShot[] {
  const kept = previous.filter((s) => s.sceneNo == null || !replacedSceneNos.has(s.sceneNo));
  const allScenes = [
    ...new Set([
      ...previous.map((s) => s.sceneNo).filter((n): n is number => n != null && n > 0),
      ...replacement.map((s) => s.sceneNo).filter((n): n is number => n != null && n > 0),
    ]),
  ].sort((a, b) => a - b);
  const out: StoryboardShot[] = [];
  for (const sn of allScenes) {
    const chunk = replacedSceneNos.has(sn)
      ? replacement.filter((s) => s.sceneNo === sn)
      : kept.filter((s) => s.sceneNo === sn);
    out.push(...chunk);
  }
  return reindexStoryboardIndices(out);
}
