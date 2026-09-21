import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerAppStateIpc } from '../../src/main/app-state/app-state-ipc';
import type { AppStateStore } from '../../src/main/app-state/app-state-store';
import type { ReadyDirectoryPlan } from '../../src/main/app-state/startup';
const mock = vi.hoisted(() => ({ handle: vi.fn(), openPath: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mock.handle },
  shell: { openPath: mock.openPath },
}));
const frame = {};
const webContents = { mainFrame: frame };
const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
let handlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>;
let checkpoint: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mock.handle.mockClear();
  checkpoint = vi.fn(() => ({ status: 'queued', warnings: [] }));
  registerAppStateIpc(
    {
      get: () => ({ marker: true }),
      checkpoint,
      resetInvalidFile: vi.fn(),
    } as unknown as AppStateStore,
    {} as ReadyDirectoryPlan,
    () => window,
  );
  handlers = new Map(mock.handle.mock.calls.map(([name, handler]) => [name, handler]));
});
describe('app-state narrow IPC', () => {
  it('exposes exactly seven capabilities and rejects extra arguments and unowned frames', async () => {
    expect([...handlers.keys()].sort()).toEqual([
      'app-state:checkpoint',
      'app-state:choose-data-directory-on-next-start',
      'app-state:flush',
      'app-state:get',
      'app-state:open-data-directory',
      'app-state:reset-invalid-file',
      'app-state:update-preferences',
    ]);
    const get = handlers.get('app-state:get')!;
    expect(await get(event)).toEqual({ status: 'ok', snapshot: { marker: true } });
    for (const [requestEvent, args] of [
      [event, ['/arbitrary']],
      [{ ...event, senderFrame: {} }, []],
      [{ ...event, sender: {} }, []],
    ] as const)
      expect(await get(requestEvent as IpcMainInvokeEvent, ...args)).toMatchObject({
        status: 'error',
        error: { code: 'INVALID_REQUEST' },
      });
  });
  it('forwards only one checkpoint DTO and limits reset targets to the two files', async () => {
    const dto = { anything: 'validated by store' };
    await handlers.get('app-state:checkpoint')!(event, dto);
    expect(checkpoint).toHaveBeenCalledWith(dto);
    expect(await handlers.get('app-state:reset-invalid-file')!(event, '../settings')).toMatchObject(
      { status: 'error', error: { code: 'INVALID_REQUEST' } },
    );
  });
});
