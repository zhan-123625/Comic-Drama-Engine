<script setup lang="ts">
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();

async function runPipeline() {
  const p = projectsStore.selected;
  if (!p) return;
  if (pipeline.pipelineStageIndex(pipeline.pipelineFrom) > pipeline.pipelineStageIndex(pipeline.pipelineTo)) {
    ui.showToast("起始阶段不能晚于结束阶段", "error");
    return;
  }
  await projectsStore.refreshProject();
  await projectsStore.saveSource();
  ui.busy = true;
  ui.logs = [];
  pipeline.resetPipelineUiState();
  try {
    const payload: Record<string, unknown> = {
      from: pipeline.pipelineFrom,
      to: pipeline.pipelineTo,
    };
    if (!pipeline.pipelineAssetsGenInRun) payload.assetsGenerateImages = false;
    if (!pipeline.pipelineStoryboardGenInRun) payload.storyboardGenerateImages = false;
    const r = await fetch(`/api/projects/${p.id}/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await r.json().catch(() => ({}))) as {
      error?: string;
      pipelineStatus?: string;
      pipelineError?: string;
      logTail?: string[];
    };
    if (r.status === 409) {
      ui.logs.push(`管线已在运行中：${body.error ?? "请稍后重试"}`);
      if (body.pipelineStatus)
        ui.logs.push(`服务端状态：${body.pipelineStatus}${body.pipelineError ? `（${body.pipelineError}）` : ""}`);
      if (body.logTail?.length) {
        ui.logs.push("服务端最近日志：");
        for (const line of body.logTail) ui.logs.push(line);
      }
      await projectsStore.refreshProject();
      return;
    }
    if (!r.ok) {
      ui.logs.push(`启动失败：${body.error ?? `HTTP ${r.status}`}`);
      await projectsStore.refreshProject();
      return;
    }
    ui.logs.push("已接受任务，等待阶段事件...");
  } finally {
    ui.busy = false;
  }
}

async function cancelPipeline() {
  const p = projectsStore.selected;
  if (!p) return;
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/pipeline/cancel`, { method: "POST" });
    if (!r.ok) throw new Error(`取消失败：HTTP ${r.status}`);
    ui.logs.push("已请求取消管线（等待服务端在下一检查点停止）");
    await projectsStore.refreshProject();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    ui.busy = false;
  }
}
</script>

<template>
  <section v-if="projectsStore.selected" class="card">
    <h3>管线运行</h3>
    <p v-if="projectsStore.selected.pipelineError" class="err pipeline-error-banner">
      {{ projectsStore.selected.pipelineError }}
    </p>
    <div class="pipeline-progress">
      <div v-for="s in pipeline.stageOrder" :key="s" class="stage-item" :data-state="pipeline.stageState[s]">
        <span class="dot"></span>
        <span class="name">{{ pipeline.stageLabels[s] }}</span>
        <span class="state">{{ pipeline.stageState[s] }}</span>
      </div>
    </div>
    <div class="role-board">
      <div class="role" data-role="script" :data-state="pipeline.roleState.script">
        剧本 Agent &middot; {{ pipeline.roleState.script }}
      </div>
      <div class="role" data-role="assets" :data-state="pipeline.roleState.assets">
        资产 Agent &middot; {{ pipeline.roleState.assets }}
      </div>
      <div class="role" data-role="storyboard" :data-state="pipeline.roleState.storyboard">
        分镜 Agent &middot; {{ pipeline.roleState.storyboard }}
      </div>
      <div class="role" data-role="image_batch" :data-state="pipeline.roleState.image_batch">
        生图 Agent &middot; {{ pipeline.roleState.image_batch }}
      </div>
      <div class="role" data-role="video_plan" :data-state="pipeline.roleState.video_plan">
        视频 Agent &middot; {{ pipeline.roleState.video_plan }}
      </div>
      <div class="role" data-role="director" :data-state="pipeline.roleState.director">
        导演 Gate &middot; {{ pipeline.roleState.director }}
      </div>
    </div>
    <p class="hint">
      全链路顺序：剧本 → 资产 → 分镜/生图 →
      视频入队（基于原文）。当区间包含资产或分镜时，可用下方勾选分别控制是否在管线内自动生图：勾选则该阶段会调用生图模型；不勾选则只生成条目与
      prompt，之后在资产页或分镜页再逐条生图。每步可经导演审核；区间跑法需保证上游内容已存在。（关闭分镜内生图后若仍跑视频阶段，需自行保证关键帧可用，否则入队可能失败。）
      分镜：多章剧本（多个「###
      章标题」块）时按块依次生成并自动合并为全局场次号；导演打回时若意见中标出具体场次号，将尽量只重生成这些场次。
    </p>
    <div class="opt pipeline-range">
      <label class="field pipeline-field">
        <span>起始阶段</span>
        <select v-model="pipeline.pipelineFrom" class="input small">
          <option v-for="s in pipeline.stageOrder" :key="`pf-${s}`" :value="s">{{ pipeline.stageLabels[s] }}</option>
        </select>
      </label>
      <label class="field pipeline-field">
        <span>结束阶段</span>
        <select v-model="pipeline.pipelineTo" class="input small">
          <option v-for="s in pipeline.stageOrder" :key="`pt-${s}`" :value="s">{{ pipeline.stageLabels[s] }}</option>
        </select>
      </label>
      <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.setPipelinePreset('script', 'assets')">
        预设：剧本→资产
      </button>
      <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.setPipelinePreset('script', 'video')">
        预设：全链路
      </button>
    </div>
    <label v-if="pipeline.pipelineRangeCoversAssets" class="opt pipeline-gen-toggle">
      <input v-model="pipeline.pipelineAssetsGenInRun" type="checkbox" :disabled="ui.busy" />
      <span>资产阶段：管线内生图</span>
    </label>
    <label v-if="pipeline.pipelineRangeCoversStoryboard" class="opt pipeline-gen-toggle">
      <input v-model="pipeline.pipelineStoryboardGenInRun" type="checkbox" :disabled="ui.busy" />
      <span>分镜阶段：管线内逐镜生图</span>
    </label>
    <div class="actions">
      <button class="btn" type="button" :disabled="ui.busy" @click="projectsStore.saveSource">保存原文</button>
      <button
        class="btn danger"
        type="button"
        :disabled="ui.busy || projectsStore.selected.pipelineStatus !== 'running'"
        @click="cancelPipeline"
      >
        取消管线
      </button>
      <button class="btn primary" type="button" :disabled="ui.busy" @click="runPipeline">运行管线</button>
    </div>
    <pre class="log">{{ ui.logs.join("\n") || "（等待 SSE 输出）" }}</pre>
  </section>
</template>
