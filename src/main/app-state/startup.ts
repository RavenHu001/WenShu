import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import {
  planDataDirectory,
  prepareBootstrapRuntime,
  runDirectoryGuide,
  setActiveDataRoot,
  type DirectoryEnvironment,
  type DirectoryPlan,
} from './data-directory';

export type ReadyDirectoryPlan = Extract<DirectoryPlan, { status: 'ready' }>;
/** Call synchronously from the main entry. Only the ready branch invokes business initialization. */
export function startApplication(
  environment: DirectoryEnvironment,
  initialize: (plan: ReadyDirectoryPlan) => void,
): void {
  let plan: DirectoryPlan;
  try {
    plan = planDataDirectory(environment);
    const bootstrap = plan.status === 'guide' ? prepareBootstrapRuntime(environment.temp) : null;
    const runtime = plan.status === 'ready' ? plan.directory.runtime : bootstrap!.runtime;
    app.setPath('userData', runtime);
    app.setPath('sessionData', join(runtime, 'session'));
    app.setAppLogsPath(join(runtime, 'logs'));
    app.setPath('crashDumps', join(runtime, 'crashDumps'));
    if (bootstrap) process.once('exit', bootstrap.cleanup);
  } catch {
    // Electron explicitly supports showErrorBox before ready. Do not initialize a default profile.
    dialog.showErrorBox(
      '文枢启动失败',
      '无法建立安全运行目录。请检查路径和权限；不会自动改用其他数据目录。',
    );
    app.exit(1);
    return;
  }
  if (plan.status === 'guide') {
    const guide = plan;
    void app.whenReady().then(async () => {
      try {
        const result = await runDirectoryGuide(guide, {
          select: async (options) => {
            const result = await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
          },
          message: async (options) =>
            (await dialog.showMessageBox({ title: '文枢数据目录', ...options })).response,
        });
        if (result === 'restart') app.relaunch();
      } catch {
        dialog.showErrorBox('文枢启动失败', '数据目录初始化未完成，原有记录已保留。请检查后重启。');
      }
      app.quit();
    });
    return;
  }
  const ready = plan;
  setActiveDataRoot(ready.directory.root);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  void app.whenReady().then(() => {
    try {
      initialize(ready);
    } catch {
      dialog.showErrorBox('文枢启动失败', '数据目录在启动期间变得不可用，请检查后重启。');
      app.quit();
    }
  });
}
