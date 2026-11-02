import { ref } from "vue";

/**
 * Workspace scroll position memory — saves/restores scrollTop when
 * the active view (menu/project/side-tab) changes.
 */
export function useScrollMemory(scrollKeyFn: () => string) {
  const workspaceScrollEl = ref<HTMLElement | null>(null);
  const scrollTopMemory: Record<string, number> = {};

  /** Call from a watcher that fires *before* the navigation renders. */
  function saveScroll(oldKey: string) {
    const el = workspaceScrollEl.value;
    if (el) scrollTopMemory[oldKey] = el.scrollTop;
  }

  /** Call from a watcher that fires *after* the navigation renders. */
  function restoreScroll() {
    const el = workspaceScrollEl.value;
    if (el) el.scrollTop = scrollTopMemory[scrollKeyFn()] ?? 0;
  }

  return { workspaceScrollEl, saveScroll, restoreScroll };
}
