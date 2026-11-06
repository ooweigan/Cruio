import { ApplicationMenu, type BrowserWindow } from "electrobun/main";
import { getLocale, runWithLocale, t } from "@toonflow/server/i18n";
import { normalizeLocale } from "@toonflow/i18n";
import type { DesktopMenuRequest, DesktopMenuState } from "@toonflow/server/desktop";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !value.includes("\0");
}

function parseState(detail: unknown): DesktopMenuState | undefined {
  if (!isRecord(detail) || !isText(detail.locale, 64)) return;
  const locale = normalizeLocale(detail.locale);
  if (!locale || (detail.contextId !== null && !isText(detail.contextId, 256))) return;
  const booleanFields = ["available", "projectOpen", "canvasReady", "canvasFocused", "canUndo", "canRedo"] as const;
  if (!booleanFields.every(field => typeof detail[field] === "boolean")) return;
  if (!Array.isArray(detail.recentProjects) || detail.recentProjects.length > 10
    || !Array.from(detail.recentProjects).every(item => isRecord(item) && isText(item.name, 256) && isText(item.directory, 4096))) return;
  const next = detail as DesktopMenuState;
  return {
    locale, contextId: next.contextId, available: next.available, projectOpen: next.projectOpen,
    canvasReady: next.canvasReady, canvasFocused: next.canvasFocused, canUndo: next.canUndo, canRedo: next.canRedo,
    recentProjects: next.recentProjects.map(({ name, directory }) => ({ name, directory })),
  };
}

export default function createApplicationMenu(window: BrowserWindow): { update(detail: unknown): void; reset(): void } {
  const emptyState: DesktopMenuState = {
    locale: getLocale(), contextId: null, available: false, projectOpen: false,
    canvasReady: false, canvasFocused: false, canUndo: false, canRedo: false, recentProjects: [],
  };
  let state = emptyState;
  let stateJson = "";

  function commandEnabled(): Record<DesktopMenuRequest["action"], boolean> {
    const ready = state.available && state.canvasReady;
    const focused = state.available && state.canvasFocused;
    return {
      about: state.available, settings: state.available, newProject: state.available, openProject: state.available,
      recentProject: state.available && state.recentProjects.length > 0, revealProject: state.available && state.projectOpen,
      undo: focused && state.canUndo, redo: focused && state.canRedo, selectAll: focused && state.canvasReady,
      zoomIn: ready, zoomOut: ready, fitView: ready, resetZoom: ready,
    };
  }

  function render() {
    const nextJson = JSON.stringify(state);
    if (nextJson === stateJson) return;
    runWithLocale(normalizeLocale(state.locale)!, () => {
      const enabled = commandEnabled();
      const command = (action: DesktopMenuRequest["action"], label: string, accelerator?: string) =>
        ({ label, action, enabled: enabled[action], accelerator });
      ApplicationMenu.setApplicationMenu([
        { label: "Cruio", submenu: [
          state.contextId ? command("about", t`关于 Cruio`) : { role: "about", label: t`关于 Cruio` },
          { type: "separator" },
          command("settings", t`设置…`, ","),
          { type: "separator" },
          { role: "hide", label: t`隐藏 Cruio` },
          { role: "hideOthers", label: t`隐藏其他应用` },
          { role: "showAll", label: t`显示全部` },
          { type: "separator" },
          { role: "quit", label: t`退出 Cruio` },
        ] },
        { label: t`文件`, submenu: [
          command("newProject", t`新建项目`, "n"),
          command("openProject", t`打开项目…`, "o"),
          { label: t`最近打开的项目`, enabled: enabled.recentProject, submenu: state.recentProjects.map(project => ({
            ...command("recentProject", project.name), data: project.directory, tooltip: project.directory,
          })) },
          { type: "separator" },
          command("revealProject", t`在访达中显示项目`),
          { label: t`关闭窗口`, action: "closeWindow", accelerator: "w" },
        ] },
        { label: t`编辑`, submenu: [
          state.canvasFocused ? command("undo", t`撤销`, "z") : { role: "undo", label: t`撤销` },
          state.canvasFocused ? command("redo", t`重做`) : { role: "redo", label: t`重做` },
          { type: "separator" },
          { role: "cut", label: t`剪切`, enabled: !state.canvasFocused },
          { role: "copy", label: t`复制` },
          { role: "paste", label: t`粘贴` },
          state.canvasFocused ? command("selectAll", t`全选`, "a") : { role: "selectAll", label: t`全选` },
        ] },
        { label: t`视图`, submenu: [
          command("zoomIn", t`放大`, "="),
          command("zoomOut", t`缩小`, "-"),
          command("fitView", t`适应画布`),
          command("resetZoom", t`重置缩放`, "0"),
          { type: "separator" },
          { role: "toggleFullScreen", label: t`切换全屏` },
        ] },
        { label: t`窗口`, submenu: [
          { role: "minimize", label: t`最小化` },
          { role: "zoom", label: t`缩放` },
          { type: "separator" },
          { action: "showWindow", label: t`前置全部窗口` },
        ] },
      ]);
    });
    stateJson = nextJson;
  }

  ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
    if (!event || typeof event !== "object" || !("data" in event) || !isRecord(event.data)) return;
    const { action, data } = event.data;
    if (action === "closeWindow") {
      window.hide();
      return;
    }
    if (action === "showWindow") {
      window.unminimize();
      window.show();
      window.activate();
      return;
    }
    const enabled = commandEnabled();
    if (typeof action !== "string" || !Object.hasOwn(enabled, action) || !enabled[action as DesktopMenuRequest["action"]]) return;
    const request: DesktopMenuRequest = { action: action as DesktopMenuRequest["action"], contextId: state.contextId };
    if (action === "recentProject") {
      if (typeof data !== "string" || !state.recentProjects.some(project => project.directory === data)) return;
      request.directory = data;
    }
    window.unminimize();
    window.show();
    window.activate();
    window.webview.executeJavascript(`window.dispatchEvent(new CustomEvent("cruio:menu-command", { detail: ${JSON.stringify(request)} }));`);
  });

  function update(detail: unknown) {
    const next = parseState(detail);
    if (!next) return;
    state = next;
    render();
  }

  render();
  return { update, reset() { update({ ...emptyState, locale: state.locale }); } };
}
