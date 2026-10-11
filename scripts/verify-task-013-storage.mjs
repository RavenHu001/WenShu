import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const base = join(project, '.local-data/test/task-013/startup');
const appDirectory = join(base, 'probe-app');
const prepare = async () => {
  await mkdir(appDirectory, { recursive: true });
  await build({
    entryPoints: [join(project, 'scripts/task-013-storage-probe.mjs')],
    outfile: join(appDirectory, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  await writeFile(
    join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'wenshu-wp1-probe',
      version: '0.0.1',
      main: 'main.cjs',
      description: 'WP1 production startup modules in an isolated test host',
      author: 'WenShu',
      license: 'MIT',
    }),
  );
  await writeFile(
    join(base, 'builder.json'),
    JSON.stringify(
      {
        appId: 'io.github.ravenhu001.wenshu.wp1probe',
        productName: 'WenShu WP1 Probe',
        executableName: 'WenShu',
        electronVersion: '43.6.0',
        electronDist: join(project, 'node_modules/electron/dist'),
        directories: {
          app: appDirectory,
          output: join(base, 'package'),
          buildResources: join(project, 'build'),
        },
        files: ['main.cjs', 'package.json'],
        asar: {},
        publish: null,
        afterPack: join(project, 'scripts/after-pack-fuses.cjs'),
        win: { sign: false, target: [{ target: 'portable', arch: ['x64'] }] },
        portable: { artifactName: 'WP1-portable.exe' },
      },
      null,
      2,
    ),
  );
};
await prepare();
if (process.argv.includes('--prepare-package')) {
  console.log('Prepared .local-data/test/task-013/startup/builder.json');
  process.exit(0);
}
const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice(7) ?? 'development';
const scenario = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7) ?? 'known';
assert(['development', 'installed', 'portable', 'test'].includes(mode));
assert(
  ['known', 'first', 'first-cancel', 'reselect-cancel', 'missing-cancel', 'unwritable'].includes(
    scenario,
  ),
);
const root = await mkdtemp(join(base, `${mode}-${scenario}-`));
for (const name of ['appData/WenShu', 'temp', 'project', 'chosen 中文', 'launcher'])
  await mkdir(join(root, name), { recursive: true });
await writeFile(join(root, 'probe-marker'), 'WP1 isolated test');
let executable = join(project, 'node_modules/electron/dist/electron.exe');
let args = [appDirectory];
if (mode === 'installed') {
  executable = join(base, 'package/win-unpacked/WenShu.exe');
  args = [];
}
if (mode === 'portable') {
  executable = join(root, 'launcher/WP1-portable.exe');
  await copyFile(join(base, 'package/WP1-portable.exe'), executable);
  args = [];
}
if (mode === 'installed' && !['first', 'first-cancel'].includes(scenario))
  await writeFile(
    join(root, 'appData/WenShu/bootstrap.json'),
    JSON.stringify({
      version: 1,
      dataRoot: join(root, scenario === 'missing-cancel' ? 'missing' : 'chosen 中文'),
      ...(scenario === 'reselect-cancel' ? { reselectOnNextStart: true } : {}),
    }),
  );
if (scenario === 'unwritable') {
  assert(mode === 'portable');
  const deniedRoot = join(root, 'launcher/WenShuData');
  await mkdir(deniedRoot);
  const principal = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync('icacls.exe', [deniedRoot, '/deny', `${principal}:(W)`], {
    windowsHide: true,
    stdio: 'pipe',
  });
  // Only this newly created fixture receives an ACL, and its deny is removed on normal exit.
  process.once('exit', () => {
    execFileSync('icacls.exe', [deniedRoot, '/remove:d', principal], {
      windowsHide: true,
      stdio: 'pipe',
    });
  });
}
const environment = {
  ...process.env,
  WENSHU_WP1_ROOT: root,
  WENSHU_WP1_MODE: mode,
  TEMP: join(root, 'temp'),
  TMP: join(root, 'temp'),
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.PORTABLE_EXECUTABLE_DIR;
const children = [];
const start = () => {
  const child = spawn(executable, args, {
    cwd: project,
    env: environment,
    windowsHide: scenario === 'known',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
  child.stderr.on('data', (data) => {
    void writeFile(join(root, `stderr-${child.pid}.log`), data, { flag: 'a' });
  });
  return child;
};
const events = async () => {
  try {
    return (await readFile(join(root, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
console.log(
  JSON.stringify({
    root: relative(project, root),
    mode,
    scenario,
    nativeSelection: join(root, 'chosen 中文'),
  }),
);
start();
const deadline = Date.now() + (scenario === 'known' ? 45_000 : 600_000);
let verified = false;
while (Date.now() < deadline) {
  const list = await events();
  if (list.some((item) => item.event === 'error'))
    throw new Error('Probe failed; see isolated events.jsonl');
  if (list.some((item) => item.event === 'verified')) {
    verified = true;
    break;
  }
  if (
    ['first-cancel', 'missing-cancel', 'unwritable'].includes(scenario) &&
    list.some((item) => item.event === 'quit')
  )
    break;
  await delay(200);
}
if (verified) {
  start();
  const secondDeadline = Date.now() + 20_000;
  while (
    Date.now() < secondDeadline &&
    !(await events()).some((item) => item.event === 'second-instance')
  )
    await delay(200);
  assert(
    (await events()).some((item) => item.event === 'second-instance'),
    'Known root single instance was not observed',
  );
}
await writeFile(join(root, 'stop'), 'stop this isolated host');
await delay(1200);
const list = await events();
assert(list.length && list.some((item) => item.event === 'quit'), 'Probe did not finish');
if (scenario === 'known') assert(verified, 'Expected a real business startup');
if (scenario === 'missing-cancel') {
  assert(list.some((item) => item.event === 'native-select-result' && item.canceled));
  assert(
    list.some(
      (item) =>
        item.event === 'native-message' &&
        JSON.stringify(item.buttons) === JSON.stringify(['重试', '退出']),
    ),
  );
  assert(!list.some((item) => item.event === 'business'));
  await assert.rejects(readFile(join(root, 'missing/state.json')));
}
if (scenario === 'first-cancel') {
  assert(!list.some((item) => item.event === 'business'));
  await assert.rejects(readFile(join(root, 'appData/WenShu/bootstrap.json')));
}
assert(
  list
    .filter((item) => item.event === 'paths-before-ready')
    .every((item) => item.ready === false && item.sessions === 0 && item.windows === 0),
);
if (scenario === 'first' || scenario === 'reselect-cancel') {
  const bootstrap = list.find(
    (item) => item.event === 'quit' && item.windows === 0 && item.sessions === 0,
  );
  const business = list.find((item) => item.event === 'business');
  assert(
    bootstrap && business && bootstrap.pid !== business.pid,
    'Guide did not exit and restart without business initialization',
  );
}
for (const child of children) if (child.exitCode === null && !verified) child.kill();
console.log(
  JSON.stringify({
    result: 'passed',
    verifiedBusiness: verified,
    events: relative(project, join(root, 'events.jsonl')),
  }),
);
// Keep evidence under a fixed ignored root; never clean a user directory/profile.
assert(!isAbsolute(relative(base, root)) && !relative(base, root).startsWith('..'));
