// Isolated WP1 host: exercises the production startup/store modules, never imported by product UI.
import { app, BrowserWindow, dialog, session } from 'electron';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { startApplication } from '../src/main/app-state/startup';
import { AppStateStore } from '../src/main/app-state/app-state-store';
import { defaultSettings } from '../src/shared/app-state';

const root = process.env.WENSHU_WP1_ROOT;
assert(root && isAbsolute(root) && existsSync(join(root, 'probe-marker')));
const display = (path) => relative(root, path).replaceAll('\\', '/');
const record = (event, details = {}) =>
  appendFileSync(
    join(root, 'events.jsonl'),
    JSON.stringify({ event, pid: process.pid, ready: app.isReady(), ...details }) + '\n',
  );
let windows = 0;
let sessions = 0;
// Observe real native dialogs, preserving their implementation and user-driven responses.
const nativeSelect = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (options) => {
  record('native-select');
  const result = await nativeSelect(options);
  if (!result.canceled)
    for (const path of result.filePaths)
      assert(
        realpathSync(path).startsWith(realpathSync(root) + '\\'),
        'Selection must stay in the isolated root',
      );
  record('native-select-result', {
    canceled: result.canceled,
    paths: result.filePaths.map(display),
  });
  return result;
};
const nativeMessage = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = async (options) => {
  record('native-message', { buttons: options.buttons });
  const result = await nativeMessage(options);
  record('native-message-result', { response: result.response });
  return result;
};
app.on('browser-window-created', () => {
  windows++;
});
app.on('session-created', () => {
  sessions++;
});
app.on('second-instance', () => record('second-instance', { windows, sessions }));
app.on('will-quit', () => record('quit', { windows, sessions }));
app.setPath('appData', join(root, 'appData'));
app.setPath('temp', join(root, 'temp'));
const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDirectory)
  assert(realpathSync(portableDirectory).startsWith(realpathSync(root) + '\\'));
const mode = process.env.WENSHU_WP1_MODE;
const environment = {
  packaged: app.isPackaged,
  projectRoot: join(root, 'project'),
  executable: app.getPath('exe'),
  appData: app.getPath('appData'),
  temp: app.getPath('temp'),
  ...(portableDirectory ? { portableDirectory } : {}),
  ...(mode === 'test' ? { userDataOverride: join(root, 'override') } : {}),
};
record('entry', {
  packaged: app.isPackaged,
  exe: display(app.getPath('exe')),
  portableDirectory: portableDirectory ? display(portableDirectory) : null,
});
startApplication(environment, (plan) => {
  void (async () => {
    record('business', {
      mode: plan.directory.mode,
      root: display(plan.directory.root),
      windows,
      sessions,
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    const store = new AppStateStore({
      root: plan.directory.root,
      mode: plan.directory.mode,
      getWorkspace: () => null,
    });
    const settings = defaultSettings();
    const result = await store.updatePreferences({
      theme: 'dark',
      txtFontPreset: settings.txtFontPreset,
      txtFontSizePx: settings.txtFontSizePx,
      startupMode: 'workspace',
    });
    assert.equal(result.status, 'saved');
    await session.defaultSession.cookies.set({
      url: 'https://wenshu.invalid',
      name: 'wp1',
      value: 'isolated',
      expirationDate: Date.now() / 1000 + 3600,
    });
    await session.defaultSession.cookies.flushStore();
    const window = new BrowserWindow({
      show: false,
      width: 600,
      height: 300,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(
      'data:text/html,<title>WenShu WP1 Probe</title><p>WP1 isolated startup verification</p>',
    );
    record('verified', {
      userData: display(app.getPath('userData')),
      sessionData: display(app.getPath('sessionData')),
      storagePath: display(session.defaultSession.storagePath),
      logs: display(app.getPath('logs')),
      crashDumps: display(app.getPath('crashDumps')),
      settings: result.status,
      windows,
      sessions,
    });
    const timer = setInterval(() => {
      if (existsSync(join(root, 'stop'))) {
        clearInterval(timer);
        void store.flush().then(() => app.quit());
      }
    }, 200);
    window.on('closed', () => app.quit());
  })().catch((error) => {
    record('error', { message: String(error) });
    app.exit(1);
  });
});
record('paths-before-ready', {
  userData: display(app.getPath('userData')),
  sessionData: display(app.getPath('sessionData')),
  windows,
  sessions,
});
// Read-only evidence that the bootstrap record is isolated; never read the real appData profile.
app.on('will-quit', () => {
  const path = join(root, 'appData/WenShu/bootstrap.json');
  if (existsSync(path)) record('locator', { bytes: readFileSync(path).length });
});
