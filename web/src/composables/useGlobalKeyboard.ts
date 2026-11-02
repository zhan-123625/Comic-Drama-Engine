import { onMounted, onUnmounted } from "vue";

/**
 * Registers global keyboard / click / resize / scroll listeners that
 * close context menus and other popovers.
 */
export function useGlobalKeyboard(onEsc: (e: KeyboardEvent) => void, closeAllContextMenus: () => void) {
  function handleKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    onEsc(e);
  }

  onMounted(() => {
    window.addEventListener("click", closeAllContextMenus);
    window.addEventListener("resize", closeAllContextMenus);
    window.addEventListener("scroll", closeAllContextMenus, true);
    window.addEventListener("keydown", handleKey);
  });

  onUnmounted(() => {
    window.removeEventListener("click", closeAllContextMenus);
    window.removeEventListener("resize", closeAllContextMenus);
    window.removeEventListener("scroll", closeAllContextMenus, true);
    window.removeEventListener("keydown", handleKey);
  });
}
