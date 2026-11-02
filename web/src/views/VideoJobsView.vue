<script setup lang="ts">
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import ContextMenu from "../components/ContextMenu.vue";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();

async function runJobs() {
  const p = projectsStore.selected;
  if (!p) {
    ui.showToast("请先选择一个项目，再启动 Runner。", "error");
    return;
  }
  const cfg = (await import("../stores/config")).useConfigStore();
  ui.busy = true;
  try {
    const delayMs = Math.min(60_000, Math.max(100, Math.floor(Number(cfg.cfgDraft.ui?.runnerDelayMs ?? 600)) || 600));
    const r = await fetch(`/api/projects/${p.id}/jobs/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delayMs }),
    });
    const body = (await r.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
    if (!r.ok) {
      throw new Error(
        body.error || `启动 Runner 失败（HTTP ${r.status}），请确认后端已启动且端口与 Vite 代理一致（默认 3710）。`,
      );
    }
    ui.logs.push(
      "已启动视频任务 runner：将按顺序处理 queued → running；单条可能需数分钟（含方舟轮询）。若无 queued 任务会立即结束。失败请看任务 message 或服务端日志。",
    );
    await projectsStore.refreshProject();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ui.logs.push(`启动 Runner 失败：${msg}`);
    ui.showToast(msg, "error");
  } finally {
    ui.busy = false;
  }
}

async function enqueueVideos(mode: "all" | "missing" | "selected" | "failed", shotIds?: string[]) {
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
    ui.logs.push(
      `视频入队完成：模式=${mode}，入队 ${body.enqueued ?? 0} 条。若任务状态为 queued，表示在本地排队，请到「视频」或「任务」页点击「启动 Runner」才会真正请求视频 API。`,
    );
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.videoBatchBusy = false;
  }
}

async function retryFailedVideoJobs() {
  const p = projectsStore.selected;
  if (!p) return;
  pipeline.videoBatchBusy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/videos/retry-failed`, { method: "POST" });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      enqueued?: number;
      failedCount?: number;
      error?: string;
      blockers?: string[];
    };
    if (!r.ok) {
      const lines = [body.error || "失败任务重试失败"];
      if (Array.isArray(body.blockers) && body.blockers.length) lines.push(...body.blockers);
      throw new Error(lines.join("\n"));
    }
    if (body.project) projectsStore.mergeProject(body.project);
    ui.logs.push(`失败重试完成：失败任务 ${body.failedCount ?? 0}，重新入队 ${body.enqueued ?? 0}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    pipeline.videoBatchBusy = false;
  }
}

async function enqueueImageJobs(mode: "all" | "missing" | "selected") {
  const p = projectsStore.selected;
  if (!p) return;
  const selectedSet = new Set(pipeline.selectedStoryboardIds);
  let targets = p.storyboards;
  if (mode === "missing") targets = targets.filter((s) => !s.imageUrl);
  if (mode === "selected") targets = targets.filter((s) => selectedSet.has(s.id));
  if (!targets.length) {
    ui.logs.push("没有可入队的生图任务");
    return;
  }
  ui.busy = true;
  try {
    for (const s of targets) {
      const r = await fetch(`/api/projects/${p.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "image", shotIndex: s.index, message: `镜头 #${s.index} 生图任务` }),
      });
      if (!r.ok) throw new Error(`生图任务入队失败：镜头 #${s.index}`);
    }
    ui.logs.push(`已入队生图任务 ${targets.length} 条`);
    await projectsStore.refreshProject();
  } finally {
    ui.busy = false;
  }
}

async function pushJob() {
  const p = projectsStore.selected;
  if (!p) return;
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "video",
        message: `手工视频任务（queued，请启动 Runner）`,
      }),
    });
    if (!r.ok) throw new Error("enqueue failed");
    await projectsStore.refreshProject();
  } finally {
    ui.busy = false;
  }
}

function onVideoRowContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  pipeline.videoRowContextMenu.visible = true;
  pipeline.videoRowContextMenu.x = e.clientX;
  pipeline.videoRowContextMenu.y = e.clientY;
  pipeline.videoRowContextMenu.id = id;
}

function onVideoRowMenuAction(action: string) {
  const p = projectsStore.selected;
  const id = pipeline.videoRowContextMenu.id;
  pipeline.videoRowContextMenu.visible = false;
  if (!id || !p) return;
  if (action === "single-generate") {
    void enqueueSingleShotVideo(id);
    return;
  }
  if (action === "open-result") {
    const shot = p.storyboards.find((s) => s.id === id);
    const url = shot ? pipeline.latestVideoJobByShotIndex(shot.index)?.resultUrl : "";
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function enqueueSingleShotVideo(shotId: string) {
  const p = projectsStore.selected;
  const shot = p?.storyboards.find((s) => s.id === shotId);
  if (!p) return;
  if (pipeline.runningSingleVideoShotIds.includes(shotId)) return;
  pipeline.runningSingleVideoShotIds = [...pipeline.runningSingleVideoShotIds, shotId];
  ui.logs.push(`单镜头直执行：#${shot?.index ?? "?"}，提交中...`);
  const pollSoon = window.setTimeout(() => void projectsStore.refreshProject(), 400);
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
    ui.logs.push(`单镜头直执行失败：#${shot?.index ?? "?"} ${e instanceof Error ? e.message : String(e)}`);
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    clearTimeout(pollSoon);
    clearInterval(poll);
    pipeline.runningSingleVideoShotIds = pipeline.runningSingleVideoShotIds.filter((id) => id !== shotId);
  }
}

const videoRowMenuItems = [
  { label: "单镜头生成", action: "single-generate" },
  { label: "打开视频链接", action: "open-result" },
];

// Expose functions for parent use
defineExpose({ runJobs, enqueueVideos, retryFailedVideoJobs, enqueueImageJobs, pushJob, enqueueSingleShotVideo });
</script>

<template>
  <!-- Video Workspace Tab -->
  <section v-if="projectsStore.selected && ui.activeMenu === 'video'" class="stack">
    <article class="card">
      <div class="row spread page-toolbar-sticky">
        <h3>视频生产工作台</h3>
        <div class="actions">
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !projectsStore.selected.storyboards.length"
            @click="enqueueVideos('all')"
          >
            生成全部镜头视频
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !projectsStore.selected.storyboards.length"
            @click="enqueueVideos('missing')"
          >
            仅生成未完成镜头
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || pipeline.videoBatchBusy || !pipeline.selectedVideoShotIds.length"
            @click="enqueueVideos('selected', pipeline.selectedVideoShotIds)"
          >
            生成已勾选镜头
          </button>
          <button
            class="btn"
            type="button"
            :disabled="
              ui.busy || pipeline.videoBatchBusy || !projectsStore.selected.videoJobs.some((j) => j.status === 'failed')
            "
            @click="retryFailedVideoJobs"
          >
            失败重试
          </button>
          <button class="btn primary" type="button" :disabled="ui.busy || pipeline.videoBatchBusy" @click="runJobs">
            启动 Runner
          </button>
        </div>
      </div>
      <p class="hint">
        本页侧重<strong>成片与任务状态</strong>一览；入队与视频提示词编辑可在<strong>分镜</strong>页完成。流程：分镜入队
        → Runner 逐条执行 → 输出 resultUrl。可按全部/缺失/勾选/失败重试调度。
      </p>
      <p class="hint">右击镜头行可执行"单镜头生成 / 打开视频链接"。</p>
      <p v-if="pipeline.videoJobStats.queued > 0" class="video-queue-banner">
        <strong>{{ pipeline.videoJobStats.queued }} 条视频为 queued</strong
        >：在<strong>本机任务队列</strong>里等待，需点上方<strong>「启动 Runner」</strong>才会调用视频 API。<template
          v-if="pipeline.videoJobStats.running > 0"
          >另有 {{ pipeline.videoJobStats.running }} 条 running（执行中）。</template
        >
      </p>
      <p v-else-if="pipeline.videoJobStats.running > 0" class="hint video-runner-active-hint">
        {{ pipeline.videoJobStats.running }} 条任务 running：Runner
        正在处理，请稍候；长时间无变化请看浏览器控制台网络或服务端日志。
      </p>

      <div v-if="projectsStore.selected.storyboards.length" class="shot-table">
        <div class="shot-table-head video-head">
          <div>序号</div>
          <div>参考图</div>
          <div>状态</div>
          <div>视频链接 / 错误</div>
        </div>
        <div
          v-for="s in projectsStore.selected.storyboards"
          :key="`video-${s.id}`"
          class="shot-row video-row"
          @contextmenu="onVideoRowContextMenu($event, s.id)"
        >
          <div class="shot-leading">
            <input
              type="checkbox"
              :checked="pipeline.isVideoShotSelected(s.id)"
              @change="pipeline.onVideoShotSelectedChange(s.id, $event)"
            />
            <strong>#{{ s.index }}</strong>
          </div>
          <div>
            <div
              v-if="s.imageUrl"
              class="shot-thumb"
              @click="pipeline.openImagePreview(projectsStore.mediaSrc(s.imageUrl, `shot-${s.id}`))"
            >
              <img :src="projectsStore.mediaSrc(s.imageUrl, `shot-${s.id}`)" alt="分镜参考图" />
            </div>
            <span v-else class="hint">无参考图</span>
          </div>
          <div>
            <code
              class="video-shot-job-status"
              :data-job="pipeline.latestVideoJobByShotIndex(s.index)?.status ?? 'none'"
            >
              {{ pipeline.latestVideoJobByShotIndex(s.index)?.status ?? "未入队" }}
            </code>
          </div>
          <div class="video-meta">
            <a
              v-if="pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl"
              class="job-link"
              :href="pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl"
              target="_blank"
              rel="noreferrer"
            >
              打开视频链接
            </a>
            <div
              v-if="
                pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl &&
                pipeline.isLikelyVideoResultUrl(pipeline.latestVideoJobByShotIndex(s.index)!.resultUrl!)
              "
              class="video-preview-tap video-preview-tap--workspace"
              role="button"
              tabindex="0"
              title="点击在屏幕中央播放"
              @click="pipeline.openCenterVideoPlay(pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl)"
              @keydown.enter.prevent="
                pipeline.openCenterVideoPlay(pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl)
              "
              @keydown.space.prevent="
                pipeline.openCenterVideoPlay(pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl)
              "
            >
              <video
                class="video-preview-tap__thumb"
                :src="pipeline.latestVideoJobByShotIndex(s.index)?.resultUrl"
                muted
                playsinline
                preload="metadata"
              />
              <span class="video-preview-tap__hint">&#9654; 居中播放</span>
            </div>
            <span v-else class="hint">{{
              pipeline.latestVideoJobByShotIndex(s.index)?.message || "尚无视频结果"
            }}</span>
          </div>
        </div>
        <ContextMenu
          :visible="pipeline.videoRowContextMenu.visible"
          :x="pipeline.videoRowContextMenu.x"
          :y="pipeline.videoRowContextMenu.y"
          :items="videoRowMenuItems"
          @action="onVideoRowMenuAction"
          @close="pipeline.videoRowContextMenu.visible = false"
        />
      </div>
      <p v-else class="hint">暂无分镜，请先在分镜页准备镜头与参考图。</p>
      <pre class="log">{{ ui.logs.join("\n") || "（等待视频相关日志输出）" }}</pre>
    </article>
  </section>

  <!-- Jobs Queue Tab -->
  <section v-else-if="projectsStore.selected && ui.activeMenu === 'jobs'" class="stack">
    <article class="card">
      <div class="row spread">
        <h3>任务队列（视频/生图）</h3>
        <div class="actions">
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !projectsStore.selected.storyboards.length"
            @click="enqueueImageJobs('all')"
          >
            入队全部生图
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !projectsStore.selected.storyboards.some((s) => !s.imageUrl)"
            @click="enqueueImageJobs('missing')"
          >
            入队缺图生图
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.selectedStoryboardIds.length"
            @click="enqueueImageJobs('selected')"
          >
            入队勾选生图
          </button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pushJob">入队视频任务</button>
          <button class="btn primary" type="button" :disabled="ui.busy" @click="runJobs">启动任务 runner</button>
        </div>
      </div>
      <p class="hint">支持视频任务与生图任务混排执行。生图任务会直接回写分镜参考图。</p>
      <p v-if="pipeline.videoJobStats.queued > 0" class="video-queue-banner">
        <strong>{{ pipeline.videoJobStats.queued }} 条 queued</strong>：等待本机 Runner。请点击<strong
          >「启动任务 runner」</strong
        >。<code>failed</code> 表示已失败（见下方 message）；<code>done</code> 表示已完成。
      </p>
      <ul class="jobs">
        <li v-for="j in projectsStore.selected.videoJobs" :key="j.id" class="job-row">
          <div class="job-meta">
            <code>{{ j.kind === "image" ? "image" : "video" }}</code>
            <code :data-job="j.status">{{ j.status }}</code>
            <span v-if="j.shotIndex != null" class="job-shot">镜头 #{{ j.shotIndex }}</span>
          </div>
          <div class="job-body">
            <span class="job-msg">{{ j.message }}</span>
            <a v-if="j.resultUrl" class="job-link" :href="j.resultUrl" target="_blank" rel="noreferrer">{{
              j.kind === "image" ? "打开图片" : "打开视频链接"
            }}</a>
            <details v-if="j.prompt?.trim()" class="job-text-prompt">
              <summary>拼装后的文本提示词</summary>
              <pre class="job-prompt-pre">{{ j.prompt }}</pre>
            </details>
          </div>
          <details class="job-model-api" :open="j.status === 'failed'">
            <summary class="job-model-api-summary">模型实际请求参数</summary>
            <p v-if="j.modelApiCall" class="hint job-model-api-hint">
              含请求 URL、已脱敏的 Header、实际 JSON 请求体（内联参考图会以占位说明代替）。
            </p>
            <p v-else class="hint job-model-api-hint">暂无请求快照。</p>
            <pre v-if="j.modelApiCall" class="job-model-api-pre">{{
              pipeline.formatModelApiCallJson(j.modelApiCall)
            }}</pre>
          </details>
          <img
            v-if="j.resultUrl && j.kind === 'image' && !/\.(mp4|webm|ogg)(\?|$)/i.test(j.resultUrl)"
            class="job-image-thumb"
            :src="j.resultUrl"
            alt=""
          />
          <div
            v-if="j.resultUrl && (j.kind ?? 'video') === 'video' && pipeline.isLikelyVideoResultUrl(j.resultUrl)"
            class="video-preview-tap video-preview-tap--workspace"
            role="button"
            tabindex="0"
            title="点击在屏幕中央播放"
            @click="pipeline.openCenterVideoPlay(j.resultUrl)"
            @keydown.enter.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
            @keydown.space.prevent="pipeline.openCenterVideoPlay(j.resultUrl)"
          >
            <video class="video-preview-tap__thumb" :src="j.resultUrl" muted playsinline preload="metadata" />
            <span class="video-preview-tap__hint">&#9654; 居中播放</span>
          </div>
        </li>
      </ul>
      <p v-if="!projectsStore.selected.videoJobs.length" class="hint">暂无任务。</p>
      <p v-if="projectsStore.selected.pipelineError" class="err">{{ projectsStore.selected.pipelineError }}</p>
    </article>
  </section>
</template>
