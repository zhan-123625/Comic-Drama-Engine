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
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const res = await fetch(trimmed, { method: "GET" });
      if (!res.ok) return null;
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
 * 将多张参考图（URL 或 data URL）智能合成为单张多图参考展布（Composite Reference Board）。
 * - 0 张图：返回 undefined
 * - 1 张图：直接返回该图，不做额外处理
 * - 2 张及以上：按比例缩放并横向（或网格）平铺合成为单张 PNG Data URL，供仅支持单张 ref_img 的生图模型使用。
 */
export async function compositeReferenceImages(urls: string[]): Promise<string | undefined> {
  const validUrls = (urls || []).map((u) => u.trim()).filter(Boolean);
  if (!validUrls.length) return undefined;
  if (validUrls.length === 1) return validUrls[0];

  const loadedImages: Array<InstanceType<typeof Jimp>> = [];
  for (const u of validUrls) {
    try {
      const buf = await fetchImageBuffer(u);
      if (!buf) continue;
      const img = await Jimp.read(buf);
      loadedImages.push(img);
    } catch (e) {
      logger.warn("failed to decode image for reference composite", { err: String(e) });
    }
  }

  if (!loadedImages.length) return validUrls[0];
  if (loadedImages.length === 1) return validUrls[0];

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
