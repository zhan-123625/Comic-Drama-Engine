import { createHash } from "node:crypto";
import type { AssetItem } from "./types.js";

export function normalizeToken(v: string): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\s\-_.:/\\|]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStableId(type: AssetItem["type"], key: string): number {
  const hash = createHash("sha1").update(`${type}|${key}`).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) >>> 0;
}

/**
 * 资产去重与合并：
 * 1. 优先按 (type + 规范化名称) 进行去重，因为跨运行模型生成的英文 key 可能略有微调（如 scene:red algae market 与 scene:scene red algae market），但实体中文名是唯一稳定的；
 * 2. 若名称为空，回退到 key 或 stableId；
 * 3. 合并时优先保留已有图片（imageUrl / remoteImageUrl）；
 * 4. 合并更长更详尽的 prompt、note、aliases 与 sceneNos；
 * 5. 重新规整 index (1..N)。
 */
export function dedupeAssets(items: AssetItem[]): AssetItem[] {
  if (!items || items.length <= 1) return items ?? [];
  const map = new Map<string, AssetItem>();

  for (const item of items) {
    const rawKey = String(item.key ?? "").trim();
    const rawName = normalizeToken(item.name ?? "");
    const type = item.type || "scene";

    // 核心去重键：同类型下，名称一致即视为同一实体
    const dedupKey = rawName
      ? `${type}#name:${rawName}`
      : rawKey
        ? `${type}#key:${rawKey.toLowerCase()}`
        : item.stableId
          ? `${type}#sid:${item.stableId}`
          : `${type}#id:${item.id}`;

    const prev = map.get(dedupKey);
    if (!prev) {
      map.set(dedupKey, { ...item });
      continue;
    }

    // 保留已有图片
    if (!prev.imageUrl && item.imageUrl) {
      prev.imageUrl = item.imageUrl;
      prev.remoteImageUrl = item.remoteImageUrl || prev.remoteImageUrl;
    }
    // 提示词取更详尽的
    if ((item.prompt?.length ?? 0) > (prev.prompt?.length ?? 0)) {
      prev.prompt = item.prompt;
    }
    // 名称取更具体的
    if ((item.name?.length ?? 0) > (prev.name?.length ?? 0)) {
      prev.name = item.name;
    }
    // 合并备注
    if (item.note && !prev.note?.includes(item.note)) {
      prev.note = [prev.note, item.note].filter(Boolean).join("；");
    }
    // 合并别名
    if (item.aliases?.length) {
      prev.aliases = [...new Set([...(prev.aliases ?? []), ...item.aliases])];
    }
    // 合并场次
    if (item.sceneNos?.length) {
      prev.sceneNos = [...new Set([...(prev.sceneNos ?? []), ...item.sceneNos])].sort((a, b) => a - b);
    }
  }

  return Array.from(map.values()).map((x, i) => ({
    ...x,
    index: i + 1,
  }));
}
