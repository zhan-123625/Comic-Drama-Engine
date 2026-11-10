<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
// One 24px grid, 1.7px strokes, rounded joins; fill layers retain the same silhouette.
const paths: Record<string, string[]> = {
  projects: ["M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", "M3 10h18"],
  settings: [
    "m9 3-.6 2.3-2 .9L4.3 5.5 2 9.5l1.8 1.6v2L2 14.7l2.3 4 2.1-.7 2 .9L9 21h4l.6-2.1 2-.9 2.1.7 2.3-4-1.8-1.6v-2L20 9.5l-2.3-4-2.1.7-2-.9L13 3Z",
    "M14.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  ],
  overview: ["M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M7 16v-4m5 4V7m5 9v-6"],
  source: ["M6 3h8l4 4v14H6Z", "M14 3v5h4M9 12h6m-6 4h6"],
  pipeline: ["M5 6h14M5 18h14M5 6v12m14-12v12", "M8 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm14 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  script: ["m14 4 6 6-10 10H4v-6Z", "m11 7 6 6M4 20h16"],
  storyboard: ["M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 8V4l18-2v6", "m7 4-2 4m8-5-2 5m8-6-2 6M8 13h8m-8 4h5"],
  video: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "m10 9 5 3-5 3Z"],
  jobs: ["M9 2h6m-3 0v3m6 2 2-2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M12 9v5l3 2"],
  assets: [
    "M12 3C6.5 3 2 7 2 12s4 9 9 9h2a2 2 0 0 0 1-3.7 1.7 1.7 0 0 1 1-3.3h3c3 0 4-2 4-4 0-4-5-7-10-7Z",
    "M7 9h.01M12 7h.01M17 9h.01M6 14h.01",
  ],
  assetLibrary: ["m12 2 9 5v10l-9 5-9-5V7Z", "m3 7 9 5 9-5m-9 5v10M7.5 4.5l9 5"],
  timeline: ["M3 4v16h18M7 7h12v4H7Zm3 7h11v4H10Z"],
  user: ["M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M4 21v-2a8 8 0 0 1 16 0v2"],
  engine: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "m10 7 6 5-6 5ZM3 8h3M3 16h3m12-8h3m-3 8h3",
  ],
  arrow: ["m9 5 7 7-7 7"],
  refresh: ["M20 7v5h-5M4 17v-5h5", "M5.2 7a8 8 0 0 1 13.6-1L20 8M4 16l1.2 2A8 8 0 0 0 18.8 17"],
  search: ["M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", "m15 15 6 6"],
};
</script>
<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="app-icon"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="(d, i) in paths[name] ?? paths.engine"
      :key="i"
      :d="d"
      :fill="i === 0 ? 'currentColor' : 'none'"
      :fill-opacity="i === 0 ? 0.08 : 1"
    />
  </svg>
</template>
<style scoped>
.app-icon {
  display: inline-block;
  flex: 0 0 auto;
  vertical-align: middle;
}
</style>
