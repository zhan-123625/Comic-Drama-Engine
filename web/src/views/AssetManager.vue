<script setup lang="ts">
import { usePipelineStore } from "../stores/pipeline";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import ContextMenu from "../components/ContextMenu.vue";

const pipeline = usePipelineStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();

async function generateAssetImage(assetId: string) {
  const p = projectsStore.selected;
  if (!p) return;
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/assets/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(body.error || "资产生成失败");
    projectsStore.mergeProject(body as Parameters<typeof projectsStore.mergeProject>[0]);
    projectsStore.bumpMediaCache(`asset-${assetId}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    ui.busy = false;
  }
}

async function generateAssetBatch(onlyMissing = false) {
  const p = projectsStore.selected;
  if (!p) return;
  let assetIds: string[] | undefined;
  if (pipeline.selectedAssetIds.length) {
    assetIds = pipeline.selectedAssetIds;
  } else if (pipeline.assetFilterTab !== "all") {
    assetIds = pipeline.filteredAssets.map((a) => a.id);
  }
  ui.busy = true;
  try {
    const r = await fetch(`/api/projects/${p.id}/assets/generate-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyMissing, assetIds }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      project?: Parameters<typeof projectsStore.mergeProject>[0];
      error?: string;
      successCount?: number;
      total?: number;
    };
    if (!r.ok) throw new Error(body.error || "资产批量生成失败");
    if (body.project) {
      projectsStore.mergeProject(body.project);
      projectsStore.bumpAllMediaCachesForProject(body.project);
    }
    ui.logs.push(`资产生成完成：${body.successCount ?? 0}/${body.total ?? 0}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    ui.busy = false;
  }
}

function onAssetRowContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  pipeline.assetRowContextMenu.visible = true;
  pipeline.assetRowContextMenu.x = e.clientX;
  pipeline.assetRowContextMenu.y = e.clientY;
  pipeline.assetRowContextMenu.id = id;
}

function onAssetRowMenuAction(action: string) {
  const id = pipeline.assetRowContextMenu.id;
  pipeline.assetRowContextMenu.visible = false;
  if (!id) return;
  if (action === "generate-image") void generateAssetImage(id);
  if (action === "delete") pipeline.removeAsset(id);
}

const assetRowMenuItems = [
  { label: "图片生成", action: "generate-image" },
  { label: "删除资产", action: "delete", danger: true },
];
</script>

<template>
  <section v-if="projectsStore.selected" class="stack">
    <article class="card">
      <div class="row spread page-toolbar-sticky">
        <h3>资产管理（场景 / 物品）</h3>
        <div class="actions">
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('character')">
            新增角色
          </button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('scene')">新增场景</button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('prop')">新增物品</button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('costume')">
            新增服装造型
          </button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('action_pose')">
            新增动作姿态
          </button>
          <button class="btn" type="button" :disabled="ui.busy" @click="pipeline.addAsset('fx')">新增特效</button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.filteredAssets.length"
            @click="generateAssetBatch(false)"
          >
            批量生成资产图
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.filteredAssets.some((a) => !a.imageUrl)"
            @click="generateAssetBatch(true)"
          >
            仅生成缺图资产
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.filteredAssets.length"
            @click="pipeline.selectAllAssets"
          >
            全选
          </button>
          <button
            class="btn"
            type="button"
            :disabled="ui.busy || !pipeline.selectedAssetIds.length"
            @click="pipeline.clearSelectedAssets"
          >
            清空勾选
          </button>
          <button
            class="btn primary"
            type="button"
            :disabled="ui.busy"
            @click="projectsStore.savePatch({ assets: projectsStore.selected!.assets })"
          >
            保存资产
          </button>
        </div>
      </div>
      <div v-if="projectsStore.selected.assets.length" class="asset-panel">
        <p class="hint">右击任一资产行可执行"图片生成 / 删除资产"。</p>
        <div class="asset-subtabs" role="tablist" aria-label="按资产类型筛选">
          <button
            v-for="tab in pipeline.ASSET_FILTER_TABS"
            :key="tab.key"
            type="button"
            class="asset-subtab"
            :class="{ active: pipeline.assetFilterTab === tab.key }"
            role="tab"
            :aria-selected="pipeline.assetFilterTab === tab.key"
            @click="pipeline.assetFilterTab = tab.key"
          >
            {{ tab.label }}
            <span class="asset-subtab-count">{{ pipeline.assetCountForFilter(tab.key) }}</span>
          </button>
        </div>
        <div v-if="pipeline.filteredAssets.length" class="shot-table shot-table--assets">
          <div class="shot-table-head">
            <div>序号</div>
            <div>类型</div>
            <div>资产名</div>
            <div>提示词</div>
            <div>图片</div>
          </div>
          <div
            v-for="a in pipeline.filteredAssets"
            :id="'asset-row-' + a.id"
            :key="a.id"
            class="shot-row"
            :class="{ 'asset-row--highlight': pipeline.assetsJumpHighlightId === a.id }"
            @contextmenu="onAssetRowContextMenu($event, a.id)"
          >
            <div class="shot-leading">
              <input
                type="checkbox"
                :checked="pipeline.isAssetSelected(a.id)"
                @change="pipeline.onAssetSelectedChange(a.id, $event)"
              />
              <strong>#{{ a.index }}</strong>
            </div>
            <div>
              <select v-model="a.type" class="input">
                <option value="character">角色</option>
                <option value="scene">场景</option>
                <option value="prop">物品</option>
                <option value="costume">服装造型</option>
                <option value="action_pose">动作姿态</option>
                <option value="fx">特效</option>
              </select>
            </div>
            <div>
              <input v-model="a.name" class="input" placeholder="资产名" />
              <div class="asset-key-block">
                <label class="field block">
                  <span class="hint">语义 key（同实体应一致）</span>
                  <input v-model="a.key" class="input small" placeholder="如：character:linwan-main" />
                </label>
                <div class="asset-stable-id hint">stableId: {{ a.stableId ?? "（自动）" }}</div>
                <label class="field block">
                  <span class="hint">aliases（逗号分隔）</span>
                  <input
                    class="input small"
                    :value="(a.aliases ?? []).join(', ')"
                    placeholder="如：林晚, 女主, 晚晚"
                    @change="
                      (e: Event) => {
                        a.aliases = pipeline.parseCsvText((e.target as HTMLInputElement).value);
                      }
                    "
                  />
                </label>
                <label class="field block">
                  <span class="hint">sceneNos（逗号分隔）</span>
                  <input
                    class="input small"
                    :value="(a.sceneNos ?? []).join(', ')"
                    placeholder="如：1,2,5"
                    @change="
                      (e: Event) => {
                        a.sceneNos = pipeline.parseSceneNosText((e.target as HTMLInputElement).value);
                      }
                    "
                  />
                </label>
              </div>
            </div>
            <div>
              <textarea
                v-model="a.prompt"
                class="area"
                rows="6"
                placeholder="仅写画面主体描述即可；生图时服务端会按类型自动附加约束，不会改写本框内容"
              />
            </div>
            <div>
              <div
                v-if="a.imageUrl"
                class="shot-thumb"
                @click="pipeline.openImagePreview(projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`))"
              >
                <img :src="projectsStore.mediaSrc(a.imageUrl, `asset-${a.id}`)" alt="资产图" />
              </div>
              <span v-else class="hint">未生成</span>
            </div>
          </div>
          <ContextMenu
            :visible="pipeline.assetRowContextMenu.visible"
            :x="pipeline.assetRowContextMenu.x"
            :y="pipeline.assetRowContextMenu.y"
            :items="assetRowMenuItems"
            @action="onAssetRowMenuAction"
            @close="pipeline.assetRowContextMenu.visible = false"
          />
        </div>
        <p v-else class="hint">当前分类下暂无资产，可切换上方标签或点击「新增」。</p>
      </div>
      <p v-else class="hint">暂无资产。建议先创建"场景/物品"资产并生成图片，再用于视频生成参考。</p>
    </article>
  </section>
</template>
