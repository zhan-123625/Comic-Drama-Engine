/**
 * EasyImage 2.0：POST multipart，字段 token + image（与官方手册一致）。
 */
export async function uploadBufferToEasyImage(
  apiUrl: string,
  token: string,
  buf: Buffer,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("token", token);
  form.append("image", new Blob([new Uint8Array(buf)]), filename);
  const r = await fetch(apiUrl.trim(), { method: "POST", body: form });
  const text = await r.text();
  let j: { result?: string; code?: number; message?: string; url?: string };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new Error(`图床返回非 JSON：${text.slice(0, 240)}`);
  }
  if (j.result !== "success" || !j.url) {
    throw new Error(j.message || `图床上传失败（code ${j.code ?? "?"}）`);
  }
  return String(j.url).replace(/\\\//g, "/");
}
