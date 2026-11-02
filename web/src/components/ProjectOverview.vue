<script setup lang="ts">
const props = defineProps<{
  name: string;
  artStyle: string;
  genreType: string;
  videoAspect: string;
  storyboardImageSize: string;
  pipelineStatus: string;
  sourceLength: number;
  scriptLength: number;
  shotsCount: number;
  jobsCount: number;
}>();

const emit = defineEmits<{
  "update:name": [value: string];
  "update:artStyle": [value: string];
  "update:genreType": [value: string];
  "update:videoAspect": [value: string];
  "update:storyboardImageSize": [value: string];
}>();
</script>

<template>
  <section class="view-grid">
    <article class="card stat">
      <label>原文字数</label><strong>{{ props.sourceLength }}</strong>
    </article>
    <article class="card stat">
      <label>剧本字数</label><strong>{{ props.scriptLength }}</strong>
    </article>
    <article class="card stat">
      <label>分镜数量</label><strong>{{ props.shotsCount }}</strong>
    </article>
    <article class="card stat">
      <label>视频任务</label><strong>{{ props.jobsCount }}</strong>
    </article>
    <article class="card stat">
      <label>管线状态</label><strong>{{ props.pipelineStatus }}</strong>
    </article>
    <article class="card" style="grid-column: 1 / -1">
      <h3>项目名</h3>
      <input
        :value="props.name"
        class="input"
        @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      />
    </article>
    <article class="card" style="grid-column: 1 / -1">
      <h3>项目基本信息</h3>
      <p class="hint">这些信息会影响管线生成效果。</p>
      <label class="field block"
        ><span>画风 / 视觉参考</span
        ><input
          :value="props.artStyle"
          class="input"
          placeholder="如：日系赛璐璐、写实电影感"
          @input="emit('update:artStyle', ($event.target as HTMLInputElement).value)"
      /></label>
      <label class="field block"
        ><span>类型 / 题材</span
        ><input
          :value="props.genreType"
          class="input"
          placeholder="如：玄幻、都市言情"
          @input="emit('update:genreType', ($event.target as HTMLInputElement).value)"
      /></label>
      <label class="field block"
        ><span>视频比例</span>
        <select
          :value="props.videoAspect"
          class="input"
          @change="emit('update:videoAspect', ($event.target as HTMLSelectElement).value)"
        >
          <option value="16:9">16:9 横屏</option>
          <option value="9:16">9:16 竖屏</option>
          <option value="1:1">1:1 方形</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
        </select>
      </label>
      <label class="field block"
        ><span>分镜参考图尺寸</span>
        <select
          :value="props.storyboardImageSize"
          class="input"
          @change="emit('update:storyboardImageSize', ($event.target as HTMLSelectElement).value)"
        >
          <option value="1024x1024">1024x1024</option>
          <option value="1024x1536">1024x1536（竖）</option>
          <option value="1536x1024">1536x1024（横）</option>
        </select>
      </label>
    </article>
  </section>
</template>
