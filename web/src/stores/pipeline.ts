import { computed, nextTick, ref } from "vue";
import { defineStore } from "pinia";
import type { AssetItem, ModelApiCallSnapshot, StoryboardShot, VideoJob } from "../types";
import { alignBodiesToChapters, joinChapterScriptBodies } from "../scriptBlocks";
import { emptySceneRow, parseSceneTableMarkdown, serializeSceneTable, type ScriptSceneRow } from "../scriptSceneTable";
import { formatSseLogLine, parseSseData } from "../sseUtils";
import { matchedAssetsForVideoDisplay } from "../videoAssetMatch";
import { useProjectsStore } from "./projects";
import { useConfigStore } from "./config";
import { useUiStore } from "./ui";

type StageState = "idle" | "running" | "done" | "error";
type RoleState = "idle" | "running" | "passed" | "rejected" | "error";

const stageOrder = ["script", "assets", "storyboard", "video"] as const;
const stageLabels: Record<(typeof stageOrder)[number], string> = {
  script: "剧本",
  assets: "资产",
  storyboard: "分镜/生图",
  video: "视频",
};

export const usePipelineStore = defineStore("pipeline", () => {
  const projectsStore = useProjectsStore();
  const configStore = useConfigStore();
  const ui = useUiStore();

  // ─── Pipeline stage/role state ──────────────────────────────────────────────
  const stageState = ref<Record<(typeof stageOrder)[number], StageState>>({
    script: "idle",
    assets: "idle",
    storyboard: "idle",
    video: "idle",
  });
  const roleState = ref<
    Record<"script" | "assets" | "storyboard" | "image_batch" | "video_plan" | "director", RoleState>
  >({
    script: "idle",
    assets: "idle",
    storyboard: "idle",
    image_batch: "idle",
    video_plan: "idle",
    director: "idle",
  });
  const roleLabelMap: Record<string, keyof typeof roleState.value> = {
    script: "script",
    assets: "assets",
    storyboard: "storyboard",
    image_batch: "image_batch",
    video_plan: "video_plan",
  };
  const PIPELINE_STAGE_MARK_RE = /\[pipeline-stage\] (script|assets|storyboard|video) (start|done|error)\b/;

  function resetPipelineUiState() {
    stageState.value = { script: "idle", assets: "idle", storyboard: "idle", video: "idle" };
    roleState.value = {
      script: "idle",
      assets: "idle",
      storyboard: "idle",
      image_batch: "idle",
      video_plan: "idle",
      director: "idle",
    };
  }

  function replayPipelineStagesFromLog(pipelineLog: string[] | undefined): boolean {
    if (!pipelineLog?.length) return false;
    let any = false;
    for (const raw of pipelineLog) {
      if (PIPELINE_STAGE_MARK_RE.test(raw)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
    stageState.value = { script: "idle", assets: "idle", storyboard: "idle", video: "idle" };
    for (const raw of pipelineLog) {
      const m = raw.match(PIPELINE_STAGE_MARK_RE);
      if (!m) continue;
      const stName = m[1] as (typeof stageOrder)[number];
      const ev = m[2] as "start" | "done" | "error";
      if (stName in stageState.value) {
        stageState.value[stName] = ev === "start" ? "running" : ev;
      }
    }
    return true;
  }

  // ─── SSE connection ────────────────────────────────────────────────────────
  let es: EventSource | null = null;

  function closeEvents() {
    es?.close();
    es = null;
  }

  function sseUrlForProject(projectId: string): string {
    const path = `/api/projects/${projectId}/events`;
    if (!import.meta.env.DEV) return path;
    const origin = import.meta.env.VITE_API_SSE_ORIGIN?.replace(/\/$/, "");
    if (origin) return `${origin}${path}`;
    const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
    return `http://${host}:3710${path}`;
  }

  function subscribeEvents(id: string) {
    closeEvents();
    ui.logs = [];
    resetPipelineUiState();
    void projectsStore.refreshProject().then(() => {
      if (projectsStore.selectedId !== id) return;
      const p = projectsStore.selected;
      if (!p || p.id !== id) return;
      const replayed = replayPipelineStagesFromLog(p.pipelineLog);
      if (p.pipelineStatus === "running" && p.pipelineLog?.length) {
        for (const full of p.pipelineLog.slice(-40)) {
          ui.logs.push(full.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, ""));
        }
      } else if (p.pipelineStatus === "done" && !replayed) {
        for (const k of stageOrder) stageState.value[k] = "done";
      }
    });
    es = new EventSource(sseUrlForProject(id));
    es.onmessage = (ev) => {
      const data = parseSseData(ev.data);
      if (!data) return;
      const logLine = formatSseLogLine(data);
      if (logLine) {
        ui.logs.push(logLine);
        if (/剧本 Agent 第 \d+ 次生成/.test(logLine)) roleState.value.script = "running";
        if (/资产 Agent 第 \d+ 次生成/.test(logLine)) roleState.value.assets = "running";
        if (/分镜 Agent 第 \d+ 次生成/.test(logLine)) roleState.value.storyboard = "running";
        if (/生图 Agent 批次 第 \d+ 次/.test(logLine)) roleState.value.image_batch = "running";
        if (/视频 Agent：按导演意见修订入队计划/.test(logLine)) roleState.value.video_plan = "running";
      }
      if (data.type === "stage" && data.stage && data.status) {
        const s = data.stage as (typeof stageOrder)[number];
        if (s in stageState.value) {
          stageState.value[s] = data.status === "start" ? "running" : (data.status as StageState);
        }
        if (data.status === "error") {
          if (s === "script") roleState.value.script = "error";
          if (s === "assets") roleState.value.assets = "error";
          if (s === "storyboard") {
            roleState.value.storyboard = "error";
            roleState.value.image_batch = "error";
          }
          if (s === "video") roleState.value.video_plan = "error";
        }
      }
      if (data.type === "director") {
        roleState.value.director = data.approved ? "passed" : "rejected";
        if (data.step) {
          const mapped = roleLabelMap[data.step];
          if (mapped) roleState.value[mapped] = data.approved ? "passed" : "rejected";
        }
      }
      if (data.type === "job" && data.job) {
        const p = projectsStore.selected;
        if (p) {
          const idx = typeof data.index === "number" ? data.index : p.videoJobs.findIndex((j) => j.id === data.job!.id);
          if (idx >= 0) {
            const next = [...p.videoJobs];
            next[idx] = data.job;
            p.videoJobs = next;
          } else {
            p.videoJobs = [data.job, ...p.videoJobs];
          }
          if (data.job.kind === "image" && data.job.status === "done") {
            const shotIndex = data.job.shotIndex;
            void (async () => {
              await projectsStore.refreshProject();
              const proj = projectsStore.selected;
              if (proj != null && typeof shotIndex === "number") {
                const shot = proj.storyboards.find((x) => x.index === shotIndex);
                if (shot) projectsStore.bumpMediaCache(`shot-${shot.id}`);
              }
            })();
          }
        }
      }
      if (data.type === "complete" || data.type === "error") void projectsStore.refreshProject();
    };
  }

  // ─── Source chapter management ──────────────────────────────────────────────
  const sourceChapters = ref<Array<{ title: string; content: string }>>([]);
  const novelTitle = ref("");
  const novelAuthor = ref("");
  const selectedSourceChapterIdx = ref(0);
  const syncingSourceFromChapters = ref(false);
  const skipRebuildSourceChaptersOnce = ref(false);

  function splitSourceToChapters(text: string): Array<{ title: string; content: string }> {
    const raw = (text || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return [{ title: "第1章", content: "" }];
    const lines = raw.split("\n");
    const chapterCnRe =
      /^\s*第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节回集卷篇幕](?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
    const chapterEnRe = /^\s*chapter\s*[\divxlcdm]+(?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
    const specialRe = /^\s*(序章|楔子|前言|引子|终章|尾声|后记|番外|完结感言)(?:\s*[:：.\-—_、，,\]\)）】\s].*)?\s*$/i;
    const stripPrefix = (line: string) => {
      return (line || "")
        .trim()
        .replace(/^[\s【\[\(（]?\s*[☆★◇◆■●◎○※＊*•\-–—_]+\s*[、.．·:：]\s*/u, "")
        .replace(/^[\s【\[\(（]?\s*\d+\s*[、.．·:：]\s*/u, "")
        .replace(/^[\s【\[\(（]?\s*[（(]?\s*\d+\s*[)）]\s*[、.．·:：]?\s*/u, "")
        .trim();
    };
    const isChapterTitle = (line: string) => {
      const t = stripPrefix(line);
      if (!t || t.length > 80) return false;
      return chapterCnRe.test(t) || chapterEnRe.test(t) || specialRe.test(t);
    };
    const out: Array<{ title: string; content: string }> = [];
    let cur: { title: string; contentLines: string[] } | null = null;
    for (const line of lines) {
      const t = stripPrefix(line);
      const likelyTitle = isChapterTitle(line);
      if (likelyTitle) {
        if (cur) out.push({ title: cur.title, content: cur.contentLines.join("\n").trim() });
        cur = { title: t, contentLines: [] };
      } else {
        if (!cur) cur = { title: "第1章", contentLines: [] };
        cur.contentLines.push(line);
      }
    }
    if (cur) out.push({ title: cur.title, content: cur.contentLines.join("\n").trim() });
    if (out.length > 1 && !isChapterTitle(out[0]!.title) && out[0]!.title === "第1章") {
      out[0]!.title = "序章";
    }
    return out.length ? out : [{ title: "第1章", content: raw }];
  }

  function parseNovelMetaAndBody(rawText: string): { title: string; author: string; body: string } {
    const raw = String(rawText ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!raw) return { title: "", author: "", body: "" };
    const lines = raw.split("\n");
    let title = "";
    let author = "";
    let startIdx = 0;
    const takeLineValue = (line: string) => {
      const s = line.replace(/^[\s\-–—•*#]+/, "").trim();
      const m = s.match(/^(书名|作品名|小说名|标题)\s*[:：]\s*(.+)$/);
      if (m && !title) title = m[2]!.trim();
      const a = s.match(/^(作者|Author)\s*[:：]\s*(.+)$/i);
      if (a && !author) author = a[2]!.trim();
      const t = s.match(/^《([^》]{1,80})》/);
      if (t && !title) title = t[1]!.trim();
    };
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const l = lines[i] ?? "";
      if (!l.trim()) continue;
      takeLineValue(l);
    }
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
    return { title, author, body: lines.slice(startIdx).join("\n").trim() };
  }

  function rebuildSourceChaptersFromSelected() {
    const p = projectsStore.selected;
    if (!p) {
      sourceChapters.value = [];
      return;
    }
    const parsed = parseNovelMetaAndBody(p.sourceText);
    novelTitle.value = parsed.title;
    novelAuthor.value = parsed.author;
    sourceChapters.value = splitSourceToChapters(parsed.body);
    selectedSourceChapterIdx.value = 0;
  }

  function applyChaptersToSourceText() {
    const p = projectsStore.selected;
    if (!p) return;
    skipRebuildSourceChaptersOnce.value = true;
    syncingSourceFromChapters.value = true;
    const headerLines = [
      novelTitle.value.trim() ? `书名：${novelTitle.value.trim()}` : "",
      novelAuthor.value.trim() ? `作者：${novelAuthor.value.trim()}` : "",
    ].filter(Boolean);
    const header = headerLines.length ? `${headerLines.join("\n")}\n\n` : "";
    p.sourceText =
      header +
      sourceChapters.value
        .map((c) => `${(c.title || "").trim()}\n${(c.content || "").trim()}`.trim())
        .filter(Boolean)
        .join("\n\n");
    syncingSourceFromChapters.value = false;
  }

  function addSourceChapter() {
    sourceChapters.value.push({ title: `第${sourceChapters.value.length + 1}章`, content: "" });
    applyChaptersToSourceText();
    selectedSourceChapterIdx.value = Math.max(0, sourceChapters.value.length - 1);
  }

  async function importNovelTxt(file: File) {
    const p = projectsStore.selected;
    if (!p) return;
    const text = await file.text();
    const parsed = parseNovelMetaAndBody(text);
    novelTitle.value = parsed.title;
    novelAuthor.value = parsed.author;
    sourceChapters.value = splitSourceToChapters(parsed.body);
    applyChaptersToSourceText();
    if (!p.name?.trim() && parsed.title.trim()) {
      p.name = parsed.title.trim().slice(0, 200);
    }
  }

  function splitChapter(index: number) {
    const item = sourceChapters.value[index];
    if (!item) return;
    const content = (item.content || "").replace(/\r\n/g, "\n");
    const markerRe = /(?:^|\n)\s*(第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节回集卷篇幕].*)/;
    const m = markerRe.exec(content);
    let left: string;
    let rightTitle: string;
    let right: string;
    if (m && m.index > 0) {
      left = content.slice(0, m.index).trim();
      const tail = content.slice(m.index).replace(/^\n+/, "");
      const lines = tail.split("\n");
      rightTitle = (lines[0] || "").trim() || `${item.title}（下）`;
      right = lines.slice(1).join("\n").trim();
    } else {
      const splitAt = content.indexOf("\n\n");
      if (splitAt <= 0) {
        ui.showToast("未找到可拆分位置（可先在章节内容中加入空行或下一章标题）", "error");
        return;
      }
      left = content.slice(0, splitAt).trim();
      right = content.slice(splitAt + 2).trim();
      rightTitle = `${item.title}（下）`;
    }
    if (!left || !right) {
      ui.showToast("拆分失败：拆分后章节内容为空", "error");
      return;
    }
    sourceChapters.value.splice(
      index,
      1,
      { title: item.title || `第${index + 1}章`, content: left },
      { title: rightTitle || `第${index + 2}章`, content: right },
    );
    applyChaptersToSourceText();
  }

  function mergeWithNextChapter(index: number) {
    const cur = sourceChapters.value[index];
    const next = sourceChapters.value[index + 1];
    if (!cur || !next) return;
    const merged =
      `${(cur.content || "").trim()}\n\n${(next.title || "").trim()}\n${(next.content || "").trim()}`.trim();
    sourceChapters.value.splice(index, 2, { title: cur.title, content: merged });
    applyChaptersToSourceText();
  }

  function insertSourceChapterAt(index: number) {
    const insertAt = Math.max(0, Math.min(index, sourceChapters.value.length));
    sourceChapters.value.splice(insertAt, 0, { title: `第${insertAt + 1}章`, content: "" });
    selectedSourceChapterIdx.value = insertAt;
    applyChaptersToSourceText();
  }

  function promptEditSourceChapterTitle(index: number) {
    const item = sourceChapters.value[index];
    if (!item) return;
    const next = window.prompt("编辑章节标题", (item.title || `第${index + 1}章`).trim());
    if (next === null) return;
    item.title = next.trim() || `第${index + 1}章`;
    selectedSourceChapterIdx.value = index;
    applyChaptersToSourceText();
  }

  function deleteSourceChapter(index: number) {
    const item = sourceChapters.value[index];
    if (!item) return;
    const name = (item.title || `第${index + 1}章`).trim();
    if (!window.confirm(`确认删除「${name}」？此操作不可撤销。`)) return;
    sourceChapters.value.splice(index, 1);
    selectedSourceChapterIdx.value = Math.max(0, Math.min(index, sourceChapters.value.length - 1));
    applyChaptersToSourceText();
  }

  // ─── Script chapter/table management ───────────────────────────────────────
  const selectedScriptChapterIdx = ref(0);
  const scriptChapterBodies = ref<string[]>([]);
  const scriptTableMode = ref<"table" | "raw">("raw");
  const scriptTablePrefix = ref("");
  const scriptTableRows = ref<ScriptSceneRow[]>([emptySceneRow()]);
  let scriptTableHydrating = false;
  let scriptTableCommitTimer: ReturnType<typeof setTimeout> | undefined;

  const scriptPipelineChapters = computed(() => {
    const p = projectsStore.selected;
    if (!p) return [];
    const fromSourceEditor = sourceChapters.value.filter((c) => c.content.trim());
    if (fromSourceEditor.length) return fromSourceEditor;
    const parsed = parseNovelMetaAndBody(p.sourceText);
    return splitSourceToChapters(parsed.body).filter((c) => c.content.trim());
  });

  const scriptChapterTitles = computed(() =>
    scriptPipelineChapters.value.map((c, i) => (c.title || "").trim() || `第${i + 1}章`),
  );

  const currentScriptBody = computed({
    get() {
      const i = selectedScriptChapterIdx.value;
      return scriptChapterBodies.value[i] ?? "";
    },
    set(v: string) {
      const p = projectsStore.selected;
      const titles = scriptChapterTitles.value;
      if (!p || !titles.length) return;
      const idx = selectedScriptChapterIdx.value;
      const next = [...scriptChapterBodies.value];
      while (next.length < titles.length) next.push("");
      next[idx] = v;
      scriptChapterBodies.value = next;
      p.script = joinChapterScriptBodies(titles, next);
    },
  });

  function applyChapterBodyAtIndex(idx: number, body: string) {
    const p = projectsStore.selected;
    const titles = scriptChapterTitles.value;
    if (!p || !titles.length) return;
    const next = [...scriptChapterBodies.value];
    while (next.length < titles.length) next.push("");
    next[idx] = body;
    scriptChapterBodies.value = next;
    p.script = joinChapterScriptBodies(titles, next);
  }

  function commitScriptTableNow() {
    if (scriptTableHydrating || scriptTableMode.value !== "table") return;
    const i = selectedScriptChapterIdx.value;
    const body = serializeSceneTable(scriptTablePrefix.value, scriptTableRows.value);
    applyChapterBodyAtIndex(i, body);
  }

  function scheduleScriptTableCommit() {
    if (scriptTableHydrating || scriptTableMode.value !== "table") return;
    clearTimeout(scriptTableCommitTimer);
    scriptTableCommitTimer = setTimeout(() => {
      scriptTableCommitTimer = undefined;
      commitScriptTableNow();
    }, 400);
  }

  function flushScriptTableToChapter(idx: number) {
    if (scriptTableMode.value !== "table") return;
    const body = serializeSceneTable(scriptTablePrefix.value, scriptTableRows.value);
    applyChapterBodyAtIndex(idx, body);
  }

  function loadScriptTableForChapter(i: number) {
    scriptTableHydrating = true;
    clearTimeout(scriptTableCommitTimer);
    scriptTableCommitTimer = undefined;
    try {
      const body = scriptChapterBodies.value[i] ?? "";
      const parsed = parseSceneTableMarkdown(body);
      if (parsed) {
        scriptTablePrefix.value = parsed.prefix.replace(/\n+\s*$/, "").trim();
        scriptTableRows.value = parsed.rows.length > 0 ? parsed.rows.map((r) => ({ ...r })) : [emptySceneRow()];
        scriptTableMode.value = "table";
      } else {
        scriptTableMode.value = "raw";
      }
    } finally {
      void nextTick(() => {
        scriptTableHydrating = false;
      });
    }
  }

  function switchScriptToRawView() {
    flushScriptTableToChapter(selectedScriptChapterIdx.value);
    scriptTableMode.value = "raw";
  }

  function switchScriptToTableView() {
    const i = selectedScriptChapterIdx.value;
    const body = scriptChapterBodies.value[i] ?? "";
    const parsed = parseSceneTableMarkdown(body);
    if (parsed) {
      scriptTablePrefix.value = parsed.prefix.replace(/\n+\s*$/, "").trim();
      scriptTableRows.value = parsed.rows.length > 0 ? parsed.rows.map((r) => ({ ...r })) : [emptySceneRow()];
    } else {
      scriptTablePrefix.value = body.trim();
      scriptTableRows.value = [emptySceneRow()];
    }
    scriptTableMode.value = "table";
    commitScriptTableNow();
  }

  function addScriptSceneRow() {
    const n = scriptTableRows.value.length + 1;
    scriptTableRows.value = [...scriptTableRows.value, { ...emptySceneRow(), sceneNo: String(n) }];
    scheduleScriptTableCommit();
  }

  function removeScriptSceneRow(ri: number) {
    const next = scriptTableRows.value.filter((_, j) => j !== ri);
    scriptTableRows.value = next.length ? next : [emptySceneRow()];
    scheduleScriptTableCommit();
  }

  function insertScriptSceneRowAt(index: number) {
    const at = Math.max(0, Math.min(index, scriptTableRows.value.length));
    const next = [...scriptTableRows.value];
    next.splice(at, 0, { ...emptySceneRow(), sceneNo: String(at + 1) });
    scriptTableRows.value = next;
    scheduleScriptTableCommit();
  }

  // Rebuild script chapters from project data
  function rebuildScriptChapters() {
    const p = projectsStore.selected;
    const list = scriptPipelineChapters.value;
    const titles = scriptChapterTitles.value;
    if (!p || !list.length) {
      scriptChapterBodies.value = [];
      selectedScriptChapterIdx.value = 0;
      scriptTableMode.value = "raw";
      return;
    }
    const alignedBodies = alignBodiesToChapters(p.script, titles);
    scriptChapterBodies.value = alignedBodies;
    const normalized = joinChapterScriptBodies(titles, alignedBodies);
    if ((p.script || "").trim() !== normalized.trim()) {
      p.script = normalized;
    }
    if (selectedScriptChapterIdx.value >= list.length) {
      selectedScriptChapterIdx.value = list.length - 1;
    }
    loadScriptTableForChapter(selectedScriptChapterIdx.value);
  }

  // ─── Storyboard state ─────────────────────────────────────────────────────
  const storyboardProMode = ref(true);
  const storyboardRefChapterIdx = ref(0);
  const storyboardSceneSoloEditId = ref<string | null>(null);
  const selectedStoryboardIds = ref<string[]>([]);
  const collapsedSceneRunHeadIds = ref(new Set<string>());
  const generatingShotIds = ref<string[]>([]);
  const generatingBatch = ref(false);
  const imageUrlCacheBustOverride = ref<Record<string, number>>({});

  // Shot image variants
  const shotImageVariantsMap = ref<Record<string, string[]>>({});
  let shotImageVariantsFetchTimer: ReturnType<typeof setTimeout> | null = null;
  const lastShotVariantsJsonByProject: Record<string, string> = {};

  async function fetchShotImageVariants(projectId: string) {
    try {
      const r = await fetch(`/api/projects/${projectId}/shot-image-variants`);
      if (!r.ok) return;
      const body = (await r.json()) as { variants?: Record<string, string[]> };
      if (!body.variants || typeof body.variants !== "object") return;
      const json = JSON.stringify(body.variants);
      if (lastShotVariantsJsonByProject[projectId] === json) return;
      lastShotVariantsJsonByProject[projectId] = json;
      shotImageVariantsMap.value = body.variants;
    } catch {
      /* ignore */
    }
  }

  function scheduleShotImageVariantsFetch(projectId: string) {
    if (projectsStore.selectedId !== projectId || ui.activeMenu !== "storyboard") return;
    if (shotImageVariantsFetchTimer) clearTimeout(shotImageVariantsFetchTimer);
    shotImageVariantsFetchTimer = setTimeout(() => {
      shotImageVariantsFetchTimer = null;
      void fetchShotImageVariants(projectId);
    }, 250);
  }

  function shotImageVariantsForShot(s: StoryboardShot): string[] {
    const fromMap = shotImageVariantsMap.value[s.id];
    if (fromMap?.length) return fromMap;
    return s.imageUrl?.trim() ? [s.imageUrl.trim()] : [];
  }

  async function adoptShotImageUrl(shot: StoryboardShot, url: string) {
    const p = projectsStore.selected;
    if (!p) return;
    if (storyboardImageUrlMatch(shot.imageUrl, url)) return;
    shot.imageUrl = url.trim();
    shot.remoteImageUrl = undefined;
    projectsStore.bumpMediaCache(`shot-${shot.id}`);
    delete lastShotVariantsJsonByProject[p.id];
    await projectsStore.savePatch({ storyboards: p.storyboards });
    scheduleShotImageVariantsFetch(p.id);
  }

  function storyboardImageUrlMatch(current: string | undefined, candidate: string) {
    const a = current?.trim().split("?")[0] ?? "";
    const b = candidate.trim().split("?")[0];
    return Boolean(a && b && a === b);
  }

  // Video shot management
  const selectedVideoShotIds = ref<string[]>([]);
  const selectedAssetIds = ref<string[]>([]);
  const videoBatchBusy = ref(false);
  const runningSingleVideoShotIds = ref<string[]>([]);
  const publishingEasyImageShotIds = ref<string[]>([]);

  // Computed: video aggregate assets from config
  const videoAggregateAssets = computed(() => Boolean(configStore.cfgDraft.video?.aggregateAssets ?? true));

  function storyboardShotVideoAssetMatch(shot: StoryboardShot) {
    const p = projectsStore.selected;
    if (!p) return { list: [] as AssetItem[], isFallback: false, extraIdSet: new Set<string>() };
    return matchedAssetsForVideoDisplay(shot, p.assets, videoAggregateAssets.value);
  }

  // ─── Video jobs ────────────────────────────────────────────────────────────
  const videoJobStats = computed(() => {
    const p = projectsStore.selected;
    if (!p) return { queued: 0, running: 0, failed: 0, done: 0 };
    const jobs = p.videoJobs;
    const out = { queued: 0, running: 0, failed: 0, done: 0 };
    for (const j of jobs) {
      if (j.status === "queued") out.queued++;
      else if (j.status === "running") out.running++;
      else if (j.status === "failed") out.failed++;
      else if (j.status === "done") out.done++;
    }
    return out;
  });

  function latestVideoJobByShotIndex(shotIndex: number) {
    const p = projectsStore.selected;
    if (!p) return undefined;
    for (let i = p.videoJobs.length - 1; i >= 0; i--) {
      const j = p.videoJobs[i]!;
      if ((j.kind ?? "video") === "video" && j.shotIndex === shotIndex) return j;
    }
    return undefined;
  }

  function videoJobsForShotIndex(shotIndex: number) {
    const p = projectsStore.selected;
    if (!p) return [];
    const out: VideoJob[] = [];
    for (let i = p.videoJobs.length - 1; i >= 0; i--) {
      const j = p.videoJobs[i]!;
      if ((j.kind ?? "video") === "video" && j.shotIndex === shotIndex) out.push(j);
    }
    return out;
  }

  function imageJobsForShotIndex(shotIndex: number) {
    const p = projectsStore.selected;
    if (!p) return [];
    // 找出该镜头所有的生图任务
    const shotImageJobs = p.videoJobs.filter(
      (j) => j.kind === "image" && j.shotIndex === shotIndex,
    );
    if (!shotImageJobs.length) return [];

    // 若有处于排队或执行中的任务，展示进行中的任务
    const activeJobs = shotImageJobs.filter(
      (j) => j.status === "queued" || j.status === "running",
    );
    if (activeJobs.length > 0) {
      return activeJobs;
    }

    // 若无进行中任务，取最新一条生图任务
    const latest = shotImageJobs[shotImageJobs.length - 1]!;
    // 若最新一条生图任务失败，展示报错信息（用户可点右上角 ✕ 随时手动消除）
    if (latest.status === "failed") {
      return [latest];
    }

    return [];
  }

  function dismissJob(jobId: string) {
    const p = projectsStore.selected;
    if (!p) return;
    p.videoJobs = p.videoJobs.filter((j) => j.id !== jobId);
    void projectsStore.savePatch({ videoJobs: p.videoJobs });
  }

  function formatModelApiCallJson(m: ModelApiCallSnapshot | undefined) {
    if (!m) return "";
    try {
      return JSON.stringify(m, null, 2);
    } catch {
      return String(m);
    }
  }

  function isLikelyVideoResultUrl(url: string) {
    return /\.(mp4|webm|ogg)(\?|$)/i.test(url.trim());
  }

  // ─── Video lightbox ────────────────────────────────────────────────────────
  const centerVideoUrl = ref<string | null>(null);

  function openCenterVideoPlay(url: string | undefined | null) {
    const u = url?.trim();
    if (!u || !isLikelyVideoResultUrl(u)) return;
    centerVideoUrl.value = u;
    void nextTick(() => {
      const el = document.querySelector(".video-lightbox-video") as HTMLVideoElement | null;
      el?.play()?.catch(() => {});
    });
  }

  function closeCenterVideoPlay() {
    const el = document.querySelector(".video-lightbox-video") as HTMLVideoElement | null;
    el?.pause();
    centerVideoUrl.value = null;
  }

  // ─── Image preview ─────────────────────────────────────────────────────────
  const previewImageUrl = ref<string | null>(null);
  const previewScale = ref(1);
  const previewOffsetX = ref(0);
  const previewOffsetY = ref(0);
  const previewDragging = ref(false);
  const previewDragStartX = ref(0);
  const previewDragStartY = ref(0);

  function openImagePreview(url?: string) {
    if (!url) return;
    previewImageUrl.value = url;
    previewScale.value = 1;
    previewOffsetX.value = 0;
    previewOffsetY.value = 0;
  }

  function closeImagePreview() {
    previewImageUrl.value = null;
    previewScale.value = 1;
    previewOffsetX.value = 0;
    previewOffsetY.value = 0;
    previewDragging.value = false;
  }

  function onPreviewWheel(ev: WheelEvent) {
    const step = ev.deltaY < 0 ? 0.1 : -0.1;
    const next = Math.min(5, Math.max(0.2, Number((previewScale.value + step).toFixed(2))));
    previewScale.value = next;
  }

  function onPreviewMouseDown(ev: MouseEvent) {
    if (ev.button !== 0) return;
    previewDragging.value = true;
    previewDragStartX.value = ev.clientX - previewOffsetX.value;
    previewDragStartY.value = ev.clientY - previewOffsetY.value;
  }

  function onPreviewMouseMove(ev: MouseEvent) {
    if (!previewDragging.value) return;
    previewOffsetX.value = ev.clientX - previewDragStartX.value;
    previewOffsetY.value = ev.clientY - previewDragStartY.value;
  }

  function onPreviewMouseUp() {
    previewDragging.value = false;
  }

  // ─── Context menus ─────────────────────────────────────────────────────────
  const sourceChapterContextMenu = ref<{ visible: boolean; x: number; y: number; index: number }>({
    visible: false,
    x: 0,
    y: 0,
    index: -1,
  });
  const scriptSceneRowContextMenu = ref<{ visible: boolean; x: number; y: number; index: number }>({
    visible: false,
    x: 0,
    y: 0,
    index: -1,
  });
  const assetRowContextMenu = ref<{ visible: boolean; x: number; y: number; id: string | null }>({
    visible: false,
    x: 0,
    y: 0,
    id: null,
  });
  const storyboardRowContextMenu = ref<{
    visible: boolean;
    x: number;
    y: number;
    id: string | null;
    targetImageUrl?: string | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    id: null,
    targetImageUrl: null,
  });
  const videoRowContextMenu = ref<{ visible: boolean; x: number; y: number; id: string | null }>({
    visible: false,
    x: 0,
    y: 0,
    id: null,
  });

  function closeAllContextMenus() {
    if (sourceChapterContextMenu.value.visible) sourceChapterContextMenu.value.visible = false;
    if (scriptSceneRowContextMenu.value.visible) scriptSceneRowContextMenu.value.visible = false;
    if (assetRowContextMenu.value.visible) assetRowContextMenu.value.visible = false;
    if (storyboardRowContextMenu.value.visible) {
      storyboardRowContextMenu.value.visible = false;
      storyboardRowContextMenu.value.targetImageUrl = null;
    }
    if (videoRowContextMenu.value.visible) videoRowContextMenu.value.visible = false;
    closeVideoExtraAttachPopover();
  }

  // ─── Video extra attach popover ────────────────────────────────────────────
  type AssetFilterTab = "all" | AssetItem["type"];
  const videoExtraAttachPopover = ref<{ visible: boolean; shotId: string | null; x: number; y: number }>({
    visible: false,
    shotId: null,
    x: 0,
    y: 0,
  });
  const storyboardVideoExtraPicker = ref<Partial<Record<string, { tab: AssetFilterTab; query: string }>>>({});
  const VIDEO_EXTRA_POPOVER_W = 440;
  const VIDEO_EXTRA_POPOVER_H = 340;

  const videoExtraPopoverShot = computed(() => {
    const id = videoExtraAttachPopover.value.shotId;
    if (!id || !videoExtraAttachPopover.value.visible) return null;
    const p = projectsStore.selected;
    return p?.storyboards.find((s) => s.id === id) ?? null;
  });

  function closeVideoExtraAttachPopover() {
    const v = videoExtraAttachPopover.value;
    if (!v.visible && v.shotId == null) return;
    videoExtraAttachPopover.value = { visible: false, shotId: null, x: 0, y: 0 };
  }

  function toggleVideoExtraAttachPopover(shot: StoryboardShot, e: MouseEvent) {
    const cur = videoExtraAttachPopover.value;
    if (cur.visible && cur.shotId === shot.id) {
      closeVideoExtraAttachPopover();
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const popoverW = Math.min(VIDEO_EXTRA_POPOVER_W, window.innerWidth - 24);
    let x = r.left;
    let y = r.bottom + 6;

    // 若靠右会超出屏幕，优先与按钮右侧对齐
    if (x + popoverW > window.innerWidth - 12) {
      x = r.right - popoverW;
    }
    // 严格限制在视口横向可见范围内
    if (x + popoverW > window.innerWidth - 12) {
      x = window.innerWidth - popoverW - 12;
    }
    if (x < 12) {
      x = 12;
    }
    // 纵向检查：若底部超出视口，翻转到按钮上方
    if (y + VIDEO_EXTRA_POPOVER_H > window.innerHeight - 12) {
      y = Math.max(12, r.top - VIDEO_EXTRA_POPOVER_H - 6);
    }
    videoExtraAttachPopover.value = { visible: true, shotId: shot.id, x, y };
  }

  function openVideoExtraAttachPopoverAt(shot: StoryboardShot, targetX: number, targetY: number) {
    const popoverW = Math.min(VIDEO_EXTRA_POPOVER_W, window.innerWidth - 24);
    let x = targetX;
    let y = targetY + 6;

    if (x + popoverW > window.innerWidth - 12) {
      x = window.innerWidth - popoverW - 12;
    }
    if (x < 12) {
      x = 12;
    }
    if (y + VIDEO_EXTRA_POPOVER_H > window.innerHeight - 12) {
      y = Math.max(12, targetY - VIDEO_EXTRA_POPOVER_H - 6);
    }
    videoExtraAttachPopover.value = { visible: true, shotId: shot.id, x, y };
  }

  function getVideoExtraPickerTab(shotId: string): AssetFilterTab {
    return storyboardVideoExtraPicker.value[shotId]?.tab ?? "all";
  }

  function getVideoExtraPickerQuery(shotId: string): string {
    return storyboardVideoExtraPicker.value[shotId]?.query ?? "";
  }

  function setVideoExtraPickerTab(shotId: string, tab: AssetFilterTab) {
    const prev = storyboardVideoExtraPicker.value[shotId] ?? { tab: "all" as AssetFilterTab, query: "" };
    storyboardVideoExtraPicker.value = { ...storyboardVideoExtraPicker.value, [shotId]: { ...prev, tab } };
  }

  function setVideoExtraPickerQuery(shotId: string, query: string) {
    const prev = storyboardVideoExtraPicker.value[shotId] ?? { tab: "all" as AssetFilterTab, query: "" };
    storyboardVideoExtraPicker.value = { ...storyboardVideoExtraPicker.value, [shotId]: { ...prev, query } };
  }

  // ─── Storyboard video/image prompt modals ──────────────────────────────────
  const storyboardVideoModalVisible = ref(false);
  const storyboardVideoModalShotId = ref<string | null>(null);
  const storyboardVideoDraftPrompt = ref("");
  const storyboardVideoDefaultBase = ref("");
  const storyboardVideoEnrichedBase = ref("");
  const storyboardVideoDraftDuration = ref<number>(5);
  const storyboardVideoEnrichedPreview = ref("");
  const storyboardVideoTextPayloadPreview = ref("");
  const storyboardVideoPreviewMatched = ref<Array<{ id: string; name: string; type: string }>>([]);
  type StoryboardVideoPreviewSlot = {
    role: string;
    name: string;
    id?: string;
    assetType?: string;
    storageUrl: string;
    resolvedUrl: string | null;
    sendable: boolean;
    inApiPayload: boolean;
  };
  const storyboardVideoPreviewSlots = ref<StoryboardVideoPreviewSlot[]>([]);
  const storyboardVideoPreviewApiUrls = ref<string[]>([]);
  const storyboardVideoPreviewLoading = ref(false);
  const storyboardVideoDurationApiHint = ref("");

  const storyboardVideoModalShot = computed(() => {
    const p = projectsStore.selected;
    const id = storyboardVideoModalShotId.value;
    if (!p || !id) return null;
    return p.storyboards.find((s) => s.id === id) ?? null;
  });

  const storyboardImageModalVisible = ref(false);
  const storyboardImageModalShotId = ref<string | null>(null);
  const storyboardImageDraftPrompt = ref("");
  const storyboardImageDefaultBase = ref("");
  const storyboardImageEnrichedBase = ref("");
  const storyboardImageFullPreview = ref("");
  const storyboardImagePreviewMatched = ref<Array<{ id: string; name: string; type: string }>>([]);
  type StoryboardImagePreviewSlot = {
    role: string;
    name: string;
    id?: string;
    assetType?: string;
    storageUrl: string;
    resolvedUrl: string | null;
    resolvedUrlPreview: string | null;
    sendable: boolean;
    inApiPayload: boolean;
  };
  const storyboardImagePreviewSlots = ref<StoryboardImagePreviewSlot[]>([]);
  const storyboardImagePreviewApiUrls = ref<string[]>([]);
  const storyboardImagePreviewLoading = ref(false);

  const storyboardImageModalShot = computed(() => {
    const p = projectsStore.selected;
    const id = storyboardImageModalShotId.value;
    if (!p || !id) return null;
    return p.storyboards.find((s) => s.id === id) ?? null;
  });

  // ─── Pipeline range settings ───────────────────────────────────────────────
  const pipelineFrom = ref<(typeof stageOrder)[number]>("script");
  const pipelineTo = ref<(typeof stageOrder)[number]>("video");
  const pipelineAssetsGenInRun = ref(true);
  const pipelineStoryboardGenInRun = ref(true);

  function pipelineStageIndex(s: (typeof stageOrder)[number]): number {
    return stageOrder.indexOf(s);
  }

  const pipelineRangeCoversAssets = computed(() => {
    const a = pipelineStageIndex(pipelineFrom.value);
    const b = pipelineStageIndex(pipelineTo.value);
    const x = pipelineStageIndex("assets");
    return a <= x && x <= b;
  });

  const pipelineRangeCoversStoryboard = computed(() => {
    const a = pipelineStageIndex(pipelineFrom.value);
    const b = pipelineStageIndex(pipelineTo.value);
    const x = pipelineStageIndex("storyboard");
    return a <= x && x <= b;
  });

  function setPipelinePreset(from: (typeof stageOrder)[number], to: (typeof stageOrder)[number]) {
    pipelineFrom.value = from;
    pipelineTo.value = to;
  }

  // ─── Asset filter state ────────────────────────────────────────────────────
  type AssetFilterTabFull = "all" | AssetItem["type"];
  const ASSET_FILTER_TABS: { key: AssetFilterTabFull; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "character", label: "角色" },
    { key: "scene", label: "场景" },
    { key: "prop", label: "物品" },
    { key: "costume", label: "服装造型" },
    { key: "action_pose", label: "动作姿态" },
    { key: "fx", label: "特效" },
  ];
  const assetFilterTab = ref<AssetFilterTabFull>("all");
  const assetLibraryFilterTab = ref<AssetFilterTabFull>("all");
  const assetLibraryProjectIdFilter = ref("");
  const assetsJumpHighlightId = ref<string | null>(null);

  const filteredAssets = computed(() => {
    const p = projectsStore.selected;
    if (!p) return [];
    if (assetFilterTab.value === "all") return p.assets;
    return p.assets.filter((a) => a.type === assetFilterTab.value);
  });

  function assetCountForFilter(key: AssetFilterTabFull): number {
    const p = projectsStore.selected;
    if (!p) return 0;
    if (key === "all") return p.assets.length;
    return p.assets.filter((a) => a.type === key).length;
  }

  const assetLibraryProjectOptions = computed(() => {
    const map = new Map<string, { id: string; name: string; updatedAt: string }>();
    for (const a of projectsStore.assetLibrary) {
      if (!map.has(a.projectId)) {
        map.set(a.projectId, {
          id: a.projectId,
          name: a.projectName || "（未命名项目）",
          updatedAt: a.projectUpdatedAt || "",
        });
      }
    }
    return [...map.values()].sort((x, y) => {
      const t = y.updatedAt.localeCompare(x.updatedAt);
      if (t !== 0) return t;
      return x.name.localeCompare(y.name, "zh-CN");
    });
  });

  const assetLibraryAfterProjectFilter = computed(() => {
    const pid = assetLibraryProjectIdFilter.value.trim();
    if (!pid) return projectsStore.assetLibrary;
    return projectsStore.assetLibrary.filter((a) => a.projectId === pid);
  });

  const filteredAssetLibrary = computed(() => {
    const base = assetLibraryAfterProjectFilter.value;
    if (assetLibraryFilterTab.value === "all") return base;
    return base.filter((a) => a.type === assetLibraryFilterTab.value);
  });

  function assetLibraryCountForFilter(key: AssetFilterTabFull): number {
    const base = assetLibraryAfterProjectFilter.value;
    if (key === "all") return base.length;
    return base.filter((a) => a.type === key).length;
  }

  function parseCsvText(v: string): string[] {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function parseSceneNosText(v: string): number[] {
    const nums = v
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  function isAssetSelected(id: string) {
    return selectedAssetIds.value.includes(id);
  }

  function onAssetSelectedChange(id: string, ev: Event) {
    const checked = (ev.target as HTMLInputElement | null)?.checked === true;
    if (checked) {
      if (!selectedAssetIds.value.includes(id)) selectedAssetIds.value = [...selectedAssetIds.value, id];
      return;
    }
    selectedAssetIds.value = selectedAssetIds.value.filter((x) => x !== id);
  }

  function isVideoShotSelected(id: string) {
    return selectedVideoShotIds.value.includes(id);
  }

  function onVideoShotSelectedChange(id: string, ev: Event) {
    const checked = (ev.target as HTMLInputElement | null)?.checked === true;
    if (checked) {
      if (!selectedVideoShotIds.value.includes(id)) selectedVideoShotIds.value = [...selectedVideoShotIds.value, id];
      return;
    }
    selectedVideoShotIds.value = selectedVideoShotIds.value.filter((x) => x !== id);
  }

  function selectAllAssets() {
    if (!filteredAssets.value.length) return;
    selectedAssetIds.value = filteredAssets.value.map((a) => a.id);
  }

  function clearSelectedAssets() {
    selectedAssetIds.value = [];
  }

  function addAsset(type: AssetItem["type"]) {
    const p = projectsStore.selected;
    if (!p) return;
    const labelMap: Record<AssetItem["type"], string> = {
      character: "角色",
      scene: "场景",
      prop: "物品",
      costume: "服装造型",
      action_pose: "动作姿态",
      fx: "特效",
    };
    const next: AssetItem = {
      id: crypto.randomUUID(),
      index: p.assets.length + 1,
      type,
      name: `${labelMap[type]}资产 ${p.assets.length + 1}`,
      key: `${type}:${(labelMap[type] + (p.assets.length + 1)).toLowerCase()}`,
      stableId: Math.abs(
        Array.from(`${type}-${p.assets.length + 1}-${Date.now()}`).reduce(
          (acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0,
          0,
        ),
      ),
      prompt: "",
      aliases: [],
      sceneNos: [],
      note: "",
    };
    p.assets = [...p.assets, next];
  }

  function removeAsset(id: string) {
    const p = projectsStore.selected;
    if (!p) return;
    p.assets = p.assets.filter((a) => a.id !== id).map((a, idx) => ({ ...a, index: idx + 1 }));
    selectedAssetIds.value = selectedAssetIds.value.filter((x) => x !== id);
  }

  function assetTypeChipLabel(type: AssetItem["type"]): string {
    switch (type) {
      case "character":
        return "角色";
      case "scene":
        return "场景";
      case "prop":
        return "物品";
      case "costume":
        return "服装";
      case "action_pose":
        return "动作";
      case "fx":
        return "特效";
      default:
        return String(type);
    }
  }

  async function goToAssetFromStoryboard(assetId: string) {
    ui.activeSideTab = "projects";
    ui.activeMenu = "assets";
    assetFilterTab.value = "all";
    assetsJumpHighlightId.value = assetId;
    await nextTick();
    requestAnimationFrame(() => {
      document.getElementById(`asset-row-${assetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(() => {
      if (assetsJumpHighlightId.value === assetId) assetsJumpHighlightId.value = null;
    }, 2800);
  }

  async function copyAssetRefToken(assetId: string) {
    const token = `@${assetId}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
        ui.logs.push(`已复制资产引用：${token}`);
        return;
      }
    } catch {
      /* ignore */
    }
    window.prompt("复制资产引用", token);
  }

  // ─── Return ────────────────────────────────────────────────────────────────
  return {
    // Pipeline
    stageOrder,
    stageLabels,
    stageState,
    roleState,
    resetPipelineUiState,
    subscribeEvents,
    closeEvents,
    // Source chapters
    sourceChapters,
    novelTitle,
    novelAuthor,
    selectedSourceChapterIdx,
    syncingSourceFromChapters,
    skipRebuildSourceChaptersOnce,
    rebuildSourceChaptersFromSelected,
    applyChaptersToSourceText,
    addSourceChapter,
    importNovelTxt,
    splitChapter,
    mergeWithNextChapter,
    insertSourceChapterAt,
    promptEditSourceChapterTitle,
    deleteSourceChapter,
    // Script
    selectedScriptChapterIdx,
    scriptChapterBodies,
    scriptTableMode,
    scriptTablePrefix,
    scriptTableRows,
    scriptPipelineChapters,
    scriptChapterTitles,
    currentScriptBody,
    loadScriptTableForChapter,
    switchScriptToRawView,
    switchScriptToTableView,
    addScriptSceneRow,
    removeScriptSceneRow,
    insertScriptSceneRowAt,
    commitScriptTableNow,
    flushScriptTableToChapter,
    scheduleScriptTableCommit,
    rebuildScriptChapters,
    // Storyboard
    storyboardProMode,
    storyboardRefChapterIdx,
    storyboardSceneSoloEditId,
    selectedStoryboardIds,
    collapsedSceneRunHeadIds,
    generatingShotIds,
    generatingBatch,
    shotImageVariantsMap,
    fetchShotImageVariants,
    scheduleShotImageVariantsFetch,
    shotImageVariantsForShot,
    adoptShotImageUrl,
    storyboardImageUrlMatch,
    imageUrlCacheBustOverride,
    // Video
    selectedVideoShotIds,
    selectedAssetIds,
    videoBatchBusy,
    runningSingleVideoShotIds,
    publishingEasyImageShotIds,
    videoAggregateAssets,
    storyboardShotVideoAssetMatch,
    videoJobStats,
    latestVideoJobByShotIndex,
    videoJobsForShotIndex,
    imageJobsForShotIndex,
    dismissJob,
    dismissFailedImageJob: dismissJob,
    formatModelApiCallJson,
    isLikelyVideoResultUrl,
    // Lightbox
    centerVideoUrl,
    openCenterVideoPlay,
    closeCenterVideoPlay,
    // Image preview
    previewImageUrl,
    previewScale,
    previewOffsetX,
    previewOffsetY,
    previewDragging,
    openImagePreview,
    closeImagePreview,
    onPreviewWheel,
    onPreviewMouseDown,
    onPreviewMouseMove,
    onPreviewMouseUp,
    // Context menus
    sourceChapterContextMenu,
    scriptSceneRowContextMenu,
    assetRowContextMenu,
    storyboardRowContextMenu,
    videoRowContextMenu,
    closeAllContextMenus,
    // Video extra popover
    videoExtraAttachPopover,
    storyboardVideoExtraPicker,
    videoExtraPopoverShot,
    closeVideoExtraAttachPopover,
    toggleVideoExtraAttachPopover,
    openVideoExtraAttachPopoverAt,
    getVideoExtraPickerTab,
    getVideoExtraPickerQuery,
    setVideoExtraPickerTab,
    setVideoExtraPickerQuery,
    // Prompt modals
    storyboardVideoModalVisible,
    storyboardVideoModalShotId,
    storyboardVideoDraftPrompt,
    storyboardVideoDefaultBase,
    storyboardVideoEnrichedBase,
    storyboardVideoDraftDuration,
    storyboardVideoEnrichedPreview,
    storyboardVideoTextPayloadPreview,
    storyboardVideoPreviewMatched,
    storyboardVideoPreviewSlots,
    storyboardVideoPreviewApiUrls,
    storyboardVideoPreviewLoading,
    storyboardVideoDurationApiHint,
    storyboardVideoModalShot,
    storyboardImageModalVisible,
    storyboardImageModalShotId,
    storyboardImageDraftPrompt,
    storyboardImageDefaultBase,
    storyboardImageEnrichedBase,
    storyboardImageFullPreview,
    storyboardImagePreviewMatched,
    storyboardImagePreviewSlots,
    storyboardImagePreviewApiUrls,
    storyboardImagePreviewLoading,
    storyboardImageModalShot,
    // Pipeline range
    pipelineFrom,
    pipelineTo,
    pipelineAssetsGenInRun,
    pipelineStoryboardGenInRun,
    pipelineStageIndex,
    pipelineRangeCoversAssets,
    pipelineRangeCoversStoryboard,
    setPipelinePreset,
    // Asset filter
    ASSET_FILTER_TABS,
    assetFilterTab,
    assetLibraryFilterTab,
    assetLibraryProjectIdFilter,
    assetsJumpHighlightId,
    filteredAssets,
    assetCountForFilter,
    assetLibraryProjectOptions,
    assetLibraryAfterProjectFilter,
    filteredAssetLibrary,
    assetLibraryCountForFilter,
    parseCsvText,
    parseSceneNosText,
    isAssetSelected,
    onAssetSelectedChange,
    isVideoShotSelected,
    onVideoShotSelectedChange,
    selectAllAssets,
    clearSelectedAssets,
    addAsset,
    removeAsset,
    assetTypeChipLabel,
    goToAssetFromStoryboard,
    copyAssetRefToken,
  };
});
