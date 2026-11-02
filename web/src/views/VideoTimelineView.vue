<script setup lang="ts">
import { computed, ref } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();
const collapsed = ref(false);
const concatLoading = ref(false);

interface TimelineSegment {
  id: string;
  index: number;
  shotNo: string;
  sceneNo: number | undefined;
  duration: number;
  imageUrl: string | undefined;
  videoUrl: string | null;
  jobStatus: string;
}

const PX_PER_SEC = 60;

const segments = computed<TimelineSegment[]>(() => {
  const p = projectsStore.selected;
  if (!p) return [];
  return p.storyboards.map((shot) => {
    const job = pipeline.latestVideoJobByShotIndex(shot.index);
    const duration = typeof shot.durationSec === "number" && shot.durationSec > 0 ? shot.durationSec : 3;
    const hasVideo = job?.status === "done" && job.resultUrl && pipeline.isLikelyVideoResultUrl(job.resultUrl);
    return {
      id: shot.id,
      index: shot.index,
      shotNo: shot.shotNo || `#${shot.index}`,
      sceneNo: shot.sceneNo,
      duration,
      imageUrl: shot.imageUrl,
      videoUrl: hasVideo ? job!.resultUrl! : null,
      jobStatus: job?.status ?? "none",
    };
  });
});

const totalDuration = computed(() => segments.value.reduce((sum, s) => sum + s.duration, 0));

function segWidth(seg: TimelineSegment): string {
  return Math.max(80, seg.duration * PX_PER_SEC) + "px";
}

function showSceneBoundary(seg: TimelineSegment, i: number): boolean {
  if (seg.sceneNo == null) return false;
  if (i === 0) return true;
  return seg.sceneNo !== segments.value[i - 1]?.sceneNo;
}

function onThumbClick(seg: TimelineSegment) {
  if (seg.videoUrl) {
    pipeline.openCenterVideoPlay(seg.videoUrl);
  } else if (seg.imageUrl) {
    pipeline.openImagePreview(projectsStore.mediaSrc(seg.imageUrl, `shot-${seg.id}`));
  }
}

const doneCount = computed(() => segments.value.filter((s) => s.jobStatus === "done").length);
const runningCount = computed(() => segments.value.filter((s) => s.jobStatus === "running").length);
const failedCount = computed(() => segments.value.filter((s) => s.jobStatus === "failed").length);

async function concatVideos() {
  const p = projectsStore.selected;
  if (!p || concatLoading.value) return;
  concatLoading.value = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/videos/concat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      ui.showToast(data?.message || data?.error || "拼接失败", "error");
      return;
    }
    window.open(data.url, "_blank");
    ui.showToast("视频拼接完成", "success");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "拼接失败", "error");
  } finally {
    concatLoading.value = false;
  }
}
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <article v-if="segments.length" class="card">
      <div class="row spread page-toolbar-sticky">
        <div class="row" style="gap: 10px; align-items: center">
          <button
            class="timeline-toggle"
            type="button"
            :title="collapsed ? '展开' : '收起'"
            @click="collapsed = !collapsed"
          >
            {{ collapsed ? "▸" : "▾" }}
          </button>
          <h3 style="margin: 0">视频时间线</h3>
          <span class="hint">{{ segments.length }} 镜 | 共 {{ totalDuration }}s</span>
          <span v-if="doneCount" class="timeline-stat timeline-stat--done">{{ doneCount }} 完成</span>
          <span v-if="runningCount" class="timeline-stat timeline-stat--running">{{ runningCount }} 进行</span>
          <span v-if="failedCount" class="timeline-stat timeline-stat--failed">{{ failedCount }} 失败</span>
        </div>
        <button type="button" class="btn btn-sm" :disabled="!doneCount || concatLoading" @click="concatVideos">
          {{ concatLoading ? "拼接中..." : "导出完整视频" }}
        </button>
      </div>

      <div v-show="!collapsed" class="timeline-body">
        <div class="timeline-scroll">
          <div class="timeline-track">
            <template v-for="(seg, i) in segments" :key="seg.id">
              <div v-if="showSceneBoundary(seg, i)" class="timeline-scene-boundary">
                <span class="timeline-scene-label">场{{ seg.sceneNo }}</span>
              </div>
              <div class="timeline-seg" :style="{ width: segWidth(seg) }" :class="`timeline-seg--${seg.jobStatus}`">
                <div class="timeline-seg-thumb" @click="onThumbClick(seg)">
                  <video
                    v-if="seg.videoUrl"
                    class="timeline-seg-video"
                    :src="seg.videoUrl"
                    muted
                    playsinline
                    preload="metadata"
                  />
                  <img v-else-if="seg.imageUrl" :src="projectsStore.mediaSrc(seg.imageUrl, `shot-${seg.id}`)" alt="" />
                  <span v-else class="hint">无素材</span>
                </div>
                <div class="timeline-seg-info">
                  <strong>{{ seg.shotNo }}</strong>
                  <span class="hint">{{ seg.duration }}s</span>
                </div>
                <span class="timeline-seg-dot" :data-status="seg.jobStatus" />
              </div>
            </template>
          </div>
        </div>
      </div>
    </article>

    <article v-else class="card">
      <h3>视频时间线</h3>
      <p class="hint">暂无分镜数据。请先在「分镜」页面生成分镜，时间线将自动展示。</p>
    </article>
  </section>
</template>

<style scoped>
.timeline-toggle {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: rgba(13, 20, 36, 0.7);
  color: #7dd3fc;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.timeline-toggle:hover {
  border-color: #00f0ff;
  background: rgba(14, 165, 233, 0.2);
  color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
  transform: scale(1.05);
}

.timeline-stat {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
}
.timeline-stat--done {
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.12);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
}
.timeline-stat--running {
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.12);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
}
.timeline-stat--failed {
  color: #fb7185;
  border-color: rgba(244, 63, 94, 0.4);
  background: rgba(244, 63, 94, 0.12);
}

.timeline-body {
  margin-top: 12px;
}

.timeline-scroll {
  overflow-x: auto;
  padding: 8px 0;
}

.timeline-track {
  display: flex;
  align-items: stretch;
  min-height: 104px;
}

.timeline-scene-boundary {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}
.timeline-scene-label {
  writing-mode: vertical-lr;
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  padding: 6px 4px;
  border-left: 2px solid #0284c7;
  letter-spacing: 2px;
  white-space: nowrap;
  min-height: 80px;
  display: flex;
  align-items: center;
  text-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
}

.timeline-seg {
  flex-shrink: 0;
  min-width: 90px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-right: none;
  background: rgba(10, 16, 30, 0.85);
  position: relative;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.timeline-seg:last-child {
  border-right: 1px solid rgba(56, 189, 248, 0.15);
}
.timeline-seg:hover {
  border-color: #00f0ff;
  background: rgba(14, 25, 48, 0.95);
  transform: translateY(-2px);
  z-index: 2;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.5),
    0 0 12px rgba(0, 240, 255, 0.25);
}

.timeline-seg--done {
  border-top: 3px solid #10b981;
}
.timeline-seg--running {
  border-top: 3px solid #f59e0b;
}
.timeline-seg--queued {
  border-top: 3px solid #00f0ff;
}
.timeline-seg--failed {
  border-top: 3px solid #f43f5e;
}

.timeline-seg-thumb {
  flex: 1;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  background: #000000;
}
.timeline-seg-thumb img,
.timeline-seg-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.timeline-seg-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px;
  border-top: 1px solid rgba(56, 189, 248, 0.1);
  font-size: 11.5px;
  font-weight: 600;
  color: #94a3b8;
  background: rgba(8, 12, 22, 0.85);
}

.timeline-seg-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.4);
}
.timeline-seg-dot[data-status="done"] {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}
.timeline-seg-dot[data-status="running"] {
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
}
.timeline-seg-dot[data-status="queued"] {
  background: #00f0ff;
  box-shadow: 0 0 6px #00f0ff;
}
.timeline-seg-dot[data-status="failed"] {
  background: #f43f5e;
  box-shadow: 0 0 6px #f43f5e;
}
</style>
