import type { VideoProviderConfig } from "./config.js";
import { effectiveVideoRunMode } from "./videoModeLogic.js";
import { isLikelyLocalHostUrl, isLikelyPrivateLanUrl, toPublicAssetUrl } from "./publicUrl.js";
import { composeStoryboardPrompt } from "./storyboardPrompt.js";
import { shotVideoDurationSeconds } from "./videoDurationParam.js";
import type { AssetItem, Project, StoryboardShot, VideoRunMode } from "./types.js";

const MAX_VIDEO_API_REFERENCE_IMAGES = 8;

/** 解析为视频云可拉取的 URL；否则返回 null */
export function resolveUrlForVideoApi(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const u = toPublicAssetUrl(t) ?? t;
  if (isLikelyLocalHostUrl(u) || isLikelyPrivateLanUrl(u)) return null;
  return u;
}

/**
 * 方舟等可在服务端读盘并转为 `data:image/...;base64,...` 内联提交的地址（无需公网拉图）。
 * 含官方示例 data URL、本应用 `/api/files/...` 与库内分镜图路径。
 */
export function isArkInlineResolvableImageUrl(raw: string | undefined): boolean {
  const t = raw?.trim();
  if (!t) return false;
  if (/^data:image\//i.test(t) && /;base64,/i.test(t)) return true;
  let p = t;
  try {
    if (/^https?:\/\//i.test(t)) p = new URL(t).pathname;
  } catch {
    return false;
  }
  p = p.replace(/\/+/g, "/");
  if (p.startsWith("/api/files/projects/")) return true;
  return /^\/api\/projects\/[^/]+\/shots\/[^/]+\/image$/i.test(p);
}

/** 对象存储等带签名的直链，数小时～数天后常失效 */
/** 阿里百炼 / DashScope 对象存储地址，视频生成服务原生支持直接访问 */
export function isDashScopeStorageUrl(u: string): boolean {
  const x = u.toLowerCase();
  return x.includes("dashscope") || x.includes("aliyuncs.com");
}

export function isLikelyEphemeralSignedImageUrl(u: string): boolean {
  const x = u.toLowerCase();
  if (x.includes("x-amz-") || x.includes("x-tos-")) return true;
  try {
    const sp = new URL(u).searchParams;
    if (sp.has("Expires") || sp.has("expires") || sp.has("Signature") || sp.has("signature")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 视频参考图最终 URL：优先经 MY_APP_PUBLIC_URL 可公网拉取的本地 `/api/files/...`；
 * 若仅解析到本机地址，再使用非临时的 `remote`（如图床）；避免用大模型返回的短时签名链压过已落盘文件。
 */
export function bestVideoReferenceUrl(local?: string, remote?: string): string | undefined {
  const l = (local ?? "").trim();
  const r = (remote ?? "").trim();
  const rHttp = r && /^https?:\/\//i.test(r) ? r : undefined;

  if (l.startsWith("/api/")) {
    const resolved = toPublicAssetUrl(l) ?? l;
    const resolvedBad = isLikelyLocalHostUrl(resolved) || isLikelyPrivateLanUrl(resolved);
    if (!resolvedBad) {
      return resolved;
    }
    if (
      rHttp &&
      !isLikelyLocalHostUrl(rHttp) &&
      !isLikelyPrivateLanUrl(rHttp) &&
      (!isLikelyEphemeralSignedImageUrl(rHttp) || isDashScopeStorageUrl(rHttp))
    ) {
      return rHttp;
    }
    return resolved;
  }

  /** 绝对 URL 也可能仍是本机/内网或大模型临时链，不能早于 remote 直接返回（否则视频侧 sendable=false 会整图丢弃） */
  if (/^https?:\/\//i.test(l)) {
    const lBadForCloud = isLikelyLocalHostUrl(l) || isLikelyPrivateLanUrl(l) || isLikelyEphemeralSignedImageUrl(l);
    if (!lBadForCloud) {
      return l;
    }
    if (
      rHttp &&
      !isLikelyLocalHostUrl(rHttp) &&
      !isLikelyPrivateLanUrl(rHttp) &&
      (!isLikelyEphemeralSignedImageUrl(rHttp) || isDashScopeStorageUrl(rHttp))
    ) {
      return rHttp;
    }
    return l;
  }

  if (rHttp) {
    return rHttp;
  }

  return l || undefined;
}

/** 是否建议再传图床：已有非临时公网 remote 则跳过；否则有可读本地/http 源则上传（兼容旧数据无自动图床链）。 */
export function assetImageNeedsEasyImagePublish(asset: AssetItem): boolean {
  const remote = asset.remoteImageUrl?.trim() ?? "";
  if (remote && /^https?:\/\//i.test(remote) && !isLikelyEphemeralSignedImageUrl(remote)) {
    return false;
  }
  const local = asset.imageUrl?.trim() ?? "";
  if (local.startsWith("/api/files/")) return true;
  if (/^https?:\/\//i.test(local)) return true;
  if (remote && /^https?:\/\//i.test(remote)) return true;
  return false;
}

function assetTypeLabel(t: AssetItem["type"]): string {
  if (t === "character") return "角色";
  if (t === "scene") return "场景";
  if (t === "prop") return "物品";
  if (t === "costume") return "服装造型";
  if (t === "action_pose") return "动作姿态";
  return "特效";
}

export function scoreAsset(shot: StoryboardShot, a: AssetItem): number {
  const composed = composeStoryboardPrompt(shot, { omitDuration: true });
  const text = `${composed} ${shot.note ?? ""} ${shot.imagePrompt ?? ""}`.toLowerCase();
  const refIds = new Set(
    extractAssetRefIds(`${composed} ${shot.imagePrompt ?? ""} ${shot.content ?? ""} ${shot.prompt ?? ""}`),
  );
  if (refIds.has(a.id.toLowerCase())) return 100;

  const needles: string[] = [];
  const pushNeedle = (raw: string) => {
    const v = raw.toLowerCase().trim();
    if (v.length >= 1) needles.push(v);
  };
  pushNeedle(a.name || "");
  if (a.key?.trim()) pushNeedle(a.key);
  for (const al of a.aliases ?? []) pushNeedle(String(al));
  const uniq = [...new Set(needles.filter(Boolean))];
  if (!uniq.length) return 0;

  let score = 0;
  for (const name of uniq) {
    if (text.includes(name)) score += name.length >= 2 ? 5 : 2;
    for (const token of name.split(/[\s,，、/|]+/).filter((x) => x.length >= 2)) {
      if (text.includes(token)) score += 1;
    }
  }
  return score;
}

/**
 * 与视频「聚合资产」一致：按分镜全文匹配资产名，无匹配时回退前若干条。
 */
export function pickMatchedAssetsForShot(
  project: Project,
  shot: StoryboardShot,
  opts?: { max?: number; aggregateAssets?: boolean; fallbackImagesFirst?: boolean },
): AssetItem[] {
  const max = opts?.max ?? 8;
  const aggregateAssets = opts?.aggregateAssets !== false;
  if (!aggregateAssets || !project.assets.length) return [];
  const scored = project.assets
    .map((a) => ({ a, s: scoreAsset(shot, a) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.index - y.a.index)
    .map((x) => x.a);
  const fallback = opts?.fallbackImagesFirst === true;
  const matched = scored.length > 0 ? scored : fallback ? assetsWithImagesFirst(project.assets, Math.min(max, 12)) : [];
  return matched.slice(0, max);
}

/** 无任何名称命中时：优先带参考图的资产（便于分镜生图仍能用到角色/场景图） */
function assetsWithImagesFirst(assets: AssetItem[], take: number): AssetItem[] {
  if (take <= 0 || !assets.length) return [];
  const copy = [...assets].sort((a, b) => {
    const ha = !!(a.imageUrl?.trim() || a.remoteImageUrl?.trim());
    const hb = !!(b.imageUrl?.trim() || b.remoteImageUrl?.trim());
    if (ha !== hb) return ha ? -1 : 1;
    return a.index - b.index;
  });
  return copy.slice(0, take);
}

function dedupeAssetsById(assets: AssetItem[]): AssetItem[] {
  const seen = new Set<string>();
  const out: AssetItem[] = [];
  for (const a of assets) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/**
 * 资产表 `sceneNos` 含当前分镜 `sceneNo` 的 **场景 + 角色**（与剧本场次对齐）。
 */
export function assetsLinkedToStoryboardScene(project: Project, shot: StoryboardShot): AssetItem[] {
  const sn = shot.sceneNo;
  if (sn == null || !Number.isInteger(sn) || sn < 1) return [];
  const out: AssetItem[] = [];
  for (const a of project.assets) {
    // 场次关联只匹配空间场景（作为环境底色）。角色必须在镜头文案/台词中出镜才引用，避免纯空景错绑角色
    if (a.type !== "scene") continue;
    const nos = a.sceneNos ?? [];
    if (!nos.includes(sn)) continue;
    out.push(a);
  }
  return out;
}

function byAssetIndex(xs: AssetItem[]): AssetItem[] {
  return [...xs].sort((a, b) => a.index - b.index);
}

function assetHasImageRef(a: AssetItem): boolean {
  return !!(a.imageUrl?.trim() || a.remoteImageUrl?.trim());
}

/**
 * 当前分镜「场次」对应的**场景类**资产（用于同场统一空间参考图）。
 * - 优先：`sceneNos` 含该场次号的场景资产；
 * - 若无：回退至多 2 条「未填场次」的场景资产（有图优先），避免同场完全无场景参考。
 */
export function sceneAssetsForStoryboardSceneNo(project: Project, sceneNo: number): AssetItem[] {
  const explicit = project.assets
    .filter((a) => a.type === "scene" && (a.sceneNos ?? []).includes(sceneNo))
    .sort((a, b) => a.index - b.index);
  if (explicit.length > 0) return explicit;

  const globals = project.assets
    .filter((a) => a.type === "scene" && !a.sceneNos?.length)
    .sort((a, b) => {
      const ha = assetHasImageRef(a);
      const hb = assetHasImageRef(b);
      if (ha !== hb) return ha ? -1 : 1;
      return a.index - b.index;
    });
  return globals.slice(0, 2);
}

/**
 * 分镜生图参考图与「图片提示词」匹配列表共用：**本场次场景（固定最前）→ 其它场景 → 角色 → 服装 → 其它**。
 * 来源 = **场次对应场景资产** + 场次绑定（sceneNos 角色/场景）+ **文案 + imagePrompt + 别名/key + @资产ID** 匹配。
 * 与视频设置「聚合资产」无关：生图侧始终做文案匹配（视频仍用 `pickMatchedAssetsForShot` 的 aggregate 开关）。
 */
export function orderedAssetsForStoryboardVisual(project: Project, shot: StoryboardShot): AssetItem[] {
  const sn = shot.sceneNo;
  const sceneForThisRun =
    sn != null && Number.isInteger(sn) && sn >= 1 ? sceneAssetsForStoryboardSceneNo(project, sn) : [];
  const runSceneId = new Set(sceneForThisRun.map((x) => x.id));

  const linked = assetsLinkedToStoryboardScene(project, shot);
  const picked = pickMatchedAssetsForShot(project, shot, { max: 48, aggregateAssets: true });
  const excludedSet = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));
  const merged = dedupeAssetsById([...sceneForThisRun, ...linked, ...picked]).filter(
    (a) => !excludedSet.has(a.id.toLowerCase()),
  );

  const otherScenes: AssetItem[] = [];
  const chars: AssetItem[] = [];
  const costumes: AssetItem[] = [];
  const rest: AssetItem[] = [];
  for (const a of merged) {
    if (a.type === "scene") {
      if (!runSceneId.has(a.id)) otherScenes.push(a);
    } else if (a.type === "character") chars.push(a);
    else if (a.type === "costume") costumes.push(a);
    else rest.push(a);
  }
  return [
    ...byAssetIndex(chars),
    ...byAssetIndex(sceneForThisRun),
    ...byAssetIndex(otherScenes),
    ...byAssetIndex(costumes),
    ...byAssetIndex(rest),
  ];
}

export function extractAssetRefIds(text: string): string[] {
  const s = String(text ?? "");
  const ids = new Set<string>();
  const re = /@([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;
  for (const m of s.matchAll(re)) {
    const id = String(m[1] ?? "").toLowerCase();
    if (id) ids.add(id);
  }
  return [...ids];
}

export type VideoReferenceSlot = {
  role: "shot" | "asset";
  assetType?: AssetItem["type"];
  name: string;
  id?: string;
  /** 项目内存储的地址（相对路径或外链原文） */
  storageUrl: string;
  /** 经 MY_APP_PUBLIC_URL 解析后的 URL；无法解析时与 storage 相同或为空 */
  resolvedUrl: string | null;
  /** 云端是否可能拉取（非本机 host） */
  sendable: boolean;
};

export type VideoInputBuilt = {
  /** 分镜基底提示词 + 可选「参考图附件」短说明（不再嵌入整段资产 prompt 正文） */
  prompt: string;
  /** 送视频 API 的整秒时长（来自分镜 durationSec），与 prompt 分离 */
  durationSeconds?: number;
  matchedAssets: AssetItem[];
  /** 按送 API 顺序：先分镜关键帧（若有），再匹配资产图 */
  referenceSlots: VideoReferenceSlot[];
  /** 将传给视频模型的参考图 URL 列表（公网 URL、data URL 或由方舟路径内联的本应用 `/api/...`） */
  apiImageUrls: string[];
  /** 全能参考模式：可选音频 / 参考视频 URL */
  omniAudioUrl?: string;
  omniVideoUrl?: string;
  /** 本构建使用的视频模式（供前端预览对齐） */
  runMode?: VideoRunMode;
};

function resolveSlot(raw: string): { resolvedUrl: string | null; sendable: boolean } {
  const r = toPublicAssetUrl(raw.trim()) ?? null;
  if (!r) return { resolvedUrl: null, sendable: false };
  const sendable = !isLikelyLocalHostUrl(r) && !isLikelyPrivateLanUrl(r);
  return { resolvedUrl: r, sendable };
}

function assetImageRawForVideo(a: AssetItem): string | undefined {
  return bestVideoReferenceUrl(a.imageUrl, a.remoteImageUrl);
}

function buildReferenceSlots(
  shot: StoryboardShot,
  baseImageUrl: string | undefined,
  matched: AssetItem[],
): VideoReferenceSlot[] {
  const slots: VideoReferenceSlot[] = [];
  const seenResolved = new Set<string>();
  const assetIdsWithImageSlot = new Set<string>();

  if (baseImageUrl?.trim()) {
    const t = baseImageUrl.trim();
    const { resolvedUrl, sendable } = resolveSlot(t);
    if (!(resolvedUrl && seenResolved.has(resolvedUrl))) {
      if (resolvedUrl) seenResolved.add(resolvedUrl);
      slots.push({
        role: "shot",
        name: `镜头 #${shot.index} 关键帧`,
        id: shot.id,
        storageUrl: t,
        resolvedUrl,
        sendable,
      });
    }
  }

  for (const a of matched) {
    const raw = assetImageRawForVideo(a);
    if (!raw) continue;
    const t = raw.trim();
    const { resolvedUrl, sendable } = resolveSlot(t);
    if (resolvedUrl && seenResolved.has(resolvedUrl)) {
      assetIdsWithImageSlot.add(a.id);
      continue;
    }
    if (resolvedUrl) seenResolved.add(resolvedUrl);
    slots.push({
      role: "asset",
      name: a.name,
      id: a.id,
      assetType: a.type,
      storageUrl: t,
      resolvedUrl,
      sendable,
    });
    assetIdsWithImageSlot.add(a.id);
  }

  /** 与分镜页「视频引用资产」一致：无图的匹配资产也占一行，避免误以为预览漏数据 */
  for (const a of matched) {
    if (assetIdsWithImageSlot.has(a.id)) continue;
    slots.push({
      role: "asset",
      name: a.name,
      id: a.id,
      assetType: a.type,
      storageUrl: "（无图：未设置 imageUrl / remoteImageUrl，视频请求不会附带该资产图）",
      resolvedUrl: null,
      sendable: false,
    });
  }

  return slots;
}

/** 分镜「手动附加」的视频资产 ID → 本项目资产条目（顺序与 ID 列表一致，去重）。 */
export function assetsFromVideoExtraIds(project: Project, ids: string[] | undefined): AssetItem[] {
  if (!ids?.length) return [];
  const map = new Map(project.assets.map((a) => [a.id.toLowerCase(), a]));
  const out: AssetItem[] = [];
  const used = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!id || used.has(id)) continue;
    used.add(id);
    const a = map.get(id);
    if (a) out.push(a);
  }
  return out;
}

/** 与 {@link shortRefAttachmentNote} 成对：带图请求失败回退纯文本时去掉尾段，避免谎称已传参考图 */
export const VIDEO_REF_ATTACHMENT_SUFFIX_RE = /\n\n【参考图附件】[\s\S]*$/;

export function stripVideoRefAttachmentNoteSuffix(prompt: string): string {
  return prompt.replace(VIDEO_REF_ATTACHMENT_SUFFIX_RE, "").trimEnd();
}

function shortRefAttachmentNote(slots: VideoReferenceSlot[], apiImageUrls: string[]): string {
  if (apiImageUrls.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < apiImageUrls.length; i++) {
    const u = apiImageUrls[i]!;
    const s = slots.find((x) => x.resolvedUrl === u);
    if (!s) continue;
    const lab = s.role === "shot" ? "分镜关键帧" : `${assetTypeLabel(s.assetType!)}「${s.name}」`;
    parts.push(`第${i + 1}张：${lab}`);
  }
  if (!parts.length) return "";
  return `\n\n【参考图附件】按序共 ${apiImageUrls.length} 张参考图（${parts.join("；")}）。请以第 1 张为画面主体与构图基准，其余用于角色/场景/道具一致性参考，避免机械拼贴无关细节。`;
}

export function buildVideoInputWithAssets(opts: {
  project: Project;
  shot?: StoryboardShot;
  basePrompt: string;
  baseImageUrl?: string;
  videoCfg: VideoProviderConfig;
  referencedAssets?: AssetItem[];
  /** 省略时按分镜 + 模型 supportedModes 自动选取 */
  runMode?: VideoRunMode;
}): VideoInputBuilt {
  const { project, shot, basePrompt, baseImageUrl, videoCfg, referencedAssets = [] } = opts;
  const runMode = opts.runMode ?? (shot ? effectiveVideoRunMode(shot, videoCfg) : "multi_ref");

  if (shot && runMode === "text_only") {
    const durationSeconds = shotVideoDurationSeconds(shot);
    const pOnly = stripVideoRefAttachmentNoteSuffix(basePrompt).slice(0, 10_000);
    return {
      prompt: pOnly,
      durationSeconds,
      matchedAssets: [],
      referenceSlots: [],
      apiImageUrls: [],
      omniAudioUrl: undefined,
      omniVideoUrl: undefined,
      runMode: "text_only",
    };
  }

  let effCfg: VideoProviderConfig = { ...videoCfg };
  if (runMode === "first_frame") {
    effCfg = { ...effCfg, aggregateAssets: false, multiReferenceImages: false };
  } else if (runMode === "first_last") {
    effCfg = { ...effCfg, aggregateAssets: false, multiReferenceImages: true };
  }

  const aggregateAssets = effCfg.aggregateAssets ?? true;
  const multiReferenceImages = effCfg.multiReferenceImages ?? true;

  if (!shot) {
    return {
      prompt: basePrompt.slice(0, 10_000),
      matchedAssets: [],
      referenceSlots: [],
      apiImageUrls: [],
      runMode,
    };
  }

  /** 仅首帧：只送分镜关键帧，不附带手动附加 / 文案匹配资产图（对齐官方单图 i2v，且无 reference_image role） */
  const fromExtra = runMode === "first_frame" ? [] : assetsFromVideoExtraIds(project, shot.videoExtraAssetIds);
  const matchedAuto =
    runMode === "first_frame" || !aggregateAssets
      ? []
      : pickMatchedAssetsForShot(project, shot, { max: 8, aggregateAssets: true });
  const refFromPrompt = runMode === "first_frame" ? [] : referencedAssets;
  /** 手动附加 → @ 引用 → 文案自动匹配（去重保序） */
  const excludedSet = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));
  const merged = [...fromExtra, ...refFromPrompt, ...matchedAuto].filter((a) => !excludedSet.has(a.id.toLowerCase()));
  const matched = merged.filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i);

  /** 仅分镜自身关键帧；无图时由 referenceSlots 中首个资产图担任「首图」（与 referenceMode:auto 单图时代行为一致）；仅首帧模式不合并资产 */
  const referenceSlots = buildReferenceSlots(shot, baseImageUrl, matched);

  const orderedSendable = referenceSlots
    .filter((s) => {
      if (!s.resolvedUrl) return false;
      if (s.sendable) return true;
      return isArkInlineResolvableImageUrl(s.resolvedUrl);
    })
    .map((s) => s.resolvedUrl!);
  const unique: string[] = [];
  const us = new Set<string>();
  for (const u of orderedSendable) {
    if (us.has(u)) continue;
    us.add(u);
    unique.push(u);
  }
  let apiImageUrls = unique.slice(0, MAX_VIDEO_API_REFERENCE_IMAGES);
  if (!multiReferenceImages) apiImageUrls = apiImageUrls.slice(0, 1);

  if (runMode === "first_frame") {
    apiImageUrls = apiImageUrls.slice(0, 1);
  } else if (runMode === "first_last") {
    const first = apiImageUrls[0];
    const lastRaw = bestVideoReferenceUrl(shot.lastFrameImageUrl, shot.lastFrameRemoteUrl);
    const lastResolved = lastRaw?.trim() ? (toPublicAssetUrl(lastRaw.trim()) ?? lastRaw.trim()) : "";
    const lastPub = resolveUrlForVideoApi(lastRaw ?? undefined);
    const last = lastPub ?? (lastResolved && isArkInlineResolvableImageUrl(lastResolved) ? lastResolved : null);
    if (first && last) apiImageUrls = [first, last];
    else if (first) apiImageUrls = [first];
    else apiImageUrls = last ? [last] : [];
  }

  let omniAudioUrl: string | undefined;
  let omniVideoUrl: string | undefined;
  if (runMode === "omni") {
    omniAudioUrl = shot.videoRefAudioUrl?.trim() || undefined;
    omniVideoUrl = shot.videoRefVideoUrl?.trim() || undefined;
  }

  const note =
    runMode === "first_frame" && apiImageUrls.length <= 1 ? "" : shortRefAttachmentNote(referenceSlots, apiImageUrls);
  const prompt = (basePrompt + note).slice(0, 10_000);
  const durationSeconds = shotVideoDurationSeconds(shot);

  return {
    prompt,
    durationSeconds,
    matchedAssets: matched,
    referenceSlots,
    apiImageUrls,
    omniAudioUrl,
    omniVideoUrl,
    runMode,
  };
}

/**
 * 视频参考图用的分镜关键帧 URL。逻辑见 {@link bestVideoReferenceUrl}。
 */
export function shotBaseImageUrlForVideo(shot: StoryboardShot): string | undefined {
  return bestVideoReferenceUrl(shot.imageUrl, shot.remoteImageUrl);
}

/**
 * 分镜已有关键帧但解析后仍为本机地址时返回说明文案；无关键帧或未阻塞时返回 null。
 * 无分镜图、仅靠资产参考图生成视频时不拦截。
 */
export function shotKeyframeBlockingVideoReason(shot: StoryboardShot): string | null {
  if (!shot.imageUrl?.trim()) return null;
  const base = shotBaseImageUrlForVideo(shot);
  if (!base?.trim()) return null;
  const resolved = toPublicAssetUrl(base.trim()) ?? base.trim();
  if (!isLikelyLocalHostUrl(resolved) && !isLikelyPrivateLanUrl(resolved)) return null;
  if (isArkInlineResolvableImageUrl(resolved)) return null;
  const short = resolved.length > 64 ? `${resolved.slice(0, 64)}…` : resolved;
  return `镜头 #${shot.index}：分镜关键帧为内网/本机地址（${short}），视频服务无法拉取。请设置环境变量 MY_APP_PUBLIC_URL 为公网可访问基地址，或使用 EasyImage 等稳定图床外链（remoteImageUrl）。`;
}
