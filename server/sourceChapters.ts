export type SourceChapter = {
  title: string;
  content: string;
};

function stripPrefix(line: string): string {
  return (line || "")
    .trim()
    .replace(/^[\s【\[\(（]?\s*[☆★◇◆■●◎○※＊*•\-–—_]+\s*[、.．·:：]\s*/u, "")
    .replace(/^[\s【\[\(（]?\s*\d+\s*[、.．·:：]\s*/u, "")
    .replace(/^[\s【\[\(（]?\s*[（(]?\s*\d+\s*[)）]\s*[、.．·:：]?\s*/u, "")
    .trim();
}

function isChapterTitle(line: string): boolean {
  const t = stripPrefix(line);
  if (!t || t.length > 80) return false;
  const chapterCnRe =
    /^\s*第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节回集卷篇幕](?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
  const chapterEnRe = /^\s*chapter\s*[\divxlcdm]+(?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
  const specialRe = /^\s*(序章|楔子|前言|引子|终章|尾声|后记|番外|完结感言)(?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
  return chapterCnRe.test(t) || chapterEnRe.test(t) || specialRe.test(t);
}

export function splitSourceToChapters(text: string): SourceChapter[] {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let startIdx = 0;
  // 与前端一致：忽略开头元信息（书名/作者/《书名》），避免被误识别为“第1章/序章”。
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const l = (lines[i] ?? "").trim();
    if (!l) {
      startIdx = i + 1;
      continue;
    }
    if (/^(书名|作品名|小说名|标题|作者|Author)\s*[:：]/i.test(l) || /^《[^》]{1,80}》/.test(l)) {
      startIdx = i + 1;
      continue;
    }
    break;
  }
  const raw = lines.slice(startIdx).join("\n").trim();
  if (!raw) return [{ title: "第1章", content: "" }];
  const bodyLines = raw.split("\n");
  const out: SourceChapter[] = [];
  let cur: { title: string; contentLines: string[] } | null = null;
  for (const line of bodyLines) {
    const title = stripPrefix(line);
    if (isChapterTitle(line)) {
      if (cur) out.push({ title: cur.title, content: cur.contentLines.join("\n").trim() });
      cur = { title: title || "第1章", contentLines: [] };
    } else {
      if (!cur) cur = { title: "第1章", contentLines: [] };
      cur.contentLines.push(line);
    }
  }
  if (cur) out.push({ title: cur.title, content: cur.contentLines.join("\n").trim() });
  if (out.length > 1 && out[0]?.title === "第1章") out[0].title = "序章";
  return out.length ? out : [{ title: "第1章", content: raw }];
}
