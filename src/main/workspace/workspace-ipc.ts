/** Fixed workspace capabilities. Roots come from native selection or validated main state. */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { scanWorkspace } from './scan-workspace';
import {
  beginWorkspaceOpen,
  getCurrentWorkspaceRoot,
  getWorkspaceIdentity,
  isCurrentWorkspaceOpen,
  setCurrentWorkspaceRoot,
} from './workspace-session';
import { ordinaryDirectory } from '../app-state/app-state-files';
import { isDataPath } from '../app-state/data-directory';
import { resolveExistingWorkspaceFile } from './resolve-workspace-entry';
import { selectRestoreTabs, type LastWorkspace } from '../../shared/app-state';
import type { AppStateStore } from '../app-state/app-state-store';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  RestoreWorkspaceResult,
} from '../../shared/workspace';

let registered = false;
const failed = (code: string, message: string) => ({
  status: 'error' as const,
  error: { code, message },
});

/** Both sources share validation, scanning, and the final generation check. No writes on failure. */
async function scanAndCommit(
  root: string,
  generation: number,
  alive: () => boolean,
  record?: LastWorkspace,
): Promise<RestoreWorkspaceResult> {
  try {
    const rootPath = ordinaryDirectory(root);
    if (isDataPath(rootPath)) throw new Error('data root');
    const selected = selectRestoreTabs(
      record?.tabRelativePaths ?? [],
      record?.activeRelativePath ?? null,
    );
    const paths: string[] = [];
    const warnings: ('TAB_LIMIT' | 'UNSAFE_PATH')[] = selected.truncated ? ['TAB_LIMIT'] : [];
    for (const path of selected.paths) {
      const checked = await resolveExistingWorkspaceFile(rootPath, path);
      if (
        isDataPath(join(rootPath, path)) ||
        (checked.status === 'error' &&
          !['NOT_FOUND', 'ACCESS_DENIED', 'FS_FAILED'].includes(checked.error.code))
      ) {
        if (!warnings.includes('UNSAFE_PATH')) warnings.push('UNSAFE_PATH');
      } else paths.push(path);
      if (!alive() || !isCurrentWorkspaceOpen(generation)) return { status: 'cancelled' };
    }
    const workspace = await scanWorkspace(rootPath);
    ordinaryDirectory(rootPath);
    if (!alive() || !isCurrentWorkspaceOpen(generation)) return { status: 'cancelled' };
    const identity = setCurrentWorkspaceRoot(rootPath);
    return {
      status: 'selected',
      workspace,
      workspaceSessionId: identity.id,
      restore: { tabRelativePaths: paths, activeRelativePath: selected.active, warnings },
    };
  } catch {
    if (!alive() || !isCurrentWorkspaceOpen(generation)) return { status: 'cancelled' };
    return failed(
      'WORKSPACE_UNAVAILABLE',
      '无法打开工作区：目录缺失、不可读取或包含不安全链接。可重试或打开其他文件夹。',
    );
  }
}

export function registerWorkspaceIpc(store: Pick<AppStateStore, 'get' | 'getRestoreRecord'>): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(
    'workspace:open',
    async (event, ...args: unknown[]): Promise<OpenWorkspaceResult> => {
      if (args.length || event.senderFrame !== event.sender.mainFrame)
        return failed('INVALID_REQUEST', '工作区请求无效');
      const generation = beginWorkspaceOpen();
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = { title: '打开工作区文件夹', properties: ['openDirectory' as const] };
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0] || !isCurrentWorkspaceOpen(generation))
          return { status: 'cancelled' };
        const opened = await scanAndCommit(
          result.filePaths[0],
          generation,
          () => !event.sender.isDestroyed(),
        );
        return opened.status === 'not-recorded' ? { status: 'cancelled' } : opened;
      } catch {
        return failed('WORKSPACE_UNAVAILABLE', '无法打开工作区，请重试');
      }
    },
  );
  ipcMain.handle(
    'workspace:restore-last',
    async (event, ...args: unknown[]): Promise<RestoreWorkspaceResult> => {
      if (args.length || event.senderFrame !== event.sender.mainFrame)
        return failed('INVALID_REQUEST', '恢复请求不接受路径或其他参数');
      const generation = beginWorkspaceOpen();
      const snapshot = store.get();
      if (snapshot.files.state.error) return { status: 'error', error: snapshot.files.state.error };
      const record = store.getRestoreRecord();
      if (!record) return { status: 'not-recorded' };
      return scanAndCommit(record.rootPath, generation, () => !event.sender.isDestroyed(), record);
    },
  );
  ipcMain.handle(
    'workspace:refresh',
    async (event, ...args: unknown[]): Promise<RefreshWorkspaceResult> => {
      if (args.length || event.senderFrame !== event.sender.mainFrame)
        return failed('INVALID_REQUEST', '工作区请求无效');
      const identity = getWorkspaceIdentity();
      const rootPath = getCurrentWorkspaceRoot();
      if (!rootPath) return { status: 'not-open' };
      try {
        ordinaryDirectory(rootPath);
        const workspace = await scanWorkspace(rootPath);
        if (identity !== getWorkspaceIdentity() || event.sender.isDestroyed())
          return { status: 'not-open' };
        return { status: 'refreshed', workspace };
      } catch {
        return failed('WORKSPACE_UNAVAILABLE', '无法刷新工作区，请重试');
      }
    },
  );
}
