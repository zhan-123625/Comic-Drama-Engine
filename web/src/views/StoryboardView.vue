<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useConfigStore } from "../stores/config";
import { useUiStore } from "../stores/ui";
import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "../constants";
import type { StoryboardShot, VideoRunMode, Project } from "../types";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const cfg = useConfigStore();
const ui = useUiStore();

const ttsLoadingShotId = ref<string | null>(null);

async function onGenerateShotTts(shot: StoryboardShot) {
  if (!projectsStore.selected) return;
  ttsLoadingShotId.value = shot.id;
  try {
    const res = await fetch(`/api/projects/${projectsStore.selected.id}/shots/${shot.id}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: shot.dialogue, model: shot.voice }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.project) {
      projectsStore.mergeProject(data.project);
    } else if (data.audioUrl) {
      shot.audioUrl = data.audioUrl;
      shot.videoRefAudioUrl = data.audioUrl;
    }
    ui.showToast("台词配音生成成功！", "success");
  } catch (e) {
    ui.showToast(`配音失败: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    ttsLoadingShotId.value = null;
  }
}

const VIDEO_EXTRA_POPOVER_W = 440;

function currentBgmUrl(musicText?: string): string {
  const t = (musicText || "").toLowerCase().trim();
  if (t.startsWith("/api/files/")) return t;
  if (projectsStore.selected && t.includes(".")) {
    const fn = t.replace(/^.*[\\/]/, "");
    return `/api/files/projects/${projectsStore.selected.id}/bgm/${fn}`;
  }
  if (t.includes("木琴") || t.includes("逗趣") || t.includes("搞怪") || t.includes("幽默") || t.includes("playful") || t.includes("萌趣")) {
    return "/api/files/bgm/playful_comic.mp3";
  }
  if (t.includes("钢琴") || t.includes("治愈") || t.includes("晨光") || t.includes("温暖") || t.includes("warm")) {
    return "/api/files/bgm/warm_gentle.mp3";
  }
  if (t.includes("悬疑") || t.includes("危机") || t.includes("紧张") || t.includes("惊险") || t.includes("对峙") || t.includes("suspense")) {
    return "/api/files/bgm/suspense_tension.mp3";
  }
  if (t.includes("星火") || t.includes("史诗") || t.includes("科幻") || t.includes("浩瀚") || t.includes("宇宙") || t.includes("epic")) {
    return "/api/files/bgm/epic_spark.mp3";
  }
  if (t.includes("童话") || t.includes("八音盒") || t.includes("竖琴") || t.includes("梦幻") || t.includes("奇幻") || t.includes("dream")) {
    return "/api/files/bgm/fairytale_dream.mp3";
  }
  return "/api/files/bgm/forest_whistle.mp3";
}

const playingBgmUrl = ref<string | null>(null);
let bgmAudioInstance: HTMLAudioElement | null = null;
const remuxingShotId = ref<string | null>(null);
const remuxingAll = ref(false);

async function remuxShotAudio(shot: StoryboardShot) {
  if (!projectsStore.selected) return;
  remuxingShotId.value = shot.id;
  try {
    const res = await fetch(`/api/projects/${projectsStore.selected.id}/shots/${shot.id}/remux-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.project) {
      projectsStore.mergeProject(data.project);
    }
    ui.showToast(`镜头 #${shot.index} 配乐、对白与字幕已成功融合进视频！`, "success");
  } catch (e) {
    ui.showToast(`融合音画失败: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    remuxingShotId.value = null;
  }
}

async function remuxAllVideosAudio() {
  if (!projectsStore.selected) return;
  remuxingAll.value = true;
  try {
    const res = await fetch(`/api/projects/${projectsStore.selected.id}/remux-all-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.project) {
      projectsStore.mergeProject(data.project);
    }
    ui.showToast(`全集融合完成！已成功融合 ${data.remuxedCount} 条镜头视频音轨与字幕！`, "success");
  } catch (e) {
    ui.showToast(`全集融合失败: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    remuxingAll.value = false;
  }
}

async function onUploadCustomBgm(shot: StoryboardShot, event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file || !projectsStore.selected) return;
  try {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const res = await fetch(`/api/projects/${projectsStore.selected!.id}/bgm/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      shot.music = data.file.filename;
      ui.showToast(`自定义配乐「${file.name}」上传成功并已应用！`, "success");
    };
    reader.readAsDataURL(file);
  } catch (e) {
    ui.showToast(`上传配乐失败: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    target.value = "";
  }
}

function togglePlayBgm(musicText?: string) {
  const url = currentBgmUrl(musicText);
  if (bgmAudioInstance && playingBgmUrl.value === url) {
    bgmAudioInstance.pause();
    bgmAudioInstance = null;
    playingBgmUrl.value = null;
    return;
  }
  if (bgmAudioInstance) {
    bgmAudioInstance.pause();
    bgmAudioInstance = null;
  }
  const audio = new Audio(url);
  bgmAudioInstance = audio;
  playingBgmUrl.value = url;
  audio.onended = () => {
    if (bgmAudioInstance === audio) {
      playingBgmUrl.value = null;
      bgmAudioInstance = null;
    }
  };
  audio.onerror = (e) => {
    console.error("BGM audio play error:", e);
    if (bgmAudioInstance === audio) {
      playingBgmUrl.value = null;
      bgmAudioInstance = null;
    }
  };
  audio.play().catch((err) => {
    console.warn("Failed to play BGM:", err);
    if (bgmAudioInstance === audio) {
      playingBgmUrl.value = null;
      bgmAudioInstance = null;
    }
  });
}

onUnmounted(() => {
  if (bgmAudioInstance) {
    bgmAudioInstance.pause();
    bgmAudioInstance = null;
  }
});

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
    await projectsStore.savePatch({ storyboards: p.storyboards });
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
    await projectsStore.savePatch({ storyboards: p.storyboards });
    for (const s of targets) {
      await generateShotImage(s);
    }
  } finally {
    pipeline.generatingBatch = false;
  }
}

async function generateShotImage(
  s: StoryboardShot,
  opts?: { customReferenceUrls?: string[]; promptOverride?: string } | string[],
) {
  const p = projectsStore.selected;
  if (!p) return;
  if (pipeline.generatingShotIds.includes(s.id)) return;
  pipeline.generatingShotIds = [...pipeline.generatingShotIds, s.id];
  try {
    // 关键：先保存当前分镜表的修改（如编辑的画面内容、分镜提示词、手动引用的资产等），避免后端使用旧数据或生图完成后覆盖前端未保存内容
    await projectsStore.savePatch({ storyboards: p.storyboards });

    const payload: { referenceImageUrls?: string[]; promptOverride?: string } = {};
    if (Array.isArray(opts)) {
      if (opts.length) payload.referenceImageUrls = opts;
    } else if (opts) {
      if (opts.customReferenceUrls?.length) {
        payload.referenceImageUrls = opts.customReferenceUrls;
      }
      if (opts.promptOverride?.trim()) {
        payload.promptOverride = opts.promptOverride.trim();
      }
    }
    if (!payload.promptOverride && s.imagePrompt?.trim()) {
      payload.promptOverride = s.imagePrompt.trim();
    }

    const r = await fetch(`/api/projects/${p.id}/storyboards/${s.id}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
  pipeline.closeAllContextMenus();
  const menuWidth = 220;
  const menuHeight = 360;
  const x = Math.min(e.clientX, (window.innerWidth || 1200) - menuWidth);
  const y = Math.min(e.clientY, (window.innerHeight || 800) - menuHeight);
  pipeline.storyboardRowContextMenu.visible = true;
  pipeline.storyboardRowContextMenu.x = Math.max(10, x);
  pipeline.storyboardRowContextMenu.y = Math.max(10, y);
  pipeline.storyboardRowContextMenu.id = id;
  pipeline.storyboardRowContextMenu.targetImageUrl = null;
}

function onStoryboardImageContextMenu(e: MouseEvent, id: string, imageUrl?: string) {
  e.preventDefault();
  e.stopPropagation();
  pipeline.closeAllContextMenus();
  const menuWidth = 220;
  const menuHeight = 360;
  const x = Math.min(e.clientX, (window.innerWidth || 1200) - menuWidth);
  const y = Math.min(e.clientY, (window.innerHeight || 800) - menuHeight);
  pipeline.storyboardRowContextMenu.visible = true;
  pipeline.storyboardRowContextMenu.x = Math.max(10, x);
  pipeline.storyboardRowContextMenu.y = Math.max(10, y);
  pipeline.storyboardRowContextMenu.id = id;
  pipeline.storyboardRowContextMenu.targetImageUrl = imageUrl ?? null;
}

const contextMenuShot = computed(() => {
  const id = pipeline.storyboardRowContextMenu.id;
  if (!id) return null;
  return projectsStore.selected?.storyboards.find((s) => s.id === id) ?? null;
});

const contextMenuShotImages = computed(() => {
  const shot = contextMenuShot.value;
  if (!shot) return [];
  return pipeline.shotImageVariantsForShot(shot);
});

async function deleteShotImage(shotId: string, targetUrl?: string | null) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return;
  ui.busy = true;
  try {
    const query = targetUrl ? `?url=${encodeURIComponent(targetUrl)}` : "";
    const r = await fetch(`/api/projects/${p.id}/shots/${shotId}/image${query}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || "删除分镜图失败");
    }
    const body = (await r.json()) as {
      project: Project;
      remainingUrls?: string[];
    };
    if (body.project) {
      projectsStore.mergeProject(body.project);
    }
    projectsStore.bumpMediaCache(`shot-${shotId}`);
    await pipeline.fetchShotImageVariants(p.id);
    ui.showToast(targetUrl ? "已删除该分镜图" : "已清空分镜图", "info");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    ui.busy = false;
  }
}

async function onStoryboardRowMenuAction(action: string) {
  const p = projectsStore.selected;
  const id = pipeline.storyboardRowContextMenu.id;
  pipeline.storyboardRowContextMenu.visible = false;
  if (!id || !p) return;
  const shot = p.storyboards.find((s) => s.id === id);
  if (!shot) return;
  if (action === "generate-image") void generateShotImage(shot);
  if (action === "delete-image") void deleteShotImage(id, pipeline.storyboardRowContextMenu.targetImageUrl);
  if (action === "delete-all-images") void deleteShotImage(id, null);
  if (action === "attach-assets") {
    pipeline.openVideoExtraAttachPopoverAt(
      shot,
      pipeline.storyboardRowContextMenu.x,
      pipeline.storyboardRowContextMenu.y,
    );
  }
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
  if (pipeline.storyboardImageModalVisible && pipeline.storyboardImageModalShotId === shot.id) {
    void refreshStoryboardImagePreview(false);
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
  if (pipeline.storyboardImageModalVisible && pipeline.storyboardImageModalShotId === shot.id) {
    void refreshStoryboardImagePreview(false);
  }
}

async function restoreAutoAssetsForShot(shot: StoryboardShot) {
  const p = projectsStore.selected;
  if (!p) return;
  shot.videoExcludedAssetIds = [];
  await projectsStore.savePatch({ storyboards: p.storyboards });
  if (pipeline.storyboardImageModalVisible && pipeline.storyboardImageModalShotId === shot.id) {
    void refreshStoryboardImagePreview(false);
  }
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
  if (pipeline.storyboardImageModalVisible && pipeline.storyboardImageModalShotId === shot.id) {
    void refreshStoryboardImagePreview(false);
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
function computeDefaultShotVideoBase(shot: StoryboardShot): string {
  const content = (shot.content || shot.prompt || "").trim();
  const shotNo = (shot.shotNo || "").trim() || String(shot.index ?? "");
  const size = (shot.shotSize || "").trim();
  const camera = (shot.camera || "").trim();

  let camDesc = "摄影机运镜自然平稳，画面稳定连贯";
  if (camera) {
    if (/推|zoom\s*in|push/i.test(camera)) camDesc = "摄影机平稳匀速向前推进，从中景平滑推近至特写，焦点稳稳锁住主体神态与动作核心，镜头平稳无抖动";
    else if (/拉|zoom\s*out|pull/i.test(camera)) camDesc = "摄影机平缓后拉远移，由局部特写徐徐拉开，展现主体与其身处的环境纵深层次";
    else if (/摇|pan/i.test(camera)) camDesc = "摄影机水平平稳摇移，镜头顺畅移动展现环境连贯性与主体视线延伸";
    else if (/跟|跟拍|track|truck/i.test(camera)) camDesc = "摄影机平稳跟拍横移，平滑追踪主体行进动线，构图保持主体在视觉黄金焦点";
    else if (/仰|low\s*angle/i.test(camera)) camDesc = "低机位仰角摄影，强化主体立体感与空间透视张力，镜头轻微跟随主体微动";
    else if (/俯|high\s*angle|top/i.test(camera)) camDesc = "高机位俯视拍摄，清晰展现主体与周围地面、环境的相对空间关系";
    else if (/特写/i.test(camera)) camDesc = "定焦浅景深特写拍摄，主体面部微表情与微观材质细节清晰分明";
    else camDesc = `摄法为【${camera}】，运镜平滑流畅，动态连贯无突兀跳帧`;
  }
  const sizeDesc = size ? `景别设定为【${size}】；` : "";

  const firstMatch = content.match(/(?:【首帧】|\*\*首帧\*\*|首帧[：:])\s*([^\n*【]+)/);
  const dynamicMatch = content.match(/(?:【(?:镜内动态与神态|镜内动态|镜头动态)】|\*\*(?:镜内动态与神态|镜内动态|镜头动态)\*\*|(?:镜内动态与神态|镜内动态|镜头动态)[：:])\s*([^\n*【]+)/);
  const lastMatch = content.match(/(?:【尾帧】|\*\*尾帧\*\*|尾帧[：:])\s*([^\n*【]+)/);

  let firstFrame = firstMatch?.[1]?.trim() || content.split(/[。！？\n]/)[0] || content || "主体在画面中心处于准备动作的稳定起幅姿态。";
  firstFrame = firstFrame.replace(/^镜头\s*\S+[：:]\s*/, "").replace(/[。！？\s]+$/u, "");
  let dynamic = dynamicMatch?.[1]?.trim() || "主体保持自然呼吸与动作起伏，运动流畅舒展，与周围环境产生自然的物理接触与光影互动";
  dynamic = dynamic.replace(/[。！？\s]+$/u, "");
  let lastFrame = lastMatch?.[1]?.trim() || "镜头平稳收束，主体动作自然完成或平稳过渡，画风与光照严格统一";
  lastFrame = lastFrame.replace(/[。！？\s]+$/u, "");

  return [
    `【镜头 ${shotNo} · 运镜与机位调度】\n${sizeDesc}${camDesc}。`,
    `【首帧起幅状态】\n${firstFrame}。`,
    `【镜内动态演变与走位】\n${dynamic}。主体动作连贯流畅，肢体起伏自然，毛发与服饰随运动产生真实物理风动飘拂，运动规律符合重力惯性。`,
    `【微表情与神态细节】\n面部微表情丰富传神，眼神灵动有光，呼吸起伏自然，动作与情绪起承转合层次分明。`,
    `【落幅与终帧收束】\n${lastFrame}。`,
    `【视频画质规范】\n电影级高帧率丝滑动态，高保真物理运动，无噪点无畸变。严禁生成任何对白字幕、文字条、Logo、水印或UI界面。`,
  ].join("\n\n");
}

function setDraftVideoDuration(sec: number) {
  pipeline.storyboardVideoDraftDuration = sec;
  void refreshStoryboardVideoPreview();
}

function clampRoundDraftVideoDuration() {
  const d = pipeline.storyboardVideoDraftDuration;
  if (typeof d !== "number" || !Number.isFinite(d)) {
    pipeline.storyboardVideoDraftDuration = 5;
    return;
  }
  pipeline.storyboardVideoDraftDuration = Math.min(
    SHOT_DURATION_SEC_MAX,
    Math.max(SHOT_DURATION_SEC_MIN, Math.round(d)),
  );
  void refreshStoryboardVideoPreview();
}

function enrichVideoDraftPrompt() {
  const shot = pipeline.storyboardVideoModalShot;
  if (!shot) return;
  if (pipeline.storyboardVideoEnrichedBase?.trim()) {
    pipeline.storyboardVideoDraftPrompt = pipeline.storyboardVideoEnrichedBase.trim();
  } else {
    pipeline.storyboardVideoDraftPrompt = computeDefaultShotVideoBase(shot);
  }
  ui.showToast("已应用丰富电影级动态提示词", "success");
  void refreshStoryboardVideoPreview();
}

function enrichImageDraftPrompt() {
  const shot = pipeline.storyboardImageModalShot;
  if (!shot) return;
  if (pipeline.storyboardImageEnrichedBase?.trim()) {
    pipeline.storyboardImageDraftPrompt = pipeline.storyboardImageEnrichedBase.trim();
  } else {
    pipeline.storyboardImageDraftPrompt = computeDefaultShotImageBase(shot);
  }
  ui.showToast("已应用丰富光影与质感提示词", "success");
  void refreshStoryboardImagePreview();
}

function openStoryboardVideoPromptModal(shotId: string) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return;
  pipeline.storyboardVideoModalShotId = shotId;
  pipeline.storyboardVideoDraftDuration = shot.durationSec ?? 5;

  const localDefaultBase = computeDefaultShotVideoBase(shot);
  pipeline.storyboardVideoDefaultBase = localDefaultBase;
  const hasCustom = Boolean(shot.videoPrompt && shot.videoPrompt.trim());
  pipeline.storyboardVideoDraftPrompt = hasCustom ? shot.videoPrompt!.trim() : localDefaultBase;

  pipeline.storyboardVideoEnrichedPreview = "";
  pipeline.storyboardVideoTextPayloadPreview = "";
  pipeline.storyboardVideoPreviewMatched = [];
  pipeline.storyboardVideoPreviewSlots = [];
  pipeline.storyboardVideoPreviewApiUrls = [];
  pipeline.storyboardVideoDurationApiHint = "";
  pipeline.storyboardVideoModalVisible = true;
  void refreshStoryboardVideoPreview(!hasCustom);
}

function closeStoryboardVideoPromptModal() {
  pipeline.storyboardVideoModalVisible = false;
  pipeline.storyboardVideoModalShotId = null;
}

function resetToDefaultVideoBase() {
  const shot = pipeline.storyboardVideoModalShot;
  if (!shot) return;
  const def = pipeline.storyboardVideoDefaultBase.trim() || computeDefaultShotVideoBase(shot);
  pipeline.storyboardVideoDraftPrompt = def;
  ui.showToast("已恢复默认视频基底提示词", "info");
  void refreshStoryboardVideoPreview();
}

async function refreshStoryboardVideoPreview(fillIfMatchesDefault = false) {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  pipeline.storyboardVideoPreviewLoading = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shot.id}/video-prompt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptOverride: pipeline.storyboardVideoDraftPrompt,
        videoPrompt: pipeline.storyboardVideoDraftPrompt,
        durationSec: pipeline.storyboardVideoDraftDuration,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(body.error ?? "预览失败"));
    pipeline.storyboardVideoTextPayloadPreview = String(body.textPayload ?? "");
    pipeline.storyboardVideoEnrichedPreview = String(body.enrichedText ?? body.enrichedPrompt ?? body.textPayload ?? "");

    if (typeof body.defaultBasePrompt === "string" && body.defaultBasePrompt.trim()) {
      pipeline.storyboardVideoDefaultBase = body.defaultBasePrompt.trim();
    } else if (typeof body.basePrompt === "string" && body.basePrompt.trim()) {
      pipeline.storyboardVideoDefaultBase = body.basePrompt.trim();
    }
    if (typeof body.enrichedBasePrompt === "string" && body.enrichedBasePrompt.trim()) {
      pipeline.storyboardVideoEnrichedBase = body.enrichedBasePrompt.trim();
    }

    if (fillIfMatchesDefault || !pipeline.storyboardVideoDraftPrompt.trim()) {
      const bestBase =
        typeof body.basePrompt === "string" && body.basePrompt.trim()
          ? body.basePrompt.trim()
          : pipeline.storyboardVideoDefaultBase;
      if (bestBase) {
        pipeline.storyboardVideoDraftPrompt = bestBase;
      }
    }

    const rawVideoMatched = body.matchedAssets ?? body.matched;
    pipeline.storyboardVideoPreviewMatched = Array.isArray(rawVideoMatched)
      ? (rawVideoMatched as typeof pipeline.storyboardVideoPreviewMatched)
      : [];
    const rawVideoSlots = body.referenceSlots ?? body.slots;
    pipeline.storyboardVideoPreviewSlots = Array.isArray(rawVideoSlots)
      ? (rawVideoSlots as typeof pipeline.storyboardVideoPreviewSlots)
      : [];
    const rawVideoApiUrls = body.apiImageUrls ?? body.apiUrls;
    pipeline.storyboardVideoPreviewApiUrls = Array.isArray(rawVideoApiUrls) ? (rawVideoApiUrls as string[]) : [];
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
  if (pipeline.storyboardVideoDraftDuration != null && Number.isFinite(pipeline.storyboardVideoDraftDuration)) {
    shot.durationSec = Math.min(
      SHOT_DURATION_SEC_MAX,
      Math.max(SHOT_DURATION_SEC_MIN, Math.round(pipeline.storyboardVideoDraftDuration)),
    );
  }
  await projectsStore.savePatch({ storyboards: p.storyboards });
  ui.showToast("已保存基底提示词与视频时长到分镜", "success");
}

async function enqueueStoryboardVideoFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  shot.videoPrompt = pipeline.storyboardVideoDraftPrompt.trim() || undefined;
  if (pipeline.storyboardVideoDraftDuration != null && Number.isFinite(pipeline.storyboardVideoDraftDuration)) {
    shot.durationSec = Math.min(
      SHOT_DURATION_SEC_MAX,
      Math.max(SHOT_DURATION_SEC_MIN, Math.round(pipeline.storyboardVideoDraftDuration)),
    );
  }
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await enqueueVideos("selected", [shot.id]);
  closeStoryboardVideoPromptModal();
}

async function runStoryboardVideoOnceFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardVideoModalShot;
  if (!p || !shot) return;
  shot.videoPrompt = pipeline.storyboardVideoDraftPrompt.trim() || undefined;
  if (pipeline.storyboardVideoDraftDuration != null && Number.isFinite(pipeline.storyboardVideoDraftDuration)) {
    shot.durationSec = Math.min(
      SHOT_DURATION_SEC_MAX,
      Math.max(SHOT_DURATION_SEC_MIN, Math.round(pipeline.storyboardVideoDraftDuration)),
    );
  }
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await enqueueSingleShotVideo(shot.id);
  closeStoryboardVideoPromptModal();
}

// Image prompt modal
function computeDefaultShotImageBase(shot: StoryboardShot): string {
  let content = (shot.content || shot.prompt || "").trim();
  content = content.replace(/^镜头\s*\S+[：:]\s*/, "");
  const firstFrameMatch = content.match(/(?:【首帧】|\*\*首帧\*\*|首帧[：:])\s*([^\n*【]+)/);
  if (firstFrameMatch && firstFrameMatch[1]) {
    content = firstFrameMatch[1].trim();
  } else {
    const seqMatch = content.match(/^(.*?)(?=然后|接着|随后|继而|忽然|突然|最后|终于|先是|随即|不一会儿|片刻之后|紧接着|下一秒)/);
    if (seqMatch && seqMatch[1] && seqMatch[1].trim().length >= 8) {
      content = seqMatch[1].trim();
    }
  }
  content = content.replace(/^镜头\s*\S+[：:]\s*/, "").replace(/[。！？\s]+$/u, "");

  const shotNo = shot.shotNo || String(shot.index ?? "");
  const size = (shot.shotSize || "").trim();
  const camera = (shot.camera || "").trim();

  const detailBits: string[] = [];
  if (size === "特写" || size === "近景") {
    detailBits.push("面部微表情传神细腻，眼眸清澈带有灵动高光，神态生动，睫毛与毛发根根分明，耳尖泛着柔和透光感");
  } else if (size === "全景" || size === "远景") {
    detailBits.push("主体与空间环境比例自然协调，空气透视与纵深层次丰富，展现出浓郁的空间氛围");
  } else {
    detailBits.push("主体姿态生动自然，肢体语言饱满，与随身物件自然交互，地面接触阴影真实细腻");
  }
  detailBits.push("温暖柔和的自然光照斜洒，斑驳丁达尔微光点缀，浅景深电影柔焦虚化，8k壁纸级细腻画质");

  const lines: string[] = [];
  if (content) {
    if (/^镜头\s*\S+[：:]/.test(content)) {
      lines.push(`${content}。${detailBits.join("，")}。`);
    } else {
      lines.push(`镜头 ${shotNo}：${content}。${detailBits.join("，")}。`);
    }
  }
  const meta: string[] = [];
  if (size && !content.includes(`景别：${size}`)) {
    meta.push(`景别：${size}`);
  }
  if (camera && !content.includes(`摄法：${camera}`)) {
    meta.push(`摄法：${camera}`);
  }
  if (meta.length) lines.push(meta.join("；"));
  return lines.join("\n").trim();
}

function openStoryboardImagePromptModal(shotId: string) {
  const p = projectsStore.selected;
  if (!p) return;
  const shot = p.storyboards.find((s) => s.id === shotId);
  if (!shot) return;
  pipeline.storyboardImageModalShotId = shotId;

  const localDefaultBase = computeDefaultShotImageBase(shot);
  pipeline.storyboardImageDefaultBase = localDefaultBase;
  const hasCustom = Boolean(shot.imagePrompt && shot.imagePrompt.trim());
  pipeline.storyboardImageDraftPrompt = hasCustom ? shot.imagePrompt!.trim() : localDefaultBase;

  pipeline.storyboardImageFullPreview = "";
  pipeline.storyboardImagePreviewMatched = [];
  pipeline.storyboardImagePreviewSlots = [];
  pipeline.storyboardImagePreviewApiUrls = [];
  pipeline.storyboardImageModalVisible = true;

  void refreshStoryboardImagePreview(!hasCustom);
}

function closeStoryboardImagePromptModal() {
  pipeline.storyboardImageModalVisible = false;
  pipeline.storyboardImageModalShotId = null;
}

function resetToDefaultImageBase() {
  const shot = pipeline.storyboardImageModalShot;
  if (!shot) return;
  const def = pipeline.storyboardImageDefaultBase.trim() || computeDefaultShotImageBase(shot);
  pipeline.storyboardImageDraftPrompt = def;
  ui.showToast("已恢复默认基底提示词", "info");
  void refreshStoryboardImagePreview();
}

async function refreshStoryboardImagePreview(fillIfMatchesDefault = false) {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  pipeline.storyboardImagePreviewLoading = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/storyboards/${shot.id}/image-prompt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptOverride: pipeline.storyboardImageDraftPrompt,
        imagePrompt: pipeline.storyboardImageDraftPrompt,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(body.error ?? "预览失败"));
    pipeline.storyboardImageFullPreview = String(body.fullPrompt ?? "");

    if (typeof body.defaultBasePrompt === "string" && body.defaultBasePrompt.trim()) {
      pipeline.storyboardImageDefaultBase = body.defaultBasePrompt.trim();
    } else if (typeof body.basePrompt === "string" && body.basePrompt.trim()) {
      pipeline.storyboardImageDefaultBase = body.basePrompt.trim();
    }
    if (typeof body.enrichedBasePrompt === "string" && body.enrichedBasePrompt.trim()) {
      pipeline.storyboardImageEnrichedBase = body.enrichedBasePrompt.trim();
    }

    if (fillIfMatchesDefault || !pipeline.storyboardImageDraftPrompt.trim()) {
      const bestBase =
        typeof body.basePrompt === "string" && body.basePrompt.trim()
          ? body.basePrompt.trim()
          : pipeline.storyboardImageDefaultBase;
      if (bestBase) {
        pipeline.storyboardImageDraftPrompt = bestBase;
      }
    }

    const rawImageMatched = body.matchedAssets ?? body.matched;
    pipeline.storyboardImagePreviewMatched = Array.isArray(rawImageMatched)
      ? (rawImageMatched as typeof pipeline.storyboardImagePreviewMatched)
      : [];
    const rawImageSlots = body.referenceSlots ?? body.slots;
    pipeline.storyboardImagePreviewSlots = Array.isArray(rawImageSlots)
      ? (rawImageSlots as typeof pipeline.storyboardImagePreviewSlots)
      : [];
    const rawImageApiUrls = body.apiImageUrls ?? body.apiUrls;
    pipeline.storyboardImagePreviewApiUrls = Array.isArray(rawImageApiUrls) ? (rawImageApiUrls as string[]) : [];
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.storyboardImagePreviewLoading = false;
  }
}

const modalAttachedAssets = computed(() => {
  const shot = pipeline.storyboardImageModalShot;
  const p = projectsStore.selected;
  if (!shot || !p) return [];
  const extraIds = new Set((shot.videoExtraAssetIds ?? []).map((x) => String(x).toLowerCase()));
  return p.assets.filter((a) => extraIds.has(a.id.toLowerCase()));
});

function removeAssetFromModalShot(assetId: string) {
  const shot = pipeline.storyboardImageModalShot;
  if (!shot) return;
  void removeAssetFromShot(shot, assetId);
}

function openAssetAttachFromModal(e: MouseEvent) {
  const shot = pipeline.storyboardImageModalShot;
  if (!shot) return;
  pipeline.toggleVideoExtraAttachPopover(shot, e);
}

async function saveStoryboardImagePromptFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  shot.imagePrompt = pipeline.storyboardImageDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
  ui.showToast("已保存基底提示词到分镜", "success");
}

async function saveAndGenerateStoryboardImageFromModal() {
  await saveStoryboardImagePromptFromModal();
  const shot = pipeline.storyboardImageModalShot;
  if (shot) {
    await generateShotImage(shot, {
      promptOverride: pipeline.storyboardImageDraftPrompt.trim() || undefined,
      customReferenceUrls: pipeline.storyboardImagePreviewApiUrls.length
        ? pipeline.storyboardImagePreviewApiUrls
        : undefined,
    });
  }
}

async function runStoryboardImageOnceFromModal() {
  const p = projectsStore.selected;
  const shot = pipeline.storyboardImageModalShot;
  if (!p || !shot) return;
  shot.imagePrompt = pipeline.storyboardImageDraftPrompt.trim() || undefined;
  await projectsStore.savePatch({ storyboards: p.storyboards });
  await generateShotImage(shot, {
    promptOverride: pipeline.storyboardImageDraftPrompt.trim() || undefined,
    customReferenceUrls: pipeline.storyboardImagePreviewApiUrls.length
      ? pipeline.storyboardImagePreviewApiUrls
      : undefined,
  });
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
            :disabled="ui.busy || remuxingAll || !projectsStore.selected.videoJobs.some(j => j.status === 'done')"
            title="一键将设定时长、对白字幕与小说背景音乐融合进所有已生成的分镜视频中（无需重新生成视频画面）"
            @click="remuxAllVideosAudio"
          >
            {{ remuxingAll ? "全镜融合中..." : "🎵 全镜融合配乐与字幕" }}
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
            <div class="shot-video-assets-head" title="自动按文案/提示词匹配，支持手动附加或排除（分镜生图与视频通用）">引用资产（分镜/视频）</div>
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
                  <button
                    v-if="j.status === 'failed'"
                    type="button"
                    class="btn-close-compact"
                    title="清除此报错提示"
                    style="margin-left: 6px; font-size: 11px; cursor: pointer; padding: 0 4px; line-height: 1"
                    @click="pipeline.dismissJob(j.id)"
                  >
                    ✕
                  </button>
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
                        ? '当前采用的参考图（右键可删除分镜图）'
                        : '预览；下方可「采用」为参考图（右键可删除此图）'
                    "
                    @click="pipeline.openImagePreview(projectsStore.mediaSrc(u, `shot-${s.id}`))"
                    @contextmenu="onStoryboardImageContextMenu($event, s.id, u)"
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
                  <div class="row" style="align-items: center; gap: 4px">
                    <input
                      v-model.number="s.durationSec"
                      type="number"
                      :min="SHOT_DURATION_SEC_MIN"
                      :max="SHOT_DURATION_SEC_MAX"
                      step="1"
                      class="input small"
                      style="width: 56px"
                      :placeholder="`秒`"
                      title="视频镜头时长（秒）"
                      @change="clampRoundShotDuration(s)"
                    />
                    <span class="hint" style="font-size: 11px">秒</span>
                    <button
                      v-for="sec in [3, 5, 8, 10]"
                      :key="sec"
                      type="button"
                      class="btn"
                      :class="{ primary: s.durationSec === sec }"
                      style="padding: 1px 6px; font-size: 11px; min-width: unset; height: 26px; line-height: 24px"
                      :title="`快速设为 ${sec} 秒`"
                      @click="s.durationSec = sec; clampRoundShotDuration(s)"
                    >
                      {{ sec }}s
                    </button>
                  </div>
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
                <div v-if="s.dialogue?.trim()" style="font-size: 11px; color: #38bdf8; margin: 4px 0 2px 2px; display: flex; align-items: center; gap: 4px;">
                  <span>💬 成片自动烧录对白字幕</span>
                </div>
                <div v-if="s.dialogue?.trim() || s.audioUrl || s.videoRefAudioUrl" class="shot-tts-actions">
                  <span v-if="s.speaker" class="shot-speaker-badge" :title="`说话人: ${s.speaker}`">{{ s.speaker }}</span>
                  <select v-model="s.voice" class="input shot-voice-select" title="配音音色（空则智能匹配角色或旁白）">
                    <option value="">（智能自动音色：团团配小春，滚滚配龙硕）</option>
                    <optgroup label="✨ CosyVoice-v2 大模型情感音色（强烈推荐）">
                      <option value="cosyvoice-v2:longxiaochun_v2">龙小春 · 灵动萌系女童（团团首选）</option>
                      <option value="cosyvoice-v2:longshuo_v2">龙硕 · 阳光风趣少年（滚滚首选）</option>
                      <option value="cosyvoice-v2:longjielidou_v2">杰力豆 · 卡通幽默搞怪（滚滚卡通风）</option>
                      <option value="cosyvoice-v2:longwan_v2">龙婉 · 温润知性抒情（旁白首选）</option>
                      <option value="cosyvoice-v2:longmiao_v2">龙喵 · 软萌可爱萝莉</option>
                      <option value="cosyvoice-v2:longcheng_v2">龙橙 · 磁性沉稳解说</option>
                    </optgroup>
                    <optgroup label="🎙️ Sambert 备选音色">
                      <option value="sambert-zhiwei-v1">知薇 · 纯真可爱萝莉</option>
                      <option value="sambert-zhiming-v1">知明 · 幽默风趣男声</option>
                      <option value="sambert-zhiting-v1">知婷 · 温柔知性叙事</option>
                      <option value="sambert-zhixiao-v1">知澖 · 活泼亲切女声</option>
                      <option value="sambert-zhichu-v1">知厨 · 沉稳自然男声</option>
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    class="btn small shot-tts-btn"
                    :disabled="ttsLoadingShotId === s.id"
                    @click="onGenerateShotTts(s)"
                  >
                    {{ ttsLoadingShotId === s.id ? "生成中..." : (s.audioUrl || s.videoRefAudioUrl ? "🔄 重新配音" : "🔊 生成台词配音") }}
                  </button>
                  <audio
                    v-if="s.audioUrl || s.videoRefAudioUrl"
                    :src="s.audioUrl || s.videoRefAudioUrl"
                    controls
                    class="shot-audio-control"
                    preload="none"
                  />
                </div>
                <p v-if="shotDialogueMatchesScript(s)" class="hint script-shot-link-hint">台词见于剧本（全文匹配）</p>
                <div class="row" style="margin-top: 8px; gap: 8px; align-items: center">
                  <input v-model="s.music" class="input" style="flex: 1; min-width: 0" placeholder="背景音乐（可空，智能匹配BGM）" />
                  <input v-model="s.sfx" class="input" style="flex: 1; min-width: 0" placeholder="音效（可空）" />
                </div>
                <div class="shot-bgm-toolbar" style="margin-top: 6px; display: flex; flex-direction: column; gap: 5px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 6px 8px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0">
                      <span class="hint" style="font-size: 11px; color: #94a3b8; font-weight: 500; white-space: nowrap">🎵 小说情境配乐</span>
                      <span v-if="s.music?.trim()" style="color: #38bdf8; font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="s.music">
                        · {{ s.music }}
                      </span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <button
                        type="button"
                        class="btn small"
                        :class="{ primary: playingBgmUrl === currentBgmUrl(s.music) }"
                        style="padding: 1px 7px; font-size: 11px; height: 22px; line-height: 20px; color: #00f0ff"
                        :title="playingBgmUrl === currentBgmUrl(s.music) ? '点击停止试听' : '点击试听当前匹配的背景音乐'"
                        @click="togglePlayBgm(s.music)"
                      >
                        {{ playingBgmUrl === currentBgmUrl(s.music) ? "⏹ 停止试听" : "▶ 试听" }}
                      </button>
                      <label class="btn small" style="padding: 1px 7px; font-size: 11px; height: 22px; line-height: 20px; cursor: pointer; color: #a5b4fc" title="上传您本地的小说专属配乐（MP3/WAV）">
                        📁 上传
                        <input type="file" accept="audio/*" style="display: none" @change="onUploadCustomBgm(s, $event)" />
                      </label>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                    <button
                      v-for="b in [
                        { label: '🎋 竹林国风', val: '微风竹林 · 笛韵筝鸣' },
                        { label: '🪵 萌趣日常', val: '萌趣日常 · 欢快木琴与拨弦' },
                        { label: '🎹 治愈温情', val: '温暖治愈 · 晨光微漾钢琴' },
                        { label: '🔍 悬疑紧迫', val: '悬疑紧迫 · 危机低吟脉冲' },
                        { label: '🌌 星火史诗', val: '星火浩瀚 · 史诗科幻管弦' },
                        { label: '🔮 纯真童话', val: '纯真童话 · 梦幻八音盒与竖琴' },
                      ]"
                      :key="b.label"
                      type="button"
                      class="btn small"
                      :class="{ primary: s.music?.includes(b.val.slice(0, 4)) }"
                      style="padding: 1px 6px; font-size: 11px; height: 22px; line-height: 20px; border-radius: 4px;"
                      @click="s.music = b.val"
                    >
                      {{ b.label }}
                    </button>
                  </div>
                </div>
                <textarea
                  v-model="s.prompt"
                  class="area"
                  rows="2"
                  placeholder="分镜提示词 prompt（可留空，填写则补充注入生图）"
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
                      title="手动为本镜头附加指定资产引用（分镜生图与视频通用）"
                      @click.stop="pipeline.toggleVideoExtraAttachPopover(s, $event)"
                    >
                      附加资产引用
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
                    <button
                      v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                      type="button"
                      class="btn small primary"
                      style="width: 100%; margin-top: 6px; font-size: 11px; padding: 2px 6px"
                      :disabled="remuxingShotId === s.id"
                      title="将本镜设定时长、对白字幕与小说背景音乐直接融合进此视频（无需重新排队生成画面）"
                      @click.stop="remuxShotAudio(s)"
                    >
                      {{ remuxingShotId === s.id ? "融合中..." : "🎵 融合配乐与字幕" }}
                    </button>
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
                  <div class="row" style="align-items: center; gap: 4px">
                    <input
                      v-model.number="s.durationSec"
                      type="number"
                      :min="SHOT_DURATION_SEC_MIN"
                      :max="SHOT_DURATION_SEC_MAX"
                      step="1"
                      class="input small"
                      style="width: 56px"
                      :placeholder="`秒`"
                      title="视频镜头时长（秒）"
                      @change="clampRoundShotDuration(s)"
                    />
                    <span class="hint" style="font-size: 11px">秒</span>
                    <button
                      v-for="sec in [3, 5, 8, 10]"
                      :key="sec"
                      type="button"
                      class="btn"
                      :class="{ primary: s.durationSec === sec }"
                      style="padding: 1px 6px; font-size: 11px; min-width: unset; height: 26px; line-height: 24px"
                      :title="`快速设为 ${sec} 秒`"
                      @click="s.durationSec = sec; clampRoundShotDuration(s)"
                    >
                      {{ sec }}s
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <textarea v-model="s.dialogue" class="area" rows="3" placeholder="台词/旁白（可空）" />
                <div v-if="s.dialogue?.trim()" style="font-size: 11px; color: #38bdf8; margin: 4px 0 2px 2px; display: flex; align-items: center; gap: 4px;">
                  <span>💬 成片自动烧录对白字幕</span>
                </div>
                <div v-if="s.dialogue?.trim() || s.audioUrl || s.videoRefAudioUrl" class="shot-tts-actions">
                  <span v-if="s.speaker" class="shot-speaker-badge" :title="`说话人: ${s.speaker}`">{{ s.speaker }}</span>
                  <select v-model="s.voice" class="input shot-voice-select" title="配音音色（空则智能匹配角色或旁白）">
                    <option value="">（智能自动音色：团团配小春，滚滚配龙硕）</option>
                    <optgroup label="✨ CosyVoice-v2 大模型情感音色（强烈推荐）">
                      <option value="cosyvoice-v2:longxiaochun_v2">龙小春 · 灵动萌系女童（团团首选）</option>
                      <option value="cosyvoice-v2:longshuo_v2">龙硕 · 阳光风趣少年（滚滚首选）</option>
                      <option value="cosyvoice-v2:longjielidou_v2">杰力豆 · 卡通幽默搞怪（滚滚卡通风）</option>
                      <option value="cosyvoice-v2:longwan_v2">龙婉 · 温润知性抒情（旁白首选）</option>
                      <option value="cosyvoice-v2:longmiao_v2">龙喵 · 软萌可爱萝莉</option>
                      <option value="cosyvoice-v2:longcheng_v2">龙橙 · 磁性沉稳解说</option>
                    </optgroup>
                    <optgroup label="🎙️ Sambert 备选音色">
                      <option value="sambert-zhiwei-v1">知薇 · 纯真可爱萝莉</option>
                      <option value="sambert-zhiming-v1">知明 · 幽默风趣男声</option>
                      <option value="sambert-zhiting-v1">知婷 · 温柔知性叙事</option>
                      <option value="sambert-zhixiao-v1">知澖 · 活泼亲切女声</option>
                      <option value="sambert-zhichu-v1">知厨 · 沉稳自然男声</option>
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    class="btn small shot-tts-btn"
                    :disabled="ttsLoadingShotId === s.id"
                    @click="onGenerateShotTts(s)"
                  >
                    {{ ttsLoadingShotId === s.id ? "生成中..." : (s.audioUrl || s.videoRefAudioUrl ? "🔄 重新配音" : "🔊 生成台词配音") }}
                  </button>
                  <audio
                    v-if="s.audioUrl || s.videoRefAudioUrl"
                    :src="s.audioUrl || s.videoRefAudioUrl"
                    controls
                    class="shot-audio-control"
                    preload="none"
                  />
                </div>
                <p v-if="shotDialogueMatchesScript(s)" class="hint script-shot-link-hint">台词见于剧本（全文匹配）</p>
                <div class="row" style="margin-top: 8px; gap: 8px; align-items: center">
                  <input v-model="s.music" class="input" style="flex: 1; min-width: 0" placeholder="背景音乐（可空，智能匹配BGM）" />
                  <input v-model="s.sfx" class="input" style="flex: 1; min-width: 0" placeholder="音效（可空）" />
                </div>
                <div class="shot-bgm-toolbar" style="margin-top: 6px; display: flex; flex-direction: column; gap: 5px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 6px 8px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0">
                      <span class="hint" style="font-size: 11px; color: #94a3b8; font-weight: 500; white-space: nowrap">🎵 小说情境配乐</span>
                      <span v-if="s.music?.trim()" style="color: #38bdf8; font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="s.music">
                        · {{ s.music }}
                      </span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <button
                        type="button"
                        class="btn small"
                        :class="{ primary: playingBgmUrl === currentBgmUrl(s.music) }"
                        style="padding: 1px 7px; font-size: 11px; height: 22px; line-height: 20px; color: #00f0ff"
                        :title="playingBgmUrl === currentBgmUrl(s.music) ? '点击停止试听' : '点击试听当前匹配的背景音乐'"
                        @click="togglePlayBgm(s.music)"
                      >
                        {{ playingBgmUrl === currentBgmUrl(s.music) ? "⏹ 停止试听" : "▶ 试听" }}
                      </button>
                      <label class="btn small" style="padding: 1px 7px; font-size: 11px; height: 22px; line-height: 20px; cursor: pointer; color: #a5b4fc" title="上传您本地的小说专属配乐（MP3/WAV）">
                        📁 上传
                        <input type="file" accept="audio/*" style="display: none" @change="onUploadCustomBgm(s, $event)" />
                      </label>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                    <button
                      v-for="b in [
                        { label: '🎋 竹林国风', val: '微风竹林 · 笛韵筝鸣' },
                        { label: '🪵 萌趣日常', val: '萌趣日常 · 欢快木琴与拨弦' },
                        { label: '🎹 治愈温情', val: '温暖治愈 · 晨光微漾钢琴' },
                        { label: '🔍 悬疑紧迫', val: '悬疑紧迫 · 危机低吟脉冲' },
                        { label: '🌌 星火史诗', val: '星火浩瀚 · 史诗科幻管弦' },
                        { label: '🔮 纯真童话', val: '纯真童话 · 梦幻八音盒与竖琴' },
                      ]"
                      :key="b.label"
                      type="button"
                      class="btn small"
                      :class="{ primary: s.music?.includes(b.val.slice(0, 4)) }"
                      style="padding: 1px 6px; font-size: 11px; height: 22px; line-height: 20px; border-radius: 4px;"
                      @click="s.music = b.val"
                    >
                      {{ b.label }}
                    </button>
                  </div>
                </div>
                <input v-model="s.note" class="input" placeholder="备注（可空）" style="margin-top: 8px" />
                <textarea
                  v-model="s.prompt"
                  class="area"
                  rows="2"
                  placeholder="分镜提示词 prompt（可留空，填写则补充注入生图）"
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
                      title="手动为本镜头附加指定资产引用（分镜生图与视频通用）"
                      @click.stop="pipeline.toggleVideoExtraAttachPopover(s, $event)"
                    >
                      附加资产引用
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
                    <button
                      v-if="j.resultUrl && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
                      type="button"
                      class="btn small primary"
                      style="width: 100%; margin-top: 6px; font-size: 11px; padding: 2px 6px"
                      :disabled="remuxingShotId === s.id"
                      title="将本镜设定时长、对白字幕与小说背景音乐直接融合进此视频（无需重新排队生成画面）"
                      @click.stop="remuxShotAudio(s)"
                    >
                      {{ remuxingShotId === s.id ? "融合中..." : "🎵 融合配乐与字幕" }}
                    </button>
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
              @contextmenu.stop.prevent
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
              <button
                v-if="contextMenuShotImages.length"
                type="button"
                class="chapter-context-item danger"
                @click="onStoryboardRowMenuAction('delete-image')"
              >
                {{ pipeline.storyboardRowContextMenu.targetImageUrl ? "删除此分镜图" : "删除分镜图" }}
              </button>
              <button
                v-if="contextMenuShotImages.length > 1 && pipeline.storyboardRowContextMenu.targetImageUrl"
                type="button"
                class="chapter-context-item danger"
                @click="onStoryboardRowMenuAction('delete-all-images')"
              >
                删除该镜所有版本分镜图
              </button>
              <button type="button" class="chapter-context-item" @click="onStoryboardRowMenuAction('attach-assets')">
                🔗 附加资产引用...
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
          <Teleport to="body">
            <div
              v-if="pipeline.videoExtraAttachPopover.visible && pipeline.videoExtraPopoverShot"
              class="video-extra-attach-popover"
              :style="{
                left: `${pipeline.videoExtraAttachPopover.x}px`,
                top: `${pipeline.videoExtraAttachPopover.y}px`,
                width: `${VIDEO_EXTRA_POPOVER_W}px`,
              }"
              role="dialog"
              aria-label="附加资产到本镜"
              @click.stop
            >
              <div class="video-extra-attach-header">
                <span class="video-extra-attach-title">
                  附加资产引用（分镜生图与视频通用） | 镜头 #{{ pipeline.videoExtraPopoverShot.index }}
                </span>
                <button
                  type="button"
                  class="btn-close-compact"
                  title="关闭"
                  @click="pipeline.closeVideoExtraAttachPopover"
                >
                  ✕
                </button>
              </div>
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
          </Teleport>
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
          <p class="hint" style="margin-top: 10px">
            基底提示词（已自动填入当前镜头分镜内容，可直接编辑调整；对应 videoPrompt）。留空则由服务端自动拼接。
          </p>
          <div class="row" style="align-items: center; gap: 8px; margin-top: 10px; padding: 8px 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--color-border); border-radius: 6px">
            <span class="hint" style="font-weight: 600; color: var(--color-text)">⏱ 调整视频时长：</span>
            <input
              v-model.number="pipeline.storyboardVideoDraftDuration"
              type="number"
              :min="SHOT_DURATION_SEC_MIN"
              :max="SHOT_DURATION_SEC_MAX"
              step="1"
              class="input small"
              style="width: 60px"
              @change="clampRoundDraftVideoDuration()"
            />
            <span class="hint">秒</span>
            <div class="row" style="gap: 6px; margin-left: 6px">
              <button
                v-for="sec in [3, 5, 10]"
                :key="sec"
                type="button"
                class="btn small"
                :class="{ primary: pipeline.storyboardVideoDraftDuration === sec }"
                style="padding: 2px 8px; font-size: 12px"
                @click="setDraftVideoDuration(sec)"
              >
                {{ sec }}秒
              </button>
            </div>
            <span class="hint" style="margin-left: auto; font-size: 12px">
              💡 阿里百炼Wanx 2.1建议5s；火山方舟Seedance/可灵支持5s或10s
            </span>
          </div>
          <p v-if="pipeline.storyboardVideoDurationApiHint" class="hint" style="margin-top: 8px">
            {{ pipeline.storyboardVideoDurationApiHint }}
          </p>
          <div class="field block" style="margin-top: 12px">
            <div class="row spread" style="align-items: center; margin-bottom: 6px">
              <span class="hint" style="font-weight: 600; color: var(--color-text)">基底提示词</span>
              <div class="row" style="gap: 8px">
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px; color: var(--color-primary-active)"
                  title="智能丰富电影级运镜、动态细节与微表情"
                  @click="enrichVideoDraftPrompt"
                >
                  ✨ 丰富电影级动态
                </button>
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px"
                  title="重新载入由分镜内容自动生成的默认视频基底"
                  @click="resetToDefaultVideoBase"
                >
                  恢复默认基底
                </button>
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px"
                  title="清空后将由服务端全自动拼接"
                  @click="pipeline.storyboardVideoDraftPrompt = ''"
                >
                  清空
                </button>
              </div>
            </div>
            <textarea
              v-model="pipeline.storyboardVideoDraftPrompt"
              class="area"
              rows="8"
              placeholder="镜头动态与画面基底描述（如：镜头 1：首帧：... 镜内动态与神态：... 尾帧：...）"
            ></textarea>
          </div>
          <div class="row" style="margin-top: 10px; flex-wrap: wrap; gap: 8px">
            <button
              type="button"
              class="btn"
              :disabled="pipeline.storyboardVideoPreviewLoading"
              @click="refreshStoryboardVideoPreview(false)"
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
            基底画面描述（已自动填入当前镜头画面，可直接编辑调整；对应 imagePrompt）。留空则由服务端自动拼接。
          </p>
          <div class="field block" style="margin-top: 12px">
            <div class="row spread" style="align-items: center; margin-bottom: 6px">
              <span class="hint" style="font-weight: 600; color: var(--color-text)">基底提示词</span>
              <div class="row" style="gap: 8px">
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px; color: var(--color-primary-active)"
                  title="智能丰富微表情、光影与电影质感提示词"
                  @click="enrichImageDraftPrompt"
                >
                  ✨ 丰富光影质感
                </button>
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px"
                  title="重新载入分镜内容自动生成的默认基底"
                  @click="resetToDefaultImageBase"
                >
                  恢复默认基底
                </button>
                <button
                  type="button"
                  class="btn"
                  style="padding: 2px 10px; font-size: 12px"
                  title="清空后将由服务端全自动拼接"
                  @click="pipeline.storyboardImageDraftPrompt = ''"
                >
                  清空
                </button>
              </div>
            </div>
            <textarea
              v-model="pipeline.storyboardImageDraftPrompt"
              class="area"
              rows="8"
              placeholder="单帧起始画面基底描述（如：镜头 7：团团战战兢兢睁开一条眼缝。景别：特写；摄法：仰拍）"
            ></textarea>
          </div>
          <div class="row" style="margin-top: 10px; flex-wrap: wrap; gap: 8px">
            <button
              type="button"
              class="btn"
              :disabled="pipeline.storyboardImagePreviewLoading"
              @click="refreshStoryboardImagePreview(false)"
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
          <div class="field block" style="margin-top: 14px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 12px;">
            <div class="row spread" style="align-items: center; margin-bottom: 8px">
              <div style="display: flex; align-items: center; gap: 8px">
                <span style="font-weight: 600; font-size: 13px; color: var(--color-text)">🎨 本分镜引用资产</span>
                <span class="hint" style="font-size: 12px">（勾选的资产作为视觉锚定图与核心设定注入生图）</span>
              </div>
              <button
                type="button"
                class="btn small primary"
                style="padding: 2px 10px; font-size: 12px"
                @click="openAssetAttachFromModal($event)"
              >
                + 增减附加资产
              </button>
            </div>
            <div v-if="modalAttachedAssets.length" class="row" style="gap: 6px; flex-wrap: wrap">
              <span
                v-for="a in modalAttachedAssets"
                :key="a.id"
                class="storyboard-asset-chip-wrap storyboard-asset-chip-wrap--manual"
                style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 4px; font-size: 12px"
              >
                <span style="color: #38bdf8; font-weight: 500">[{{ pipeline.assetTypeChipLabel(a.type) }}]</span>
                <span>{{ a.name }}</span>
                <span v-if="a.imageUrl" style="color: #4ade80; font-size: 11px">（已有参考图）</span>
                <span v-else style="color: #f87171; font-size: 11px">（无图，可去资产页上传）</span>
                <button
                  type="button"
                  style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0 2px; font-size: 14px; line-height: 1"
                  title="移除本镜对此资产的引用"
                  @click="removeAssetFromModalShot(a.id)"
                >×</button>
              </span>
            </div>
            <p v-else class="hint" style="margin: 0; font-size: 12px">
              暂无手动附加资产。点击右上角「+ 增减附加资产」即可勾选本分镜要引用的角色、场景或道具。
            </p>
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
