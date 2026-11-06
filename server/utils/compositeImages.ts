import { Jimp } from "jimp";
import { logger } from "../logger.js";

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m || !m[2]) return null;
  return Buffer.from(m[2], "base64");
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) {
    return dataUrlToBuffer(trimmed);
  }
  const cleanPath = trimmed.split("?")[0]!.split("#")[0]!;
  if (cleanPath.startsWith("/api/files/")) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rel = cleanPath.replace(/^\/api\/files\//, "");
    const absPath = path.join(__dirname, "..", "..", "data", "files", rel);
    try {
      return await fs.readFile(absPath);
    } catch (e) {
      logger.warn("failed to read local image for composite", { absPath, err: String(e) });
      return null;
    }
  }
  const shotDbMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/image$/i);
  if (shotDbMatch) {
    try {
      const { getDb } = await import("../db.js");
      const row = getDb()
        .prepare(`SELECT image_blob FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`)
        .get(shotDbMatch[1], shotDbMatch[2]) as { image_blob: Buffer | Uint8Array | null } | undefined;
      if (row?.image_blob) {
        return Buffer.isBuffer(row.image_blob) ? row.image_blob : Buffer.from(row.image_blob);
      }
    } catch (e) {
      logger.warn("failed to read shot blob for composite", { err: String(e) });
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const res = await fetch(trimmed, {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        logger.warn("reference image remote URL returned non-200", { url: trimmed, status: res.status });
        return null;
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      logger.warn("failed to fetch reference image for composite", { url: trimmed, err: String(e) });
      return null;
    }
  }
  return null;
}

/**
 * 智能裁切资产设定表：
 * - 针对 16:9 / 宽画幅三视图（首图角色），提取左侧 4%~40% 的正面主立绘，避免并排的侧/背视图干扰生图模型；
 * - 针对宽画幅单品道具/服装（次图），提取居中 50% 核心实体，剥离无用白边。
 */
type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

export function cropHeroSubjectIfTurnaround(
  img: JimpImage,
  index: number,
): { img: JimpImage; cropped: boolean } {
  const aspect = img.width / img.height;
  if (aspect >= 1.4 && aspect <= 2.2) {
    const cropX = index === 0 ? Math.floor(img.width * 0.04) : Math.floor(img.width * 0.22);
    const cropW = index === 0 ? Math.floor(img.width * 0.36) : Math.floor(img.width * 0.56);
    const cropY = Math.floor(img.height * 0.04);
    const cropH = Math.floor(img.height * 0.92);
    try {
      return { img: img.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH }) as JimpImage, cropped: true };
    } catch {
      return { img, cropped: false };
    }
  }
  return { img, cropped: false };
}

/**
 * 将多张参考图（URL 或 data URL）智能合成为单张多图参考展布（Composite Reference Board）。
 * - 0 张图或全部失效：返回 undefined
 * - 1 张图：转换为稳定的 Data URL 或返回原有效图（若为三视图则自动裁切为单体正面立绘）
 * - 2 张及以上：按比例缩放并横向（或网格）平铺合成为单张 PNG Data URL，供生图模型使用。
 */
export async function compositeReferenceImages(urls: string[]): Promise<string | undefined> {
  const validUrls = (urls || []).map((u) => u.trim()).filter(Boolean);
  if (!validUrls.length) return undefined;

  let anyCropped = false;
  const loadedImages: JimpImage[] = [];
  for (let idx = 0; idx < validUrls.length; idx++) {
    const u = validUrls[idx]!;
    try {
      const buf = await fetchImageBuffer(u);
      if (!buf) continue;
      const img = await Jimp.read(buf);
      const { img: cleaned, cropped } = cropHeroSubjectIfTurnaround(img, idx);
      if (cropped) anyCropped = true;
      loadedImages.push(cleaned);
    } catch (e) {
      logger.warn("failed to decode image for reference composite", { err: String(e) });
    }
  }

  if (!loadedImages.length) {
    logger.warn("none of the reference image URLs could be loaded/decoded", { count: validUrls.length });
    return undefined;
  }
  if (loadedImages.length === 1) {
    if (validUrls[0]?.startsWith("data:") && !anyCropped) return validUrls[0];
    try {
      return await loadedImages[0]!.getBase64("image/png");
    } catch {
      return validUrls[0];
    }
  }

  try {
    const targetH = 512;
    for (const img of loadedImages) {
      img.resize({ h: targetH });
    }

    const spacing = 16;
    if (loadedImages.length <= 3) {
      // 横向平铺并排
      const totalW = loadedImages.reduce((sum, img) => sum + img.width, 0) + spacing * (loadedImages.length - 1);
      const canvas = new Jimp({ width: totalW, height: targetH, color: 0xffffffff });
      let currentX = 0;
      for (const img of loadedImages) {
        canvas.composite(img, currentX, 0);
        currentX += img.width + spacing;
      }
      return await canvas.getBase64("image/png");
    } else {
      // 4 张及以上采用 2x2 网格
      const imgW = Math.max(...loadedImages.map((i) => i.width));
      const gridW = imgW * 2 + spacing;
      const gridH = targetH * 2 + spacing;
      const canvas = new Jimp({ width: gridW, height: gridH, color: 0xffffffff });
      for (let i = 0; i < Math.min(4, loadedImages.length); i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col * (imgW + spacing);
        const y = row * (targetH + spacing);
        canvas.composite(loadedImages[i]!, x, y);
      }
      return await canvas.getBase64("image/png");
    }
  } catch (err) {
    logger.warn("failed to composite reference images, falling back to first image", { err: String(err) });
    return validUrls[0];
  }
}
