/** 与 server/textNormalize.ts 对齐：分镜等字段展示时把 &lt;br&gt; 等转为真实换行 */
export function normalizeHtmlishToPlainText(s: string): string {
  let t = String(s ?? "");
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/<\s*br\s*\/?>/gi, "\n");
  t = t.replace(/&lt;\s*br\s*\/?\s*&gt;/gi, "\n");
  t = t.replace(/&#(\d+);/g, (_, num) => {
    const c = Number(num);
    if (!Number.isFinite(c) || c < 0 || c > 0x10ffff) return _;
    if (c === 10 || c === 13) return "\n";
    if (c === 160) return " ";
    try {
      return String.fromCodePoint(c);
    } catch {
      return _;
    }
  });
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const c = parseInt(hex, 16);
    if (!Number.isFinite(c) || c < 0 || c > 0x10ffff) return _;
    if (c === 10 || c === 13) return "\n";
    try {
      return String.fromCodePoint(c);
    } catch {
      return _;
    }
  });
  t = t.replace(/&nbsp;/gi, " ");
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&amp;/g, "&");
  t = t.replace(/&lt;/g, "<");
  t = t.replace(/&gt;/g, ">");
  t = t.replace(/<\s*\/\s*p\s*>/gi, "\n");
  t = t.replace(/<\s*p\s*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
