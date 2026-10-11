import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppStateStore } from '../../src/main/app-state/app-state-store';
import {
  defaultTempWriteFactory,
  type TempWriteFactory,
} from '../../src/main/document/write-safety';
import {
  defaultSettings,
  defaultState,
  SETTINGS_MAX_BYTES,
  STATE_MAX_BYTES,
  validSettings,
  validState,
  type WorkspaceIdentity,
} from '../../src/shared/app-state';
import { ordinaryDirectory } from '../../src/main/app-state/app-state-files';

let root: string;
let workspace: WorkspaceIdentity | null;
const stores: AppStateStore[] = [];
function store(factory?: TempWriteFactory): AppStateStore {
  const result = new AppStateStore({
    root,
    mode: 'test',
    getWorkspace: () => workspace,
    coalesceMs: 60_000,
    ...(factory ? { writeFactory: factory } : {}),
  });
  stores.push(result);
  return result;
}
const checkpoint = (paths = ['first.txt']) => ({
  workspaceSessionId: workspace?.id ?? null,
  tabRelativePaths: paths,
  activeRelativePath: paths.at(-1) ?? null,
  sidebar: { width: 280, collapsed: false },
});
const preferences = (theme: 'light' | 'dark' = 'dark') => ({ ...defaultSettings(), theme });
const preferenceInput = (theme: 'light' | 'dark' = 'dark') => {
  const s = preferences(theme);
  return {
    theme: s.theme,
    txtFontPreset: s.txtFontPreset,
    txtFontSizePx: s.txtFontSizePx,
    startupMode: s.startupMode,
  };
};
beforeEach(() => {
  const base = resolve('.local-data/test/task-013/storage');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'case-'));
  const path = join(root, 'workspace');
  mkdirSync(path);
  workspace = { id: randomUUID(), rootPath: path };
});
afterEach(async () => {
  for (const item of stores.splice(0)) await item.flush();
  rmSync(root, { recursive: true, force: true });
});

describe('fixed settings/state persistence', () => {
  it.each(['blank', 'workspace'] as const)(
    'layout writes still honor durable %s policy after a prior interrupted policy write',
    async (startupMode) => {
      const lastWorkspace = {
        rootPath: workspace!.rootPath,
        tabRelativePaths: ['a.txt'],
        activeRelativePath: 'a.txt',
      };
      writeFileSync(join(root, 'state.json'), JSON.stringify({ ...defaultState(), lastWorkspace }));
      writeFileSync(
        join(root, 'settings.json'),
        JSON.stringify({ ...defaultSettings(), startupMode }),
      );
      const service = store();
      service.updateSidebar({ width: 300, collapsed: true });
      await service.flush();
      expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).lastWorkspace).toEqual(
        startupMode === 'blank'
          ? null
          : { ...lastWorkspace, tabRelativePaths: [], activeRelativePath: null },
      );
    },
  );
  it('layout-only close preserves the full old workspace during restoration, even for oversized selection', async () => {
    const lastWorkspace = {
      rootPath: workspace!.rootPath,
      tabRelativePaths: Array.from({ length: 105 }, (_, i) => `${i}.txt`),
      activeRelativePath: '104.txt',
    };
    writeFileSync(join(root, 'state.json'), JSON.stringify({ ...defaultState(), lastWorkspace }));
    const service = store();
    workspace = { ...workspace!, id: randomUUID() };
    expect(service.updateSidebar({ width: 420, collapsed: true }).status).toBe('queued');
    service.updateWindow({
      normalBounds: { x: 10, y: 20, width: 1000, height: 700 },
      maximized: true,
    });
    expect((await service.flush()).status).toBe('saved');
    const disk = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
    expect(disk.lastWorkspace).toEqual(lastWorkspace);
    expect(disk.sidebar).toEqual({ width: 420, collapsed: true });
    expect(disk.window.maximized).toBe(true);
    await service.updatePreferences(preferenceInput());
    expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).lastWorkspace).toEqual(
      lastWorkspace,
    );
    expect(service.updateSidebar({ width: 421, collapsed: false }).status).toBe('error');
    expect(service.updateSidebar({ width: 180, collapsed: false, rootPath: root }).status).toBe(
      'error',
    );
  });
  it('preserves the original when Windows rejects replacing a read-only target', async () => {
    if (process.platform !== 'win32') return; // Windows replacement semantics, not a POSIX permission claim.
    const path = join(root, 'state.json');
    const original = JSON.stringify(defaultState());
    writeFileSync(path, original);
    chmodSync(path, 0o444);
    try {
      const service = store();
      service.checkpoint(checkpoint());
      expect(await service.flush()).toMatchObject({
        status: 'error',
        error: { code: 'WRITE_FAILED' },
      });
      expect(readFileSync(path, 'utf8')).toBe(original);
      chmodSync(path, 0o666);
      expect((await service.flush()).status).toBe('saved');
    } finally {
      chmodSync(path, 0o666);
    }
  });
  it('loads missing files without writing defaults on get, unchanged preferences or flush', async () => {
    const service = store();
    expect(service.get().settings).toEqual(defaultSettings());
    expect(await service.updatePreferences(preferenceInput('light'))).toMatchObject({
      status: 'saved',
    });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual(
      preferences('light'),
    );
    expect(readdirSync(root)).not.toContain('state.json');
    const second = store();
    await second.flush();
    expect(second.get().files.state.status).toBe('missing');
  });
  it.each([
    '{broken',
    JSON.stringify({ ...defaultState(), version: 9 }),
    ' '.repeat(STATE_MAX_BYTES + 1),
    JSON.stringify({ ...defaultState(), body: 'forbidden' }),
  ])('blocks all automatic writes over bad state case %#', async (original) => {
    writeFileSync(join(root, 'state.json'), original);
    const service = store();
    expect(service.checkpoint(checkpoint()).status).toBe('error');
    expect(service.updateWindow({ normalBounds: null, maximized: true }).status).toBe('error');
    await service.updatePreferences({ ...preferenceInput(), startupMode: 'blank' });
    await service.flush();
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe(original);
  });
  it.each([
    '{broken',
    JSON.stringify({ ...defaultSettings(), version: 2 }),
    'x'.repeat(SETTINGS_MAX_BYTES + 1),
    JSON.stringify({ ...defaultSettings(), secret: 1 }),
  ])('blocks bad settings despite defaults and exit flush case %#', async (original) => {
    writeFileSync(join(root, 'settings.json'), original);
    const service = store();
    expect((await service.updatePreferences(preferenceInput())).status).toBe('error');
    await service.flush();
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(original);
  });
  it('resets invalid and oversized files only on explicit request, preserving their complete bytes', async () => {
    for (const original of ['{bad', 'x'.repeat(STATE_MAX_BYTES + 23)]) {
      writeFileSync(join(root, 'state.json'), original);
      const service = store();
      expect(await service.resetInvalidFile('state')).toMatchObject({ status: 'saved' });
      expect(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'))).toEqual(defaultState());
      expect(
        readdirSync(root)
          .filter((n) => n.startsWith('.wenshu-invalid-'))
          .some((n) => readFileSync(join(root, n), 'utf8') === original),
      ).toBe(true);
    }
  });
  it('does not reset a newer version or an externally replaced oversized file', async () => {
    writeFileSync(join(root, 'state.json'), JSON.stringify({ ...defaultState(), version: 4 }));
    const newer = store();
    expect(await newer.resetInvalidFile('state')).toMatchObject({
      status: 'error',
      error: { code: 'UNSUPPORTED_VERSION' },
    });
    writeFileSync(join(root, 'state.json'), 'x'.repeat(STATE_MAX_BYTES + 1));
    const oversized = store();
    writeFileSync(join(root, 'state.json'), 'changed');
    expect(await oversized.resetInvalidFile('state')).toMatchObject({
      status: 'error',
      error: { code: 'FILE_CHANGED' },
    });
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe('changed');
  });
  it('coalesces metadata and retains active tab within the first 100 unique paths', async () => {
    const service = store();
    service.checkpoint(checkpoint(['old.txt']));
    const paths = Array.from({ length: 105 }, (_, i) => `${i}.txt`);
    expect(service.checkpoint(checkpoint(paths))).toEqual({
      status: 'queued',
      warnings: ['TAB_LIMIT'],
    });
    await service.flush();
    const value = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
    expect(value.lastWorkspace.tabRelativePaths).toHaveLength(100);
    expect(value.lastWorkspace.activeRelativePath).toBe('104.txt');
    expect(value.lastWorkspace.tabRelativePaths).not.toContain('old.txt');
    expect(validState(value)).toBe(true);
  });
  it('serializes changes during a delayed write and flush waits for the latest revision', async () => {
    let release!: () => void;
    let began!: () => void;
    const started = new Promise<void>((r) => {
      began = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let count = 0;
    const factory: TempWriteFactory = {
      create: async (target) => {
        const handle = await defaultTempWriteFactory.create(target);
        return {
          ...handle,
          sync: async () => {
            if (++count === 1) {
              began();
              await gate;
            }
            await handle.sync();
          },
        };
      },
    };
    const service = store(factory);
    service.checkpoint(checkpoint(['one.txt']));
    const flush = service.flush();
    await started;
    service.checkpoint(checkpoint(['two.docx']));
    const alsoFlush = service.flush();
    release();
    expect((await flush).status).toBe('saved');
    expect((await alsoFlush).status).toBe('saved');
    expect(
      JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).lastWorkspace.tabRelativePaths,
    ).toEqual(['two.docx']);
    expect(count).toBe(2);
  });
  it.each(['write', 'sync', 'close'] as const)(
    'preserves disk and memory on %s failure, with retry',
    async (stage) => {
      const original = JSON.stringify(defaultState());
      writeFileSync(join(root, 'state.json'), original);
      let fail = true;
      const factory: TempWriteFactory = {
        create: async (target) => {
          const handle = await defaultTempWriteFactory.create(target);
          return {
            ...handle,
            [stage]: async (...args: [Buffer]) => {
              if (fail) {
                if (stage === 'close') await handle.close();
                throw new Error('injected failure');
              }
              if (stage === 'write') await handle.write(args[0]);
              else await handle[stage]();
            },
          };
        },
      };
      const service = store(factory);
      service.checkpoint(checkpoint());
      expect(await service.flush()).toMatchObject({
        status: 'error',
        error: { code: 'WRITE_FAILED', retryable: true },
      });
      expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe(original);
      expect(service.get().state.lastWorkspace?.tabRelativePaths).toEqual(['first.txt']);
      fail = false;
      expect((await service.flush()).status).toBe('saved');
      expect(readdirSync(root).some((n) => n.endsWith('.tmp'))).toBe(false);
    },
  );
  it('detects an external edit at replacement and leaves it intact', async () => {
    const factory: TempWriteFactory = {
      create: async (target) => {
        const handle = await defaultTempWriteFactory.create(target);
        return {
          ...handle,
          sync: async () => {
            await handle.sync();
            writeFileSync(target, 'external');
          },
        };
      },
    };
    const service = store(factory);
    service.checkpoint(checkpoint());
    expect(await service.flush()).toMatchObject({
      status: 'error',
      error: { code: 'FILE_CHANGED' },
    });
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe('external');
  });
  it('checks the current session again immediately before replacement', async () => {
    const old = workspace!;
    const factory: TempWriteFactory = {
      create: async (target) => {
        const handle = await defaultTempWriteFactory.create(target);
        return {
          ...handle,
          sync: async () => {
            await handle.sync();
            workspace = { id: randomUUID(), rootPath: old.rootPath };
          },
        };
      },
    };
    const service = store(factory);
    service.checkpoint(checkpoint());
    expect(await service.flush()).toMatchObject({
      status: 'error',
      error: { code: 'STALE_SESSION' },
    });
    expect(readdirSync(root)).not.toContain('state.json');
    expect(service.checkpoint({ ...checkpoint(), workspaceSessionId: old.id })).toMatchObject({
      status: 'error',
      error: { code: 'STALE_SESSION' },
    });
  });
  it('centralizes mode clearing/trimming and does not erase pending restore from an empty renderer', async () => {
    const service = store();
    service.checkpoint(checkpoint());
    await service.flush();
    workspace = null;
    service.checkpoint(checkpoint([]));
    await service.flush();
    expect(service.get().state.lastWorkspace).not.toBeNull();
    await service.updatePreferences({ ...preferenceInput(), startupMode: 'workspace' });
    expect(service.get().state.lastWorkspace?.tabRelativePaths).toEqual([]);
    await service.updatePreferences({ ...preferenceInput(), startupMode: 'blank' });
    expect(service.get().state.lastWorkspace).toBeNull();
    await service.updatePreferences(preferenceInput());
    expect(service.get().state.lastWorkspace).toBeNull();
  });
  it.each(['../bad.txt', '/bad.txt', 'C:/bad.txt', 'sub\\bad.txt', 'con.txt', 'sub/../bad.docx'])(
    'rejects dangerous checkpoint path %s',
    (path) => {
      expect(store().checkpoint(checkpoint([path])).status).toBe('error');
    },
  );
  it('rejects extra fields, coercible preferences, hard-linked JSON and junction roots', async () => {
    const service = store();
    expect(service.checkpoint({ ...checkpoint(), rootPath: root }).status).toBe('error');
    expect(validSettings({ ...defaultSettings(), theme: { toString: () => 'dark' } })).toBe(false);
    writeFileSync(join(root, 'outside.json'), JSON.stringify(defaultSettings()));
    linkSync(join(root, 'outside.json'), join(root, 'settings.json'));
    const linked = store();
    expect((await linked.updatePreferences(preferenceInput())).status).toBe('error');
    const link = join(root, 'alias');
    symlinkSync(workspace!.rootPath, link, 'junction');
    expect(() => ordinaryDirectory(link)).toThrow();
    expect(service.checkpoint(checkpoint(['alias/a.txt']))).toMatchObject({ status: 'queued' }); // absent inside the workspace is metadata, never created
    mkdirSync(join(root, 'target'));
    symlinkSync(join(root, 'target'), join(workspace!.rootPath, 'escape'), 'junction');
    expect(service.checkpoint(checkpoint(['escape/a.txt'])).status).toBe('error');
  });
});
