<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useUiStore } from "../stores/ui";
const ui = useUiStore();
import type { MenuItem, MenuKey, ProjectSummary, SideTabItem, SideTabKey } from "../types";

const props = defineProps<{
  busy?: boolean;
  projects: ProjectSummary[];
  projectsLoadError: string | null;
  selectedId: string | null;
  selected: { id: string; name: string } | null;
  activeMenu: MenuKey;
  activeSideTab: SideTabKey;
  sideTabs: SideTabItem[];
  projectMenus: MenuItem[];
  /** 新建项目页打开时不折叠一级，便于切换 Tab */
  showingCreateProject?: boolean;
}>();

const emit = defineEmits<{
  (e: "select-side-tab", key: SideTabKey): void;
  (e: "open-create"): void;
  (e: "select-project", id: string): void;
  (e: "delete-project", id: string): void;
  (e: "select-project-menu", key: MenuKey): void;
  (e: "clear-project-selection"): void;
}>();

/** 已进入某项目的二级菜单：隐藏一级（侧栏 Tab + 项目列表） */
const projectDrilldown = computed(
  () => props.activeSideTab === "projects" && props.selected != null && props.showingCreateProject !== true,
);
</script>

<template>
  <aside class="sidebar">
    <!-- Brand Header -->
    <div class="brand">
      <div class="brand-title-wrap">
        <AppIcon name="engine" :size="26" class="brand-icon" />
        <h1>漫剧引擎</h1>
        <div class="style-switch" role="group" aria-label="界面风格">
          <button
            v-for="option in [
              { key: 'default', label: '默认' },
              { key: 'glass', label: '新版' },
            ] as const"
            :key="option.key"
            type="button"
            :aria-pressed="ui.interfaceStyle === option.key"
            :class="{ chosen: ui.interfaceStyle === option.key }"
            @click="ui.interfaceStyle = option.key"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <span class="brand-tag">AI COMIC &amp; FILM STUDIO</span>
    </div>

    <!-- Top-level Tab Switcher: Big horizontal buttons across full width -->
    <nav v-if="!projectDrilldown" class="side-tabs" aria-label="主切换">
      <button
        v-for="t in sideTabs"
        :key="t.key"
        type="button"
        class="side-tab-btn"
        :class="{ active: activeSideTab === t.key }"
        @click="emit('select-side-tab', t.key)"
      >
        <AppIcon :name="t.key" class="side-tab-icon" />
        <span class="side-tab-label">{{ t.label }}</span>
      </button>
    </nav>

    <!-- Drilldown Header when inside a project -->
    <div v-if="projectDrilldown" class="sidebar-drill-head">
      <button
        type="button"
        class="sidebar-back-btn"
        title="返回项目列表"
        aria-label="返回项目列表"
        @click="emit('clear-project-selection')"
      >
        <span class="sidebar-back-arrow">‹</span>
        <span>返回项目列表</span>
      </button>
      <div class="sidebar-drill-project-card">
        <div class="sidebar-drill-meta">
          <span class="drill-dot"></span>
          <span class="sidebar-drill-badge">当前项目</span>
        </div>
        <span class="sidebar-drill-project" :title="selected?.name ?? ''">{{ selected?.name ?? "—" }}</span>
      </div>
    </div>

    <!-- Project List (when on projects tab and not in drilldown) -->
    <div v-if="activeSideTab === 'projects' && !projectDrilldown" class="project-box">
      <div class="project-box-header">
        <span class="project-box-title">项目列表</span>
        <span class="project-count-badge">{{ projects.length }}</span>
      </div>
      <p v-if="projectsLoadError" class="sidebar-load-err">{{ projectsLoadError }}</p>
      <ul v-if="projects.length" class="project-list">
        <li v-for="p in projects" :key="p.id" class="project-item-btn" :class="{ active: p.id === selectedId }">
          <button type="button" class="project-select" @click="emit('select-project', p.id)">
            <AppIcon name="storyboard" class="project-icon" /><span class="name">{{ p.name }}</span>
          </button>
          <span class="badge" :data-status="p.pipelineStatus">{{ p.pipelineStatus }}</span>
          <button
            type="button"
            class="btn icon danger delete-btn"
            title="删除项目"
            :disabled="busy"
            @click.stop="emit('delete-project', p.id)"
          >
            ×
          </button>
        </li>
      </ul>
      <p v-else-if="!projectsLoadError" class="hint sidebar-project-empty">暂无项目，点击右上角新建</p>
    </div>

    <!-- Project Submenu (when project is selected): BIG BUTTONS -->
    <nav v-if="activeSideTab === 'projects' && selected" class="menu project-submenu">
      <div class="menu-section-label">工作流导航</div>
      <button
        v-for="m in projectMenus"
        :key="m.key"
        type="button"
        class="menu-item big-menu-btn"
        :class="{ active: activeMenu === m.key }"
        @click="emit('select-project-menu', m.key)"
      >
        <span class="menu-btn-main">
          <AppIcon :name="m.key" class="menu-btn-icon" />
          <span class="menu-btn-title">{{ m.label }}</span>
        </span>
        <span v-if="m.hint" class="menu-btn-hint">{{ m.hint.split("（")[0] }}</span>
      </button>
    </nav>
    <button
      type="button"
      class="profile-entry"
      :class="{ active: activeSideTab === 'profile' }"
      :aria-current="activeSideTab === 'profile' ? 'page' : undefined"
      @click="emit('select-side-tab', 'profile')"
    >
      <AppIcon name="user" :size="22" /><span><strong>个人中心</strong><small>我的项目与视频作品</small></span
      ><AppIcon name="arrow" :size="16" />
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  padding: 16px 14px 20px;
  border-right: 1px solid rgba(56, 189, 248, 0.15);
  background: linear-gradient(180deg, #090e1a 0%, #060912 100%);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  box-sizing: border-box;
  min-width: 0;
}

/* ── Brand ────────────────────────────────────────────────────────── */
.brand {
  margin-bottom: 12px;
  flex-shrink: 0;
}

.brand-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-icon {
  font-size: 1.25rem;
  color: #00f0ff;
  filter: drop-shadow(0 0 8px #00f0ff);
}

.brand h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: 0.06em;
  background: linear-gradient(135deg, #38bdf8 0%, #00f0ff 50%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.35));
}

.brand-tag {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #38bdf8;
  opacity: 0.75;
  margin-top: 3px;
}

/* ── Top-level Tab Switcher (Big full-width buttons) ──────────────── */
.side-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.side-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding: 10px 12px;
  font-size: 13.5px;
  font-weight: 700;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.2);
  background: rgba(13, 20, 36, 0.7);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.side-tab-btn:hover:not(.active) {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(14, 165, 233, 0.15);
  color: #e2eaf4;
  transform: translateY(-1.5px);
}

.side-tab-btn.active {
  border-color: #00f0ff;
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.35) 0%, rgba(6, 182, 212, 0.25) 100%);
  color: #00f0ff;
  box-shadow: 0 0 14px rgba(0, 240, 255, 0.3);
}

.side-tab-icon {
  font-size: 15px;
}

/* ── Drilldown Header & Big Back Button ───────────────────────────── */
.sidebar-drill-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 16px;
}

.sidebar-back-btn {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.3);
  background: rgba(14, 23, 42, 0.85);
  color: #38bdf8;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sidebar-back-btn:hover {
  border-color: #00f0ff;
  background: rgba(14, 165, 233, 0.22);
  color: #00f0ff;
  box-shadow: 0 0 14px rgba(0, 240, 255, 0.3);
  transform: translateX(-2px);
}

.sidebar-back-arrow {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}

.sidebar-drill-project-card {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.2);
  background: rgba(13, 20, 36, 0.8);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sidebar-drill-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.drill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00f0ff;
  box-shadow: 0 0 8px #00f0ff;
}

.sidebar-drill-badge {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 800;
  color: #7dd3fc;
}

.sidebar-drill-project {
  font-size: 14.5px;
  font-weight: 700;
  color: #f8fafc;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Project Box & Items ─────────────────────────────────────────── */
.project-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.project-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}

.project-box-title {
  font-size: 12px;
  font-weight: 700;
  color: #7dd3fc;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.project-count-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  font-weight: 700;
}

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.project-item-btn {
  min-height: 48px;
  padding: 10px 14px;
  border: 1px solid rgba(56, 189, 248, 0.16);
  border-radius: 12px;
  background: rgba(13, 20, 36, 0.7);
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  color: #e2eaf4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.project-item-btn:hover:not(.active) {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(15, 26, 48, 0.9);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

.project-item-btn.active {
  border-color: #00f0ff;
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.3) 0%, rgba(6, 182, 212, 0.2) 100%);
  color: #00f0ff;
  box-shadow: 0 0 16px rgba(0, 240, 255, 0.3);
  font-weight: 700;
}

.project-icon {
  font-size: 16px;
}

.project-item-btn .name {
  font-size: 13.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.sidebar-load-err {
  margin: 0 0 10px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: #fb7185;
  background: rgba(244, 63, 94, 0.15);
  border: 1px solid rgba(244, 63, 94, 0.4);
  border-radius: 8px;
}

.sidebar-project-empty {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: #64748b;
}

/* ── Big Menu Buttons (工作流大导航按钮) ──────────────────────────── */
.project-submenu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}

.menu-section-label {
  font-size: 11px;
  font-weight: 700;
  color: #7dd3fc;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin: 4px 4px 6px;
}

.big-menu-btn {
  width: 100%;
  min-height: 48px;
  padding: 11px 14px;
  border: 1px solid rgba(56, 189, 248, 0.16);
  border-radius: 12px;
  background: rgba(13, 20, 36, 0.7);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.big-menu-btn:hover:not(.active) {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(14, 165, 233, 0.15);
  transform: translateX(3px);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.big-menu-btn.active {
  border-color: #00f0ff;
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.38) 0%, rgba(6, 182, 212, 0.25) 100%);
  color: #00f0ff;
  box-shadow:
    0 0 16px rgba(0, 240, 255, 0.3),
    inset 0 0 10px rgba(0, 240, 255, 0.08);
  font-weight: 700;
  transform: translateX(2px);
}

.menu-btn-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.menu-btn-icon {
  font-size: 16px;
  line-height: 1;
}

.menu-btn-title {
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: inherit;
}

.menu-btn-hint {
  font-size: 11.5px;
  font-weight: 500;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
  text-align: right;
}

.big-menu-btn.active .menu-btn-hint {
  color: #7dd3fc;
}

@media (max-width: 960px) {
  .sidebar {
    height: auto;
    max-height: 440px;
    overflow: hidden;
    border-right: none;
    border-bottom: 1px solid rgba(56, 189, 248, 0.15);
  }

  .project-submenu {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
}

@media (max-width: 640px) {
  .project-submenu {
    grid-template-columns: 1fr;
  }
}
/* The middle region owns scrolling; the footer never shrinks out of view. */
.brand h1 {
  font-size: 21px;
  letter-spacing: 0;
  white-space: nowrap;
}
.brand-title-wrap {
  gap: 7px;
}
.brand-icon {
  filter: none;
}
.style-switch {
  display: flex;
  flex-shrink: 0;
  padding: 3px;
  margin-left: auto;
  border: 1px solid #33465c;
  background: #111b2b;
  border-radius: 999px;
}
.style-switch button {
  border: 0;
  background: transparent;
  color: #a9bacd;
  padding: 4px 7px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  border-radius: 999px;
}
.style-switch .chosen {
  background: #d8edf6;
  color: #13283a;
  box-shadow: 0 1px 5px #0003;
}
.project-box {
  overflow: hidden;
  padding: 10px 6px;
  border: 1px solid #29425980;
  border-radius: 14px;
  background: #08111a60;
}
.project-box-header {
  flex: 0 0 auto;
}
.project-list {
  flex: 1 1 0;
  min-height: 0;
  align-content: start;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  padding: 2px;
}
.project-item-btn {
  padding: 10px 8px;
  gap: 5px;
}
.project-select {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 34px;
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.project-select .name {
  min-width: 0;
}
.project-submenu {
  min-height: 0;
  flex: 1 1 0;
  overscroll-behavior: contain;
}
.big-menu-btn {
  flex-shrink: 0;
}
.profile-entry {
  margin-top: auto;
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 12px;
  border: 1px solid #294259;
  border-radius: 14px;
  background: #0d1424;
  color: #dae8f5;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.project-box + .profile-entry,
.project-submenu + .profile-entry {
  margin-top: 12px;
}
.profile-entry span {
  display: grid;
  gap: 3px;
  flex: 1;
}
.profile-entry strong {
  font-size: 14px;
  font-weight: 600;
}
.profile-entry small {
  color: #99adbf;
  font-size: 11px;
}
.profile-entry.active {
  border-color: #7dd3fc;
  background: #16384b;
}
button:focus-visible {
  outline: 2px solid #7dd3fc;
  outline-offset: 2px;
}
@media (max-width: 960px) {
  .project-box {
    flex: 1 1 auto;
    min-height: 80px;
  }
  .project-list {
    flex: 1 1 auto;
    max-height: 180px;
  }
  .project-submenu {
    display: grid;
    max-height: 170px;
    flex: 1 1 auto;
  }
  .menu-section-label {
    grid-column: 1 / -1;
  }
  .profile-entry {
    margin-top: 12px;
    padding: 10px 12px;
  }
}
</style>
