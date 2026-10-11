// WP0-only Electron entry. Never import this module from the product entry.
import { app, BrowserWindow, dialog, session } from 'electron';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import process from 'node:process';

const root = process.env.WENSHU_WP0_ROOT;
assert(root && isAbsolute(root) && existsSync(join(root, 'probe-marker')));
const inside = (path) => {
  const part = relative(realpathSync(root), realpathSync(path));
  assert(part && !part.startsWith('..') && !isAbsolute(part), 'Outside probe directory');
  return path;
};
const record = (event, details = {}) =>
  appendFileSync(
    join(root, 'events.jsonl'),
    JSON.stringify({ event, pid: process.pid, ready: app.isReady(), ...details }) + '\n',
  );
const display = (path) => relative(root, path).replaceAll('\\', '/');
const fail = (error) => {
  record('probe-error', { name: error.name, message: error.message.replaceAll(root, '<probe>') });
  app.exit(1);
};
let sessions = 0;
let windows = 0;
app.on('session-created', () => {
  sessions++;
});
app.on('browser-window-created', () => {
  windows++;
});

// Test-only isolation of even the native bootstrap branch; not a product fallback.
app.setPath('appData', inside(join(root, 'appData')));
const locator = join(app.getPath('appData'), 'WenShu', 'bootstrap.json');
const portable = process.env.PORTABLE_EXECUTABLE_DIR;
const dataRoot = portable
  ? join(inside(portable), 'WenShuData')
  : existsSync(locator)
    ? JSON.parse(readFileSync(locator, 'utf8')).dataRoot
    : null;
const runtime = dataRoot ? join(dataRoot, 'runtime') : join(root, 'bootstrap-traces');
if (dataRoot) {
  if (portable) mkdirSync(dataRoot, { recursive: true });
  inside(dataRoot);
}
for (const path of [
  runtime,
  join(runtime, 'session'),
  join(runtime, 'logs'),
  join(runtime, 'crashDumps'),
]) {
  mkdirSync(path, { recursive: true });
  inside(path);
}
assert.equal(app.isReady(), false);
app.setPath('userData', runtime);
app.setPath('sessionData', join(runtime, 'session'));
app.setAppLogsPath(join(runtime, 'logs'));
app.setPath('crashDumps', join(runtime, 'crashDumps'));
record('paths-before-ready', {
  branch: dataRoot ? 'normal' : 'bootstrap',
  paths: Object.fromEntries(
    ['userData', 'sessionData', 'logs', 'crashDumps'].map((key) => [
      key,
      display(app.getPath(key)),
    ]),
  ),
  portableDirectory: portable ? display(portable) : null,
  executableInLauncherDirectory: portable ? dirname(app.getPath('exe')) === portable : null,
  executableInProbeTemp: app.getPath('exe').startsWith(join(root, 'temp')),
});

if (!dataRoot) {
  void app
    .whenReady()
    .then(async () => {
      record('native-dialog', { sessions, windows });
      const chosen = await dialog.showOpenDialog({
        title: 'WenShu WP0 — 选择隔离数据目录',
        defaultPath: join(root, '数据 根'),
        properties: ['openDirectory'],
      });
      assert.equal(sessions, 0);
      assert.equal(windows, 0);
      if (chosen.canceled) {
        record('native-cancelled', { sessions, windows });
        app.quit();
        return;
      }
      const selected = inside(chosen.filePaths[0]);
      const bytes = Buffer.from(JSON.stringify({ version: 1, dataRoot: selected }));
      assert(bytes.length <= 8192);
      mkdirSync(dirname(locator), { recursive: true });
      const temporary = `${locator}.tmp`;
      const fd = openSync(temporary, 'wx');
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, locator);
      record('bootstrap-written', { bytes: bytes.length, sessions, windows });
      app.relaunch();
      app.quit();
    })
    .catch(fail);
} else if (!app.requestSingleInstanceLock()) {
  record('lock-denied', { sessions, windows });
  app.quit();
} else {
  let window;
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    record('second-instance', {
      windows: BrowserWindow.getAllWindows().length,
      focused: window?.isFocused(),
    });
  });
  void app
    .whenReady()
    .then(async () => {
      assert.equal(session.defaultSession.getStoragePath(), app.getPath('sessionData'));
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      window = new BrowserWindow({
        show: false,
        width: 480,
        height: 240,
        title: 'WenShu WP0 startup probe',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      await window.loadURL(
        'data:text/html,<title>WenShu WP0 startup probe</title><p>Isolated startup probe</p>',
      );
      const previous = await session.defaultSession.cookies.get({ name: 'wp0' });
      await session.defaultSession.cookies.set({
        url: 'https://wp0.invalid',
        name: 'wp0',
        value: 'synthetic',
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      });
      await session.defaultSession.cookies.flushStore();
      record('normal-ready', {
        sessions,
        windows,
        previousCookie: previous.length === 1,
        storagePath: display(session.defaultSession.getStoragePath()),
        sandbox: window.webContents.getLastWebPreferences().sandbox,
      });
      const timer = setInterval(() => {
        if (existsSync(join(root, `stop-${process.pid}`))) {
          clearInterval(timer);
          record('normal-exit');
          window.destroy();
          app.quit();
        }
      }, 100);
      setTimeout(() => {
        record('watchdog-expired');
        app.exit(2);
      }, 60_000).unref();
    })
    .catch(fail);
}
