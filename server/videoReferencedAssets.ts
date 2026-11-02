import { store } from "./store.js";
import { extractAssetRefIds } from "./videoContext.js";
import type { AssetItem, Project, StoryboardShot } from "./types.js";

let globalAssetById: Map<string, AssetItem> | null = null;

/** 按 @uuid 与项目资产表、资产库解析「显式引用」资产（与 run-once / runner 一致） */
export async function resolveReferencedAssetsForVideo(
  project: Project,
  shot: StoryboardShot,
  basePrompt: string,
): Promise<AssetItem[]> {
  const refText = [basePrompt, shot.content ?? "", shot.note ?? "", shot.dialogue ?? ""].join("\n");
  const refIds = extractAssetRefIds(refText);
  const referencedAssets: AssetItem[] = [];
  if (refIds.length > 0) {
    const localById = new Map(project.assets.map((a) => [a.id.toLowerCase(), a]));
    const missing: string[] = [];
    for (const idRef of refIds) {
      const hit = localById.get(idRef);
      if (hit) referencedAssets.push(hit);
      else missing.push(idRef);
    }
    if (missing.length > 0) {
      if (!globalAssetById) {
        const all = await store.listAssetLibrary();
        globalAssetById = new Map(all.map((x) => [x.asset.id.toLowerCase(), x.asset]));
      }
      for (const idRef of missing) {
        const hit = globalAssetById.get(idRef);
        if (hit) referencedAssets.push(hit);
      }
    }
  }
  return referencedAssets;
}
