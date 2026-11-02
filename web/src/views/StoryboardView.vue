<script setup lang="ts">
import { computed } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useConfigStore } from "../stores/config";
import { useUiStore } from "../stores/ui";
import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "../constants";
import type { StoryboardShot, VideoRunMode } from "../types";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const cfg = useConfigStore();
const ui = useUiStore();

const VIDEO_EXTRA_POPOVER_W = 400;

const shotSizePresets = ["远景", "全景", "中景", "近景", "特写", "大特写"];
const cameraPresets = ["固定", "推", "拉", "摇", "移", "跟拍", "航拍", "手持", "甩"];

const storyboardVisibleRows = computed(() => {
  const p = projectsStore.selected;
  if (!p) return [];
  const shots = p.storyboards;
  const collapsed = pipeline.collapsedSceneRunHeadIds;
  const out: { shot: StoryboardShot; idx: number }[] = [];
  let i = 0;
  while (i < shots.length) {
    const s = shots[i]!;
    const head = isSceneRunHead(i);
    out.push({ shot: s, idx: i });
    if (head && collapsed.has(s.id)) {
      const runLen = sceneRunLengthFromHead(i);
      i += runLen;
    } else {
      i++;
    }
  }
  return out;
});

const storyboardPageStats = computed(() => {
  const p = projectsStore.selected;
  if (!p) return { total: 0, singleSceneNos: [] as number[], filledDurationCount: 0, totalDurationRounded: 0 };
  const shots = p.storyboards;
  const total = shots.length;
  const sceneCountMap = new Map<number, number>();
  let filledDurationCount = 0;
  let totalDuration = 0;
  for (const s of shots) {
    if (typeof s.sceneNo === "number" && s.sceneNo > 0) {
      sceneCountMap.set(s.sceneNo, (sceneCountMap.get(s.sceneNo) ?? 0) + 1);
    }
    if (typeof s.durationSec === "number" && s.durationSec > 0) {
      filledDurationCount++;
      totalDuration += s.durationSec;
    }
  }
  const singleSceneNos: number[] = [];
  for (const [no, count] of sceneCountMap) {
    if (count === 1) singleSceneNos.push(no);
  }
  singleSceneNos.sort((a, b) => a - b);
  return { total, singleSceneNos, filledDurationCount, totalDurationRounded: Math.round(totalDuration) };
});

const storyboardVideoModelCapabilityLine = computed(() => {
  const v = cfg.cfgDraft.video;
  if (!v?.model?.trim()) return "";
  const list = cfg.volcPresets?.video;
  const hit =
    list?.find((p) => p.id === v.volcVideoPresetId) ??
    list?.find((p) => p.model.toLowerCase() === v.model.trim().toLowerCase());
  if (!hit) return "";
  return hit.modesLabel;
});

// ─── Scene run helpers ────────────────────────────────────────────────
function isSceneRunHead(idx: number): boolean {
  const p = projectsStore.selected;
  if (!p) return false;
  const shots = p.storyboards;
  if (idx <= 0) return true;
  const cur = shots[idx];
  const prev = shots[idx - 1];
  if (!cur || !prev) return true;
  if (typeof cur.sceneNo !== "number" || typeof prev.sceneNo !== "number") return true;
  return cur.sceneNo !== prev.sceneNo;
}

function sceneRunLengthFromHead(headIdx: number): number {
  const p = projectsStore.selected;
  if (!p) return 1;
  const shots = p.storyboards;
  const head = shots[headIdx];
  if (!head || typeof head.sceneNo !== "number") return 1;
  let count = 1;
  for (let i = headIdx + 1; i < shots.length; i++) {
    if (shots[i]?.sceneNo === head.sceneNo) count++;
    else break;
  }
  return count;
}

function sceneRunHeadIndex(idx: number): number {
  const p = projectsStore.selected;
  if (!p) return idx;
  const shots = p.storyboards;
  let i = idx;
  while (i > 0 && shots[i] && shots[i - 1] && shots[i]!.sceneNo === shots[i - 1]!.sceneNo) i--;
  return i;
}

function shotOrdinalInSceneRun(idx: number): number {
  return idx - sceneRunHeadIndex(idx) + 1;
}

function storyRefTextForShot(s: StoryboardShot): string {
  const chapters = pipeline.scriptPipelineChapters;
  const refIdx = pipeline.storyboardRefChapterIdx;
  if (!chapters.length) return "";
  const chap = chapters[refIdx];
  if (!chap) return "";
  if (typeof s.sceneNo !== "number" || s.sceneNo <= 0) return "";
  const body = chap.content || "";
  const sceneRe = new RegExp(`(?:^|\\n)\\s*(?:场次|Scene)\\s*[:：]?\\s*${s.sceneNo}\\b[^\\n]*`, "i");
  const m = sceneRe.exec(body);
  if (!m) return "";
  const start = m.index + m[0].length;
  const nextScene = /\n\s*(?:场次|Scene)\s*[:：]?\s*\d+/i.exec(body.slice(start));
  const end = nextScene ? start + nextScene.index : body.length;
  return body.slice(start, end).trim().slice(0, 600);
}

function isSceneRunCollapsedForHead(headIdx: number): boolean {
  const p = projectsStore.selected;
  if (!p) return false;
  const shot = p.storyboards[headIdx];
  return shot ? pipeline.collapsedSceneRunHeadIds.has(shot.id) : false;
}

function toggleSceneRunCollapse(headIdx: number) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards[headIdx];
  if (!shot) return;
  const next = new Set(pipeline.collapsedSceneRunHeadIds);
  if (next.has(shot.id)) next.delete(shot.id);
  else next.add(shot.id);
  pipeline.collapsedSceneRunHeadIds = next;
}

function setSceneNoForRunHead(headIdx: number, ev: Event) {
  const p = projectsStore.selected;
  if (!p) return;
  const val = Number((ev.target as HTMLInputElement).value);
  const no = Number.isInteger(val) && val > 0 ? val : undefined;
  const head = p.storyboards[headIdx];
  if (!head) return;
  const runLen = sceneRunLengthFromHead(headIdx);
  for (let i = headIdx; i < headIdx + runLen; i++) {
    if (p.storyboards[i]) p.storyboards[i]!.sceneNo = no;
  }
}

function setShotSceneNo(shot: StoryboardShot, ev: Event) {
  const val = Number((ev.target as HTMLInputElement).value);
  shot.sceneNo = Number.isInteger(val) && val > 0 ? val : undefined;
}

function openStoryboardSceneSolo(shotId: string) {
  pipeline.storyboardSceneSoloEditId = shotId;
}

function onStoryboardSceneSoloBlur() {
  pipeline.storyboardSceneSoloEditId = null;
}

// ─── Shot management ──────────────────────────────────────────────────
function addShot() {
  const p = projectsStore.selected;
  if (!p) return;
  const next: StoryboardShot = {
    id: crypto.randomUUID(),
    index: p.storyboards.length + 1,
    shotNo: String(p.storyboards.length + 1),
    shotSize: "",
    camera: "",
    content: "",
    dialogue: "",
    music: "",
    sfx: "",
    prompt: "",
    note: "",
  };
  p.storyboards = [...p.storyboards, next];
  reindexShots(p.storyboards);
}

function moveShot(fromIdx: number, toIdx: number) {
  const p = projectsStore.selected;
  if (!p) return;
  const shots = [...p.storyboards];
  if (fromIdx < 0 || fromIdx >= shots.length || toIdx < 0 || toIdx >= shots.length) return;
  const [moved] = shots.splice(fromIdx, 1);
  shots.splice(toIdx, 0, moved!);
  reindexShots(shots);
  p.storyboards = shots;
}

function reindexShots(shots: StoryboardShot[]) {
  for (let i = 0; i < shots.length; i++) shots[i]!.index = i + 1;
}

function clampRoundShotDuration(s: StoryboardShot) {
  if (typeof s.durationSec !== "number" || !Number.isFinite(s.durationSec)) {
    s.durationSec = undefined;
    return;
  }
  s.durationSec = Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, Math.round(s.durationSec)));
}

function shotDialogueMatchesScript(s: StoryboardShot): boolean {
  const d = (s.dialogue ?? "").trim();
  if (d.length < 4) return false;
  const p = projectsStore.selected;
  if (!p) return false;
  return (p.script ?? "").includes(d);
}

function shotVariantStripItemKey(shotId: string, vi: number, url: string): string {
  return `${shotId}-${vi}-${url.split("?")[0]}`;
}

// ─── Selection ────────────────────────────────────────────────────────
function isStoryboardSelected(id: string) {
  return pipeline.selectedStoryboardIds.includes(id);
}

function onStoryboardSelectedChange(id: string, ev: Event) {
  const checked = (ev.target as HTMLInputElement | null)?.checked === true;
  if (checked) {
    if (!pipeline.selectedStoryboardIds.includes(id))
      pipeline.selectedStoryboardIds = [...pipeline.selectedStoryboardIds, id];
    return;
  }
  pipeline.selectedStoryboardIds = pipeline.selectedStoryboardIds.filter((x) => x !== id);
}

function selectAllStoryboards() {
  const p = projectsStore.selected;
  if (!p) return;
  pipeline.selectedStoryboardIds = p.storyboards.map((s) => s.id);
}

function clearSelectedStoryboards() {
  pipeline.selectedStoryboardIds = [];
}

function removeSelectedStoryboards() {
  const p = projectsStore.selected;
  if (!p) return;
  const set = new Set(pipeline.selectedStoryboardIds);
  p.storyboards = p.storyboards.filter((s) => !set.has(s.id));
  reindexShots(p.storyboards);
  pipeline.selectedStoryboardIds = [];
}

// ─── Image generation ─────────────────────────────────────────────────
async function generateAllShotImages(onlyMissing: boolean) {
  const p = projectsStore.selected;
  if (!p) return;
  let targets = p.storyboards;
  if (onlyMissing) targets = targets.filter((s) => !s.imageUrl);
  if (!targets.length) return;
  pipeline.generatingBatch = true;
  try {
    for (const s of targets) {
      await generateShotImage(s);
    }
  } finally {
    pipeline.generatingBatch = false;
  }
}

async function generateSelectedShotImages() {
  const p = projectsStore.selected;
  if (!p) return;
  const set = new Set(pipeline.selectedStoryboardIds);
  const targets = p.storyboards.filter((s) => set.has(s.id));
  if (!targets.length) return;
  pipeline.generatingBatch = true;
  try {
    for (const s of targets) {
      await generateShotImage(s);
    }
  } finally {
    pipeline.generatingBatch = false;
  }
}

async function generateShotImage(s: StoryboardShot) {
  const p = projectsStore.selected;
  if (!p) return;
  if (pipeline.generatingShotIds.includes(s.id)) return;
  pipeline.generatingShotIds = [...pipeline.generatingShotIds, s.id];
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${s.id}/generate-image`, { method: "POST" });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      project?: Parameters<typeof projectsStore.mergeProject>[0];
    };
    if (body.project) projectsStore.mergeProject(body.project);
    if (!r.ok) throw new Error(body.error || "生图失败");
    projectsStore.bumpMediaCache(`shot-${s.id}`);
    pipeline.scheduleShotImageVariantsFetch(p.id);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.generatingShotIds = pipeline.generatingShotIds.filter((id) => id !== s.id);
  }
}

// ─── Video enqueue ────────────────────────────────────────────────────
async function enqueueVideos(mode: "all" | "missing" | "selected", shotIds?: string[]) {
  const p = projectsStore.selected;
  if (!p) return;
  pipeline.videoBatchBusy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/videos/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, shotIds }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      enqueued?: number;
      error?: string;
      blockers?: string[];
    };
    if (!r.ok) {
      const lines = [body.error || "视频入队失败"];
      if (Array.isArray(body.blockers) && body.blockers.length) lines.push(...body.blockers);
      throw new Error(lines.join("\n"));
    }
    if (body.project) projectsStore.mergeProject(body.project);
    ui.logs.push(`视频入队完成：模式=${mode}，入队 ${body.enqueued ?? 0} 条。`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.videoBatchBusy = false;
  }
}

async function runJobs() {
  const p = projectsStore.selected;
  if (!p) return;
  ui.busy = true;
  try {
    const delayMs = Math.min(60_000, Math.max(100, Math.floor(Number(cfg.cfgDraft.ui?.runnerDelayMs ?? 600)) || 600));
    const r = await fetch(`/api/projects/${p.id}/jobs/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delayMs }),
    });
    const body = (await r.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
    if (!r.ok) throw new Error(body.error || `启动 Runner 失败（HTTP ${r.status}）`);
    ui.logs.push("已启动视频任务 runner");
    await projectsStore.refreshProject();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    ui.busy = false;
  }
}

// ─── Context menu ─────────────────────────────────────────────────────
function onStoryboardRowContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  const menuWidth = 220;
  const menuHeight = 320;
  const x = Math.min(e.clientX, (window.innerWidth || 1200) - menuWidth);
  const y = Math.min(e.clientY, (window.innerHeight || 800) - menuHeight);
  pipeline.storyboardRowContextMenu.visible = true;
  pipeline.storyboardRowContextMenu.x = Math.max(10, x);
  pipeline.storyboardRowContextMenu.y = Math.max(10, y);
  pipeline.storyboardRowContextMenu.id = id;
}

async function onStoryboardRowMenuAction(action: string) {
  const p = projectsStore.selected;
  const id = pipeline.storyboardRowContextMenu.id;
  pipeline.storyboardRowContextMenu.visible = false;
  if (!id || !p) return;
  const shot = p.storyboards.find((s) => s.id === id);
  if (!shot) return;
  if (action === "generate-image") void generateShotImage(shot);
  if (action === "image-prompt") openStoryboardImagePromptModal(id);
  if (action === "video-prompt") openStoryboardVideoPromptModal(id);
  if (action === "video-run-once") void enqueueSingleShotVideo(id);
  if (action === "delete") {
    p.storyboards = p.storyboards.filter((s) => s.id !== id);
    reindexShots(p.storyboards);
  }
  if (action === "publish-easyimage") void publishEasyImage(id, false);
  if (action === "publish-easyimage-and-video") void publishEasyImage(id, true);
  if (action === "publish-easyimage-shot-only") void publishEasyImageShotOnly(id, false);
  if (action === "publish-easyimage-and-video-shot-only") void publishEasyImageShotOnly(id, true);
}

async function enqueueSingleShotVideo(shotId: string) {
  const p = projectsStore.selected;
  const shot = p?.storyboards.find((s) => s.id === shotId);
  if (!p) return;
  if (pipeline.runningSingleVideoShotIds.includes(shotId)) return;
  pipeline.runningSingleVideoShotIds = [...pipeline.runningSingleVideoShotIds, shotId];
  ui.logs.push(`单镜头直执行：#${shot?.index ?? "?"}，提交中...`);
  const poll = window.setInterval(() => void projectsStore.refreshProject(), 3000);
  try {
    const r = await fetch(`/api/projects/${p.id}/videos/run-once`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      resultUrl?: string;
      error?: string | Record<string, unknown>;
    };
    if (body.project) projectsStore.mergeProject(body.project);
    if (!r.ok) {
      const errRaw = body.error;
      const errMsg =
        typeof errRaw === "string" ? errRaw : errRaw != null ? JSON.stringify(errRaw) : "单镜头视频生成失败";
      throw new Error(errMsg);
    }
    ui.logs.push(`单镜头直执行完成：#${shot?.index ?? "?"}`);
  } catch (e) {
    ui.logs.push(`单镜头直执行失败：${e instanceof Error ? e.message : String(e)}`);
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    clearInterval(poll);
    pipeline.runningSingleVideoShotIds = pipeline.runningSingleVideoShotIds.filter((x) => x !== shotId);
  }
}

async function publishEasyImage(shotId: string, alsoRunVideo: boolean) {
  const p = projectsStore.selected;
  if (!p) return;
  pipeline.publishingEasyImageShotIds = [...pipeline.publishingEasyImageShotIds, shotId];
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shotId}/publish-easyimage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alsoRunVideo }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      error?: string;
    };
    if (body.project) projectsStore.mergeProject(body.project);
    if (!r.ok) throw new Error(body.error || "上传图床失败");
    ui.logs.push(`图床上传完成：镜头 #${p.storyboards.find((s) => s.id === shotId)?.index ?? "?"}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.publishingEasyImageShotIds = pipeline.publishingEasyImageShotIds.filter((x) => x !== shotId);
  }
}

async function publishEasyImageShotOnly(shotId: string, alsoRunVideo: boolean) {
  const p = projectsStore.selected;
  if (!p) return;
  pipeline.publishingEasyImageShotIds = [...pipeline.publishingEasyImageShotIds, shotId];
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shotId}/publish-easyimage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alsoRunVideo, shotOnly: true }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      error?: string;
    };
    if (body.project) projectsStore.mergeProject(body.project);
    if (!r.ok) throw new Error(body.error || "上传图床失败");
    ui.logs.push(`图床上传完成（仅分镜）：镜头 #${p.storyboards.find((s) => s.id === shotId)?.index ?? "?"}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.publishingEasyImageShotIds = pipeline.publishingEasyImageShotIds.filter((x) => x !== shotId);
  }
}

// ─── Video extra assets ───────────────────────────────────────────────
function assetsSelectableForVideoExtra(shot: StoryboardShot) {
  const p = projectsStore.selected;
  if (!p) return [];
  const existing = new Set((shot.videoExtraAssetIds ?? []).map((x) => String(x).toLowerCase()));
  return p.assets.filter((a) => !existing.has(a.id.toLowerCase()));
}

function videoExtraPickerTabCount(shot: StoryboardShot, tab: string) {
  const all = assetsSelectableForVideoExtra(shot);
  if (tab === "all") return all.length;
  return all.filter((a) => a.type === tab).length;
}

const videoExtraPopoverFilteredAssets = computed(() => {
  const shot = pipeline.videoExtraPopoverShot;
  if (!shot) return [];
  const tab = pipeline.getVideoExtraPickerTab(shot.id);
  const query = pipeline.getVideoExtraPickerQuery(shot.id).toLowerCase();
  let list = assetsSelectableForVideoExtra(shot);
  if (tab !== "all") list = list.filter((a) => a.type === tab);
  if (query) {
    list = list.filter((a) => {
      const text = `${a.name} ${(a.aliases ?? []).join(" ")} ${a.key ?? ""} ${a.prompt}`.toLowerCase();
      return text.includes(query);
    });
  }
  return list;
});

async function pickVideoExtraAssetForShot(shot: StoryboardShot, assetId: string) {
  const p = projectsStore.selected;
  const idLower = assetId.toLowerCase();
  // 若此前曾手动排除该资产，先从排除列表中移除
  if (shot.videoExcludedAssetIds?.some((x) => String(x).toLowerCase() === idLower)) {
    shot.videoExcludedAssetIds = shot.videoExcludedAssetIds.filter((x) => String(x).toLowerCase() !== idLower);
  }
  const ids = [...(shot.videoExtraAssetIds ?? [])];
  if (!ids.some((x) => String(x).toLowerCase() === idLower)) {
    ids.push(assetId);
    shot.videoExtraAssetIds = ids;
  }
  if (p) {
    await projectsStore.savePatch({ storyboards: p.storyboards });
  }
}

async function clearAssetsForShot(shot: StoryboardShot) {
  const p = projectsStore.selected;
  if (!p) return;
  const currentList = pipeline.storyboardShotVideoAssetMatch(shot).list;
  const idsToExclude = currentList.map((a) => a.id.toLowerCase());
  shot.videoExtraAssetIds = [];
  const excluded = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));
  for (const id of idsToExclude) {
    excluded.add(id);
  }
  shot.videoExcludedAssetIds = Array.from(excluded);
  await projectsStore.savePatch({ storyboards: p.storyboards });
}

async function restoreAutoAssetsForShot(shot: StoryboardShot) {
  const p = projectsStore.selected;
  if (!p) return;
  shot.videoExcludedAssetIds = [];
  await projectsStore.savePatch({ storyboards: p.storyboards });
}

async function clearAssetsForSelectedShots() {
  const p = projectsStore.selected;
  if (!p || !pipeline.selectedStoryboardIds.length) return;
  const selectedSet = new Set(pipeline.selectedStoryboardIds);
  for (const shot of p.storyboards) {
    if (!selectedSet.has(shot.id)) continue;
    const currentList = pipeline.storyboardShotVideoAssetMatch(shot).list;
    const idsToExclude = currentList.map((a) => a.id.toLowerCase());
    shot.videoExtraAssetIds = [];
    const excluded = new Set((shot.videoExcludedAssetIds ?? []).map((x) => String(x).toLowerCase()));
    for (const id of idsToExclude) {
      excluded.add(id);
    }
    shot.videoExcludedAssetIds = Array.from(excluded);
  }
  await projectsStore.savePatch({ storyboards: p.storyboards });
}

async function removeAssetFromShot(shot: StoryboardShot, assetId: string) {
  const p = projectsStore.selected;
  const idLower = assetId.toLowerCase();
  // 1. 如果属于手动附加列表，直接移除
  if (shot.videoExtraAssetIds?.some((x) => String(x).toLowerCase() === idLower)) {
    shot.videoExtraAssetIds = shot.videoExtraAssetIds.filter((x) => String(x).toLowerCase() !== idLower);
  } else {
    // 2. 如果属于系统自动匹配，加入排除列表
    const excluded = [...(shot.videoExcludedAssetIds ?? [])];
    if (!excluded.some((x) => String(x).toLowerCase() === idLower)) {
      excluded.push(assetId);
      shot.videoExcludedAssetIds = excluded;
    }
  }
  if (p) {
    await projectsStore.savePatch({ storyboards: p.storyboards });
  }
}

// ─── Video model helpers ──────────────────────────────────────────────
function onShotVideoModelChange(s: StoryboardShot) {
  // Reset video run mode when model changes
  s.videoRunMode = undefined;
}

function onShotVideoRunChange(_s: StoryboardShot) {
  void _s;
}

function videoRunModeOptionsForShot(_s: StoryboardShot) {
  void _s;
  const modes = cfg.cfgDraft.video?.supportedModes;
  const opts: { value: string; label: string }[] = [];
  if (modes?.firstFrame !== false) opts.push({ value: "first_frame", label: "首帧图生视频" });
  if (modes?.firstLastFrame) opts.push({ value: "first_last", label: "首尾帧" });
  if (modes?.multiRef !== false) opts.push({ value: "multi_ref", label: "多图参考" });
  if (modes?.omni) opts.push({ value: "omni", label: "全能参考" });
  if (modes?.textOnly) opts.push({ value: "text_only", label: "纯文本" });
  return opts;
}

// ─── Prompt modals ────────────────────────────────────────────────────
function openStoryboardVideoPromptModal(shotId: string) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return;
  pipeline.storyboardVideoModalShotId = shotId;
  pipeline.storyboardVideoDraftPrompt = shot.videoPrompt ?? "";
  pipeline.storyboardVideoEnrichedPreview = "";
  pipeline.storyboardVideoTextPayloadPreview = "";
  pipeline.storyboardVideoPreviewMatched = [];
  pipeline.storyboardVideoPreviewSlots = [];
  pipeline.storyboardVideoPreviewApiUrls = [];
  pipeline.storyboardVideoDurationApiHint = "";
  pipeline.storyboardVideoModalVisible = true;
}

function closeStoryboardVideoPromptModal() {
  pipeline.storyboardVideoModalVisible = false;
  pipeline.storyboardVideoModalShotId = null;
}

async function refreshStoryboardVideoPreview() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  pipeline.storyboardVideoPreviewLoading = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shot.id}/video-prompt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoPrompt: pipeline.storyboardVideoDraftPrompt }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(body.error ?? "预览失败"));
    pipeline.storyboardVideoTextPayloadPreview = String(body.textPayload ?? "");
    pipeline.storyboardVideoEnrichedPreview = String(body.enrichedText ?? body.textPayload ?? "");
    pipeline.storyboardVideoPreviewMatched = Array.isArray(body.matched)
      ? (body.matched as typeof pipeline.storyboardVideoPreviewMatched)
      : [];
    pipeline.storyboardVideoPreviewSlots = Array.isArray(body.slots)
      ? (body.slots as typeof pipeline.storyboardVideoPreviewSlots)
      : [];
    pipeline.storyboardVideoPreviewApiUrls = Array.isArray(body.apiUrls) ? (body.apiUrls as string[]) : [];
    pipeline.storyboardVideoDurationApiHint = String(body.durationApiHint ?? "");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.storyboardVideoPreviewLoading = false;
  }
}

async function saveStoryboardVideoPromptFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  shot.videoPrompt = pipeline.storyboardVideoDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
}

async function enqueueStoryboardVideoFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  shot.videoPrompt = pipeline.storyboardVideoDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await enqueueVideos("selected", [shot.id]);
  closeStoryboardVideoPromptModal();
}

async function runStoryboardVideoOnceFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  shot.videoPrompt = pipeline.storyboardVideoDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await enqueueSingleShotVideo(shot.id);
  closeStoryboardVideoPromptModal();
}

// Image prompt modal
function openStoryboardImagePromptModal(shotId: string) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return;
  pipeline.storyboardImageModalShotId = shotId;
  pipeline.storyboardImageDraftPrompt = shot.imagePrompt ?? "";
  pipeline.storyboardImageFullPreview = "";
  pipeline.storyboardImagePreviewMatched = [];
  pipeline.storyboardImagePreviewSlots = [];
  pipeline.storyboardImagePreviewApiUrls = [];
  pipeline.storyboardImageModalVisible = true;
}

function closeStoryboardImagePromptModal() {
  pipeline.storyboardImageModalVisible = false;
  pipeline.storyboardImageModalShotId = null;
}

async function refreshStoryboardImagePreview() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  pipeline.storyboardImagePreviewLoading = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shot.id}/image-prompt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePrompt: pipeline.storyboardImageDraftPrompt }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(body.error ?? "预览失败"));
    pipeline.storyboardImageFullPreview = String(body.fullPrompt ?? "");
    pipeline.storyboardImagePreviewMatched = Array.isArray(body.matched)
      ? (body.matched as typeof pipeline.storyboardImagePreviewMatched)
      : [];
    pipeline.storyboardImagePreviewSlots = Array.isArray(body.slots)
      ? (body.slots as typeof pipeline.storyboardImagePreviewSlots)
      : [];
    pipeline.storyboardImagePreviewApiUrls = Array.isArray(body.apiUrls) ? (body.apiUrls as string[]) : [];
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.storyboardImagePreviewLoading = false;
  }
}

async function saveStoryboardImagePromptFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  shot.imagePrompt = pipeline.storyboardImageDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
}

async function saveAndGenerateStoryboardImageFromModal() {
  await saveStoryboardImagePromptFromModal();
  const shot = pipeline.storyboardImageModalShot;
  if (shot) await generateShotImage(shot);
}

async function runStoryboardImageOnceFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  shot.imagePrompt = pipeline.storyboardImageDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await generateShotImage(shot);
  closeStoryboardImagePromptModal();
}
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <article class="card">
      <div class="row spread page-toolbar-sticky">
        <h3>分镜占位管理</h3>
        <div class="actions">
          <button class="btn" type="button" @click="addShot">新增分镜</button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy"
            @click="pipeline.storyboardProMode = !pipeline.storyboardProMode"
          >
            {{ pipeline.storyboardProMode ? "切换：简洁模式" : "切换：专业模式" }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.generatingBatch || !projectsStore.selected.storyboards.length"
            @click="generateAllShotImages(false)"
          >
            {{ pipeline.generatingBatch ? "批量生成中..." : "批量生成图片" }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="
              ui.busy || pipeline.generatingBatch || !projectsStore.selected.storyboards.some((x) => !x.imageUrl)
            "
            @click="generateAllShotImages(true)"
          >
            仅生成未有图片的分镜
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.generatingBatch || !pipeline.selectedStoryboardIds.length"
            @click="generateSelectedShotImages"
          >
            生成已勾选分镜
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.generatingBatch || !projectsStore.selected.storyboards.length"
            @click="selectAllStoryboards"
          >
            全选
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.generatingBatch || !pipeline.selectedStoryboardIds.length"
            @click="clearSelectedStoryboards"
          >
            清空勾选
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.selectedStoryboardIds.length"
            title="一键清空勾选镜头引用的所有资产"
            @click="clearAssetsForSelectedShots"
          >
            清空勾选镜头资产
          </button>
          <button
            class="btn danger"
            type="button"
            :disabled="ui.busy || pipeline.generatingBatch || !pipeline.selectedStoryboardIds.length"
            @click="removeSelectedStoryboards"
          >
            删除勾选分镜
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !projectsStore.selected.storyboards.length"
            @click="enqueueVideos('all')"
          >
            视频入队（全部镜）
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !projectsStore.selected.storyboards.length"
            @click="enqueueVideos('missing')"
          >
            视频入队（未完成）
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !pipeline.selectedStoryboardIds.length"
            @click="enqueueVideos('selected', pipeline.selectedStoryboardIds)"
          >
            视频入队（勾选）
          </button>
          <button class="btn" type="button" :disabled="ui.busy || pipeline.videoBatchBusy" @click="runJobs">
            启动视频 Runner
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !projectsStore.selected.storyboards.length"
            @click="openStoryboardVideoPromptModal(projectsStore.selected.storyboards[0]!.id)"
          >
            视频提示词（首镜）
          </button>
          <button
            class="btn primary"
            type="button"
            :disabled="ui.busy"
            @click="projectsStore.savePatch({ storyboards: projectsStore.selected.storyboards })"
          >
            保存分镜
          </button>
        </div>
      </div>

      <p class="hint">
        与管线、视频模型一致：<strong>每个场次至少 2 条分镜</strong
        >（同一场用相同场次号<strong>连续排列</strong>，场次列会合并显示）；首行左侧
        <strong>/ </strong> 可<strong>折叠、展开</strong>本场次除首条外的分镜。全书分镜总数约
        <strong>6~48</strong> 条。时长<strong>整秒 {{ SHOT_DURATION_SEC_MIN }}~{{ SHOT_DURATION_SEC_MAX }}</strong
        >。<strong>视频引用资产</strong>列可跳转资产页、悬停预览图。
      </p>
      <p v-if="pipeline.videoJobStats.queued > 0" class="video-queue-banner">
        <strong>当前有 {{ pipeline.videoJobStats.queued }} 条视频任务为 queued（本地队列）</strong
        >：尚未执行，不是云端排队。请点击工具栏<strong>「启动视频 Runner」</strong>。
      </p>
      <div class="storyboard-page-stack">
        <div class="storyboard-chapter-bar row spread" style="align-items: flex-end; flex-wrap: wrap; gap: 6px">
          <div>
            <strong>剧本场次对照</strong>
            <span class="hint storyboard-chapter-hint">解析 Markdown 场次表，非整章粘贴</span>
          </div>
          <label
            v-if="pipeline.scriptPipelineChapters.length"
            class="field block storyboard-chapter-select"
            style="margin: 0"
          >
            <span class="hint">对照章节</span>
            <select v-model.number="pipeline.storyboardRefChapterIdx" class="input">
              <option v-for="(c, i) in pipeline.scriptPipelineChapters" :key="`sb-ref-${i}`" :value="i">
                {{ (c.title || `第${i + 1}章`).trim() }}
              </option>
            </select>
          </label>
          <span v-else class="hint">当前剧本未按 ### 分章，场次表从全文解析。</span>
        </div>
        <p v-if="projectsStore.selected.storyboards.length" class="hint storyboard-stats-line">
          当前 <strong>{{ storyboardPageStats.total }}</strong> 条分镜
          <template v-if="storyboardPageStats.singleSceneNos.length">
            | 提示：场次 <strong>{{ storyboardPageStats.singleSceneNos.join(", ") }}</strong> 目前仅 1 镜，建议每场至少
            2 镜
          </template>
          <template v-if="storyboardPageStats.filledDurationCount > 0">
            | 已填时长合计 <strong>{{ storyboardPageStats.totalDurationRounded }}</strong> 秒（{{
              storyboardPageStats.filledDurationCount
            }}/{{ storyboardPageStats.total }} 条已填秒数）
          </template>
        </p>
        <div
          v-if="projectsStore.selected.storyboards.length"
          class="shot-table shot-table--storyboard"
          :class="{ 'storyboard-pro': pipeline.storyboardProMode }"
        >
          <div class="shot-table-head">
            <div class="shot-leading-head" title="拖动排序、勾选批量生图">排序 / 勾选</div>
            <div>剧本场次</div>
            <div title="多次生图会保留历史文件；可点「采用」切换当前参考图">分镜图 / 历史版本</div>
            <div v-if="pipeline.storyboardProMode">镜头号 / 景别 / 摄法 / 时长(整秒)</div>
            <div v-else>画面内容 / 景别 / 摄法 / 时长(整秒)</div>
            <div v-if="pipeline.storyboardProMode">画面内容 / 台词 / 音乐 / 音效</div>
            <div v-else>台词 / 音乐 / 音效 / 备注</div>
            <div class="shot-video-assets-head" title="自动按文案/视频提示词匹配">视频引用资产</div>
            <div title="对应镜头号的视频任务">视频状态 / 成片</div>
          </div>
          <div
            v-for="{ shot: s, idx } in storyboardVisibleRows"
            :key="s.id"
            class="shot-row"
            :class="{
              'shot-row--scene-continuation': !isSceneRunHead(idx),
              'shot-row--scene-group-head': isSceneRunHead(idx) && sceneRunLengthFromHead(idx) > 1,
            }"
            @dragover.prevent
            @drop="(e) => moveShot(Number(e.dataTransfer?.getData('text/plain') ?? -1), idx)"
            @contextmenu="onStoryboardRowContextMenu($event, s.id)"
          >
            <div class="shot-leading">
              <button
                class="drag-handle"
                type="button"
                title="按住拖动调整顺序"
                draggable="true"
                @dragstart="(e) => e.dataTransfer?.setData('text/plain', String(idx))"
              >
                =
              </button>
              <input
                type="checkbox"
                :checked="isStoryboardSelected(s.id)"
                @change="onStoryboardSelectedChange(s.id, $event)"
              />
            </div>
            <div
              class="shot-scene-ref"
              :class="{ 'is-scene-run-head': isSceneRunHead(idx), 'is-scene-run-tail': !isSceneRunHead(idx) }"
            >
              <template v-if="isSceneRunHead(idx)">
                <div class="scene-run-head-toolbar">
                  <button
                    v-if="sceneRunLengthFromHead(idx) > 1"
                    type="button"
                    class="scene-collapse-toggle"
                    :title="isSceneRunCollapsedForHead(idx) ? '展开本场次其它分镜' : '折叠本场次其它分镜'"
                    :aria-expanded="!isSceneRunCollapsedForHead(idx)"
                    @click.stop="toggleSceneRunCollapse(idx)"
                  >
                    {{ isSceneRunCollapsedForHead(idx) ? " " : " " }}
                  </button>
                  <div class="scene-run-head-fields">
                    <input
                      class="input small"
                      type="number"
                      min="1"
                      step="1"
                      :value="s.sceneNo ?? ''"
                      placeholder="场次号"
                      title="与对照章节场次表「场次」列一致"
                      @input="setSceneNoForRunHead(idx, $event)"
                    />
                    <textarea
                      class="area scene-snippet"
                      readonly
                      tabindex="-1"
                      rows="3"
                      :value="storyRefTextForShot(s)"
                    />
                  </div>
                </div>
                <p v-if="sceneRunLengthFromHead(idx) > 1" class="hint scene-run-badge">
                  本场次共 {{ sceneRunLengthFromHead(idx) }} 条分镜
                  <template v-if="isSceneRunCollapsedForHead(idx)">
                    | 已折叠 {{ sceneRunLengthFromHead(idx) - 1 }} 条</template
                  >
                </p>
              </template>
              <template v-else-if="pipeline.storyboardSceneSoloEditId === s.id">
                <input
                  class="input small"
                  type="number"
                  min="1"
                  step="1"
                  :value="s.sceneNo ?? ''"
                  placeholder="场次号"
                  title="仅改当前这条分镜的场次号"
                  @input="setShotSceneNo(s, $event)"
                  @blur="onStoryboardSceneSoloBlur"
                />
                <textarea class="area scene-snippet" readonly tabindex="-1" rows="3" :value="storyRefTextForShot(s)" />
              </template>
              <template v-else>
                <div class="scene-run-continuation">
                  <span class="hint"
                    >同场次 | 第 {{ shotOrdinalInSceneRun(idx) }}/{{
                      sceneRunLengthFromHead(sceneRunHeadIndex(idx))
                    }}
                    镜</span
                  >
                  <button type="button" class="btn scene-solo-btn" @click="openStoryboardSceneSolo(s.id)">
                    本镜改场次
                  </button>
                </div>
              </template>
            </div>
            <div class="shot-ref-media-cell">
              <div v-if="pipeline.imageJobsForShotIndex(s.index).length" class="shot-pending-image-jobs">
                <span
                  v-for="j in pipeline.imageJobsForShotIndex(s.index)"
                  :key="j.id"
                  class="hint shot-pending-image-job-line"
                >
                  生图队列 <code :data-job="j.status">{{ j.status }}</code>
                  <span class="shot-pending-msg">{{ j.message }}</span>
                </span>
              </div>
              <div v-if="pipeline.shotImageVariantsForShot(s).length" class="shot-image-variants-strip">
                <div
                  v-for="(u, vi) in pipeline.shotImageVariantsForShot(s)"
                  :key="shotVariantStripItemKey(s.id, vi, u)"
                  class="shot-variant-item"
                >
                  <button
                    type="button"
                    class="shot-variant-thumb"
                    :class="{ 'shot-variant-thumb--current': pipeline.storyboardImageUrlMatch(s.imageUrl, u) }"
                    :title="
                      pipeline.storyboardImageUrlMatch(s.imageUrl, u)
                        ? '当前采用的参考图'
                        : '预览；下方可「采用」为当前参考图'
                    "
                    @click="pipeline.openImagePreview(projectsStore.mediaSrc(u, `shot-${s.id}`))"
                  >
                    <img :src="projectsStore.mediaSrc(u, `shot-${s.id}`)" alt="" />
                  </button>
                  <button
                    v-if="!pipeline.storyboardImageUrlMatch(s.imageUrl, u)"
                    type="button"
                    class="btn small shot-variant-adopt"
                    @click="pipeline.adoptShotImageUrl(s, u)"
                  >
                    采用
                  </button>
                  <span v-else class="hint shot-variant-current-label">当前</span>
                </div>
              </div>
              <span v-else class="hint">未生成</span>
              <p v-if="storyboardVideoModelCapabilityLine" class="hint shot-volc-modes-hint">
                {{ storyboardVideoModelCapabilityLine }}
              </p>
              <div class="shot-per-model-panel">
                <label class="shot-model-field">
                  <span class="shot-model-label">本镜生图</span>
                  <select v-model="s.imageModelId" class="input shot-model-select">
                    <option value="">全局默认</option>
                    <option v-for="m in cfg.cfgDraft.imageModels ?? []" :key="'sb-im-' + m.id" :value="m.id">
                      {{ m.label }}
                    </option>
                  </select>
                </label>
                <label class="shot-model-field">
                  <span class="shot-model-label">本镜视频</span>
                  <select v-model="s.videoModelId" class="input shot-model-select" @change="onShotVideoModelChange(s)">
                    <option value="">全局默认</option>
                    <option v-for="m in cfg.cfgDraft.videoModels ?? []" :key="'sb-vm-' + m.id" :value="m.id">
                      {{ m.label }}
                    </option>
                  </select>
                </label>
                <label class="shot-model-field">
                  <span class="shot-model-label">视频模式</span>
                  <select
                    class="input shot-model-select"
                    :value="s.videoRunMode ?? ''"
                    @change="
                      s.videoRunMode = (($event.target as HTMLSelectElement).value || undefined) as
                        | VideoRunMode
                        | undefined;
                      onShotVideoRunChange(s);
                    "
                  >
                    <option value="">自动</option>
                    <option
                      v-for="opt in videoRunModeOptionsForShot(s)"
                      :key="'vrm-' + s.id + opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                </label>
                <template v-if="s.videoRunMode === 'first_last'">
                  <label class="shot-model-field block"
                    ><span class="shot-model-label">尾帧 imageUrl</span
                    ><input v-model="s.lastFrameImageUrl" class="input" placeholder="/api/files/... 或 https://"
                  /></label>
                  <label class="shot-model-field block"
                    ><span class="shot-model-label">尾帧 remote（可选）</span
                    ><input v-model="s.lastFrameRemoteUrl" class="input" placeholder="图床稳定外链"
                  /></label>
                </template>
                <template v-if="s.videoRunMode === 'omni'">
                  <label class="shot-model-field block"
                    ><span class="shot-model-label">参考音频 URL</span
                    ><input v-model="s.videoRefAudioUrl" class="input" placeholder="https://..."
                  /></label>
                  <label class="shot-model-field block"
                    ><span class="shot-model-label">参考视频 URL</span
                    ><input v-model="s.videoRefVideoUrl" class="input" placeholder="https://..."
                  /></label>
                </template>
              </div>
            </div>
            <template v-if="pipeline.storyboardProMode">
              <div>
                <div class="row storyboard-meta-row">
                  <input v-model="s.shotNo" class="input small" placeholder="镜头号" />
                  <select v-model="s.shotSize" class="input">
                    <option value="">景别（可选）</option>
                    <option v-for="x in shotSizePresets" :key="x" :value="x">{{ x }}</option>
                  </select>
                  <select v-model="s.camera" class="input">
                    <option value="">摄法（可选）</option>
                    <option v-for="x in cameraPresets" :key="x" :value="x">{{ x }}</option>
                  </select>
                  <input
                    v-model.number="s.durationSec"
                    type="number"
                    :min="SHOT_DURATION_SEC_MIN"
                    :max="SHOT_DURATION_SEC_MAX"
                    step="1"
                    class="input small"
                    :placeholder="`整秒 ${SHOT_DURATION_SEC_MIN}--${SHOT_DURATION_SEC_MAX}`"
                    @change="clampRoundShotDuration(s)"
                  />
                </div>
                <input v-model="s.note" class="input" placeholder="备注（可空）" style="margin-top: 8px" />
              </div>
              <div>
                <textarea v-model="s.content" class="area" rows="5" placeholder="本镜起始瞬间的画面（单帧）" />
                <textarea
                  v-model="s.dialogue"
                  class="area"
                  rows="2"
                  placeholder="台词/旁白（可空）"
                  style="margin-top: 8px"
                />
                <p v-if="shotDialogueMatchesScript(s)" class="hint script-shot-link-hint">台词见于剧本（全文匹配）</p>
                <div class="row" style="margin-top: 8px; align-items: flex-start">
                  <input v-model="s.music" class="input" placeholder="音乐（可空）" />
                  <input v-model="s.sfx" class="input" placeholder="音效（可空）" />
                </div>
                <textarea
                  v-model="s.prompt"
                  class="area"
                  rows="2"
                  placeholder="兼容字段 prompt（可留空）"
                  style="margin-top: 8px"
                />
              </div>
              <div class="storyboard-video-assets-cell">
                <template v-if="!projectsStore.selected.assets.length"><span class="hint">暂无资产</span></template>
                <template v-else>
                  <p v-if="!pipeline.videoAggregateAssets" class="hint">
                    已关闭「聚合资产」：仅<strong>下方手动附加</strong>的资产会写入视频参考图
                  </p>
                  <p
                    v-else-if="pipeline.storyboardShotVideoAssetMatch(s).isFallback"
                    class="hint storyboard-asset-fallback-hint"
                  >
                    与文案无名称匹配，下列为管线回退用的前若干条
                  </p>
                  <div class="storyboard-asset-chips">
                    <span
                      v-for="a in pipeline.storyboardShotVideoAssetMatch(s).list"
                      :key="a.id"
                      class="storyboard-asset-chip-wrap"
                      :class="{
                        'storyboard-asset-chip-wrap--manual': pipeline
                          .storyboardShotVideoAssetMatch(s)
                          .extraIdSet.has(a.id.toLowerCase()),
                      }"
                    >
                      <div class="storyboard-asset-chip-row">
                        <button
                          type="button"
                          class="storyboard-asset-chip"
                          :title="'跳转资产页：' + a.name"
                          @click="pipeline.goToAssetFromStoryboard(a.id)"
                        >
                          <span class="chip-type">{{ pipeline.assetTypeChipLabel(a.type) }}</span>
                          <span class="chip-name">{{ a.name }}</span>
                          <span
                            v-if="pipeline.storyboardShotVideoAssetMatch(s).extraIdSet.has(a.id.toLowerCase())"
                            class="chip-manual-tag"
                            >手动</span
                          >
                        </button>
                        <button
                          type="button"
                          class="storyboard-asset-unpin"
                          :title="
                            pipeline.storyboardShotVideoAssetMatch(s).extraIdSet.has(a.id.toLowerCase())
                              ? '移除手动附加'
                              : '排除此自动匹配资产（本镜不引用）'
                          "
                          @click.stop="removeAssetFromShot(s, a.id)"
                        >
                          x
                        </button>
                      </div>
                      <div class="storyboard-asset-preview" :class="{ 'storyboard-asset-preview--empty': !a.imageUrl }">
                        <img
                          v-if="a.imageUrl"
                          :src="projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`)"
                          :alt="a.name"
                        />
                        <span v-else class="hint">无参考图</span>
                      </div>
                    </span>
                  </div>
                  <div class="storyboard-extra-asset-row">
                    <button
                      type="button"
                      class="btn storyboard-extra-asset-open-btn"
                      :class="{
                        active:
                          pipeline.videoExtraAttachPopover.visible && pipeline.videoExtraAttachPopover.shotId === s.id,
                      }"
                      :disabled="!assetsSelectableForVideoExtra(s).length"
                      @click.stop="pipeline.toggleVideoExtraAttachPopover(s, $event)"
                    >
                      附加到本镜视频
                      <span v-if="assetsSelectableForVideoExtra(s).length" class="storyboard-extra-asset-open-count">{{
                        assetsSelectableForVideoExtra(s).length
                      }}</span>
                    </button>
                    <button
                      v-if="pipeline.storyboardShotVideoAssetMatch(s).list.length"
                      type="button"
                      class="btn small"
                      title="一键清空本镜当前所有引用的资产"
                      @click.stop="clearAssetsForShot(s)"
                    >
                      清空引用
                    </button>
                    <button
                      v-if="s.videoExcludedAssetIds?.length"
                      type="button"
                      class="btn small"
                      style="opacity: 0.85"
                      title="恢复系统默认的自动匹配资产"
                      @click.stop="restoreAutoAssetsForShot(s)"
                    >
                      恢复默认匹配
                    </button>
                  </div>
                </template>
              </div>
              <div class="shot-video-jobs-cell">
                <template v-if="!pipeline.videoJobsForShotIndex(s.index).length">
                  <code class="video-shot-job-status" data-job="none">未入队</code>
                </template>
                <div v-else class="shot-video-jobs-scroll">
                  <div v-for="j in pipeline.videoJobsForShotIndex(s.index)" :key="j.id" class="shot-video-job-block">
                    <div class="shot-video-job-head">
                      <code class="video-shot-job-status" :data-job="j.status">{{ j.status }}</code>
                      <a
                        v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                        class="job-link"
                        :href="j.resultUrl"
                        target="_blank"
                        rel="noreferrer"
                        >打开链接</a
                      >
                    </div>
                    <span class="hint shot-video-job-msg">{{ j.message }}</span>
                    <details class="job-model-api shot-inline-job-api" :open="j.status === 'failed'">
                      <summary class="job-model-api-summary">模型实际请求参数</summary>
                      <pre v-if="j.modelApiCall" class="job-model-api-pre">{{
                        pipeline.formatModelApiCallJson(j.modelApiCall)
                      }}</pre>
                    </details>
                    <div
                      v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                      class="video-preview-tap"
                      role="button"
                      tabindex="0"
                      title="点击在屏幕中央播放"
                      @click="pipeline.openCenterVideoPlay(j.resultUrl)"
                      @keydown.enter.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
                      @keydown.space.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
                    >
                      <video class="video-preview-tap__thumb" :src="j.resultUrl" muted playsinline preload="metadata" />
                      <span class="video-preview-tap__hint">> 居中播放</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <div>
                <textarea v-model="s.content" class="area" rows="6" placeholder="本镜起始瞬间的画面（单帧）" />
                <div class="row" style="margin-top: 8px; align-items: flex-start">
                  <input v-model="s.shotNo" class="input small" placeholder="镜头号" />
                  <input v-model="s.shotSize" class="input" placeholder="景别" />
                  <input v-model="s.camera" class="input" placeholder="摄法" />
                  <input
                    v-model.number="s.durationSec"
                    type="number"
                    :min="SHOT_DURATION_SEC_MIN"
                    :max="SHOT_DURATION_SEC_MAX"
                    step="1"
                    class="input small"
                    :placeholder="`整秒 ${SHOT_DURATION_SEC_MIN}--${SHOT_DURATION_SEC_MAX}`"
                    @change="clampRoundShotDuration(s)"
                  />
                </div>
              </div>
              <div>
                <textarea v-model="s.dialogue" class="area" rows="3" placeholder="台词/旁白（可空）" />
                <p v-if="shotDialogueMatchesScript(s)" class="hint script-shot-link-hint">台词见于剧本（全文匹配）</p>
                <div class="row" style="margin-top: 8px; align-items: flex-start">
                  <input v-model="s.music" class="input" placeholder="音乐（可空）" />
                  <input v-model="s.sfx" class="input" placeholder="音效（可空）" />
                </div>
                <input v-model="s.note" class="input" placeholder="备注（可空）" style="margin-top: 8px" />
                <textarea
                  v-model="s.prompt"
                  class="area"
                  rows="2"
                  placeholder="兼容字段 prompt（可留空）"
                  style="margin-top: 8px"
                />
              </div>
              <div class="storyboard-video-assets-cell">
                <template v-if="!projectsStore.selected.assets.length"><span class="hint">暂无资产</span></template>
                <template v-else>
                  <div class="storyboard-asset-chips">
                    <span
                      v-for="a in pipeline.storyboardShotVideoAssetMatch(s).list"
                      :key="a.id"
                      class="storyboard-asset-chip-wrap"
                      :class="{
                        'storyboard-asset-chip-wrap--manual': pipeline
                          .storyboardShotVideoAssetMatch(s)
                          .extraIdSet.has(a.id.toLowerCase()),
                      }"
                    >
                      <div class="storyboard-asset-chip-row">
                        <button
                          type="button"
                          class="storyboard-asset-chip"
                          :title="'跳转资产页：' + a.name"
                          @click="pipeline.goToAssetFromStoryboard(a.id)"
                        >
                          <span class="chip-type">{{ pipeline.assetTypeChipLabel(a.type) }}</span>
                          <span class="chip-name">{{ a.name }}</span>
                        </button>
                        <button
                          type="button"
                          class="storyboard-asset-unpin"
                          :title="
                            pipeline.storyboardShotVideoAssetMatch(s).extraIdSet.has(a.id.toLowerCase())
                              ? '移除手动附加'
                              : '排除此自动匹配资产（本镜不引用）'
                          "
                          @click.stop="removeAssetFromShot(s, a.id)"
                        >
                          x
                        </button>
                      </div>
                      <div class="storyboard-asset-preview" :class="{ 'storyboard-asset-preview--empty': !a.imageUrl }">
                        <img
                          v-if="a.imageUrl"
                          :src="projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`)"
                          :alt="a.name"
                        />
                        <span v-else class="hint">无参考图</span>
                      </div>
                    </span>
                  </div>
                  <div class="storyboard-extra-asset-row">
                    <button
                      type="button"
                      class="btn storyboard-extra-asset-open-btn"
                      :class="{
                        active:
                          pipeline.videoExtraAttachPopover.visible && pipeline.videoExtraAttachPopover.shotId === s.id,
                      }"
                      :disabled="!assetsSelectableForVideoExtra(s).length"
                      @click.stop="pipeline.toggleVideoExtraAttachPopover(s, $event)"
                    >
                      附加到本镜视频
                      <span v-if="assetsSelectableForVideoExtra(s).length" class="storyboard-extra-asset-open-count">{{
                        assetsSelectableForVideoExtra(s).length
                      }}</span>
                    </button>
                    <button
                      v-if="pipeline.storyboardShotVideoAssetMatch(s).list.length"
                      type="button"
                      class="btn small"
                      title="一键清空本镜当前所有引用的资产"
                      @click.stop="clearAssetsForShot(s)"
                    >
                      清空引用
                    </button>
                    <button
                      v-if="s.videoExcludedAssetIds?.length"
                      type="button"
                      class="btn small"
                      style="opacity: 0.85"
                      title="恢复系统默认的自动匹配资产"
                      @click.stop="restoreAutoAssetsForShot(s)"
                    >
                      恢复默认匹配
                    </button>
                  </div>
                </template>
              </div>
              <div class="shot-video-jobs-cell">
                <template v-if="!pipeline.videoJobsForShotIndex(s.index).length">
                  <code class="video-shot-job-status" data-job="none">未入队</code>
                </template>
                <div v-else class="shot-video-jobs-scroll">
                  <div v-for="j in pipeline.videoJobsForShotIndex(s.index)" :key="j.id" class="shot-video-job-block">
                    <div class="shot-video-job-head">
                      <code class="video-shot-job-status" :data-job="j.status">{{ j.status }}</code>
                      <a
                        v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                        class="job-link"
                        :href="j.resultUrl"
                        target="_blank"
                        rel="noreferrer"
                        >打开链接</a
                      >
                    </div>
                    <span class="hint shot-video-job-msg">{{ j.message }}</span>
                    <div
                      v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                      class="video-preview-tap"
                      role="button"
                      tabindex="0"
                      title="点击在屏幕中央播放"
                      @click="pipeline.openCenterVideoPlay(j.resultUrl)"
                      @keydown.enter.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
                      @keydown.space.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
                    >
                      <video class="video-preview-tap__thumb" :src="j.resultUrl" muted playsinline preload="metadata" />
                      <span class="video-preview-tap__hint">> 居中播放</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <Teleport to="body">
            <div
              v-if="pipeline.storyboardRowContextMenu.visible"
              class="chapter-context-menu"
              :style="{
                left: `${pipeline.storyboardRowContextMenu.x}px`,
                top: `${pipeline.storyboardRowContextMenu.y}px`,
              }"
              @click.stop
            >
              <button
                type="button"
                class="chapter-context-item"
                :disabled="pipeline.generatingShotIds.includes(pipeline.storyboardRowContextMenu.id ?? '')"
                @click="onStoryboardRowMenuAction('generate-image')"
              >
                {{
                  pipeline.generatingShotIds.includes(pipeline.storyboardRowContextMenu.id ?? "")
                    ? "分镜图生成中..."
                    : "生成分镜图"
                }}
              </button>
              <button type="button" class="chapter-context-item" @click="onStoryboardRowMenuAction('image-prompt')">
                分镜图提示词...
              </button>
              <button type="button" class="chapter-context-item" @click="onStoryboardRowMenuAction('video-prompt')">
                视频提示词...
              </button>
              <button type="button" class="chapter-context-item" @click="onStoryboardRowMenuAction('video-run-once')">
                本镜视频直跑
              </button>
              <button
                type="button"
                class="chapter-context-item"
                :disabled="pipeline.publishingEasyImageShotIds.includes(pipeline.storyboardRowContextMenu.id ?? '')"
                @click="onStoryboardRowMenuAction('publish-easyimage')"
              >
                上传图床（分镜 + 本镜参考资产）
              </button>
              <button
                type="button"
                class="chapter-context-item"
                :disabled="pipeline.publishingEasyImageShotIds.includes(pipeline.storyboardRowContextMenu.id ?? '')"
                @click="onStoryboardRowMenuAction('publish-easyimage-and-video')"
              >
                上传图床并直跑（含资产）
              </button>
              <button
                type="button"
                class="chapter-context-item"
                :disabled="pipeline.publishingEasyImageShotIds.includes(pipeline.storyboardRowContextMenu.id ?? '')"
                @click="onStoryboardRowMenuAction('publish-easyimage-shot-only')"
              >
                仅上传分镜关键帧
              </button>
              <button
                type="button"
                class="chapter-context-item"
                :disabled="pipeline.publishingEasyImageShotIds.includes(pipeline.storyboardRowContextMenu.id ?? '')"
                @click="onStoryboardRowMenuAction('publish-easyimage-and-video-shot-only')"
              >
                仅分镜上传并直跑
              </button>
              <button type="button" class="chapter-context-item danger" @click="onStoryboardRowMenuAction('delete')">
                删除分镜
              </button>
            </div>
          </Teleport>
          <div
            v-if="pipeline.videoExtraAttachPopover.visible && pipeline.videoExtraPopoverShot"
            class="video-extra-attach-popover"
            :style="{
              left: `${pipeline.videoExtraAttachPopover.x}px`,
              top: `${pipeline.videoExtraAttachPopover.y}px`,
              width: `${VIDEO_EXTRA_POPOVER_W}px`,
            }"
            role="dialog"
            aria-label="附加资产到本镜视频"
            @click.stop
          >
            <div class="video-extra-attach-popover-inner">
              <div class="video-extra-attach-cats" role="tablist" aria-label="资产分类">
                <button
                  v-for="tab in pipeline.ASSET_FILTER_TABS"
                  :key="'vep-pop-' + tab.key"
                  type="button"
                  class="video-extra-attach-cat"
                  :class="{ active: pipeline.getVideoExtraPickerTab(pipeline.videoExtraPopoverShot.id) === tab.key }"
                  role="tab"
                  @click="pipeline.setVideoExtraPickerTab(pipeline.videoExtraPopoverShot!.id, tab.key)"
                >
                  <span class="video-extra-attach-cat-label">{{ tab.label }}</span>
                  <span class="asset-subtab-count">{{
                    videoExtraPickerTabCount(pipeline.videoExtraPopoverShot, tab.key)
                  }}</span>
                </button>
              </div>
              <div class="video-extra-attach-panel">
                <input
                  type="search"
                  class="input video-extra-attach-search"
                  placeholder="搜索名称、别名、key、prompt..."
                  :value="pipeline.getVideoExtraPickerQuery(pipeline.videoExtraPopoverShot.id)"
                  @input="
                    pipeline.setVideoExtraPickerQuery(
                      pipeline.videoExtraPopoverShot!.id,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
                <div class="video-extra-attach-list">
                  <button
                    v-for="opt in videoExtraPopoverFilteredAssets"
                    :key="opt.id"
                    type="button"
                    class="video-extra-attach-item"
                    @click="pickVideoExtraAssetForShot(pipeline.videoExtraPopoverShot!, opt.id)"
                  >
                    <span class="seai-type">{{ pipeline.assetTypeChipLabel(opt.type) }}</span>
                    <span class="seai-name">{{ opt.name }}</span>
                  </button>
                </div>
                <p v-if="!videoExtraPopoverFilteredAssets.length" class="hint video-extra-attach-empty">
                  当前分类/搜索下无可附加（或已全部加入本镜）
                </p>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!projectsStore.selected.storyboards.length" class="hint">暂无分镜，可点击"新增分镜"。</p>
      </div>
    </article>

    <!-- Video prompt modal (Teleport to body so it overlays properly) -->
    <Teleport to="body">
      <div
        v-if="pipeline.storyboardVideoModalVisible && pipeline.storyboardVideoModalShot"
        class="video-prompt-modal-mask"
        @click.self="closeStoryboardVideoPromptModal"
      >
        <div class="video-prompt-modal-card" @click.stop>
          <div class="row spread" style="align-items: center; flex-wrap: wrap; gap: 10px">
            <h3 style="margin: 0">视频提示词 | 镜头 #{{ pipeline.storyboardVideoModalShot.index }}</h3>
            <button type="button" class="btn" @click="closeStoryboardVideoPromptModal">关闭</button>
          </div>
          <p class="hint" style="margin-top: 10px">基底提示词（可编辑，对应 videoPrompt）。留空则由服务端自动拼接。</p>
          <p v-if="pipeline.storyboardVideoDurationApiHint" class="hint" style="margin-top: 8px">
            {{ pipeline.storyboardVideoDurationApiHint }}
          </p>
          <label class="field block" style="margin-top: 12px">
            <span class="hint">基底提示词</span>
            <textarea
              v-model="pipeline.storyboardVideoDraftPrompt"
              class="area"
              rows="8"
              placeholder="留空则用分镜自动拼接"
            ></textarea>
          </label>
          <div class="row" style="margin-top: 10px; flex-wrap: wrap; gap: 8px">
            <button
              type="button"
              class="btn"
              :disabled="pipeline.storyboardVideoPreviewLoading"
              @click="refreshStoryboardVideoPreview"
            >
              {{ pipeline.storyboardVideoPreviewLoading ? "预览加载中..." : "刷新预览" }}
            </button>
            <button type="button" class="btn" :disabled="ui.busy" @click="saveStoryboardVideoPromptFromModal">
              保存到分镜
            </button>
            <button
              type="button"
              class="btn"
              :disabled="ui.busy || pipeline.videoBatchBusy"
              @click="enqueueStoryboardVideoFromModal"
            >
              保存并入队本镜
            </button>
            <button
              type="button"
              class="btn primary"
              :disabled="ui.busy || pipeline.runningSingleVideoShotIds.includes(pipeline.storyboardVideoModalShot.id)"
              @click="runStoryboardVideoOnceFromModal"
            >
              立即生成视频（直跑）
            </button>
          </div>
          <div v-if="pipeline.storyboardVideoPreviewMatched.length" class="hint" style="margin-top: 12px">
            匹配资产：<span v-for="(a, i) in pipeline.storyboardVideoPreviewMatched" :key="a.id"
              >{{ i ? ", " : "" }}{{ a.name }}</span
            >
          </div>
          <div
            v-if="pipeline.storyboardVideoPreviewSlots.length"
            class="video-ref-preview-block"
            style="margin-top: 14px"
          >
            <div class="hint" style="margin-bottom: 8px">参考图明细</div>
            <table class="video-ref-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>类型</th>
                  <th>名称</th>
                  <th>存储地址</th>
                  <th>解析后 URL</th>
                  <th>进 API</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in pipeline.storyboardVideoPreviewSlots" :key="(row.id || '') + row.storageUrl + i">
                  <td>{{ i + 1 }}</td>
                  <td>{{ row.role === "shot" ? "分镜" : "资产" }}</td>
                  <td>{{ row.name }}</td>
                  <td>
                    <code class="url-cell">{{ row.storageUrl }}</code>
                  </td>
                  <td>
                    <code v-if="row.resolvedUrl" class="url-cell">{{ row.resolvedUrl }}</code
                    ><span v-else class="hint">--</span>
                  </td>
                  <td>{{ row.inApiPayload ? "是" : "否" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <label class="field block" style="margin-top: 14px">
            <span class="hint">送 API 的正文</span>
            <textarea
              :value="pipeline.storyboardVideoTextPayloadPreview"
              class="area"
              rows="8"
              readonly
              tabindex="-1"
            ></textarea>
          </label>
          <label class="field block" style="margin-top: 12px">
            <span class="hint">方舟 Seedance 多模态路径下最终值</span>
            <textarea
              :value="pipeline.storyboardVideoEnrichedPreview"
              class="area"
              rows="8"
              readonly
              tabindex="-1"
            ></textarea>
          </label>
        </div>
      </div>

      <!-- Image prompt modal -->
      <div
        v-if="pipeline.storyboardImageModalVisible && pipeline.storyboardImageModalShot"
        class="video-prompt-modal-mask"
        @click.self="closeStoryboardImagePromptModal"
      >
        <div class="video-prompt-modal-card" @click.stop>
          <div class="row spread" style="align-items: center; flex-wrap: wrap; gap: 10px">
            <h3 style="margin: 0">图片提示词 | 镜头 #{{ pipeline.storyboardImageModalShot.index }}</h3>
            <button type="button" class="btn" @click="closeStoryboardImagePromptModal">关闭</button>
          </div>
          <p class="hint" style="margin-top: 10px">
            基底画面描述（可编辑，对应 imagePrompt）。留空则由服务端自动拼接。
          </p>
          <label class="field block" style="margin-top: 12px">
            <span class="hint">基底提示词</span>
            <textarea
              v-model="pipeline.storyboardImageDraftPrompt"
              class="area"
              rows="8"
              placeholder="单帧起始画面"
            ></textarea>
          </label>
          <div class="row" style="margin-top: 10px; flex-wrap: wrap; gap: 8px">
            <button
              type="button"
              class="btn"
              :disabled="pipeline.storyboardImagePreviewLoading"
              @click="refreshStoryboardImagePreview"
            >
              {{ pipeline.storyboardImagePreviewLoading ? "预览加载中..." : "刷新预览" }}
            </button>
            <button type="button" class="btn" :disabled="ui.busy" @click="saveStoryboardImagePromptFromModal">
              保存到分镜
            </button>
            <button
              type="button"
              class="btn"
              :disabled="ui.busy || pipeline.generatingShotIds.includes(pipeline.storyboardImageModalShot.id)"
              @click="saveAndGenerateStoryboardImageFromModal"
            >
              保存并生成本镜图
            </button>
            <button
              type="button"
              class="btn primary"
              :disabled="ui.busy || pipeline.generatingShotIds.includes(pipeline.storyboardImageModalShot.id)"
              @click="runStoryboardImageOnceFromModal"
            >
              立即生图（直跑）
            </button>
          </div>
          <div v-if="pipeline.storyboardImagePreviewMatched.length" class="hint" style="margin-top: 12px">
            匹配资产：<span v-for="(a, i) in pipeline.storyboardImagePreviewMatched" :key="a.id"
              >{{ i ? ", " : "" }}{{ a.name }}</span
            >
          </div>
          <div
            v-if="pipeline.storyboardImagePreviewSlots.length"
            class="video-ref-preview-block"
            style="margin-top: 14px"
          >
            <div class="hint" style="margin-bottom: 8px">参考图明细</div>
            <table class="video-ref-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>类型</th>
                  <th>名称</th>
                  <th>存储地址</th>
                  <th>解析结果</th>
                  <th>进 API</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in pipeline.storyboardImagePreviewSlots" :key="(row.id || '') + row.storageUrl + i">
                  <td>{{ i + 1 }}</td>
                  <td>{{ row.role === "shot" ? "分镜" : "资产" }}</td>
                  <td>{{ row.name }}</td>
                  <td>
                    <code class="url-cell">{{ row.storageUrl }}</code>
                  </td>
                  <td>
                    <code v-if="row.resolvedUrl" class="url-cell">{{ row.resolvedUrl }}</code
                    ><code v-else-if="row.resolvedUrlPreview" class="url-cell">{{ row.resolvedUrlPreview }}</code
                    ><span v-else class="hint">--</span>
                  </td>
                  <td>{{ row.inApiPayload ? "是" : "否" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <label class="field block" style="margin-top: 14px">
            <span class="hint">完整生图 prompt</span>
            <textarea
              :value="pipeline.storyboardImageFullPreview"
              class="area"
              rows="10"
              readonly
              tabindex="-1"
            ></textarea>
          </label>
        </div>
      </div>
    </Teleport>
  </section>
</template>
