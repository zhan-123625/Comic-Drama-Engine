import { runImageAgentForShot } from "../../agents/imageAgent.js";
import { appendImageJobRecord } from "../../jobs.js";
import { tryEasyImageUrlAfterGenerate } from "../../easyImageAfterGenerate.js";
import { bytesFromGenerateImageResult, saveProjectImageFile } from "../../imagePersist.js";
import { getModelApiCallFromError } from "../../modelCallError.js";
import { composeAssetImagePrompt } from "../../assetImagePrompt.js";
import { store } from "../../store.js";

export async function generateAssetImage(projectId: string, assetId: string) {
  const p = await store.get(projectId);
  if (!p) return { ok: false as const, status: 404 as const, error: "project not found" };
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) return { ok: false as const, status: 404 as const, error: "asset not found" };
  if (!a.prompt?.trim()) return { ok: false as const, status: 400 as const, error: "asset prompt is empty" };
  const fullPrompt = composeAssetImagePrompt(a.prompt, a.type);
  try {
    const img = await runImageAgentForShot(fullPrompt, p.storyboardImageSize);
    const { buf, mime, remoteUrl } = await bytesFromGenerateImageResult(img);
    const localUrl = await saveProjectImageFile(p.id, "assets", a.id, buf, mime);
    const easyUrl = await tryEasyImageUrlAfterGenerate(buf, a.id, mime);
    p.assets = p.assets.map((x) =>
      x.id === a.id ? { ...x, imageUrl: localUrl, remoteImageUrl: easyUrl ?? remoteUrl ?? x.remoteImageUrl } : x,
    );
    await store.save(p);
    try {
      await appendImageJobRecord(projectId, {
        status: "done",
        message: `资产生图完成：${a.name}（#${a.index}）`,
        prompt: fullPrompt,
        resultUrl: localUrl,
        modelApiCall: img.modelApiCall,
      });
    } catch {
      /* 任务记录失败不影响主流程 */
    }
    const refreshed = await store.get(projectId);
    return { ok: true as const, project: refreshed ?? p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failedSnap = getModelApiCallFromError(e);
    try {
      await appendImageJobRecord(projectId, {
        status: "failed",
        message: `资产生图失败：${a.name}（#${a.index}）：${msg}`.slice(0, 600),
        prompt: fullPrompt,
        modelApiCall: failedSnap,
      });
    } catch {
      /* noop */
    }
    return { ok: false as const, status: 502 as const, error: msg };
  }
}
