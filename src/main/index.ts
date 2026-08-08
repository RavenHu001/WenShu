import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { registerWorkspaceIpc } from './workspace/workspace-ipc';
import { registerDocumentIpc } from './document/document-ipc';
import { registerSearchIpc } from './search/search-ipc';
import { registerWindowCloseIpc, registerWindowCloseProtection } from './window/window-close';

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: '文枢',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f5f7',
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

void app.whenReady().then(() => {
  // 当前应用无需摄像头、定位等 Web 权限，因此采用拒绝优先策略。
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  registerWorkspaceIpc();
  registerDocumentIpc();
  registerSearchIpc();
  registerWindowCloseIpc();

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
