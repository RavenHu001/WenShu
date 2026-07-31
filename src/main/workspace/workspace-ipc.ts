/**
 * 工作区 IPC 处理器 —— 注册 `workspace:open` 与 `workspace:refresh` 两个固定通道。
 *
 * ## 安全约束
 *
 * - 处理器不接受渲染进程传入的任何路径参数。
 * - `open` 的路径仅来自 Electron 原生目录选择器。
 * - `refresh` 仅扫描主进程已保存的当前根路径。
 * - 不注册通用文件系统路由或任意命令分发器。
 * - 跨进程返回值为纯可序列化对象，不包含 Node.js 运行时引用。
 *
 * ## 工作区状态模型
 *
 * 主进程保存单一的 `currentWorkspaceRoot` 变量：
 * - 初始为 `null`（未打开工作区）。
 * - 成功打开后更新为新路径。
 * - 打开失败或取消时保持不变（保留原工作区）。
 * - 刷新时只读取已保存的路径。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { scanWorkspace } from './scan-workspace';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntryError,
} from '../../shared/workspace';

/** 当前工作区根路径；null 表示尚未打开任何工作区。 */
let currentWorkspaceRoot: string | null = null;

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

/**
 * 将异常转换为可序列化的 WorkspaceEntryError。
 * 与 scan-workspace 中的 toWorkspaceError 语义一致但独立维护。
 */
function toWorkspaceEntryError(err: unknown): WorkspaceEntryError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code) {
      return { code: nodeErr.code, message: nodeErr.message };
    }
    return { message: nodeErr.message };
  }
  return { message: String(err) };
}

/** 注册工作区相关的 IPC 通道。应在 app.whenReady 回调中调用。 */
export function registerWorkspaceIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  // ---- workspace:open ----
  // 打开原生目录选择器，用户选中后扫描并更新当前工作区。
  // 不接受渲染进程传入的任何路径参数。
  ipcMain.handle('workspace:open', async (event): Promise<OpenWorkspaceResult> => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogResult = win
        ? await dialog.showOpenDialog(win, {
            title: '打开工作区文件夹',
            properties: ['openDirectory'],
          })
        : await dialog.showOpenDialog({
            title: '打开工作区文件夹',
            properties: ['openDirectory'],
          });

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { status: 'cancelled' };
      }

      const rootPath = dialogResult.filePaths[0]!;
      const workspace = await scanWorkspace(rootPath);
      // 扫描成功后才更新当前工作区，失败或取消保留原状态
      currentWorkspaceRoot = rootPath;
      return { status: 'selected', workspace };
    } catch (err) {
      // 对话框或根目录扫描失败：保留原有工作区，返回错误让界面提示
      return { status: 'error', error: toWorkspaceEntryError(err) };
    }
  });

  // ---- workspace:refresh ----
  // 重新扫描已保存的当前工作区根路径。
  // 不接受渲染进程传入的任何路径参数。
  ipcMain.handle('workspace:refresh', async (): Promise<RefreshWorkspaceResult> => {
    if (currentWorkspaceRoot === null) {
      return { status: 'not-open' };
    }

    try {
      const workspace = await scanWorkspace(currentWorkspaceRoot);
      return { status: 'refreshed', workspace };
    } catch (err) {
      return { status: 'error', error: toWorkspaceEntryError(err) };
    }
  });
}
