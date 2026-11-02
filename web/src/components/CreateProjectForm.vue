<script setup lang="ts">
import { ref } from "vue";
import { artStylePresets, projectTypePresets } from "../constants";

const props = defineProps<{
  busy: boolean;
  draft: { name: string; genreType: string; videoAspect: string; storyboardImageSize: string; artStyle: string };
}>();

const emit = defineEmits<{
  create: [];
}>();

const selectedArtPreset = ref(artStylePresets[0]!.key);
const createProjectNameRef = ref<HTMLInputElement | null>(null);

function focus() {
  createProjectNameRef.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <article class="card">
    <h3>创建项目</h3>
    <label class="field block"
      ><span>项目名称（可留空）</span
      ><input ref="createProjectNameRef" v-model="props.draft.name" class="input" placeholder="留空将自动生成"
    /></label>
    <label class="field block">
      <span>类型（可选/可自定义）</span>
      <input
        v-model="props.draft.genreType"
        class="input"
        list="projectTypePresets"
        placeholder="如：言情、悬疑、都市…"
      />
      <datalist id="projectTypePresets">
        <option v-for="t in projectTypePresets" :key="t" :value="t" />
      </datalist>
    </label>
    <label class="field block">
      <span>视频生成比例</span>
      <select v-model="props.draft.videoAspect" class="input">
        <option value="16:9">16:9 横屏</option>
        <option value="9:16">9:16 竖屏</option>
        <option value="4:3">4:3</option>
        <option value="3:4">3:4</option>
        <option value="1:1">1:1 方形</option>
      </select>
    </label>
    <label class="field block">
      <span>生图尺寸（分镜参考图）</span>
      <select v-model="props.draft.storyboardImageSize" class="input">
        <option value="1024x1024">1024x1024</option>
        <option value="1024x1536">1024x1536（竖）</option>
        <option value="1536x1024">1536x1024（横）</option>
      </select>
    </label>
    <label class="field block">
      <span>画风预设</span>
      <select v-model="selectedArtPreset" class="input">
        <option v-for="p in artStylePresets" :key="p.key" :value="p.key">{{ p.label }}</option>
      </select>
    </label>
    <label class="field block">
      <span>画风提示词（可自定义）</span>
      <textarea
        v-model="props.draft.artStyle"
        class="area"
        rows="5"
        placeholder="描述画风、渲染方式、色调、镜头感等。建议也写清：无字幕无水印。"
      />
    </label>
    <div class="actions">
      <button class="btn primary" type="button" :disabled="props.busy" @click="emit('create')">创建项目</button>
    </div>
  </article>
</template>
