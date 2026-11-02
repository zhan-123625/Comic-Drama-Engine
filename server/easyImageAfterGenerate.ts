import { readConfig } from "./config.js";
import { uploadBufferToEasyImage } from "./easyImageClient.js";
import { projectStoredImageFilename } from "./imagePersist.js";
import { logger } from "./logger.js";

/**
 * 生图落盘后：若已配置 EasyImage，则上传并返回稳定外链，写入 `remoteImageUrl`。
 * 未配置或任意失败返回 null（绝不抛错，避免拖垮资产生图/分镜生图主流程）。
 */
export async function tryEasyImageUrlAfterGenerate(
  buf: Buffer,
  entityId: string,
  mime: string,
): Promise<string | null> {
  try {
    const ei = (await readConfig()).easyImage;
    const apiUrl = ei?.apiUrl?.trim();
    const token = ei?.token?.trim();
    if (!apiUrl || !token) return null;
    const filename = projectStoredImageFilename(entityId, mime);
    try {
      const url = await uploadBufferToEasyImage(apiUrl, token, buf, filename);
      const clean = url.trim().slice(0, 50_000);
      if (!clean) return null;
      logger.debug("easyimage uploaded after image generate", { entityId: entityId.slice(0, 8), filename });
      return clean;
    } catch (e) {
      logger.warn("easyimage upload after generate failed (local file kept)", {
        entityId: entityId.slice(0, 8),
        filename,
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  } catch (e) {
    logger.warn("easyimage after-generate skipped (unexpected error)", {
      entityId: String(entityId ?? "").slice(0, 8),
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
