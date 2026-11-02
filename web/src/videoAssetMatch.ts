import type { AssetItem, StoryboardShot } from "./types";

function clean(s: string): string {
  return String(s ?? "").trim();
}

/** 与 server/storyboardPrompt.ts `composeStoryboardPrompt` 一致，供视频侧资产匹配 */
export function composeStoryboardPromptForVideoMatch(shot: StoryboardShot): string {
  const content = clean(shot.content) || clean(shot.prompt);
  const size = clean(shot.shotSize);
  const camera = clean(shot.camera);
  const dialogue = clean(shot.dialogue);
  const music = clean(shot.music);
  const sfx = clean(shot.sfx);
  const legacyNote = clean(shot.note);

  const lines: string[] = [];
  const shotNo = clean(shot.shotNo) || String(shot.index);
  if (content) lines.push(`镜头 ${shotNo}：${content}`);
  const metaBits = [size ? `景别：${size}` : "", camera ? `摄法：${camera}` : ""].filter(Boolean);
  if (metaBits.length) lines.push(metaBits.join("；"));
  if (dialogue) lines.push(`台词/旁白：${dialogue}`);
  if (music) lines.push(`音乐：${music}`);
  if (sfx) lines.push(`音效：${sfx}`);
  if (legacyNote && !lines.join("\n").includes(legacyNote)) lines.push(`备注：${legacyNote}`);
  return lines.join("\n").trim();
}

function scoreAsset(shot: StoryboardShot, a: AssetItem): number {
  const text =
    `${composeStoryboardPromptForVideoMatch(shot)} ${shot.note ?? ""} ${shot.videoPrompt ?? ""}`.toLowerCase();
  const name = (a.name || "").toLowerCase().trim();
  if (!name) return 0;
  let score = 0;
  if (text.includes(name)) score += 5;
  for (const token of name.split(/[\s,，、/|]+/).filter((x) => x.length >= 2)) {
    if (text.includes(token)) score += 1;
  }
  return score;
}

/**
 * 与 server/videoContext.ts `buildVideoInputWithAssets` 中 matched 列表逻辑一致（最多 8 条）。
 */
export function matchedAssetsForVideoShot(
  shot: StoryboardShot,
  assets: AssetItem[],
  aggregateAssets: boolean,
): { list: AssetItem[]; isFallback: boolean } {
  if (!aggregateAssets || !assets.length) return { list: [], isFallback: false };
  const excluded = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));

  const scored = assets
    .filter((a) => !excluded.has(a.id.toLowerCase()))
    .map((a) => ({ a, s: scoreAsset(shot, a) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.index - y.a.index)
    .map((x) => x.a);

  const isFallback = scored.length === 0;
  const list = (isFallback ? assets.filter((a) => !excluded.has(a.id.toLowerCase())).slice(0, 6) : scored).slice(0, 8);
  return { list, isFallback };
}

/**
 * 分镜页「视频引用资产」列：手动附加（videoExtraAssetIds）固定在前，再跟自动匹配（与 buildVideoInputWithAssets 顺序一致，不含 @ 引用预览）。
 */
export function matchedAssetsForVideoDisplay(
  shot: StoryboardShot,
  assets: AssetItem[],
  aggregateAssets: boolean,
): { list: AssetItem[]; isFallback: boolean; extraIdSet: Set<string> } {
  const excluded = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));
  const byId = new Map(assets.map((a) => [a.id.toLowerCase(), a]));
  const extra: AssetItem[] = [];
  const seen = new Set<string>();
  for (const raw of shot.videoExtraAssetIds ?? []) {
    const id = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!id || seen.has(id) || excluded.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (a) extra.push(a);
  }
  const extraIdSet = new Set(extra.map((a) => a.id.toLowerCase()));

  if (!aggregateAssets) {
    return { list: extra, isFallback: false, extraIdSet };
  }

  if (!assets.length) {
    return { list: extra, isFallback: false, extraIdSet };
  }

  const scored = assets
    .filter((a) => !excluded.has(a.id.toLowerCase()))
    .map((a) => ({ a, s: scoreAsset(shot, a) }))
    .filter((x) => x.s > 0 && !seen.has(x.a.id.toLowerCase()))
    .sort((x, y) => y.s - x.s || x.a.index - y.a.index)
    .map((x) => x.a);

  const isFallback = scored.length === 0;
  const auto = (
    isFallback
      ? assets.filter((a) => !seen.has(a.id.toLowerCase()) && !excluded.has(a.id.toLowerCase())).slice(0, 6)
      : scored
  ).slice(0, 8);

  return {
    list: [...extra, ...auto],
    isFallback: extra.length === 0 && isFallback,
    extraIdSet,
  };
}
