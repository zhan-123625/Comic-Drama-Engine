<script setup lang="ts">
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="toast"
          :class="`toast--${toast.type}`"
          role="alert"
          @click="ui.removeToast(toast.id)"
        >
          <span class="toast-icon">
            <template v-if="toast.type === 'success'">&#10003;</template>
            <template v-else-if="toast.type === 'error'">&#10007;</template>
            <template v-else>&#8505;</template>
          </span>
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: rgba(10, 16, 30, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.6),
    0 0 16px rgba(56, 189, 248, 0.15);
  cursor: pointer;
  pointer-events: auto;
}

.toast--success {
  border-color: rgba(16, 185, 129, 0.5);
  background: rgba(16, 185, 129, 0.15);
  color: #6ee7b7;
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.25);
}

.toast--error {
  border-color: rgba(244, 63, 94, 0.5);
  background: rgba(244, 63, 94, 0.15);
  color: #fda4af;
  box-shadow: 0 0 16px rgba(244, 63, 94, 0.25);
}

.toast--info {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.25);
}

.toast-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
}

.toast--success .toast-icon {
  background: rgba(80, 200, 120, 0.25);
  color: #50c878;
}

.toast--error .toast-icon {
  background: rgba(255, 120, 120, 0.25);
  color: #ff7878;
}

.toast--info .toast-icon {
  background: rgba(110, 161, 255, 0.25);
  color: #6ea1ff;
}

.toast-message {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.25s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(60px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(60px);
}
</style>
