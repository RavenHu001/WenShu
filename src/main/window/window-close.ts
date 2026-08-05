/**
 * 窗口关闭协调 —— 主进程侧的最小 dirty 状态与关闭确认协议（TASK-004 第 6.4 / 8.6 节）。
 *
 * ## 协议
 *
 * - 渲染进程通过 `window:dirty-changed`（固定通道，单个布尔参数）上报当前文档
 *   是否存在未保存修改；主进程只维护"当前窗口是否有未保存文档"的最小状态；
 * - 用户触发窗口关闭时，主进程先 `preventDefault`，通过 `window:close-requested`
 *   事件询问渲染进程当前状态，避免依赖可能滞后的 fire-and-forget dirty 通知；
 * - 渲染进程依据自身最新状态决定：无未保存修改 → 调用 `window:close-allowed`；
 *   有未保存修改 → 显示"放弃修改 / 取消"确认，放弃后调用 `window:close-allowed`，
 *   取消后调用 `window:close-cancelled`；
 * - `close-allowed` 只放行本次关闭，随后窗口销毁并清理对应状态；
 * - `pendingRequest` 防止多次关闭事件递归触发确认；取消后必须由渲染进程调用
 *   `close-cancelled` 复位，否则后续关闭将无法再次发起询问。
 *
 * ## 边界
 *
 * - 不获得文件内容、工作区根路径或任何通用 IPC 能力；
 * - 不注册通用事件总线、`fs:*`、动态通道或命令执行器；
 * - 窗口销毁后立即清理对应 dirty / 关闭状态，避免内存泄漏。
 */

import { BrowserWindow, ipcMain } from 'electron';

interface WindowCloseState {
  dirty: boolean;
  closeAllowed: boolean;
  pendingRequest: boolean;
}

/** 按 webContents id 维护每个窗口的最小关闭协调状态。 */
const windowStates = new Map<number, WindowCloseState>();

let ipcRegistered = false;

/** 为指定窗口启用关闭保护；应在窗口创建后立即调用。 */
export function registerWindowCloseProtection(window: BrowserWindow): void {
  const id = window.webContents.id;
  windowStates.set(id, { dirty: false, closeAllowed: false, pendingRequest: false });

  window.on('close', (event) => {
    const state = windowStates.get(id);
    if (state === undefined || state.closeAllowed) {
      // 已放行（用户已确认放弃）：允许本次关闭继续
      return;
    }
    event.preventDefault();
    if (state.pendingRequest) {
      // 已有确认请求在途：防止递归触发或重复弹出确认
      return;
    }
    state.pendingRequest = true;
    window.webContents.send('window:close-requested');
  });

  window.on('closed', () => {
    windowStates.delete(id);
  });
}

/** 注册窗口关闭协调 IPC；应在 app.whenReady 中调用一次，保持幂等。 */
export function registerWindowCloseIpc(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle('window:dirty-changed', (event, dirty: unknown) => {
    const state = windowStates.get(event.sender.id);
    if (state !== undefined) {
      // 只接受严格布尔值，避免把任意数据误记为 dirty
      state.dirty = dirty === true;
    }
  });

  ipcMain.handle('window:close-allowed', (event) => {
    const state = windowStates.get(event.sender.id);
    if (state === undefined) {
      return;
    }
    state.closeAllowed = true;
    state.pendingRequest = false;
    // 再次触发 close：本次放行，窗口正常销毁
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:close-cancelled', (event) => {
    const state = windowStates.get(event.sender.id);
    if (state !== undefined) {
      state.pendingRequest = false;
    }
  });
}
