<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Project } from "../types";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ projects: Project[]; projectsLoadError: string | null }>();
const emit = defineEmits<{ (e: "open-project", id: string): void; (e: "create"): void; (e: "refresh"): void }>();
const query = ref("");
const tab = ref<"projects" | "videos">("projects");
const projectFilter = ref("");
const exports = ref<{ projectId: string; name: string; url: string; createdAt: string }[]>([]);
const exportsError = ref("");
const loading = ref(false);
const playing = ref<{ url: string; title: string } | null>(null);
const playerError = ref("");
const player = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
watch(playing, async (value) => {
  playerError.value = "";
  if (value) {
    previousFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    player.value?.querySelector<HTMLButtonElement>("button")?.focus();
  } else previousFocus?.focus();
});
function playerKeys(e: KeyboardEvent) {
  if (!playing.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    playing.value = null;
  }
  if (e.key === "Tab") {
    const controls = player.value?.querySelectorAll<HTMLElement>("button, video, a[href]");
    if (!controls?.length) return;
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
onMounted(() => window.addEventListener("keydown", playerKeys));
onUnmounted(() => {
  window.removeEventListener("keydown", playerKeys);
  previousFocus?.focus();
});
const statusLabel: Record<string, string> = { idle: "待开始", running: "生成中", done: "已完成", error: "需处理" };
const videos = computed(() =>
  props.projects
    .flatMap((p) => {
      const seen = new Set<string>();
      return p.videoJobs
        .filter((j) => (j.kind ?? "video") === "video" && j.status === "done" && j.resultUrl)
        .filter((j) => {
          if (seen.has(j.resultUrl!)) return false;
          seen.add(j.resultUrl!);
          return true;
        })
        .map((j) => ({
          id: j.id,
          projectId: p.id,
          projectName: p.name,
          title: j.shotIndex != null ? `镜头 ${j.shotIndex}` : "生成视频",
          url: j.resultUrl!,
          poster: p.storyboards.find((s) => s.id === j.shotId)?.imageUrl,
          type: "镜头视频",
        }));
    })
    .concat(
      exports.value
        .filter((v) => props.projects.some((p) => p.id === v.projectId))
        .map((v) => ({
          id: v.url,
          projectId: v.projectId,
          projectName: props.projects.find((p) => p.id === v.projectId)?.name ?? "",
          title: v.name,
          url: v.url,
          poster: undefined,
          type: "合成作品",
        })),
    ),
);
const filteredProjects = computed(() =>
  props.projects.filter((p) => p.name.toLowerCase().includes(query.value.trim().toLowerCase())),
);
const filteredVideos = computed(() =>
  videos.value.filter(
    (v) =>
      (!projectFilter.value || v.projectId === projectFilter.value) &&
      `${v.projectName} ${v.title}`.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
const running = computed(() => props.projects.filter((p) => p.pipelineStatus === "running").length);
async function loadExports() {
  if (loading.value) return;
  loading.value = true;
  exportsError.value = "";
  try {
    const r = await fetch("/api/portfolio/exports");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data.items)) throw new Error("作品数据格式错误");
    exports.value = data.items;
  } catch {
    exportsError.value = "合成作品暂时加载失败，可重试；镜头视频仍可查看。";
  } finally {
    loading.value = false;
  }
}
function refresh() {
  emit("refresh");
  void loadExports();
}
onMounted(loadExports);
</script>

<template>
  <div class="personal-center stack">
    <section class="card profile-intro">
      <div class="profile-heading">
        <AppIcon name="user" :size="32" />
        <div>
          <h3>我的创作空间</h3>
          <p class="hint">从故事到银幕，每一次创作都在这里。</p>
        </div>
        <button class="btn primary" type="button" @click="emit('create')">新建项目</button>
      </div>
      <dl class="portfolio-stats">
        <div>
          <dt>已创建项目</dt>
          <dd>{{ projects.length }}</dd>
        </div>
        <div>
          <dt>视频作品</dt>
          <dd>{{ videos.length }}</dd>
        </div>
        <div>
          <dt>生成中的项目</dt>
          <dd>{{ running }}</dd>
        </div>
      </dl>
    </section>
    <section class="card portfolio-content">
      <div class="portfolio-toolbar">
        <div class="portfolio-tabs" role="group" aria-label="作品分类">
          <button
            type="button"
            :aria-pressed="tab === 'projects'"
            :class="{ active: tab === 'projects' }"
            @click="tab = 'projects'"
          >
            我的项目 <span>{{ projects.length }}</span></button
          ><button
            type="button"
            :aria-pressed="tab === 'videos'"
            :class="{ active: tab === 'videos' }"
            @click="tab = 'videos'"
          >
            视频作品 <span>{{ videos.length }}</span>
          </button>
        </div>
        <button type="button" class="btn small" :disabled="loading" @click="refresh">
          <AppIcon name="refresh" :size="16" />{{ loading ? "刷新中…" : "刷新" }}
        </button>
      </div>
      <div class="portfolio-filters">
        <label class="portfolio-search"
          ><AppIcon name="search" :size="18" /><input
            v-model="query"
            class="input"
            type="search"
            aria-label="搜索项目或作品"
            placeholder="搜索项目或作品" /></label
        ><select v-if="tab === 'videos'" v-model="projectFilter" class="input portfolio-select" aria-label="按项目筛选">
          <option value="">全部项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <p v-if="projectsLoadError" class="err" role="alert">{{ projectsLoadError }}</p>
      <p v-if="exportsError" class="err" role="alert">
        {{ exportsError }} <button class="btn small" type="button" @click="loadExports">重试</button>
      </p>
      <template v-if="tab === 'projects'">
        <div v-if="filteredProjects.length" class="portfolio-projects">
          <button
            v-for="p in filteredProjects"
            :key="p.id"
            class="portfolio-project"
            type="button"
            @click="emit('open-project', p.id)"
          >
            <img
              v-if="p.storyboards.find((s) => s.imageUrl)?.imageUrl"
              :src="p.storyboards.find((s) => s.imageUrl)?.imageUrl"
              alt=""
              loading="lazy"
            /><AppIcon v-else name="storyboard" :size="28" /><span class="portfolio-project-info"
              ><strong>{{ p.name }}</strong
              ><small
                >{{ p.genreType || "未设置题材" }} · {{ p.storyboards.length }} 个分镜 ·
                {{ videos.filter((v) => v.projectId === p.id).length }} 个视频</small
              ></span
            ><span class="badge" :data-status="p.pipelineStatus">{{
              statusLabel[p.pipelineStatus] ?? p.pipelineStatus
            }}</span
            ><AppIcon name="arrow" :size="16" />
          </button>
        </div>
        <div v-else class="portfolio-empty">
          <AppIcon name="projects" :size="36" />
          <h3>{{ query ? "没有匹配的项目" : "开始你的第一部漫剧" }}</h3>
          <p class="hint">{{ query ? "试试其他项目名称。" : "创建项目后，故事、分镜和视频都会汇集到这里。" }}</p>
          <button v-if="!query" class="btn" type="button" @click="emit('create')">创建项目</button>
        </div>
      </template>
      <template v-else>
        <div v-if="filteredVideos.length" class="portfolio-videos">
          <article v-for="v in filteredVideos" :key="v.projectId + v.id" class="portfolio-video">
            <button
              type="button"
              class="portfolio-preview"
              :aria-label="'播放 ' + v.projectName + ' ' + v.title"
              @click="playing = { url: v.url, title: v.projectName + ' · ' + v.title }"
            >
              <img v-if="v.poster" :src="v.poster" alt="" loading="lazy" /><AppIcon
                v-else
                name="video"
                :size="40"
              /><span class="portfolio-play">播放</span><small>{{ v.type }}</small>
            </button>
            <div class="portfolio-video-meta">
              <strong>{{ v.title }}</strong
              ><button type="button" class="portfolio-link" @click="emit('open-project', v.projectId)">
                {{ v.projectName }} ↗</button
              ><a :href="v.url" target="_blank" rel="noopener noreferrer">打开视频</a>
            </div>
          </article>
        </div>
        <div v-else class="portfolio-empty">
          <AppIcon name="video" :size="36" />
          <h3>{{ query || projectFilter ? "没有匹配的视频" : "作品，正在酝酿" }}</h3>
          <p class="hint">
            {{ query || projectFilter ? "调整搜索或项目筛选后再试。" : "生成成功的镜头视频与合成作品会显示在这里。" }}
          </p>
        </div>
      </template>
    </section>
    <Teleport to="body"
      ><div
        v-if="playing"
        class="portfolio-player-mask"
        @click.self="playing = null"
        @keydown.esc.stop="playing = null"
      >
        <section ref="player" class="portfolio-player" role="dialog" aria-modal="true" :aria-label="playing.title">
          <div class="row spread">
            <strong>{{ playing.title }}</strong
            ><button class="btn" type="button" autofocus @click="playing = null">关闭</button>
          </div>
          <p v-if="playerError" class="err" role="alert">{{ playerError }}</p>
          <video
            :key="playing.url"
            tabindex="0"
            :src="playing.url"
            controls
            autoplay
            playsinline
            @error="playerError = '视频无法播放，文件可能已被删除或链接已过期。'"
          />
        </section></div
    ></Teleport>
  </div>
</template>
<style scoped>
.personal-center {
  max-width: 1360px;
  margin: 0 auto;
  gap: 20px;
}
.profile-intro {
  padding: 28px;
}
.profile-heading {
  display: flex;
  align-items: center;
  gap: 16px;
}
.profile-heading h3 {
  margin: 0;
  font-size: 24px;
}
.profile-heading .hint {
  margin-bottom: 0;
}
.profile-heading > .btn {
  margin-left: auto;
  flex-shrink: 0;
}
.portfolio-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 28px 0 0;
  padding-top: 24px;
  border-top: 1px solid #ffffff1c;
}
.portfolio-stats div + div {
  border-left: 1px solid #ffffff1c;
  padding-left: 24px;
}
.portfolio-stats dt {
  color: #aebdce;
  font-size: 13px;
}
.portfolio-stats dd {
  margin: 8px 0 0;
  font-size: 30px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.portfolio-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.portfolio-tabs {
  display: flex;
  gap: 24px;
}
.portfolio-tabs button {
  padding: 12px 0;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #aebdce;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.portfolio-tabs .active {
  color: #ecf7ff;
  border-color: #83c8ef;
}
.portfolio-tabs span {
  margin-left: 5px;
  font-variant-numeric: tabular-nums;
}
.portfolio-filters {
  display: flex;
  gap: 12px;
  margin: 20px 0;
}
.portfolio-search {
  display: flex;
  align-items: center;
  position: relative;
  max-width: 360px;
  flex: 1;
  min-width: 0;
}
.portfolio-search > svg {
  position: absolute;
  left: 12px;
  color: #aebdce;
}
.portfolio-search .input {
  padding-left: 38px;
}
.portfolio-select {
  width: 200px;
}
.portfolio-projects {
  display: grid;
  gap: 8px;
}
.portfolio-project {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #ffffff15;
  background: #ffffff04;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 16px;
  border-radius: 12px;
  font: inherit;
}
.portfolio-project:hover {
  background: #ffffff0c;
}
.portfolio-project > img {
  width: 72px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
}
.portfolio-project-info {
  display: grid;
  gap: 7px;
  flex: 1;
  min-width: 0;
}
.portfolio-project strong {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.portfolio-project small {
  font-size: 12px;
  color: #aebdce;
  line-height: 1.5;
}
.portfolio-empty {
  display: grid;
  justify-items: center;
  text-align: center;
  padding: 52px 20px;
  color: #b4c5d6;
}
.portfolio-empty h3 {
  margin: 20px 0 0;
}
.portfolio-videos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 20px;
}
.portfolio-video {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #ffffff1a;
  border-radius: 14px;
}
.portfolio-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #09111ecc;
  border: 0;
  color: #b9d9e9;
  display: grid;
  place-items: center;
  cursor: pointer;
  overflow: hidden;
}
.portfolio-preview img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.portfolio-preview small {
  position: absolute;
  top: 10px;
  left: 10px;
  background: #0009;
  color: white;
  border-radius: 5px;
  padding: 4px 7px;
}
.portfolio-play {
  position: absolute;
  bottom: 12px;
  right: 12px;
  border: 1px solid #ffffff55;
  border-radius: 999px;
  padding: 6px 14px;
  color: white;
  background: #1119;
  backdrop-filter: blur(12px);
}
.portfolio-video-meta {
  display: grid;
  gap: 10px;
  padding: 16px;
}
.portfolio-video-meta strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.portfolio-link,
.portfolio-video-meta a {
  color: #a8d4ed;
  font: inherit;
  font-size: 12px;
  text-align: left;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  overflow-wrap: anywhere;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid #8bd2fa;
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .profile-intro {
    padding: 20px;
  }
  .profile-heading {
    flex-wrap: wrap;
  }
  .profile-heading > svg {
    display: none;
  }
  .profile-heading h3 {
    font-size: 22px;
  }
  .profile-heading > .btn {
    margin-left: 0;
  }
  .portfolio-stats div + div {
    padding-left: 12px;
  }
  .portfolio-stats dt {
    font-size: 11px;
  }
  .portfolio-filters {
    flex-wrap: wrap;
  }
  .portfolio-search,
  .portfolio-select {
    max-width: none;
    width: 100%;
    flex-basis: 100%;
  }
  .portfolio-tabs {
    gap: 14px;
  }
  .portfolio-project {
    gap: 10px;
    padding: 12px;
  }
  .portfolio-project > img {
    width: 42px;
    height: 42px;
  }
  .portfolio-project > .app-icon:first-child {
    display: none;
  }
}
</style>
<style>
.portfolio-player-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: #000b;
  backdrop-filter: blur(18px);
}
.portfolio-player {
  box-sizing: border-box;
  width: min(100%, 1000px);
  max-height: 95dvh;
  overflow: auto;
  border: 1px solid #ffffff35;
  border-radius: 20px;
  padding: 20px;
  background: #131b28;
  color: #f2f6fc;
}
.portfolio-player video {
  width: 100%;
  max-height: 75dvh;
  margin-top: 16px;
  background: #000;
  border-radius: 10px;
}
</style>
