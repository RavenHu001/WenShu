import { BrowserWindow, ipcMain, shell } from 'electron';
import { stateFailure } from '../../shared/app-state';
import { AppStateStore } from './app-state-store';
import { markReselect, type DirectoryPlan } from './data-directory';
import { ordinaryDirectory } from './app-state-files';
import { isWindowFinalizing } from '../window/window-close';

/** Only the application's own top-level renderer can use these fixed capabilities. */
export function registerAppStateIpc(
  store: AppStateStore,
  plan: Extract<DirectoryPlan, { status: 'ready' }>,
  getWindow: () => BrowserWindow | null,
): void {
  const handle = (
    channel: string,
    count: number,
    action: (...args: unknown[]) => unknown,
  ): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const window = getWindow();
      if (
        !window ||
        window.isDestroyed() ||
        isWindowFinalizing(window.webContents.id) ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        args.length !== count
      )
        return stateFailure('INVALID_REQUEST');
      try {
        return await action(...args);
      } catch {
        return stateFailure('WRITE_FAILED');
      }
    });
  };
  handle('app-state:get', 0, () => ({ status: 'ok', snapshot: store.get() }));
  handle('app-state:update-preferences', 1, (value) => store.updatePreferences(value));
  handle('app-state:checkpoint', 1, (value) => store.checkpoint(value));
  handle('app-state:update-sidebar', 1, (value) => store.updateSidebar(value));
  handle('app-state:flush', 0, () => store.flush());
  handle('app-state:open-data-directory', 0, async () => {
    try {
      ordinaryDirectory(plan.directory.root);
      const error = await shell.openPath(plan.directory.root);
      return error ? stateFailure('DATA_DIRECTORY_UNAVAILABLE') : { status: 'ok' };
    } catch {
      return stateFailure('DATA_DIRECTORY_UNAVAILABLE');
    }
  });
  handle('app-state:choose-data-directory-on-next-start', 0, () => markReselect(plan));
  handle('app-state:reset-invalid-file', 1, (file) =>
    file === 'settings' || file === 'state'
      ? store.resetInvalidFile(file)
      : stateFailure('INVALID_REQUEST'),
  );
}
