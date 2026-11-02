import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { AssetLibraryItem, Project, StoryboardImageSize, StoryboardShot } from "../types";
import { normalizeProject } from "../projectUtils";
import { useUiStore } from "./ui";

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref<Project[]>([]);
  const projectsLoadError = ref<string | null>(null);
  const selectedId = ref<string | null>(null);
  const selected = computed(() => projects.value.find((p) => p.id === selectedId.value) ?? null);
  const assetLibrary = ref<AssetLibraryItem[]>([]);

  // Create project draft
  const createDraft = ref<{
    name: string;
    genreType: string;
    artStyle: string;
    videoAspect: string;
    storyboardImageSize: StoryboardImageSize;
  }>({
    name: "",
    genreType: "",
    artStyle: "",
    videoAspect: "16:9",
    storyboardImageSize: "1024x1024",
  });

  // Media cache bust map
  const imageUrlCacheBust = ref<Record<string, number>>({});

  function mediaSrc(url: string | undefined, cacheKey: string): string {
    if (!url?.trim()) return "";
    const u = url.trim();
    const sep = u.includes("?") ? "&" : "?";
    const b = imageUrlCacheBust.value[cacheKey];
    const isLocalApi = u.startsWith("/api/");
    if (!isLocalApi) {
      if (b == null) return u;
      return `${u}${sep}_cb=${b}`;
    }
    const bust = b ?? 0;
    return `${u}${sep}_cb=${bust}`;
  }

  function bumpMediaCache(cacheKey: string) {
    imageUrlCacheBust.value = { ...imageUrlCacheBust.value, [cacheKey]: Date.now() };
  }

  function bumpAllMediaCachesForProject(p: Project) {
    const t = Date.now();
    const next = { ...imageUrlCacheBust.value };
    for (const s of p.storyboards ?? []) {
      if (s.imageUrl?.trim()) next[`shot-${s.id}`] = t;
    }
    for (const a of p.assets ?? []) {
      if (a.imageUrl?.trim()) next[`asset-${a.id}`] = t;
    }
    imageUrlCacheBust.value = next;
  }

  function mergeStoryboardsPreservingShotUi(prev: StoryboardShot[], next: StoryboardShot[]): StoryboardShot[] {
    const prevById = new Map(prev.map((s) => [s.id, s]));
    return next.map((ns) => {
      const os = prevById.get(ns.id);
      if (!os) return ns;
      return {
        ...ns,
        videoRunMode: ns.videoRunMode ?? os.videoRunMode,
        videoModelId: ns.videoModelId ?? os.videoModelId,
        imageModelId: ns.imageModelId ?? os.imageModelId,
        lastFrameImageUrl: ns.lastFrameImageUrl ?? os.lastFrameImageUrl,
        lastFrameRemoteUrl: ns.lastFrameRemoteUrl ?? os.lastFrameRemoteUrl,
        videoRefAudioUrl: ns.videoRefAudioUrl ?? os.videoRefAudioUrl,
        videoRefVideoUrl: ns.videoRefVideoUrl ?? os.videoRefVideoUrl,
      };
    });
  }

  function mergeProject(p: Project) {
    const i = projects.value.findIndex((x) => x.id === p.id);
    if (i !== -1) {
      const prevShots = projects.value[i]!.storyboards;
      const normalized = normalizeProject(p);
      normalized.storyboards = mergeStoryboardsPreservingShotUi(prevShots, normalized.storyboards);
      projects.value[i] = normalized;
    }
  }

  async function loadProjects() {
    const ui = useUiStore();
    try {
      const r = await fetch("/api/projects");
      let raw: unknown;
      try {
        raw = await r.json();
      } catch {
        projectsLoadError.value =
          "无法解析项目列表。常见原因：后端未启动（需监听 3710，与 Vite 代理一致），或本页未通过开发服务器打开。可执行 pnpm dev 或单独 pnpm run dev:server。";
        ui.logs.push(projectsLoadError.value);
        return;
      }
      if (!r.ok) {
        const detail =
          raw && typeof raw === "object" && raw !== null && "error" in raw
            ? ` ${String((raw as { error: unknown }).error)}`
            : "";
        projectsLoadError.value = `加载项目列表失败（HTTP ${r.status}）${detail}`;
        ui.logs.push(projectsLoadError.value);
        return;
      }
      if (!Array.isArray(raw)) {
        projectsLoadError.value = "服务器返回的数据不是项目数组，列表未更新。";
        ui.logs.push(projectsLoadError.value);
        return;
      }
      projectsLoadError.value = null;
      projects.value = raw.map(normalizeProject);
      if (!selectedId.value && projects.value.length) selectedId.value = projects.value[0]!.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      projectsLoadError.value = `加载项目列表失败：${msg}`;
      ui.logs.push(projectsLoadError.value);
    }
  }

  async function createProject() {
    const ui = useUiStore();
    ui.busy = true;
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createDraft.value.name,
          genreType: createDraft.value.genreType,
          artStyle: createDraft.value.artStyle,
          videoAspect: createDraft.value.videoAspect,
          storyboardImageSize: createDraft.value.storyboardImageSize,
        }),
      });
      const p = (await r.json()) as Project;
      await loadProjects();
      selectedId.value = p.id;
      ui.activeSideTab = "projects";
      ui.showingCreateProject = false;
      ui.activeMenu = "overview";
    } finally {
      ui.busy = false;
    }
  }

  async function deleteProject(id: string) {
    const ui = useUiStore();
    if (!confirm("确定删除该项目？数据将从数据库移除，不可恢复。")) return;
    ui.busy = true;
    try {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (r.status === 404) throw new Error("项目不存在");
      if (!r.ok) throw new Error("删除失败");
      if (selectedId.value === id) selectedId.value = null;
      await loadProjects();
    } catch (e) {
      ui.showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      ui.busy = false;
    }
  }

  async function savePatch(
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "sourceText"
        | "script"
        | "artStyle"
        | "genreType"
        | "videoAspect"
        | "storyboardImageSize"
        | "assets"
        | "storyboards"
        | "videoJobs"
      >
    >,
  ) {
    const ui = useUiStore();
    const p = selected.value;
    if (!p) return;
    ui.busy = true;
    try {
      const r = await fetch(`/api/projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("save failed");
      const updated = (await r.json()) as Project;
      mergeProject(updated);
    } finally {
      ui.busy = false;
    }
  }

  async function saveSource() {
    const p = selected.value;
    if (!p) return;
    const ui = useUiStore();
    ui.busy = true;
    try {
      const r = await fetch(`/api/projects/${p.id}/source`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: p.sourceText }),
      });
      const updated = (await r.json()) as Project;
      mergeProject(updated);
    } finally {
      ui.busy = false;
    }
  }

  async function refreshProject() {
    const id = selectedId.value;
    if (!id) return;
    const r = await fetch(`/api/projects/${id}`);
    if (!r.ok) return;
    const p = (await r.json()) as Project;
    mergeProject(p);
  }

  async function refreshProjectAndBustImages() {
    await refreshProject();
    const p = selected.value;
    if (p) bumpAllMediaCachesForProject(p);
  }

  async function loadAssetLibrary() {
    const r = await fetch("/api/assets/library");
    if (!r.ok) throw new Error(`加载资产库失败：HTTP ${r.status}`);
    const data = (await r.json()) as { items?: AssetLibraryItem[] };
    assetLibrary.value = Array.isArray(data.items) ? data.items : [];
  }

  function openProjectDetail(id: string) {
    const ui = useUiStore();
    selectedId.value = id;
    ui.activeSideTab = "projects";
    ui.showingCreateProject = false;
    ui.activeMenu = "overview";
  }

  return {
    projects,
    projectsLoadError,
    selectedId,
    selected,
    assetLibrary,
    createDraft,
    imageUrlCacheBust,
    mediaSrc,
    bumpMediaCache,
    bumpAllMediaCachesForProject,
    mergeProject,
    loadProjects,
    createProject,
    deleteProject,
    savePatch,
    saveSource,
    refreshProject,
    refreshProjectAndBustImages,
    loadAssetLibrary,
    openProjectDetail,
  };
});
