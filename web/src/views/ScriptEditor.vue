<script setup lang="ts">
import { watch } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import ContextMenu from "../components/ContextMenu.vue";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();

// Watch for script chapter changes
watch(
  pipeline.scriptPipelineChapters,
  (list) => {
    if (!list.length) pipeline.storyboardRefChapterIdx = 0;
    else if (pipeline.storyboardRefChapterIdx >= list.length) pipeline.storyboardRefChapterIdx = list.length - 1;
  },
  { immediate: true },
);

// Watch for selectedScriptChapterIdx changes
watch(pipeline.selectedScriptChapterIdx, (newI, oldI) => {
  if (typeof oldI === "number") pipeline.flushScriptTableToChapter(oldI);
  pipeline.loadScriptTableForChapter(newI);
});

// Watch for scriptTableRows changes
watch(
  pipeline.scriptTableRows,
  () => {
    if (pipeline["scriptTableHydrating" as keyof typeof pipeline]) return;
    pipeline.scheduleScriptTableCommit();
  },
  { deep: true },
);

watch(pipeline.scriptTablePrefix, () => {
  if (pipeline["scriptTableHydrating" as keyof typeof pipeline]) return;
  pipeline.scheduleScriptTableCommit();
});

function onScriptSceneRowContextMenu(e: MouseEvent, index: number) {
  e.preventDefault();
  pipeline.scriptSceneRowContextMenu.visible = true;
  pipeline.scriptSceneRowContextMenu.x = e.clientX;
  pipeline.scriptSceneRowContextMenu.y = e.clientY;
  pipeline.scriptSceneRowContextMenu.index = index;
}

function onScriptSceneRowMenuAction(action: string) {
  const i = pipeline.scriptSceneRowContextMenu.index;
  pipeline.scriptSceneRowContextMenu.visible = false;
  if (i < 0) return;
  if (action === "insert-before") pipeline.insertScriptSceneRowAt(i);
  if (action === "insert-after") pipeline.insertScriptSceneRowAt(i + 1);
  if (action === "delete") pipeline.removeScriptSceneRow(i);
}

async function polishField(field: "source" | "script") {
  const p = projectsStore.selected;
  if (!p) return;
  ui.polishErr = "";
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/polish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(body.error || "润色失败");
    projectsStore.mergeProject(body as Parameters<typeof projectsStore.mergeProject>[0]);
  } catch (e) {
    ui.polishErr = e instanceof Error ? e.message : String(e);
  } finally {
    ui.busy = false;
  }
}

async function regenerateScriptChapter() {
  const p = projectsStore.selected;
  if (!p) return;
  const list = pipeline.scriptPipelineChapters;
  if (!list.length) {
    ui.polishErr = "原文中未解析到有效章节，无法单章重生。";
    return;
  }
  const idx = pipeline.selectedScriptChapterIdx;
  ui.polishErr = "";
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/script/regenerate-chapter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterIndex: idx }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(body.error || "单章重生失败");
    projectsStore.mergeProject(body as Parameters<typeof projectsStore.mergeProject>[0]);
  } catch (e) {
    ui.polishErr = e instanceof Error ? e.message : String(e);
  } finally {
    ui.busy = false;
  }
}

const scriptSceneRowMenuItems = [
  { label: "在上方插入行", action: "insert-before" },
  { label: "在下方插入行", action: "insert-after" },
  { label: "删除该行", action: "delete", danger: true },
];
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <p v-if="ui.polishErr" class="err">{{ ui.polishErr }}</p>
    <article class="card">
      <div class="row spread">
        <h3>剧本</h3>
        <div class="actions">
          <button class="btn" type="button" :disabled="ui.busy" @click="polishField('script')">润色全剧</button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.scriptPipelineChapters.length"
            @click="regenerateScriptChapter"
          >
            重生本章
          </button>
        </div>
      </div>
      <template v-if="pipeline.scriptPipelineChapters.length">
        <p class="hint">
          用上方下拉切换<strong>本章</strong>。每场一行；<strong>原文对照</strong>写在对应场次行内（摘录本章原文，管线生成时会自动填）。切换章节前会自动保存。
        </p>
        <label class="field block script-chapter-picker">
          <span>本章（共 {{ pipeline.scriptPipelineChapters.length }} 章）</span>
          <select v-model.number="pipeline.selectedScriptChapterIdx" class="input">
            <option v-for="(c, i) in pipeline.scriptPipelineChapters" :key="`script-pick-${i}`" :value="i">
              {{ (c.title || `第${i + 1}章`).trim() }}
            </option>
          </select>
        </label>
        <div class="script-scene-workspace">
          <section class="script-pane script-pane--scenes">
            <div class="row spread script-pane-head">
              <strong>剧本 · 场次表</strong>
              <div class="row wrap">
                <button class="btn" type="button" @click="pipeline.switchScriptToTableView">场次表</button>
                <button class="btn" type="button" @click="pipeline.switchScriptToRawView">源码</button>
                <button
                  class="btn"
                  type="button"
                  :disabled="pipeline.scriptTableMode !== 'table'"
                  @click="pipeline.addScriptSceneRow"
                >
                  新增场次
                </button>
                <span class="hint">右击表格行可插入/删除</span>
              </div>
            </div>
            <template v-if="pipeline.scriptTableMode === 'table'">
              <label class="field block">
                <span class="hint">章前说明（可选，不在表格内）</span>
                <textarea
                  v-model="pipeline.scriptTablePrefix"
                  class="area"
                  rows="2"
                  placeholder="如：本章基调、删改说明等"
                />
              </label>
              <div class="script-scene-table-wrap">
                <table class="script-scene-table">
                  <thead>
                    <tr>
                      <th class="col-scene-no">场次</th>
                      <th class="col-setting">内/外景·时间·地点</th>
                      <th class="col-chars">人物</th>
                      <th class="col-action">剧情与动作</th>
                      <th class="col-dialogue">台词/旁白</th>
                      <th class="col-note">备注</th>
                      <th class="col-source-ref">原文对照</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, ri) in pipeline.scriptTableRows"
                      :key="ri"
                      @contextmenu="onScriptSceneRowContextMenu($event, ri)"
                    >
                      <td><input v-model="row.sceneNo" class="input script-cell" type="text" placeholder="1" /></td>
                      <td>
                        <textarea
                          v-model="row.setting"
                          class="area script-cell-area"
                          rows="3"
                          placeholder="内·夜·客厅"
                        />
                      </td>
                      <td>
                        <textarea v-model="row.characters" class="area script-cell-area" rows="3" placeholder="角色" />
                      </td>
                      <td>
                        <textarea
                          v-model="row.action"
                          class="area script-cell-area"
                          rows="5"
                          placeholder="动作与走位"
                        />
                      </td>
                      <td>
                        <textarea
                          v-model="row.dialogue"
                          class="area script-cell-area"
                          rows="5"
                          placeholder="对白或旁白"
                        />
                      </td>
                      <td>
                        <textarea v-model="row.note" class="area script-cell-area" rows="3" placeholder="调度/道具等" />
                      </td>
                      <td>
                        <textarea
                          v-model="row.sourceRef"
                          class="area script-cell-area script-cell-source-ref"
                          rows="5"
                          placeholder="本场对应原文摘录"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <ContextMenu
                  :visible="pipeline.scriptSceneRowContextMenu.visible"
                  :x="pipeline.scriptSceneRowContextMenu.x"
                  :y="pipeline.scriptSceneRowContextMenu.y"
                  :items="scriptSceneRowMenuItems"
                  @action="onScriptSceneRowMenuAction"
                  @close="pipeline.scriptSceneRowContextMenu.visible = false"
                />
              </div>
            </template>
            <textarea
              v-else
              v-model="pipeline.currentScriptBody"
              class="area script-pane-area"
              rows="14"
              placeholder="本章剧本文本；可点「场次表」解析为表格（若含标准表头）"
            />
          </section>
        </div>
      </template>
      <template v-else>
        <p class="hint">原文中暂无带正文的章节，以下为整本剧本编辑（与旧版相同）。</p>
        <textarea v-model="projectsStore.selected.script" class="area" rows="12" placeholder="可手工修改剧本" />
      </template>
    </article>
  </section>
</template>
