import { computed, onScopeDispose, ref, shallowRef, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { locale } from "@toonflow/i18n/vue";
import type { DesktopCanvasCommand, DesktopMenuRequest, DesktopMenuState } from "@toonflow/server/desktop";
import { accountBusy, accountDataReady, accountSession, isAuthenticated } from "@/stores/account";
import { useWorkspaceStore } from "@/stores/workspace";
import { getAccountContext } from "@/lib/accountTransport";
import { waitForControlValue } from "@/lib/mcpControl";
import { isDesktop, isRemoteConnection } from "@/lib/platform";
import useWorkspaceFiles from "@/lib/workspaceFiles";

type ProjectMenu = {
  busy(): boolean;
  run(action: "newProject" | "openProject" | "recentProject", directory?: string): Promise<void>;
};
type CanvasMenu = {
  state(): { ready: boolean; canUndo: boolean; canRedo: boolean };
  run(action: DesktopCanvasCommand): void | Promise<unknown>;
};
type SettingsMenu = { open(panel: "about" | "settings"): void };
const projectMenu = shallowRef<ProjectMenu>();
const canvasMenu = shallowRef<CanvasMenu>();
const settingsMenu = shallowRef<SettingsMenu>();
const hasNativeMenu = isDesktop && /Mac/i.test(navigator.platform);

declare global {
  interface Window {
    __electrobunSendToHost?: (message: unknown) => void;
  }
  interface WindowEventMap {
    "cruio:menu-command": CustomEvent<DesktopMenuRequest>;
  }
}

export function registerProjectMenu(control: ProjectMenu) {
  if (!hasNativeMenu) return;
  projectMenu.value = control;
  onScopeDispose(() => { if (projectMenu.value === control) projectMenu.value = undefined; });
}

export function registerCanvasMenu(control: CanvasMenu) {
  if (!hasNativeMenu) return;
  canvasMenu.value = control;
  onScopeDispose(() => { if (canvasMenu.value === control) canvasMenu.value = undefined; });
}

export function registerSettingsMenu(control: SettingsMenu) {
  if (!hasNativeMenu) return;
  settingsMenu.value = control;
  onScopeDispose(() => { if (settingsMenu.value === control) settingsMenu.value = undefined; });
}

export function useDesktopMenu() {
  if (!hasNativeMenu) return;
  const router = useRouter();
  const workspace = useWorkspaceStore();
  const busy = ref(false);
  const modalOpen = ref(false);
  const focusedElement = shallowRef<Element | null>(document.activeElement);
  const selectedText = ref(false);
  const lifetime = new AbortController();
  const state = computed<DesktopMenuState>(() => {
    const path = router.currentRoute.value.path;
    const available = isAuthenticated.value && accountDataReady.value && !accountBusy.value && !isRemoteConnection
      && ["/home", "/workspace"].includes(path) && !workspace.projectLoading && !busy.value && !modalOpen.value && !projectMenu.value?.busy();
    const canvas = canvasMenu.value?.state();
    const canvasReady = available && path === "/workspace" && !!canvas?.ready;
    const target = focusedElement.value;
    const canvasFocused = canvasReady && !selectedText.value && !!target
      && !target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider'], [role='dialog'], #agentPanel")
      && (target === document.body || target === document.documentElement || !!target.closest(".vue-flow"));
    return {
      locale: locale.value,
      contextId: accountSession.value.contextId,
      available,
      projectOpen: available && path === "/workspace" && !!workspace.project,
      canvasReady,
      canvasFocused,
      canUndo: !!canvas?.canUndo,
      canRedo: !!canvas?.canRedo,
      recentProjects: isAuthenticated.value && accountDataReady.value && !accountBusy.value
        ? [...workspace.projectList].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).slice(0, 10).map(({ name, directory }) => ({ name, directory }))
        : [],
    };
  });
  let lastState = "";
  watchEffect(() => {
    const serialized = JSON.stringify(state.value);
    if (lastState === serialized) return;
    lastState = serialized;
    window.__electrobunSendToHost?.({ type: "menuState", state: state.value });
  }, { flush: "post" });

  function updateFocus() {
    focusedElement.value = document.activeElement;
    selectedText.value = !!window.getSelection()?.toString();
  }
  function updateModals() {
    modalOpen.value = [...document.querySelectorAll<HTMLElement>("[role='dialog'], [role='alertdialog']")].some(element => element.getClientRects().length > 0);
    updateFocus();
  }
  const dialogSelector = "[role='dialog'], [role='alertdialog'], .el-overlay";
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.closest(dialogSelector)
      || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(dialogSelector) || node.querySelector(dialogSelector))))) updateModals();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-hidden"] });
  document.addEventListener("focusin", updateFocus);
  document.addEventListener("selectionchange", updateFocus);
  document.addEventListener("click", updateFocus);
  updateModals();

  async function handleCommand(event: WindowEventMap["cruio:menu-command"]) {
    const request = event.detail;
    if (!request || !state.value.available || request.contextId !== getAccountContext()) return;
    const contextId = request.contextId;
    if (request.action === "about" || request.action === "settings") {
      settingsMenu.value?.open(request.action);
      return;
    }
    if (request.action === "revealProject") {
      if (!state.value.projectOpen || !workspace.project) return;
      try { await useWorkspaceFiles(workspace.project.directory).reveal(""); }
      catch (error) { ElMessage.error(error instanceof Error ? error.message : "无法打开项目所在位置"); }
      return;
    }
    if (["newProject", "openProject", "recentProject"].includes(request.action)) {
      if (request.action === "recentProject" && !state.value.recentProjects.some(project => project.directory === request.directory)) return;
      busy.value = true;
      try {
        if (router.currentRoute.value.path !== "/home") {
          if (await router.push("/home")) return;
        }
        if (router.currentRoute.value.path !== "/home" || contextId !== getAccountContext() || !isAuthenticated.value) return;
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)]);
        const control = await waitForControlValue(() => projectMenu.value, signal);
        if (contextId !== getAccountContext() || !isAuthenticated.value) return;
        await control.run(request.action as "newProject" | "openProject" | "recentProject", request.directory);
      } catch (error) {
        if (!lifetime.signal.aborted && contextId === getAccountContext()) ElMessage.error(error instanceof Error ? error.message : "无法打开项目，请重试");
      } finally { busy.value = false; }
      return;
    }
    if (!state.value.canvasReady) return;
    if (["undo", "redo", "selectAll"].includes(request.action) && !state.value.canvasFocused) return;
    if (!["undo", "redo", "selectAll", "zoomIn", "zoomOut", "fitView", "resetZoom"].includes(request.action)) return;
    try { await canvasMenu.value?.run(request.action as DesktopCanvasCommand); }
    catch (error) { ElMessage.error(error instanceof Error ? error.message : "画布操作失败"); }
  }
  const onCommand = (event: WindowEventMap["cruio:menu-command"]) => { void handleCommand(event); };
  window.addEventListener("cruio:menu-command", onCommand);
  onScopeDispose(() => {
    lifetime.abort();
    observer.disconnect();
    document.removeEventListener("focusin", updateFocus);
    document.removeEventListener("selectionchange", updateFocus);
    document.removeEventListener("click", updateFocus);
    window.removeEventListener("cruio:menu-command", onCommand);
    window.__electrobunSendToHost?.({ type: "menuState", state: { ...state.value, available: false, projectOpen: false, canvasReady: false, canvasFocused: false, recentProjects: [] } });
  });
}
