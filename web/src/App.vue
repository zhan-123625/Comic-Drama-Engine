<script setup lang="ts">
/**
 * App.vue — root shell. Logic is split into Pinia stores + composables;
 * child views/components own their UI and styles.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { menus, projectMenus, sideTabs } from "./constants";
import SidebarPanel from "./components/SidebarPanel.vue";
import ToastContainer from "./components/ToastContainer.vue";
import SettingsModal from "./components/SettingsModal.vue";
import CreateProjectForm from "./components/CreateProjectForm.vue";
import ProjectOverview from "./components/ProjectOverview.vue";
import "./global-styles.css";
import SourceEditor from "./components/SourceEditor.vue";
import AssetLibrary from "./components/AssetLibrary.vue";
import StoryboardView from "./views/StoryboardView.vue";
import VideoJobsView from "./views/VideoJobsView.vue";
import VideoTimelineView from "./views/VideoTimelineView.vue";
import ScriptEditor from "./views/ScriptEditor.vue";
import PipelinePanel from "./views/PipelinePanel.vue";
import AssetManager from "./views/AssetManager.vue";
import { buildEditorPatch } from "./projectUtils";
import type { MenuKey, SideTabKey, StoryboardImageSize } from "./types";

import { useProjectsStore } from "./stores/projects";
import { useUiStore } from "./stores/ui";
import { useConfigStore } from "./stores/config";
import { usePipelineStore } from "./stores/pipeline";
import { useScrollMemory } from "./composables/useScrollMemory";
import { useGlobalKeyboard } from "./composables/useGlobalKeyboard";

// ─── Store 初始化 ───────────────────────────────────────────────
const projectsStore = useProjectsStore();
const ui = useUiStore();
const cfg = useConfigStore();
const pipeline = usePipelineStore();

// ─── 响应式状态 (storeToRefs) ───────────────────────────────────
const { projects, projectsLoadError, selectedId, selected, createDraft } = storeToRefs(projectsStore);

const { activeMenu, activeSideTab, showingCreateProject, busy } = storeToRefs(ui);

const { centerVideoUrl, previewImageUrl, previewScale, previewOffsetX, previewOffsetY, previewDragging } =
  storeToRefs(pipeline);

// ─── Store 函数 ─────────────────────────────────────────────────
const { loadProjects, createProject, deleteProject, savePatch, refreshProjectAndBustImages, openProjectDetail } =
  projectsStore;

const { loadVolcenginePresets, loadBailianPresets, loadRemoteConfig, saveRemoteConfig, ensureCfgSections } = cfg;

const {
  subscribeEvents,
  closeEvents,
  rebuildSourceChaptersFromSelected,
  rebuildScriptChapters,
  closeCenterVideoPlay,
  closeImagePreview,
  onPreviewWheel,
  onPreviewMouseDown,
  onPreviewMouseMove,
  onPreviewMouseUp,
  closeAllContextMenus,
} = pipeline;

// ─── Composables ────────────────────────────────────────────────
function workspaceScrollKeyFrom(side: SideTabKey, projId: string | null, create: boolean, menu: MenuKey): string {
  if (side === "settings") return "side:settings";
  if (side === "projects" && create) return "projects:create";
  if (side === "projects" && !projId) return "projects:list";
  return `proj:${projId}:${menu}`;
}
function workspaceViewScrollKey(): string {
  return workspaceScrollKeyFrom(activeSideTab.value, selectedId.value, showingCreateProject.value, activeMenu.value);
}

const { workspaceScrollEl, saveScroll, restoreScroll } = useScrollMemory(workspaceViewScrollKey);

function onEscClose(_e: KeyboardEvent) {
  if (centerVideoUrl.value) {
    closeCenterVideoPlay();
    return;
  }
  closeAllContextMenus();
}
useGlobalKeyboard(onEscClose, closeAllContextMenus);

// ─── 根组件 UI 状态 ────────────────────────────────────────────
const createProjectCardRef = ref<HTMLElement | null>(null);
const createProjectFormRef = ref<InstanceType<typeof CreateProjectForm> | null>(null);

const sidebarProjectDrilldown = computed(
  () => activeSideTab.value === "projects" && selected.value != null && !showingCreateProject.value,
);

const stats = computed(() => {
  const p = selected.value;
  if (!p) return { source: 0, script: 0, shots: 0, jobs: 0 };
  return {
    source: (p.sourceText ?? "").length,
    script: (p.script ?? "").length,
    shots: p.storyboards.length,
    jobs: p.videoJobs.length,
  };
});

// ─── 根组件函数 ────────────────────────────────────────────────
function onClearProjectSelection() {
  selectedId.value = null;
  activeMenu.value = "overview";
}
function onSelectSideTab(t: SideTabKey) {
  activeSideTab.value = t;
  showingCreateProject.value = false;
  if (t === "settings") activeMenu.value = "settings";
  else if (t === "projects") activeMenu.value = "overview";
}
async function openCreateProjectPage() {
  activeSideTab.value = "projects";
  showingCreateProject.value = true;
  activeMenu.value = "overview";
  await nextTick();
  createProjectCardRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  createProjectFormRef.value?.focus();
}
async function flushCurrentMenu() {
  if (showingCreateProject.value) return;
  if (activeMenu.value === "settings") {
    await saveRemoteConfig();
    return;
  }
  const p = selected.value;
  if (!p) return;
  if (activeMenu.value === "overview" || activeMenu.value === "source" || activeMenu.value === "script") {
    await savePatch(buildEditorPatch(p));
    return;
  }
  if (activeMenu.value === "storyboard") {
    await savePatch({ storyboards: p.storyboards });
    return;
  }
  if (activeMenu.value === "jobs") {
    await savePatch({ videoJobs: p.videoJobs });
    return;
  }
}

// ─── Watchers ──────────────────────────────────────────────────
watch(activeMenu, (k) => {
  try {
    localStorage.setItem("my-app.activeMenu", k);
  } catch {
    /* ignore */
  }
  if (k === "settings") {
    showingCreateProject.value = false;
    activeSideTab.value = "settings";
    ensureCfgSections();
    loadRemoteConfig();
    loadVolcenginePresets();
    loadBailianPresets();
  }
});
watch(
  () => selected.value?.id,
  () => {
    rebuildSourceChaptersFromSelected();
    rebuildScriptChapters();
    if (selectedId.value) subscribeEvents(selectedId.value);
    else closeEvents();
  },
);
watch(
  [activeMenu, selectedId, activeSideTab, showingCreateProject],
  async (_n, oldVals) => {
    if (oldVals) {
      const [pm, ps, pt, pc] = oldVals as [MenuKey, string | null, SideTabKey, boolean];
      saveScroll(workspaceScrollKeyFrom(pt, ps, pc, pm));
    }
    await nextTick();
    restoreScroll();
  },
  { flush: "post" },
);

// ─── 生命周期 ──────────────────────────────────────────────────
onMounted(() => {
  loadVolcenginePresets();
  loadBailianPresets();
  try {
    const saved = localStorage.getItem("my-app.activeMenu") as MenuKey | null;
    if (saved && [...menus, ...projectMenus].some((m) => m.key === saved)) activeMenu.value = saved;
  } catch {
    /* ignore */
  }
  if (!projects.value.length) activeMenu.value = activeSideTab.value === "settings" ? "settings" : "overview";
});

void loadProjects();
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--project-drilldown': sidebarProjectDrilldown }">
    <SidebarPanel
      :busy="busy"
      :projects="projects"
      :projects-load-error="projectsLoadError"
      :selected-id="selectedId"
      :selected="selected"
      :active-menu="activeMenu"
      :active-side-tab="activeSideTab"
      :side-tabs="sideTabs"
      :project-menus="projectMenus"
      :showing-create-project="showingCreateProject"
      @select-side-tab="onSelectSideTab"
      @open-create="openCreateProjectPage"
      @select-project="openProjectDetail"
      @delete-project="deleteProject"
      @select-project-menu="activeMenu = $event"
      @clear-project-selection="onClearProjectSelection"
    />

    <main class="workspace">
      <header class="topbar workspace-topbar">
        <div>
          <h2>
            {{
              activeSideTab === "settings"
                ? "全局设置"
                : showingCreateProject
                  ? "新建项目"
                  : (selected?.name ?? "项目列表")
            }}
          </h2>
          <p v-if="selected" class="hint">项目 ID：{{ selected.id }}</p>
        </div>
        <div class="actions">
          <button v-if="activeSideTab === 'projects'" class="btn" type="button" :disabled="busy" @click="loadProjects">
            刷新项目列表
          </button>
          <button
            v-if="activeSideTab === 'projects'"
            class="btn primary"
            type="button"
            :disabled="busy"
            @click="openCreateProjectPage"
          >
            新建项目
          </button>
          <button v-if="selected" class="btn danger" type="button" :disabled="busy" @click="deleteProject(selected.id)">
            删除项目
          </button>
          <button v-if="selected" class="btn" type="button" :disabled="busy" @click="refreshProjectAndBustImages">
            刷新
          </button>
          <button class="btn primary" type="button" :disabled="busy" @click="flushCurrentMenu">保存当前页</button>
        </div>
      </header>

      <div ref="workspaceScrollEl" class="workspace-scroll">
        <section v-if="activeSideTab === 'projects' && !showingCreateProject && !selected" class="card">
          <h3>项目列表</h3>
          <p v-if="projectsLoadError" class="err">{{ projectsLoadError }}</p>
          <p v-if="projects.length" class="hint">请选择左侧项目进入详情。</p>
          <template v-else>
            <p v-if="!projectsLoadError" class="hint">暂无项目，请先新建项目开始。</p>
            <p v-else class="hint">
              数据文件位于应用目录下
              <code>data/app.db</code
              >（相对后端工作目录）。若你确认未删除数据库却仍为空，多半是连到了另一份空库或后端未启动导致未加载成功。
            </p>
          </template>
        </section>

        <section v-else-if="activeSideTab === 'projects' && showingCreateProject" class="stack">
          <div ref="createProjectCardRef">
            <CreateProjectForm ref="createProjectFormRef" :busy="busy" :draft="createDraft" @create="createProject" />
          </div>
        </section>

        <ProjectOverview
          v-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'overview' && selected"
          :name="selected.name"
          :art-style="selected.artStyle"
          :genre-type="selected.genreType"
          :video-aspect="selected.videoAspect"
          :storyboard-image-size="selected.storyboardImageSize"
          :pipeline-status="selected.pipelineStatus ?? 'idle'"
          :source-length="stats.source"
          :script-length="stats.script"
          :shots-count="stats.shots"
          :jobs-count="stats.jobs"
          @update:name="selected.name = $event"
          @update:art-style="selected.artStyle = $event"
          @update:genre-type="selected.genreType = $event"
          @update:video-aspect="selected.videoAspect = $event"
          @update:storyboard-image-size="selected.storyboardImageSize = $event as StoryboardImageSize"
        />

        <PipelinePanel
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'pipeline' && selected"
        />

        <SourceEditor
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'source' && selected"
        />

        <ScriptEditor
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'script' && selected"
        />

        <AssetManager
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'assets' && selected"
        />

        <AssetLibrary
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'assetLibrary' && selected"
        />

        <StoryboardView
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'storyboard' && selected"
        />

        <VideoJobsView
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'video' && selected"
        />

        <VideoJobsView
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'jobs' && selected"
        />

        <VideoTimelineView
          v-else-if="activeSideTab === 'projects' && !showingCreateProject && activeMenu === 'timeline' && selected"
        />

        <SettingsModal v-if="activeSideTab === 'settings' && activeMenu === 'settings'" />
      </div>
    </main>

    <div v-if="previewImageUrl" class="image-preview-mask" @click="closeImagePreview">
      <div class="image-preview-card" @click.stop>
        <button class="btn image-preview-close" type="button" @click="closeImagePreview">关闭</button>
        <div
          class="image-preview-viewport"
          :class="{ dragging: previewDragging }"
          @wheel.prevent="onPreviewWheel"
          @mousedown="onPreviewMouseDown"
          @mousemove="onPreviewMouseMove"
          @mouseup="onPreviewMouseUp"
          @mouseleave="onPreviewMouseUp"
        >
          <img
            :src="previewImageUrl"
            alt="分镜大图预览"
            :style="{ transform: `translate(${previewOffsetX}px, ${previewOffsetY}px) scale(${previewScale})` }"
          />
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="centerVideoUrl" class="video-lightbox-backdrop" @click.self="closeCenterVideoPlay">
      <div class="video-lightbox-dialog" role="dialog" aria-modal="true" aria-label="视频播放" @click.stop>
        <button type="button" class="video-lightbox-close" aria-label="关闭" @click="closeCenterVideoPlay">×</button>
        <video :key="centerVideoUrl" class="video-lightbox-video" :src="centerVideoUrl" controls playsinline autoplay />
      </div>
    </div>
  </Teleport>

  <ToastContainer />
</template>

<style scoped>
/* ── App shell layout ───────────────────────────────────────────── */
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  background: radial-gradient(circle at 12% 10%, #101c36 0%, #080d1a 45%, #04070f 100%);
  color: #e2eaf4;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    sans-serif;
  color-scheme: dark;
  overflow: hidden;
}

.app-shell--project-drilldown {
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
}

/* ── Workspace ──────────────────────────────────────────────────── */
.workspace {
  padding: 18px 26px 28px;
  height: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.workspace.empty {
  color: #8ea0ba;
}

.workspace-topbar {
  flex: 0 0 auto;
}

.workspace-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 28px;
}

/* ── Topbar ─────────────────────────────────────────────────────── */
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.topbar h2 {
  margin: 0;
  font-size: 1.32rem;
  font-weight: 800;
  color: #f8fafc;
  letter-spacing: 0.02em;
  text-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
}

.topbar p {
  margin: 4px 0 0;
  color: #7dd3fc;
  font-size: 12.5px;
  letter-spacing: 0.01em;
}

/* ── Responsive: app shell ──────────────────────────────────────── */
@media (max-width: 960px) {
  .app-shell {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }

  .workspace {
    height: auto;
    padding: 14px 14px 18px;
    overflow: visible;
  }

  .workspace-scroll {
    overflow: visible;
    padding-bottom: 0;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>

<style>
/* 让右侧详情区域滚动（非整页滚动），侧栏保持稳定 */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

#app {
  height: 100%;
}
</style>
