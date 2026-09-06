import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';
import type {
  ReadDocxDocumentResult,
  SaveDocxDocumentRequest,
  SaveDocxDocumentResult,
} from '../../src/shared/docx';

const electronMock = vi.hoisted(() => {
  const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  const expose = vi.fn<(channel: string, api: unknown) => void>();
  const on = vi.fn<(channel: string, listener: () => void) => void>();
  const removeListener = vi.fn<(channel: string, listener: () => void) => void>();
  return { invoke, expose, on, removeListener };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMock.expose },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
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

  it('desktop 只包含 runtime、workspace、document、search、window 五个命名空间', () => {
    expect(Object.keys(desktop).sort()).toEqual([
      'document',
      'runtime',
      'search',
      'window',
      'workspace',
    ]);
  });

  it('runtime 只暴露构建时固定的版本、平台和 Electron 版本', () => {
    expect(Object.keys(desktop.runtime).sort()).toEqual([
      'appVersion',
      'electronVersion',
      'platform',
    ]);
    expect(desktop.runtime.appVersion).toBe('0.1.0-alpha.1');
    expect(JSON.stringify(desktop.runtime)).not.toContain('process');
  });

  it('document 命名空间只暴露 readText、saveText、readDocx、saveDocx、saveTextAs、saveDocxAs 六个固定函数', () => {
    expect(Object.keys(desktop.document).sort()).toEqual([
      'readDocx',
      'readText',
      'saveDocx',
      'saveDocxAs',
      'saveText',
      'saveTextAs',
    ]);
    expect(desktop.document.readText.length).toBe(1);
    expect(desktop.document.saveText.length).toBe(1);
    expect(desktop.document.readDocx.length).toBe(1);
    expect(desktop.document.saveDocx.length).toBe(1);
    expect(desktop.document.saveTextAs.length).toBe(1);
    expect(desktop.document.saveDocxAs.length).toBe(1);
  });

  it('readText 只映射固定的 document:read-text 通道并原样传递相对路径', async () => {
    const loaded: ReadTextDocumentResult = {
      status: 'loaded',
      document: {
        name: 'a.txt',
        relativePath: 'sub/a.txt',
        content: 'x',
        byteLength: 1,
        revision: 'a'.repeat(64),
        hasUtf8Bom: false,
        lineEnding: 'none',
      },
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

  it('saveText 只映射固定的 document:save-text 通道并原样传递结构化请求', async () => {
    const request = {
      relativePath: 'sub/a.txt',
      content: '新正文',
      expectedRevision: 'b'.repeat(64),
    };
    const saved: SaveTextDocumentResult = {
      status: 'saved',
      document: {
        name: 'a.txt',
        relativePath: 'sub/a.txt',
        content: '新正文',
        byteLength: 4,
        revision: 'c'.repeat(64),
        hasUtf8Bom: false,
        lineEnding: 'none',
      },
    };
    electronMock.invoke.mockResolvedValue(saved);

    const result = await desktop.document.saveText(request);

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:save-text', request);
    expect(JSON.stringify(result)).toBe(JSON.stringify(saved));
  });

  it('saveText 只接受一个参数：不会接受通道名、根路径或其他选项', () => {
    expect(desktop.document.saveText.length).toBe(1);
  });

  it('readDocx 只映射固定的 document:read-docx 通道并原样传递相对路径', async () => {
    const loaded: ReadDocxDocumentResult = {
      status: 'error',
      error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
    };
    electronMock.invoke.mockResolvedValue(loaded);

    const result = await desktop.document.readDocx('sub/a.docx');

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:read-docx', 'sub/a.docx');
    expect(JSON.stringify(result)).toBe(JSON.stringify(loaded));
  });

  it('saveDocx 只映射固定的 document:save-docx 通道并原样传递结构化请求', async () => {
    const request: SaveDocxDocumentRequest = {
      relativePath: 'sub/a.docx',
      expectedRevision: 'a'.repeat(64),
      model: { schemaVersion: 1, blocks: [] },
    };
    const saved: SaveDocxDocumentResult = {
      status: 'saved',
      document: {
        kind: 'docx',
        name: 'a.docx',
        relativePath: 'sub/a.docx',
        revision: 'b'.repeat(64),
        size: 10,
        model: { schemaVersion: 1, blocks: [] },
        compatibility: { level: 'supported', warnings: [] },
      },
      backupRelativePath: 'a.docx.wenshu.bak',
    };
    electronMock.invoke.mockResolvedValue(saved);

    const result = await desktop.document.saveDocx(request);

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:save-docx', request);
    expect(JSON.stringify(result)).toBe(JSON.stringify(saved));
  });

  it('saveTextAs / saveDocxAs 只映射固定通道并原样传递请求', async () => {
    electronMock.invoke.mockResolvedValue({
      status: 'saved',
      mutationId: 1,
      relativePath: 'b.txt',
      kind: 'text',
      document: {
        name: 'b.txt',
        relativePath: 'b.txt',
        content: 'x',
        byteLength: 1,
        revision: 'a'.repeat(64),
        hasUtf8Bom: false,
        lineEnding: 'lf',
      },
    });
    const textRequest = {
      mutationId: 1,
      tabId: 'tab-1',
      sourceRelativePath: 'a.txt',
      target: { parentRelativePath: '', name: 'b.txt' },
      content: 'x',
      expectedSourceRevision: 'r1',
    };
    await desktop.document.saveTextAs(textRequest);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:save-text-as', textRequest);

    electronMock.invoke.mockClear();
    const docxRequest = {
      mutationId: 2,
      tabId: 'tab-2',
      sourceRelativePath: 'a.docx',
      target: { parentRelativePath: '', name: 'b.docx' },
      model: { schemaVersion: 1 as const, blocks: [] as const },
      expectedSourceRevision: 'r1',
    };
    await desktop.document.saveDocxAs(docxRequest);
    expect(electronMock.invoke).toHaveBeenCalledWith('document:save-docx-as', docxRequest);
  });

  it('workspace.open / refresh 仍映射固定通道', () => {
    void desktop.workspace.open();
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:open');

    electronMock.invoke.mockClear();
    void desktop.workspace.refresh();
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:refresh');
  });

  it('workspace 命名空间固定暴露 open/refresh/createText/createDocx/createDirectory/reveal/relocate/trash 八个方法', () => {
    expect(Object.keys(desktop.workspace).sort()).toEqual([
      'createDirectory',
      'createDocx',
      'createText',
      'open',
      'refresh',
      'relocate',
      'reveal',
      'trash',
    ]);
    expect(desktop.workspace.createText.length).toBe(1);
    expect(desktop.workspace.createDocx.length).toBe(1);
    expect(desktop.workspace.createDirectory.length).toBe(1);
    expect(desktop.workspace.reveal.length).toBe(1);
    expect(desktop.workspace.relocate.length).toBe(1);
    expect(desktop.workspace.trash.length).toBe(1);
  });

  it('relocate / trash 只映射固定通道并原样传递请求', async () => {
    electronMock.invoke.mockResolvedValue({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'b.txt',
      kind: 'text',
    });
    const relocateRequest = {
      mutationId: 1,
      sourceRelativePath: 'a.txt',
      parentRelativePath: 'sub',
      name: 'b.txt',
    };
    await desktop.workspace.relocate(relocateRequest);
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:relocate', relocateRequest);

    electronMock.invoke.mockClear();
    await desktop.workspace.trash({ mutationId: 2, relativePath: 'a.txt' });
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:trash', {
      mutationId: 2,
      relativePath: 'a.txt',
    });
  });

  it('createText/createDocx/createDirectory 共用固定 workspace:create-entry 通道，kind 由 preload 固定注入', async () => {
    electronMock.invoke.mockResolvedValue({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'a.txt',
      kind: 'text',
    });
    const request = { mutationId: 1, parentRelativePath: '', name: 'a.txt' };

    await desktop.workspace.createText(request);
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:create-entry', {
      ...request,
      kind: 'text',
    });

    electronMock.invoke.mockClear();
    await desktop.workspace.createDocx(request);
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:create-entry', {
      ...request,
      kind: 'docx',
    });

    electronMock.invoke.mockClear();
    await desktop.workspace.createDirectory(request);
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:create-entry', {
      ...request,
      kind: 'directory',
    });
  });

  it('reveal 只映射固定 workspace:reveal 通道并原样传递请求（根判别值/条目路径）', async () => {
    electronMock.invoke.mockResolvedValue({ status: 'revealed' });

    await desktop.workspace.reveal({ revealRoot: false, relativePath: 'sub/a.txt' });
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:reveal', {
      revealRoot: false,
      relativePath: 'sub/a.txt',
    });

    electronMock.invoke.mockClear();
    await desktop.workspace.reveal({ revealRoot: true });
    expect(electronMock.invoke).toHaveBeenCalledWith('workspace:reveal', { revealRoot: true });
  });

  it('search 命名空间只暴露 textWorkspace 与 cancelTextWorkspace 两个固定方法', () => {
    expect(Object.keys(desktop.search)).toEqual(['textWorkspace', 'cancelTextWorkspace']);
    expect(typeof desktop.search.textWorkspace).toBe('function');
    expect(typeof desktop.search.cancelTextWorkspace).toBe('function');
    expect(desktop.search.textWorkspace.length).toBe(1);
    expect(desktop.search.cancelTextWorkspace.length).toBe(1);
  });

  it('textWorkspace 只映射固定的 search:text-workspace 通道并原样传递结构化请求', async () => {
    const request = { requestId: 7, query: 'hello', caseSensitive: false };
    const completed = {
      status: 'completed',
      requestId: 7,
      files: [],
      statistics: { scannedFiles: 0, matchedFiles: 0, totalMatches: 0, skippedFiles: 0 },
      truncated: false,
      truncatedReason: null,
    } as const;
    electronMock.invoke.mockResolvedValue(completed);

    const result = await desktop.search.textWorkspace(request);

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('search:text-workspace', request);
    expect(JSON.stringify(result)).toBe(JSON.stringify(completed));
  });

  it('cancelTextWorkspace 只映射固定的 search:cancel-text-workspace 通道并原样传递取消请求', async () => {
    electronMock.invoke.mockResolvedValue(undefined);
    await desktop.search.cancelTextWorkspace({ requestId: 7 });

    expect(electronMock.invoke).toHaveBeenCalledTimes(1);
    expect(electronMock.invoke).toHaveBeenCalledWith('search:cancel-text-workspace', {
      requestId: 7,
    });
  });

  it('window 命名空间只暴露四个固定窄接口', () => {
    expect(Object.keys(desktop.window).sort()).toEqual([
      'cancelClose',
      'onCloseRequested',
      'requestClose',
      'setDirtyState',
    ]);
    expect(typeof desktop.window.setDirtyState).toBe('function');
    expect(typeof desktop.window.requestClose).toBe('function');
    expect(typeof desktop.window.cancelClose).toBe('function');
    expect(typeof desktop.window.onCloseRequested).toBe('function');
    expect(desktop.window.setDirtyState.length).toBe(1);
    expect(desktop.window.onCloseRequested.length).toBe(1);
  });

  it('window 接口只映射固定通道且参数固定', () => {
    void desktop.window.setDirtyState(true);
    expect(electronMock.invoke).toHaveBeenCalledWith('window:dirty-changed', true);

    electronMock.invoke.mockClear();
    void desktop.window.requestClose();
    expect(electronMock.invoke).toHaveBeenCalledWith('window:close-allowed');

    electronMock.invoke.mockClear();
    void desktop.window.cancelClose();
    expect(electronMock.invoke).toHaveBeenCalledWith('window:close-cancelled');
  });

  it('onCloseRequested 订阅固定事件通道并返回可用的取消订阅函数', () => {
    const callback = vi.fn();
    const unsubscribe = desktop.window.onCloseRequested(callback);

    expect(electronMock.on).toHaveBeenCalledWith('window:close-requested', expect.any(Function));
    const listener = electronMock.on.mock.calls[0]?.[1];
    listener?.();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith('window:close-requested', listener);
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

  it('desktop 与各命名空间均为冻结对象', () => {
    expect(Object.isFrozen(desktop)).toBe(true);
    expect(Object.isFrozen(desktop.runtime)).toBe(true);
    expect(Object.isFrozen(desktop.document)).toBe(true);
    expect(Object.isFrozen(desktop.workspace)).toBe(true);
    expect(Object.isFrozen(desktop.search)).toBe(true);
    expect(Object.isFrozen(desktop.window)).toBe(true);
  });
});
