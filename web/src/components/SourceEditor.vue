<script setup lang="ts">
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();

function onSourceChapterContextMenu(e: MouseEvent, index: number) {
  e.preventDefault();
  pipeline.sourceChapterContextMenu.visible = true;
  pipeline.sourceChapterContextMenu.x = e.clientX;
  pipeline.sourceChapterContextMenu.y = e.clientY;
  pipeline.sourceChapterContextMenu.index = index;
}

function onSourceChapterMenuAction(action: string) {
  const i = pipeline.sourceChapterContextMenu.index;
  pipeline.sourceChapterContextMenu.visible = false;
  if (i < 0) return;
  if (action === "edit") pipeline.promptEditSourceChapterTitle(i);
  if (action === "insert-before") pipeline.insertSourceChapterAt(i);
  if (action === "insert-after") pipeline.insertSourceChapterAt(i + 1);
  if (action === "delete") pipeline.deleteSourceChapter(i);
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
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <p v-if="ui.polishErr" class="err">{{ ui.polishErr }}</p>
    <article class="card">
      <div class="row spread">
        <h3>原文</h3>
        <div class="actions">
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.rebuildSourceChaptersFromSelected">
            重新按章节拆分
          </button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addSourceChapter">新增章节</button>
          <label class="btn" style="display: inline-flex; align-items: center; gap: 8px">
            <span>导入 TXT</span>
            <input
              type="file"
              accept=".txt,text/plain"
              :disabled="ui.busy"
              style="display: none"
              @change="
                (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) void pipeline.importNovelTxt(f);
                  (e.target as HTMLInputElement).value = '';
                }
              "
            />
          </label>
          <button class="btn" type="button" :disabled="ui.busy" @click="polishField('source')">润色原文</button>
          <button class="btn primary" type="button" :disabled="ui.busy" @click="projectsStore.saveSource">
            保存原文
          </button>
        </div>
      </div>
      <p class="hint">
        支持导入
        txt：自动解析书名、作者与章节；内容会写入原文并拆分成章节。若章节识别不准确，可手动改标题或点击"重新按章节拆分"。
      </p>
      <div class="view-grid" style="grid-template-columns: repeat(2, minmax(220px, 1fr))">
        <label class="field block">
          <span>书名（自动识别，可改）</span>
          <input
            v-model="pipeline.novelTitle"
            class="input"
            placeholder="如：xxx"
            @input="pipeline.applyChaptersToSourceText"
          />
        </label>
        <label class="field block">
          <span>作者（自动识别，可改）</span>
          <input
            v-model="pipeline.novelAuthor"
            class="input"
            placeholder="如：某某"
            @input="pipeline.applyChaptersToSourceText"
          />
        </label>
      </div>
      <div class="chapter-layout">
        <aside class="chapter-list">
          <div class="chapter-list-head">
            <strong>章节列表</strong>
          </div>
          <div class="chapter-items">
            <button
              v-for="(c, i) in pipeline.sourceChapters"
              :key="`ch-item-${i}`"
              type="button"
              class="chapter-item"
              :class="{ active: pipeline.selectedSourceChapterIdx === i }"
              :aria-current="pipeline.selectedSourceChapterIdx === i ? 'true' : undefined"
              @click="pipeline.selectedSourceChapterIdx = i"
              @contextmenu="onSourceChapterContextMenu($event, i)"
            >
              <span class="title">{{ (c.title || `第${i + 1}章`).trim() }}</span>
            </button>
          </div>
          <Teleport to="body">
            <div
              v-if="pipeline.sourceChapterContextMenu.visible"
              class="chapter-context-menu"
              :style="{
                left: `${pipeline.sourceChapterContextMenu.x}px`,
                top: `${pipeline.sourceChapterContextMenu.y}px`,
              }"
              @click.stop
            >
              <button type="button" class="chapter-context-item" @click="onSourceChapterMenuAction('edit')">
                编辑标题
              </button>
              <button type="button" class="chapter-context-item" @click="onSourceChapterMenuAction('insert-before')">
                在前面插入章节
              </button>
              <button type="button" class="chapter-context-item" @click="onSourceChapterMenuAction('insert-after')">
                在后面插入章节
              </button>
              <button type="button" class="chapter-context-item danger" @click="onSourceChapterMenuAction('delete')">
                删除章节
              </button>
            </div>
          </Teleport>
        </aside>

        <section class="chapter-editor">
          <div class="row spread" style="margin-bottom: 8px">
            <strong>当前章节</strong>
            <div class="actions">
              <button
                class="btn"
                type="button"
                :disabled="ui.busy || !pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]"
                @click="pipeline.splitChapter(pipeline.selectedSourceChapterIdx)"
              >
                拆分本章
              </button>
              <button
                class="btn"
                type="button"
                :disabled="
                  ui.busy ||
                  !pipeline.sourceChapters[pipeline.selectedSourceChapterIdx] ||
                  pipeline.selectedSourceChapterIdx >= pipeline.sourceChapters.length - 1
                "
                @click="pipeline.mergeWithNextChapter(pipeline.selectedSourceChapterIdx)"
              >
                与下一章合并
              </button>
            </div>
          </div>

          <label v-if="pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]" class="field block">
            <span>章节标题</span>
            <input
              v-model="pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]!.title"
              class="input"
              @input="pipeline.applyChaptersToSourceText"
            />
          </label>
          <label v-if="pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]" class="field block">
            <span>章节内容</span>
            <textarea
              v-model="pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]!.content"
              class="area"
              rows="14"
              placeholder="章节正文"
              @input="pipeline.applyChaptersToSourceText"
            />
          </label>
          <p v-if="!pipeline.sourceChapters[pipeline.selectedSourceChapterIdx]" class="hint">
            暂无章节。可点击"新增章节"或导入 TXT。
          </p>
        </section>
      </div>
    </article>
  </section>
</template>

<style scoped>
.chapter-layout {
  margin-top: 20px;
}
.chapter-list {
  margin-bottom: 20px;
  min-width: 0;
}
.chapter-list-head {
  margin-bottom: 12px;
  line-height: 1.5;
}
.chapter-items {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px;
}
.chapter-item {
  display: block;
  max-width: 100%;
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: #cbd5e1;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.chapter-item:hover {
  background: #ffffff0a;
}
.chapter-item.active {
  color: #edf8ff;
  background: #b1deef12;
  border-color: #b1deef38;
}
.chapter-item:focus-visible {
  outline: 2px solid #a8d8ec;
  outline-offset: 2px;
}
</style>
