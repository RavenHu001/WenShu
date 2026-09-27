import { app, BrowserWindow, dialog, Menu, nativeTheme, session } from 'electron';
import type { AppPreferences } from '../shared/app-state';
import { join, resolve } from 'node:path';
import { startApplication } from './app-state/startup';
import { AppStateStore } from './app-state/app-state-store';
import { registerAppStateIpc } from './app-state/app-state-ipc';
import { getWorkspaceIdentity } from './workspace/workspace-session';
import { appIdentity } from '../shared/app-metadata';
import { registerWorkspaceIpc } from './workspace/workspace-ipc';
import { registerDocumentIpc } from './document/document-ipc';
import { registerDocxIpc } from './docx/docx-ipc';
import { registerSearchIpc } from './search/search-ipc';
import { registerFileManagementIpc } from './workspace/file-management-ipc';
import { registerSaveAsIpc } from './document/save-as-ipc';
import { registerWindowCloseIpc, registerWindowCloseProtection } from './window/window-close';

const createMainWindow = (preferences: AppPreferences): BrowserWindow => {
  const window = new BrowserWindow({
    title: appIdentity.productName,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor:
      preferences.theme === 'dark' ||
      (preferences.theme === 'system' && nativeTheme.shouldUseDarkColors)
        ? '#20242c'
        : '#f5f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染进程必须保持浏览器权限模型，桌面能力只能经 preload 窄接口进入。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Task 1 不需要外部导航或弹窗；默认拒绝可减少未来内容注入后的攻击面。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  // 窗口关闭协调：未保存修改时由渲染进程确认后才放行关闭
  registerWindowCloseProtection(window);

  const developmentUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
};

app.setAppUserModelId(appIdentity.appId);

startApplication(
  {
    packaged: app.isPackaged,
    projectRoot: resolve(__dirname, '../..'),
    executable: app.getPath('exe'),
    appData: app.getPath('appData'),
    temp: app.getPath('temp'),
    ...(process.env['PORTABLE_EXECUTABLE_DIR']
      ? { portableDirectory: process.env['PORTABLE_EXECUTABLE_DIR'] }
      : {}),
    ...(app.commandLine.hasSwitch('user-data-dir')
      ? { userDataOverride: app.commandLine.getSwitchValue('user-data-dir') }
      : {}),
  },
  (plan) => {
    const store = new AppStateStore({
      root: plan.directory.root,
      mode: plan.directory.mode,
      getWorkspace: getWorkspaceIdentity,
    });
    let mainWindow: BrowserWindow | null = null;
    registerAppStateIpc(store, plan, () => mainWindow);
    // 文枢使用 renderer 内可测试、可访问的中文菜单；移除 Electron 默认英文菜单，避免双菜单。
    Menu.setApplicationMenu(null);
    // 当前应用无需摄像头、定位等 Web 权限，因此采用拒绝优先策略。
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    registerWorkspaceIpc();
    registerDocumentIpc();
    registerDocxIpc();
    registerSearchIpc();
    registerFileManagementIpc();
    registerSaveAsIpc();
    registerWindowCloseIpc();

    mainWindow = createMainWindow(store.get().settings);

    // Drain already accepted metadata only. WP4 owns final layout/checkpoint and dirty-close integration.
    let draining = false;
    let bypassOnce = false;
    app.on('before-quit', (event) => {
      if (bypassOnce) {
        bypassOnce = false;
        return;
      }
      if (!draining && !Object.values(store.get().files).some((file) => file.pending)) return;
      event.preventDefault();
      if (draining) return;
      draining = true;
      void store.flush().then(async (result) => {
        if (result.status === 'error') {
          const choice = await dialog.showMessageBox({
            title: '文枢记录未保存',
            type: 'error',
            message: result.error.message,
            detail: '本次设置或恢复记录未保存。原有文件和正文不受影响。',
            buttons: ['重试', '退出'],
            cancelId: 0,
          });
          if (choice.response === 0) {
            draining = false;
            app.quit();
            return;
          }
          bypassOnce = true;
        }
        draining = false;
        app.quit();
      });
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store.get().settings);
      }
    });
  },
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
