<script setup lang="ts">
interface MenuItem {
  label: string;
  action: string;
  danger?: boolean;
  disabled?: boolean;
}

defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  (e: "action", action: string): void;
  (e: "close"): void;
}>();
</script>

<template>
  <div v-if="visible" class="context-menu" :style="{ left: `${x}px`, top: `${y}px` }" @click.stop>
    <button
      v-for="(item, i) in items"
      :key="i"
      type="button"
      class="context-menu-item"
      :class="{ danger: item.danger }"
      :disabled="item.disabled"
      @click="emit('action', item.action)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 1200;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: rgba(10, 16, 30, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.65),
    0 0 12px rgba(56, 189, 248, 0.15);
  display: grid;
  gap: 4px;
}

.context-menu-item {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  background: transparent;
  color: #cbd5e1;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.context-menu-item:hover {
  background: rgba(14, 165, 233, 0.2);
  color: #00f0ff;
}

.context-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.context-menu-item.danger {
  color: #ffb0b0;
}

.context-menu-item.danger:hover {
  background: rgba(255, 84, 84, 0.15);
}
</style>
