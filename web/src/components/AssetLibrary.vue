<script setup lang="ts">
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <article class="card">
      <div class="row spread page-toolbar-sticky">
        <h3>资产库（全项目）</h3>
        <div class="actions">
          <button class="btn" type="button" :disabled="ui.busy" @click="projectsStore.loadAssetLibrary">
            刷新资产库
          </button>
        </div>
      </div>
      <p class="hint">
        可在文案中用 <code>@资产id</code> 引用资产（例如：<code>@550e8400-e29b-41d4-a716-446655440000</code>）。
      </p>
      <div v-if="projectsStore.assetLibrary.length" class="asset-panel">
        <div v-if="pipeline.assetLibraryProjectOptions.length" class="asset-library-project-filter">
          <label class="field asset-library-project-field">
            <span>按项目筛选</span>
            <select v-model="pipeline.assetLibraryProjectIdFilter" class="input">
              <option value="">全部项目</option>
              <option v-for="opt in pipeline.assetLibraryProjectOptions" :key="opt.id" :value="opt.id">
                {{ opt.name }}（{{ opt.id.slice(0, 8) }}...）
              </option>
            </select>
          </label>
        </div>
        <div class="asset-subtabs" role="tablist" aria-label="资产库按类型筛选">
          <button
            v-for="tab in pipeline.ASSET_FILTER_TABS"
            :key="`lib-${tab.key}`"
            type="button"
            class="asset-subtab"
            :class="{ active: pipeline.assetLibraryFilterTab === tab.key }"
            role="tab"
            :aria-selected="pipeline.assetLibraryFilterTab === tab.key"
            @click="pipeline.assetLibraryFilterTab = tab.key"
          >
            {{ tab.label }}
            <span class="asset-subtab-count">{{ pipeline.assetLibraryCountForFilter(tab.key) }}</span>
          </button>
        </div>
        <div v-if="pipeline.filteredAssetLibrary.length" class="shot-table shot-table--asset-library">
          <div class="shot-table-head">
            <div>资产ID</div>
            <div>项目</div>
            <div>类型/名称</div>
            <div>提示词</div>
            <div>图片</div>
          </div>
          <div v-for="a in pipeline.filteredAssetLibrary" :key="`lib-${a.id}`" class="shot-row">
            <div>
              <code>{{ a.id }}</code>
              <div style="margin-top: 6px">
                <button class="btn small" type="button" @click="pipeline.copyAssetRefToken(a.id)">复制 @引用</button>
              </div>
            </div>
            <div>
              <strong>{{ a.projectName }}</strong>
              <div class="hint">{{ a.projectId }}</div>
            </div>
            <div>
              <span class="hint">{{ a.type }}</span>
              <div>{{ a.name }}</div>
            </div>
            <div>
              <div class="hint" style="white-space: pre-wrap">{{ a.prompt }}</div>
            </div>
            <div>
              <div
                v-if="a.imageUrl"
                class="shot-thumb"
                @click="pipeline.openImagePreview(projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`))"
              >
                <img :src="projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`)" alt="资产图" />
              </div>
              <span v-else class="hint">无图</span>
            </div>
          </div>
        </div>
        <p v-else class="hint">当前项目/类型筛选下暂无资产，可调整「按项目筛选」或上方类型标签。</p>
      </div>
      <p v-else class="hint">资产库为空。先在任意项目生成资产即可汇总到这里。</p>
    </article>
  </section>
</template>
