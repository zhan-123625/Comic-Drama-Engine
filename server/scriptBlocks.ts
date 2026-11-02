export type ScriptBlock = { title: string; body: string };

/** 解析管线生成的「### 章节标题」块状剧本 */
export function splitScriptBlocks(script: string): ScriptBlock[] {
  const s = String(script ?? "").trim();
  if (!s) return [];
  const chunks = s
    .split(/\n(?=### )/)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: ScriptBlock[] = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^### (.+?)\n([\s\S]*)$/);
    if (m) out.push({ title: m[1]!.trim(), body: m[2]!.trim() });
  }
  return out;
}

/** 按章节标题顺序对齐正文（不含 ### 行）；匹配不到则为空串 */
export function alignBodiesToChapters(script: string, chapterTitles: string[]): string[] {
  const titles = chapterTitles.map((t, i) => t?.trim() || `第${i + 1}章`);
  const blocks = splitScriptBlocks(script);
  return titles.map((t, i) => {
    if (blocks[i]?.title === t) return blocks[i]!.body;
    const found = blocks.find((b) => b.title === t);
    return found?.body ?? "";
  });
}

export function joinChapterScriptBodies(titles: string[], bodies: string[]): string {
  const parts = titles.map((t, i) => {
    const title = t?.trim() || `第${i + 1}章`;
    const body = (bodies[i] ?? "").trim();
    return `### ${title}\n${body}`.trim();
  });
  return parts.join("\n\n");
}
