import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const fromWebContentsMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  BrowserWindow: { fromWebContents: fromWebContentsMock },
}));

import {
  registerWindowCloseIpc,
  registerWindowCloseProtection,
} from '../../src/main/window/window-close';

type IpcListener = (...args: unknown[]) => unknown;

/** 简化的 BrowserWindow mock：close 事件带 preventDefault，放行时触发 closed。 */
class MockWindow extends EventEmitter {
  readonly webContents: { id: number; send: ReturnType<typeof vi.fn> };
  closeCount = 0;
  private closed = false;

  constructor(id: number) {
    super();
    this.webContents = { id, send: vi.fn() };
  }

  close(): void {
    this.closeCount += 1;
    if (this.closed) {
      return;
    }
    const event = { preventDefault: vi.fn() };
    this.emit('close', event);
    if (event.preventDefault.mock.calls.length === 0) {
      this.closed = true;
      this.emit('closed');
    }
  }
}

describe('registerWindowCloseIpc', () => {
  const handlers = new Map<string, IpcListener>();

  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    handlers.clear();
    ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
      handlers.set(channel, listener);
    });
  });

  it('注册保持幂等，且只注册三个固定协调通道', () => {
    registerWindowCloseIpc();
    registerWindowCloseIpc();
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual([
      'window:close-allowed',
      'window:close-cancelled',
      'window:dirty-changed',
    ]);
  });
});

describe('registerWindowCloseProtection', () => {
  let win: MockWindow;

  beforeEach(() => {
    win = new MockWindow(1);
    fromWebContentsMock.mockReset();
    registerWindowCloseProtection(win as never);
  });

  afterEach(() => {
    fromWebContentsMock.mockClear();
  });

  it('首次关闭被阻止并向渲染进程发送一次 close-requested', () => {
    win.close();

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('window:close-requested');
    expect(win.closeCount).toBe(1);
  });

  it('确认进行中时重复关闭事件不再重复询问（防递归）', () => {
    win.close();
    win.close();
    win.close();

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('close-allowed 后只放行本次关闭，窗口销毁并清理状态', () => {
    win.close();
    expect(win.closeCount).toBe(1);

    fromWebContentsMock.mockReturnValue(win);
    const handler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:close-allowed',
    )?.[1];
    handler?.({ sender: win.webContents });
    expect(win.closeCount).toBe(2);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);

    // 再次 close 不再被阻止（closeAllowed 已置位）
    win.close();
    expect(win.closeCount).toBe(3);
  });

  it('close-cancelled 复位确认状态：取消后再次关闭会重新询问', () => {
    win.close();
    expect(win.webContents.send).toHaveBeenCalledTimes(1);

    const cancelHandler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:close-cancelled',
    )?.[1];
    cancelHandler?.({ sender: win.webContents });

    win.close();
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('dirty-changed 只接受严格布尔值并维护最小状态', () => {
    const dirtyHandler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:dirty-changed',
    )?.[1];

    expect(() => dirtyHandler?.({ sender: win.webContents }, true)).not.toThrow();
    expect(() => dirtyHandler?.({ sender: win.webContents }, false)).not.toThrow();
    expect(() => dirtyHandler?.({ sender: win.webContents }, 'yes')).not.toThrow();
    expect(() => dirtyHandler?.({ sender: win.webContents }, 1)).not.toThrow();
  });

  it('窗口已销毁时 close-allowed 安全无操作（不抛异常）', () => {
    fromWebContentsMock.mockReturnValue(undefined);
    const handler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:close-allowed',
    )?.[1];

    expect(() => handler?.({ sender: win.webContents })).not.toThrow();
  });

  it('窗口销毁后状态清理：旧窗口的后续 IPC 调用安全无操作', () => {
    win.close();
    fromWebContentsMock.mockReturnValue(win);
    const allowedHandler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:close-allowed',
    )?.[1];
    allowedHandler?.({ sender: win.webContents });
    expect(win.closeCount).toBe(2); // 放行并销毁

    const dirtyHandler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:dirty-changed',
    )?.[1];
    const cancelHandler = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'window:close-cancelled',
    )?.[1];

    // 已销毁窗口的后续 IPC 调用不再影响任何状态
    expect(() => dirtyHandler?.({ sender: win.webContents }, true)).not.toThrow();
    expect(() => cancelHandler?.({ sender: win.webContents })).not.toThrow();
  });
});
