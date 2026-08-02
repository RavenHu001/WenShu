import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { ReadTextDocumentResult } from '../../src/shared/document';

const electronMock = vi.hoisted(() => {
  const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  const expose = vi.fn<(channel: string, api: unknown) => void>();
  return { invoke, expose };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMock.expose },
  ipcRenderer: { invoke: electronMock.invoke },
}));

import '../../src/preload/index';

// preload 模块在 import 时执行 exposeInMainWorld；此处捕获暴露的 API，供全部用例复用。
const desktop = electronMock.expose.mock.calls[0]?.[1] as DesktopApi;

describe('preload 窄接口契约', () => {
  beforeEach(() => {
    electronMock.invoke.mockClear();
  });

  it('只向 main world 暴露 desktop 一个入口', () => {
    expect(electronMock.expose).toHaveBeenCalledTimes(1);
    expect(electronMock.expose.mock.calls[0]?.[0]).toBe('desktop');
  });

  it('desktop 只包含 runtime、workspace、document 三个命名空间', () => {
    expect(Object.keys(desktop).sort()).toEqual(['document', 'runtime', 'workspace']);
  });

  it('document 命名空间只暴露 readText 一个函数，且只接受一个参数', () => {
    expect(Object.keys(desktop.document)).toEqual(['readText']);
    expect(typeof desktop.document.readText).toBe('function');
    expect(desktop.document.readText.length).toBe(1);
  });

  it('readText 只映射固定的 document:read-text 通道并原样传递相对路径', async () => {
    const loaded: ReadTextDocumentResult = {
      status: 'loaded',
      document: { name: 'a.txt', relativePath: 'sub/a.txt', content: 'x', byteLength: 1 },
    };
    electronMock.invoke.mockResolvedValue(loaded);

    const result = await desktop.document.readText('sub/a.txt');

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:read-text', 'sub/a.txt');
    expect(result).toBe(loaded);
  });

  it('readText 的返回值是 invoke 的透明透传（无额外包装或字段）', async () => {
    const error: ReadTextDocumentResult = {
      status: 'error',
      error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
    };
    electronMock.invoke.mockResolvedValue(error);

    const result = await desktop.document.readText('missing.txt');

    expect(JSON.stringify(result)).toBe(JSON.stringify(error));
  });

  it('workspace.open / refresh 仍映射固定通道', () => {
    void desktop.workspace.open();
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:open');

    electronMock.invoke.mockClear();
    void desktop.workspace.refresh();
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:refresh');
  });

  it('不暴露 ipcRenderer、通用 invoke 或任何可指定通道的接口', () => {
    const flat = (Object.keys(desktop) as string[]).flatMap((key) => [
      key,
      ...Object.keys((desktop as unknown as Record<string, unknown>)[key] as object),
    ]);
    expect(flat).not.toContain('invoke');
    expect(flat).not.toContain('ipcRenderer');

    // JSON 序列化应成功且不包含内部对象名称（函数会被 JSON 自然丢弃）
    const json = JSON.stringify(desktop);
    expect(json).not.toContain('ipcRenderer');
    expect(json).not.toContain('invoke');
  });

  it('desktop 与 document 命名空间均为冻结对象', () => {
    expect(Object.isFrozen(desktop)).toBe(true);
    expect(Object.isFrozen(desktop.document)).toBe(true);
    expect(Object.isFrozen(desktop.workspace)).toBe(true);
  });
});
