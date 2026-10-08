import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { mkdir, cp, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout } from 'node:timers';
import { chromium, _electron as electron } from 'playwright-core';
import { Document, Packer, Paragraph } from 'docx';
// Complete product code, isolated fixtures, and real hardened packages. This script never installs
// or uninstalls software. Close each packaged window normally when READY_FOR_NATIVE_CLOSE appears.
// Installed EXEs use the existing test override; native bootstrap is tested by the storage probe.
const project = resolve(import.meta.dirname, '..');
const mode = process.argv[2];
assert(
  ['development', 'portable', 'installed'].includes(mode),
  'Use development, portable, or installed <test-exe>',
);
const base = join(project, '.local-data/test/task-013/wp5');
await mkdir(base, { recursive: true });
const run = await mkdtemp(join(base, `${mode}-`));
const workspace = join(run, 'workspace 中文');
const temp = join(run, 'temp');
await mkdir(workspace);
await mkdir(temp);
await writeFile(join(workspace, 'first.txt'), 'Original disk text');
await writeFile(
  join(workspace, 'second.docx'),
  await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('合成 DOCX 验收文字')] }] }),
  ),
);
let exe, args, data;
if (mode === 'development') {
  const copy = join(run, 'project');
  await mkdir(copy);
  // Copy only build inputs; historical screenshot profiles may also remain under out/.
  for (const part of ['main', 'preload', 'renderer'])
    await cp(join(project, 'out', part), join(copy, 'out', part), { recursive: true });
  await writeFile(
    join(copy, 'package.json'),
    JSON.stringify({ name: 'wenshu-desktop', type: 'module', main: 'out/main/index.js' }),
  );
  exe = join(project, 'node_modules/electron/dist/electron.exe');
  args = [copy];
  data = join(copy, '.local-data/dev');
} else if (mode === 'portable') {
  const launcher = join(run, 'launcher 中文');
  await mkdir(launcher);
  exe = join(launcher, 'WenShu-portable.exe');
  await cp(join(project, 'release/WenShu-0.1.0-alpha.1-portable-x64.exe'), exe);
  args = [];
  data = join(launcher, 'WenShuData');
} else if (mode === 'installed') {
  assert(process.argv[3], 'Supply the repository-isolated installed EXE');
  exe = resolve(project, process.argv[3]);
  assert(
    exe.startsWith(base + '\\'),
    'Installed verification accepts only this repository isolation directory',
  );
  data = join(run, 'external-data');
  args = [`--user-data-dir=${data}`];
} else throw Error('mode');
await mkdir(data, { recursive: true });
const settings = {
  version: 1,
  theme: 'dark',
  txtFontPreset: 'serif',
  txtFontSizePx: 18,
  startupMode: 'workspace-and-tabs',
};
const state = {
  version: 1,
  window: { normalBounds: { x: 80, y: 60, width: 1100, height: 760 }, maximized: false },
  sidebar: { width: 300, collapsed: false },
  lastWorkspace: {
    rootPath: workspace,
    tabRelativePaths: ['first.txt', 'second.docx'],
    activeRelativePath: 'second.docx',
  },
};
await writeFile(join(data, 'settings.json'), JSON.stringify(settings));
await writeFile(join(data, 'state.json'), JSON.stringify(state));
const runtime = mode === 'installed' ? data : join(data, 'runtime');
const env = { ...process.env, TEMP: temp, TMP: temp };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PORTABLE_EXECUTABLE_DIR;
const inventory = async (root) => {
  let result = [];
  try {
    for (const item of await readdir(root, { withFileTypes: true })) {
      const path = join(root, item.name);
      if (item.isDirectory())
        result.push(
          ...(await inventory(path)).map((x) => ({ ...x, path: item.name + '/' + x.path })),
        );
      else result.push({ path: item.name, size: (await stat(path)).size });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return result;
};
const before = await inventory(run);
const rounds = [];
console.log(JSON.stringify({ run: relative(project, run), data: relative(project, data), mode }));
let ownedChild;
try {
  for (let round = 1; round <= 3; round++) {
    let app, browser, page, child, paths;
    if (mode === 'development') {
      app = await electron.launch({ executablePath: exe, args, cwd: run, env });
      child = app.process();
      ownedChild = child;
      page = await app.firstWindow();
      paths = await app.evaluate(({ app, session, screen }) => ({
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
        storage: session.defaultSession.getStoragePath(),
        logs: app.getPath('logs'),
        crashDumps: app.getPath('crashDumps'),
        displays: screen
          .getAllDisplays()
          .map((d) => ({ workArea: d.workArea, scaleFactor: d.scaleFactor })),
      }));
      assert.equal(paths.userData, runtime);
      assert.equal(paths.sessionData, join(runtime, 'session'));
      assert.equal(paths.storage, paths.sessionData);
    } else {
      const launchedAt = Date.now();
      child = spawn(exe, [...args, '--remote-debugging-port=0'], {
        cwd: run,
        env,
        windowsHide: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      ownedChild = child;
      let endpoint = '';
      child.stderr.on('data', (b) => {
        const match = String(b).match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) endpoint = match[1];
      });
      const deadline = Date.now() + 30000;
      while (!endpoint && Date.now() < deadline) {
        try {
          const file = join(runtime, 'session/DevToolsActivePort');
          if ((await stat(file)).mtimeMs >= launchedAt) {
            const text = await readFile(file, 'utf8');
            const [port, path] = text.trim().split('\n');
            endpoint = `ws://127.0.0.1:${port}${path}`;
          }
        } catch {
          // The fresh session port file may not exist yet while the portable package extracts.
        }
        await delay(100);
      }
      assert(endpoint, 'No CDP endpoint');
      browser = await chromium.connectOverCDP(endpoint);
      const end = Date.now() + 10000;
      while (!browser.contexts()[0]?.pages().length && Date.now() < end) await delay(100);
      page = browser.contexts()[0].pages()[0];
    }
    page.setDefaultTimeout(10000);
    await page.waitForURL(/^file:/);
    await page.locator('.docx-editor .ProseMirror:visible').waitFor();
    assert.deepEqual(
      await page.getByRole('tablist', { name: '打开的文档' }).getByRole('tab').allTextContents(),
      ['first.txt', 'second.docx'],
    );
    const snapshot = await page.evaluate('window.desktop.appState.get()');
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.snapshot.dataDirectory.mode, mode === 'installed' ? 'test' : mode);
    assert.equal(snapshot.snapshot.dataDirectory.path, data);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(
      await page
        .getByRole('tab', { name: 'second.docx', exact: true })
        .getAttribute('aria-selected'),
      'true',
    );
    await page.getByRole('tab', { name: 'first.txt', exact: true }).click();
    assert.equal(
      await page.locator('.cm-content').textContent(),
      round === 1 ? 'Original disk text' : 'Updated outside after close',
    );
    assert.equal(
      await page
        .locator('.cm-scroller')
        .evaluate((e) => e.ownerDocument.defaultView.getComputedStyle(e).fontSize),
      `${settings.txtFontSizePx}px`,
    );
    await page.getByRole('tab', { name: 'second.docx', exact: true }).click();
    if (round === 1) await page.keyboard.press('Control+,');
    if (round === 1) {
      await page.getByLabel('TXT 字号', { exact: true }).selectOption('20');
      await page.getByText('设置已保存', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      settings.txtFontSizePx = 20;
    }
    // Native close is driven by the verifier operator for hardened packages; development uses BrowserWindow.close.
    rounds.push({ round, pid: child.pid, paths, snapshot, files: await inventory(data) });
    await writeFile(join(run, 'progress.json'), JSON.stringify({ mode, rounds }, null, 2));
    if (app) {
      const closed = app.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await closed;
    } else {
      console.log(`READY_FOR_NATIVE_CLOSE ${round}`);
      await new Promise((ok, bad) => {
        child.once('exit', (code) => (code === 0 ? ok() : bad(Error(`exit ${code}`))));
        setTimeout(() => bad(Error('Native close not completed in 180 seconds')), 180000).unref();
      });
      await browser.close();
    }
    const durable = JSON.parse(await readFile(join(data, 'state.json'), 'utf8'));
    assert.deepEqual(durable.lastWorkspace, state.lastWorkspace);
    assert.equal(durable.sidebar.width, 300);
    assert.deepEqual(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')), settings);
    await writeFile(join(workspace, 'first.txt'), 'Updated outside after close');
  }
  await writeFile(
    join(run, 'evidence.json'),
    JSON.stringify({ mode, rounds, before, after: await inventory(run) }, null, 2),
  );
  console.log('PASS ' + relative(project, run));
} finally {
  // Never leave an orphan after a failed assertion/operator timeout. Every owned PID was spawned
  // above with synthetic documents; never terminate by executable name or touch another instance.
  if (ownedChild?.pid && ownedChild.exitCode === null) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(ownedChild.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'pipe',
      });
    } catch {
      /* Already exited. */
    }
  }
}
