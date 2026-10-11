// Isolated real Electron probe; native mode intentionally waits for a real folder selection.
import assert from 'node:assert/strict';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = process.argv.includes('--native');
const portableSource = process.argv.find((arg) => arg.startsWith('--portable='))?.slice(11);
const installedSource = process.argv.find((arg) => arg.startsWith('--installed='))?.slice(12);
const base = join(project, '.tools', 'task-013-wp0');
assert(!(portableSource && (installedSource || native)), 'Choose one probe mode');
for (const source of [portableSource, installedSource].filter(Boolean)) {
  const part = relative(base, resolve(source));
  assert(
    part && !part.startsWith('..') && !isAbsolute(part),
    'Only WP0-isolated executables may run',
  );
}
await mkdir(base, { recursive: true });
if (process.argv.includes('--prepare-package')) {
  const appDirectory = join(base, 'probe-app');
  await mkdir(appDirectory, { recursive: true });
  await copyFile(
    join(project, 'scripts', 'task-013-startup-probe.mjs'),
    join(appDirectory, 'main.mjs'),
  );
  await writeFile(
    join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'wenshu-wp0-probe',
      version: '0.0.1',
      main: 'main.mjs',
      type: 'module',
      description: 'Isolated WP0 probe',
      author: 'WenShu',
      license: 'MIT',
    }),
  );
  await writeFile(
    join(base, 'builder.json'),
    JSON.stringify(
      {
        appId: 'io.github.ravenhu001.wenshu.wp0probe',
        productName: 'WenShu WP0 Probe',
        executableName: 'WenShu',
        electronVersion: '43.6.0',
        electronDist: join(project, 'node_modules/electron/dist'),
        directories: {
          app: appDirectory,
          output: join(base, 'package'),
          buildResources: join(project, 'build'),
        },
        files: ['main.mjs', 'package.json'],
        asar: {},
        publish: null,
        afterPack: join(project, 'scripts/after-pack-fuses.cjs'),
        win: {
          sign: false,
          target: [
            { target: 'portable', arch: ['x64'] },
            { target: 'nsis', arch: ['x64'] },
          ],
        },
        portable: { artifactName: 'WP0-portable.exe' },
        nsis: {
          artifactName: 'WP0-setup.exe',
          oneClick: false,
          perMachine: false,
          allowElevation: false,
          packElevateHelper: false,
          allowToChangeInstallationDirectory: true,
          deleteAppDataOnUninstall: false,
          runAfterFinish: false,
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    'Prepared .tools/task-013-wp0/builder.json (separate probe identity; product package unchanged)',
  );
  process.exit(0);
}
const root = await mkdtemp(
  join(base, native ? 'native-' : portableSource ? 'portable-' : 'known-'),
);
for (const part of ['temp', 'appData', '数据 根', 'launcher 中文']) await mkdir(join(root, part));
await writeFile(join(root, 'probe-marker'), 'WP0 synthetic data only');
if (!native && !portableSource) {
  await mkdir(join(root, 'appData', 'WenShu'));
  await writeFile(
    join(root, 'appData', 'WenShu', 'bootstrap.json'),
    JSON.stringify({ version: 1, dataRoot: join(root, '数据 根') }),
  );
}
let executable = join(project, 'node_modules', 'electron', 'dist', 'electron.exe');
let args = [join(project, 'scripts', 'task-013-startup-probe.mjs')];
if (installedSource) {
  executable = resolve(installedSource);
  args = [];
}
if (portableSource) {
  executable = join(root, 'launcher 中文', 'WP0-portable.exe');
  await copyFile(resolve(portableSource), executable);
  args = [];
}
const env = {
  ...process.env,
  WENSHU_WP0_ROOT: root,
  TEMP: join(root, 'temp'),
  TMP: join(root, 'temp'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.PORTABLE_EXECUTABLE_DIR;
delete env.PORTABLE_EXECUTABLE_FILE;
const children = [];
const launch = () => {
  const child = spawn(executable, args, { cwd: root, env, stdio: 'ignore' });
  children.push(child);
  child.on('error', (error) => {
    throw error;
  });
  return child;
};
const events = async () => {
  try {
    return (await readFile(join(root, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};
const waitFor = async (predicate, milliseconds = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < milliseconds) {
    const rows = await events();
    assert(
      !rows.some((row) => ['probe-error', 'watchdog-expired'].includes(row.event)),
      'Electron probe failed',
    );
    const result = predicate(rows);
    if (result) return result;
    await delay(100);
  }
  throw new Error('Probe deadline reached; no assertion or security settings were relaxed');
};
console.log(`Probe directory: ${relative(project, root).replaceAll('\\', '/')}`);
launch();
const first = await waitFor(
  (rows) => rows.find((row) => row.event === 'normal-ready'),
  native ? 180_000 : 30_000,
);
launch();
await waitFor((rows) => rows.find((row) => row.event === 'lock-denied'));
await waitFor((rows) =>
  rows.find((row) => row.event === 'second-instance' && row.windows === 1 && row.focused),
);
await writeFile(join(root, `stop-${first.pid}`), 'stop');
await waitFor((rows) => rows.find((row) => row.event === 'normal-exit' && row.pid === first.pid));
// The exit event precedes OS handle release. Wait for this exact owned PID to disappear.
const hasExited = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
};
await waitFor(() => hasExited(first.pid), 10_000);
launch();
const restarted = await waitFor((rows) =>
  rows.find((row) => row.event === 'normal-ready' && row.pid !== first.pid),
);
assert(restarted.previousCookie, 'Session cookie must survive actual process restart');
await writeFile(join(root, `stop-${restarted.pid}`), 'stop');
await waitFor((rows) =>
  rows.find((row) => row.event === 'normal-exit' && row.pid === restarted.pid),
);
await waitFor(() => hasExited(restarted.pid), 10_000);
await waitFor(() =>
  children.every((child) => child.exitCode !== null || child.signalCode !== null),
);
assert(
  children.every((child) => child.exitCode === 0),
  'Every launcher must exit successfully',
);
const rows = await events();
assert(rows.filter((row) => row.event === 'paths-before-ready').every((row) => !row.ready));
if (native) {
  const bootstrap = rows.find((row) => row.event === 'bootstrap-written');
  assert(bootstrap && bootstrap.sessions === 0 && bootstrap.windows === 0);
  assert(bootstrap.pid !== first.pid);
}
if (portableSource)
  assert(
    rows
      .filter((row) => row.event === 'paths-before-ready')
      .every(
        (row) =>
          row.portableDirectory === 'launcher 中文' &&
          row.executableInLauncherDirectory === false &&
          row.executableInProbeTemp,
      ),
  );
const files = await readdir(root, { recursive: true });
const summary = { events: rows, files: files.map((path) => path.replaceAll('\\', '/')).sort() };
await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    result: 'passed',
    native,
    portable: !!portableSource,
    events: rows.length,
    files: files.length,
  }),
);
