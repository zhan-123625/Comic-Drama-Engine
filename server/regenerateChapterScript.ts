import { runScriptAgent } from "./agents/scriptAgent.js";
import { formatProjectMeta } from "./projectMeta.js";
import { splitSourceToChapters } from "./sourceChapters.js";
import { alignBodiesToChapters, joinChapterScriptBodies, splitScriptBlocks } from "./scriptBlocks.js";
import { sseSend } from "./sse.js";
import { store } from "./store.js";
import type { Project } from "./types.js";

const SCRIPT_PARSE_FAIL =
  "当前剧本无法按「### 章节标题」解析出各章正文。请使用管线生成过剧本，或手工整理为相同格式后再试。";

export async function regenerateScriptChapter(projectId: string, chapterIndex: number): Promise<Project> {
  const p = await store.get(projectId);
  if (!p) throw Object.assign(new Error("project not found"), { status: 404 as const });

  const chapters = splitSourceToChapters(p.sourceText).filter((c) => c.content.trim());
  if (!chapters.length) {
    throw Object.assign(new Error("未解析到有效章节，无法按章重生剧本"), { status: 400 as const });
  }
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= chapters.length) {
    throw Object.assign(new Error(`chapterIndex 须在 0～${chapters.length - 1} 之间`), { status: 400 as const });
  }

  const titles = chapters.map((c, i) => c.title?.trim() || `第${i + 1}章`);
  const scriptTrim = p.script.trim();
  const bodies = alignBodiesToChapters(p.script, titles);
  const parsedBlocks = splitScriptBlocks(p.script);
  const multi = chapters.length > 1;

  if (scriptTrim.length > 80 && bodies.every((b) => !b.trim())) {
    if (parsedBlocks.length === 0) {
      throw Object.assign(new Error(SCRIPT_PARSE_FAIL), { status: 400 as const });
    }
    if (multi) {
      throw Object.assign(
        new Error(
          "剧本中的「### 章节标题」与原文拆章标题对不上，无法在不丢失其他章的前提下替换单章。请对齐标题或重新用管线生成全剧剧本。",
        ),
        { status: 400 as const },
      );
    }
  }

  const ch = chapters[chapterIndex]!;
  const title = titles[chapterIndex]!;
  sseSend(projectId, {
    type: "log",
    message: `单章重生剧本：第 ${chapterIndex + 1}/${chapters.length} 章「${title.slice(0, 40)}」`,
  });

  const part = await runScriptAgent(
    {
      chapterTitle: title,
      chapterContent: `${formatProjectMeta(p)}${ch.content}`,
      outlineHint: "",
    },
    null,
  );

  const nextBodies = [...bodies];
  nextBodies[chapterIndex] = part;
  p.script = joinChapterScriptBodies(titles, nextBodies);
  await store.save(p);
  const refreshed = await store.get(projectId);
  return refreshed ?? p;
}
