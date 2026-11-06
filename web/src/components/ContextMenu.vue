<script setup lang="ts">
import { computed } from "vue";

interface MenuItem {
  label: string;
  action: string;
  danger?: boolean;
  disabled?: boolean;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  (e: "action", action: string): void;
  (e: "close"): void;
}>();

const menuStyle = computed(() => {
  if (typeof window === "undefined") {
    return { left: `${props.x}px`, top: `${props.y}px` };
  }
  const menuWidth = 190;
  const menuHeight = Math.max(60, props.items.length * 38 + 16);
  const winW = window.innerWidth || 1200;
  const winH = window.innerHeight || 800;
  const safeX = Math.max(8, Math.min(props.x, winW - menuWidth - 8));
  const safeY = Math.max(8, Math.min(props.y, winH - menuHeight - 8));
  return {
    left: `${safeX}px`,
    top: `${safeY}px`,
  };
});

function onItemClick(action: string) {
  emit("action", action);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu"
      :style="menuStyle"
      @click.stop
      @contextmenu.stop.prevent
    >
      <button
        v-for="(item, i) in items"
        :key="i"
        type="button"
        class="context-menu-item"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="onItemClick(item.action)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 1500;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: rgba(10, 16, 30, 0.96);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.75),
    0 0 16px rgba(56, 189, 248, 0.2);
  display: grid;
  gap: 4px;
}

.context-menu-item {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  background: transparent;
  color: #cbd5e1;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.context-menu-item:hover:not(:disabled) {
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

.context-menu-item.danger:hover:not(:disabled) {
  background: rgba(255, 84, 84, 0.18);
  color: #ff8080;
}
</style>
