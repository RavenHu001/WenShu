import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { RestoreWorkspaceResult, WorkspaceSnapshot } from '../../src/shared/workspace';
import { AppStateStore } from '../../src/main/app-state/app-state-store';
import { defaultSettings, defaultState, validState } from '../../src/shared/app-state';
const mock = vi.hoisted(() => ({ handle: vi.fn(), dialog: vi.fn(), scan: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mock.handle },
  dialog: { showOpenDialog: mock.dialog },
  BrowserWindow: { fromWebContents: () => null },
}));
vi.mock('../../src/main/workspace/scan-workspace', async (original) => {
  const source = await original<typeof import('../../src/main/workspace/scan-workspace')>();
  return {
    scanWorkspace: (...args: Parameters<typeof source.scanWorkspace>) =>
      mock.scan(...args) ?? source.scanWorkspace(...args),
  };
});
let root: string;
let workspace: string;
let store: AppStateStore;
let session: typeof import('../../src/main/workspace/workspace-session');
let handlers: Map<
  string,
  (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<RestoreWorkspaceResult>
>;
let alive: boolean;
const frame = {};
const event = {
  sender: { mainFrame: frame, isDestroyed: () => !alive },
  senderFrame: frame,
} as unknown as IpcMainInvokeEvent;
function seed(
  paths = ['a.txt'],
  active: string | null = paths.at(-1) ?? null,
  selectedRoot = workspace,
) {
  const value = {
    ...defaultState(),
    lastWorkspace: { rootPath: selectedRoot, tabRelativePaths: paths, activeRelativePath: active },
  };
  writeFileSync(join(root, 'state.json'), JSON.stringify(value));
  return value;
}
async function setup() {
  store = new AppStateStore({ root, mode: 'test', getWorkspace: session.getWorkspaceIdentity });
  const { registerWorkspaceIpc } = await import('../../src/main/workspace/workspace-ipc');
  registerWorkspaceIpc(store);
  handlers = new Map(mock.handle.mock.calls.map(([name, handler]) => [name, handler]));
}
beforeEach(async () => {
  vi.resetModules();
  mock.handle.mockClear();
  mock.scan.mockReset();
  mock.dialog.mockReset();
  session = await import('../../src/main/workspace/workspace-session');
  const base = resolve('.local-data/test/task-013/restore');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'case-'));
  workspace = join(root, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'a.txt'), 'current disk');
  alive = true;
});
afterEach(async () => {
  if (store) await store.flush();
  rmSync(root, { recursive: true, force: true });
});
describe('restoreLast real roots and main generation', () => {
  it('rejects arbitrary arguments/frames and issues a new identity only after safe scanning', async () => {
    const original = seed();
    await setup();
    const restore = handlers.get('workspace:restore-last')!;
    expect(await restore(event, workspace)).toMatchObject({
      status: 'error',
      error: { code: 'INVALID_REQUEST' },
    });
    expect(await restore({ ...event, senderFrame: {} } as IpcMainInvokeEvent)).toMatchObject({
      status: 'error',
    });
    expect(session.getWorkspaceIdentity()).toBeNull();
    const first = await restore(event);
    expect(first).toMatchObject({
      status: 'selected',
      restore: { tabRelativePaths: ['a.txt'], activeRelativePath: 'a.txt' },
    });
    expect(store.get().workspaceSessionId).toBe(session.getWorkspaceIdentity()?.id);
    const second = await restore(event);
    expect(
      second.status === 'selected' &&
        first.status === 'selected' &&
        second.workspaceSessionId !== first.workspaceSessionId,
    ).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))).toEqual(original);
  });
  it('keeps missing-file positions but rejects links and directories without reading them', async () => {
    mkdirSync(join(workspace, 'folder.txt'));
    mkdirSync(join(root, 'outside'));
    symlinkSync(join(root, 'outside'), join(workspace, 'linked'), 'junction');
    seed(['a.txt', 'missing.txt', 'folder.txt', 'linked/secret.txt']);
    await setup();
    expect(await handlers.get('workspace:restore-last')!(event)).toMatchObject({
      status: 'selected',
      restore: { tabRelativePaths: ['a.txt', 'missing.txt'], warnings: ['UNSAFE_PATH'] },
    });
  });
  it('missing or linked root keeps old record and does not create directories; retry succeeds', async () => {
    const missing = join(root, 'gone');
    const original = seed(['a.txt'], 'a.txt', missing);
    await setup();
    expect(await handlers.get('workspace:restore-last')!(event)).toMatchObject({ status: 'error' });
    expect(session.getWorkspaceIdentity()).toBeNull();
    expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))).toEqual(original);
    symlinkSync(workspace, missing, 'junction');
    expect(await handlers.get('workspace:restore-last')!(event)).toMatchObject({ status: 'error' });
    rmSync(missing);
    mkdirSync(missing);
    expect(await handlers.get('workspace:restore-last')!(event)).toMatchObject({
      status: 'selected',
    });
  });
  it.each(['blank', 'workspace', 'workspace-and-tabs'] as const)(
    'uses durable %s policy',
    async (startupMode) => {
      seed();
      writeFileSync(
        join(root, 'settings.json'),
        JSON.stringify({ ...defaultSettings(), startupMode }),
      );
      await setup();
      const result = await handlers.get('workspace:restore-last')!(event);
      expect(result.status).toBe(startupMode === 'blank' ? 'not-recorded' : 'selected');
      if (result.status === 'selected')
        expect(result.restore.tabRelativePaths).toEqual(
          startupMode === 'workspace' ? [] : ['a.txt'],
        );
    },
  );
  it('deduplicates bounded disk input, keeps active item in original order and reports the cap', async () => {
    const paths = Array.from({ length: 105 }, (_, i) => `${i}.txt`);
    const original = seed([...paths, '0.TXT'], '104.txt');
    await setup();
    const result = await handlers.get('workspace:restore-last')!(event);
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('restore failed');
    expect(result.restore.tabRelativePaths).toEqual([...paths.slice(0, 99), '104.txt']);
    expect(result.restore.warnings).toEqual(['TAB_LIMIT']);
    expect(validState(store.get().state)).toBe(true);
    await store.flush();
    expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))).toEqual(original);
  });
  it.each(['../secret.txt', 'C:/secret.txt', 'a.txt:stream', 'a.pdf', 'linked\\a.txt'])(
    'rejects dangerous disk record %s and keeps bytes',
    async (path) => {
      seed([path]);
      const original = readFileSync(join(root, 'state.json'), 'utf8');
      await setup();
      expect(await handlers.get('workspace:restore-last')!(event)).toMatchObject({
        status: 'error',
        error: { code: 'INVALID_DATA' },
      });
      await store.flush();
      expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe(original);
    },
  );
  it('a later manual open wins over a delayed restoration scan; old token cannot checkpoint new root', async () => {
    seed();
    await setup();
    const old = session.setCurrentWorkspaceRoot(workspace);
    let release!: (value: WorkspaceSnapshot) => void;
    mock.scan.mockImplementationOnce(
      () =>
        new Promise<WorkspaceSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    const pending = handlers.get('workspace:restore-last')!(event);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const other = join(root, 'other');
    mkdirSync(other);
    mock.dialog.mockResolvedValue({ canceled: false, filePaths: [other] });
    const manual = await handlers.get('workspace:open')!(event);
    expect(manual.status).toBe('selected');
    release({ rootName: 'workspace', rootPath: workspace, entries: [] });
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(session.getCurrentWorkspaceRoot()).toBe(other);
    expect(
      store.checkpoint({
        workspaceSessionId: old.id,
        tabRelativePaths: ['a.txt'],
        activeRelativePath: 'a.txt',
        sidebar: defaultState().sidebar,
      }),
    ).toMatchObject({ status: 'error', error: { code: 'STALE_SESSION' } });
  });
  it('does not commit a scan after the requesting window was destroyed', async () => {
    seed();
    await setup();
    mock.scan.mockImplementationOnce(async () => {
      alive = false;
      return { rootName: 'workspace', rootPath: workspace, entries: [] };
    });
    expect(await handlers.get('workspace:restore-last')!(event)).toEqual({ status: 'cancelled' });
    expect(session.getWorkspaceIdentity()).toBeNull();
  });
});
