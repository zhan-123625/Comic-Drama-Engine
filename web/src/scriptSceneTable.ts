/** 与剧本 Agent / UI 约定的「场次」表结构（一章一表） */
export type ScriptSceneRow = {
  sceneNo: string;
  setting: string;
  /** 内/外景·时间·地点 */
  characters: string;
  action: string;
  dialogue: string;
  note: string;
  /** 对应本场次的原文摘录，便于核对 */
  sourceRef: string;
};

export const SCRIPT_SCENE_TABLE_HEADER =
  "| 场次 | 内/外景·时间·地点 | 人物 | 剧情与动作 | 台词/旁白 | 备注 | 原文对照 |";

export const SCRIPT_SCENE_TABLE_SEP =
  "|------|------------------|------|------------|----------|------|----------------|";

export function emptySceneRow(): ScriptSceneRow {
  return {
    sceneNo: "",
    setting: "",
    characters: "",
    action: "",
    dialogue: "",
    note: "",
    sourceRef: "",
  };
}

function splitTableRow(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith("|")) return [];
  const core = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  return core.split("|").map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^[\s\-:]{2,}$/.test(c));
}

function looksLikeSceneHeader(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  return /场次/.test(t) && (/人物|角色/.test(t) || /剧情|动作/.test(t));
}

function headerHasSourceRefColumn(headerLine: string): boolean {
  return /原文/.test(headerLine);
}

/** 解析一章剧本文本中的第一个场次 Markdown 表；失败返回 null（走源码编辑） */
export function parseSceneTableMarkdown(body: string): { prefix: string; rows: ScriptSceneRow[] } | null {
  const raw = String(body ?? "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const prefixLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("|") && looksLikeSceneHeader(line)) break;
    prefixLines.push(line);
    i++;
  }

  if (i >= lines.length) {
    const prefix = prefixLines.join("\n").trimEnd();
    return prefix ? { prefix: prefix + "\n\n", rows: [] } : null;
  }

  const headerLine = lines[i]!;
  if (!looksLikeSceneHeader(headerLine)) return null;
  const sourceCol = headerHasSourceRefColumn(headerLine);
  i++;
  const sepLine = lines[i];
  if (sepLine == null || !isSeparatorRow(sepLine)) return null;
  i++;

  const headerCells = splitTableRow(headerLine);
  if (headerCells.length < 6) return null;

  const rows: ScriptSceneRow[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith("|")) break;
    if (looksLikeSceneHeader(line) || isSeparatorRow(line)) break;
    const cells = splitTableRow(line);
    if (cells.length === 0) {
      i++;
      continue;
    }
    while (cells.length < 7) cells.push("");
    rows.push({
      sceneNo: cells[0] ?? "",
      setting: cells[1] ?? "",
      characters: cells[2] ?? "",
      action: cells[3] ?? "",
      dialogue: cells[4] ?? "",
      note: cells[5] ?? "",
      sourceRef: sourceCol ? (cells[6] ?? "") : "",
    });
    i++;
  }

  const prefix = prefixLines.join("\n").trimEnd();
  return { prefix: prefix ? prefix + "\n\n" : "", rows };
}

function escapeCell(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

export function serializeSceneTable(prefix: string, rows: ScriptSceneRow[]): string {
  const out: string[] = [];
  const p = String(prefix ?? "").trimEnd();
  if (p) {
    out.push(p);
    out.push("");
  }
  out.push(SCRIPT_SCENE_TABLE_HEADER);
  out.push(SCRIPT_SCENE_TABLE_SEP);
  for (const r of rows) {
    out.push(
      `| ${escapeCell(r.sceneNo)} | ${escapeCell(r.setting)} | ${escapeCell(r.characters)} | ${escapeCell(r.action)} | ${escapeCell(r.dialogue)} | ${escapeCell(r.note)} | ${escapeCell(r.sourceRef)} |`,
    );
  }
  return out.join("\n").trim();
}
