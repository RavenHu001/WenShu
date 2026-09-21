import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  bootstrapPath,
  markReselect,
  planDataDirectory,
  prepareRuntime,
  runDirectoryGuide,
  setActiveDataRoot,
  validateDataRoot,
  type DirectoryEnvironment,
  type NativeDirectoryDialogs,
} from '../../src/main/app-state/data-directory';
import { scanWorkspace } from '../../src/main/workspace/scan-workspace';
import { searchTextWorkspace } from '../../src/main/search/search-text-workspace';
let root: string;
let environment: DirectoryEnvironment;
beforeEach(() => {
  const base = resolve('.local-data/test/task-013/directories');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'case-'));
  for (const name of ['install', 'appData', 'temp', 'chosen 中文']) mkdirSync(join(root, name));
  environment = {
    packaged: true,
    projectRoot: root,
    executable: join(root, 'install/WenShu.exe'),
    appData: join(root, 'appData'),
    temp: join(root, 'temp'),
  };
});
afterEach(() => {
  setActiveDataRoot(null);
  rmSync(root, { recursive: true, force: true });
});
function locator(dataRoot: string, reselectOnNextStart = false): void {
  mkdirSync(dirname(bootstrapPath(environment)), { recursive: true });
  writeFileSync(
    bootstrapPath(environment),
    JSON.stringify({ version: 1, dataRoot, reselectOnNextStart }),
  );
}
function dialogs(selections: (string | null)[], choices: number[] = []): NativeDirectoryDialogs {
  return {
    select: vi.fn(async () => {
      if (!selections.length) throw new Error('unexpected selection');
      return selections.shift()!;
    }),
    message: vi.fn(async () => {
      if (!choices.length) throw new Error('unexpected message');
      return choices.shift()!;
    }),
  };
}
describe('data root plans and native guide decisions', () => {
  it('runtime preparation cannot recreate an already validated root that disappears', () => {
    const path = join(root, 'chosen 中文');
    validateDataRoot(path, environment, false);
    rmdirSync(path);
    expect(() => prepareRuntime(path, 'installed')).toThrow();
    expect(existsSync(path)).toBe(false);
  });
  it('uses stable development, launcher portable, and legacy test override roots', () => {
    const dev = planDataDirectory({ ...environment, packaged: false });
    expect(dev).toMatchObject({
      status: 'ready',
      directory: {
        root: join(root, '.local-data/dev'),
        runtime: join(root, '.local-data/dev/runtime'),
        mode: 'development',
      },
    });
    const portable = planDataDirectory({
      ...environment,
      portableDirectory: join(root, 'chosen 中文'),
    });
    expect(portable).toMatchObject({
      status: 'ready',
      directory: { root: join(root, 'chosen 中文/WenShuData'), mode: 'portable' },
    });
    const override = join(root, 'isolated');
    expect(planDataDirectory({ ...environment, userDataOverride: override })).toMatchObject({
      status: 'ready',
      directory: { root: override, runtime: override, mode: 'test' },
    });
    expect(existsSync(bootstrapPath(environment))).toBe(false);
  });
  it('first selection writes the bounded locator; only next launch is a ready plan', async () => {
    const first = planDataDirectory(environment);
    expect(first).toMatchObject({ status: 'guide', reason: 'first' });
    if (first.status !== 'guide') throw new Error('guide required');
    expect(await runDirectoryGuide(first, dialogs([join(root, 'chosen 中文')]))).toBe('restart');
    expect(readFileSync(bootstrapPath(environment)).length).toBeLessThanOrEqual(8192);
    expect(planDataDirectory(environment)).toMatchObject({
      status: 'ready',
      directory: { root: join(root, 'chosen 中文'), mode: 'installed' },
    });
  });
  it('first cancel exits without creating a locator', async () => {
    const plan = planDataDirectory(environment);
    if (plan.status !== 'guide') throw new Error('guide required');
    expect(await runDirectoryGuide(plan, dialogs([null]))).toBe('exit');
    expect(existsSync(bootstrapPath(environment))).toBe(false);
  });
  it('reselection is only a flag; cancellation clears it and restarts the old root', async () => {
    locator(join(root, 'chosen 中文'));
    const ready = planDataDirectory(environment);
    if (ready.status !== 'ready') throw new Error('ready required');
    expect(await markReselect(ready)).toEqual({ status: 'ok' });
    const plan = planDataDirectory(environment);
    expect(plan).toMatchObject({ status: 'guide', reason: 'reselect' });
    if (plan.status !== 'guide') throw new Error('guide required');
    expect(await runDirectoryGuide(plan, dialogs([null]))).toBe('restart');
    expect(JSON.parse(readFileSync(bootstrapPath(environment), 'utf8'))).toEqual({
      version: 1,
      dataRoot: join(root, 'chosen 中文'),
    });
  });
  it('missing old root is never recreated and cancelled replacement returns to retry/exit', async () => {
    const missing = join(root, 'missing');
    locator(missing);
    const original = readFileSync(bootstrapPath(environment));
    const plan = planDataDirectory(environment);
    if (plan.status !== 'guide') throw new Error('guide required');
    const ui = dialogs([null], [1, 1]);
    expect(await runDirectoryGuide(plan, ui)).toBe('exit');
    expect(ui.message).toHaveBeenLastCalledWith(
      expect.objectContaining({ buttons: ['重试', '退出'] }),
    );
    expect(existsSync(missing)).toBe(false);
    expect(readFileSync(bootstrapPath(environment))).toEqual(original);
  });
  it('rejects overlapping installation roots, nonempty unrelated folders and malformed locators', () => {
    for (const path of [root, dirname(environment.executable), join(root, 'install/inside')]) {
      mkdirSync(path, { recursive: true });
      expect(() => validateDataRoot(path, environment, false, true)).toThrow();
    }
    writeFileSync(join(root, 'chosen 中文/user.txt'), 'keep');
    expect(() => validateDataRoot(join(root, 'chosen 中文'), environment, false, true)).toThrow();
    locator(join(root, 'chosen 中文'));
    writeFileSync(bootstrapPath(environment), '{broken');
    expect(planDataDirectory(environment)).toMatchObject({
      status: 'guide',
      reason: 'invalid-bootstrap',
    });
  });
  it('does not fall back from an unusable fixed root or a relative override', async () => {
    writeFileSync(join(root, 'chosen 中文/WenShuData'), 'not a directory');
    const plan = planDataDirectory({
      ...environment,
      portableDirectory: join(root, 'chosen 中文'),
    });
    if (plan.status !== 'guide') throw new Error('guide required');
    const ui = dialogs([], [0]);
    expect(await runDirectoryGuide(plan, ui)).toBe('exit');
    expect(ui.select).not.toHaveBeenCalled();
    expect(planDataDirectory({ ...environment, userDataOverride: 'relative' })).toMatchObject({
      status: 'guide',
      reason: 'fixed-unavailable',
    });
    expect(planDataDirectory({ ...environment, userDataOverride: '' })).toMatchObject({
      status: 'guide',
      reason: 'fixed-unavailable',
    });
  });
  it('excludes only the active data subtree from scan and search, preserving same-named user directories', async () => {
    const active = join(root, 'WenShuData');
    const user = join(root, 'documents/WenShuData');
    mkdirSync(active);
    mkdirSync(user, { recursive: true });
    writeFileSync(join(active, 'internal.txt'), 'needle');
    writeFileSync(join(user, 'user.txt'), 'needle');
    setActiveDataRoot(active);
    const tree = await scanWorkspace(root);
    expect(tree.entries.map((e) => e.name)).not.toContain('WenShuData');
    expect(tree.entries.find((e) => e.name === 'documents')?.children?.[0]?.name).toBe(
      'WenShuData',
    );
    const results = await searchTextWorkspace(root, {
      requestId: 1,
      query: 'needle',
      caseSensitive: false,
    });
    expect(JSON.stringify(results)).toContain('documents/WenShuData/user.txt');
    expect(JSON.stringify(results)).not.toContain('internal.txt');
  });
});
