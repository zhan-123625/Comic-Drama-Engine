import { ref } from "vue";
import { defineStore } from "pinia";
import type { MenuKey, SideTabKey } from "../types";

export const useUiStore = defineStore("ui", () => {
  const activeMenu = ref<MenuKey>("settings");
  const activeSideTab = ref<SideTabKey>("projects");
  const showingCreateProject = ref(false);
  const busy = ref(false);
  const logs = ref<string[]>([]);
  const polishErr = ref("");

  // Toast notifications
  type ToastType = "success" | "error" | "info";
  interface Toast {
    id: number;
    type: ToastType;
    message: string;
  }
  const toasts = ref<Toast[]>([]);
  let toastCounter = 0;

  function showToast(message: string, type: ToastType = "info") {
    const id = ++toastCounter;
    toasts.value.push({ id, type, message });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 5000);
  }

  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    activeMenu,
    activeSideTab,
    showingCreateProject,
    busy,
    logs,
    polishErr,
    toasts,
    showToast,
    removeToast,
  };
});
