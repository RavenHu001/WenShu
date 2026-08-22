// @vitest-environment jsdom
/**
 * TASK-006 WP6 当前文件查找替换测试（任务第 8.6 节与第 4.2 节）。
 * 覆盖：Ctrl+F / Ctrl+H 快捷键；查找导航（上一个/下一个）与大小写选项；
 * 查找不修改正文、不制造 dirty；替换制造 dirty、可撤销/重做并可显式保存；
 * 全部替换为单次撤销；无匹配不修改正文不制造 dirty；
 * 多标签查找状态、选区和历史隔离；关闭标签后搜索会话清理；
 * 既有 Ctrl+S、Ctrl+W、撤销/重做行为无回归。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type {
  ReadTextDocumentResult,
  SaveTextDocumentRequest,
  SaveTextDocumentResult,
} from '../../src/shared/document';
import type {
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '../../src/shared/search';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
  if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
  }
  if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }) as DOMRect;
  }
});

function f(name: string, relativePath: string): WorkspaceEntry {
  return { name, relativePath, kind: 'file' };
}

function snapshot(entries: readonly WorkspaceEntry[]): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries };
}

interface DesktopMock {
  readText: ReturnType<typeof vi.fn>;
  saveText: ReturnType<typeof vi.fn>;
}

function mockDesktop(files: Readonly<Record<string, string>>): DesktopMock {
  const readText = vi.fn(async (relativePath: string): Promise<ReadTextDocumentResult> => {
    const content = files[relativePath];
    if (content === undefined) {
      return { status: 'error', error: { code: 'NOT_FOUND', message: '文件不存在' } };
    }
    return {
      status: 'loaded',
      document: {
        name: relativePath.split('/').pop() ?? relativePath,
        relativePath,
        content,
        byteLength: Buffer.byteLength(content, 'utf8'),
        revision: `rev-${relativePath}`,
        hasUtf8Bom: false,
        lineEnding: 'lf',
      },
    };
  });
  const saveText = vi.fn(
    async (request: SaveTextDocumentRequest): Promise<SaveTextDocumentResult> => ({
      status: 'saved',
      document: {
        name: request.relativePath.split('/').pop() ?? request.relativePath,
        relativePath: request.relativePath,
        content: request.content,
        byteLength: Buffer.byteLength(request.content, 'utf8'),
        revision: `saved-${request.relativePath}-${request.content.length}`,
        hasUtf8Bom: false,
        lineEnding: 'lf',
      },
    }),
  );
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: vi.fn(async (): Promise<OpenWorkspaceResult> => ({
        status: 'selected',
        workspace: snapshot([f('a.txt', 'a.txt'), f('b.txt', 'b.txt')]),
      })),
      refresh: vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' })),
    },
    document: { readText, saveText },
    search: {
      textWorkspace: vi.fn(
        async (request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResult> => ({
          status: 'cancelled',
          requestId: request.requestId,
        }),
      ),
      cancelTextWorkspace: vi.fn(async () => undefined),
    },
    window: {
      setDirtyState: vi.fn(async () => undefined),
      requestClose: vi.fn(async () => undefined),
      cancelClose: vi.fn(async () => undefined),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  };
  return { readText, saveText };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

async function openFile(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

function editorView(): EditorView | null {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  return content === null ? null : EditorView.findFromDOM(content);
}

function contentDOM(): HTMLElement {
  const node = document.querySelector('.cm-content') as HTMLElement | null;
  if (node === null) {
    throw new Error('no editor mounted');
  }
  return node;
}

function editorDoc(): string {
  return editorView()?.state.doc.toString() ?? '';
}

function selectionRange(): [number, number] | null {
  const view = editorView();
  if (view === null) {
    return null;
  }
  const main = view.state.selection.main;
  return [main.from, main.to];
}

function searchPanel(): HTMLElement | null {
  return document.querySelector('.cm-search');
}

function panelInput(name: string): HTMLInputElement {
  const input = document.querySelector(
    `.cm-search input[name="${name}"]`,
  ) as HTMLInputElement | null;
  if (input === null) {
    throw new Error(`search panel input ${name} not found`);
  }
  return input;
}

function saveButton(): HTMLButtonElement {
  const button = screen.getByText('保存').closest('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('expected save button');
  return button;
}

function setQuery(query: string): void {
  act(() => {
    fireEvent.change(panelInput('search'), { target: { value: query } });
  });
}

function setReplace(replacement: string): void {
  act(() => {
    fireEvent.change(panelInput('replace'), { target: { value: replacement } });
  });
}

function pressModKey(key: string, shift = false): void {
  act(() => {
    fireEvent.keyDown(contentDOM(), { key, ctrlKey: true, shiftKey: shift });
  });
}

describe('当前文件查找（第 4.2 节与 8.6 节）', () => {
  it('Ctrl+F 打开查找面板；Ctrl+H 打开面板并聚焦替换输入', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('f');
    expect(searchPanel()).not.toBeNull();
    expect(screen.getByLabelText('当前文档查找与替换').contains(searchPanel())).toBe(true);
    expect(screen.getByRole('button', { name: '搜索面板' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: '查找与替换' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByText('保存')).not.toBeNull();

    pressModKey('h');
    expect(searchPanel()).not.toBeNull();
    expect(document.activeElement).toBe(panelInput('replace'));
  });

  it('无需二次点击，切换到查找与替换标签后直接显示完整面板', async () => {
    mockDesktop({ 'a.txt': 'hello world' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    expect(document.getElementById('document-search-panel')?.hidden).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    expect(document.getElementById('workspace-search-panel')?.hidden).toBe(true);

    expect(searchPanel()).not.toBeNull();
    expect(panelInput('search')).toBeDefined();
    expect(panelInput('replace')).toBeDefined();
    expect(document.activeElement).toBe(panelInput('search'));
    expect(screen.queryByRole('button', { name: '打开文件内替换' })).toBeNull();
  });

  it('查找：上一个/下一个导航、大小写选项；不修改正文、不制造 dirty', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('f');
    setQuery('hello');
    const view = editorView();

    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([0, 5]);

    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([12, 17]);

    act(() => {
      findPrevious(view as EditorView);
    });
    expect(selectionRange()).toEqual([0, 5]);

    // 查找不改正文、不制造 dirty
    expect(editorDoc()).toBe('hello world\nhello again');
    expect(saveButton().disabled).toBe(true);
  });

  it('大小写选项：区分大小写时只匹配精确文本', async () => {
    mockDesktop({ 'a.txt': 'Hello hello' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('f');
    const view = editorView();

    // 开启区分大小写：只匹配小写 hello（位置 6..11）
    act(() => {
      fireEvent.change(panelInput('case'), { target: { checked: true } });
    });
    setQuery('hello');
    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([6, 11]);

    // 关闭区分大小写：匹配第一个 Hello（位置 0..5）
    act(() => {
      fireEvent.change(panelInput('case'), { target: { checked: false } });
    });
    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([0, 5]);
  });
});

describe('当前文件替换（第 4.2 节与 8.6 节）', () => {
  it('替换当前项：修改正文、制造 dirty、可撤销/重做并显式保存', async () => {
    const api = mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('h');
    setQuery('hello');
    setReplace('hi');
    const view = editorView();

    // 先选中当前匹配（replaceNext 只替换与查询匹配的当前选区）
    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([0, 5]);
    act(() => {
      replaceNext(view as EditorView);
    });
    expect(editorDoc()).toBe('hi world\nhello again');
    expect(saveButton().disabled).toBe(false); // dirty

    // 撤销恢复，重做再次替换
    act(() => {
      undo(view as EditorView);
    });
    expect(editorDoc()).toBe('hello world\nhello again');
    act(() => {
      redo(view as EditorView);
    });
    expect(editorDoc()).toBe('hi world\nhello again');

    // Ctrl+S 显式保存：保存器被调用且清除 dirty
    pressModKey('s');
    await act(async () => {});
    expect(api.saveText).toHaveBeenCalledTimes(1);
    expect(api.saveText).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'a.txt', content: 'hi world\nhello again' }),
    );
    expect(saveButton().disabled).toBe(true);
  });

  it('全部替换：作为单次编辑操作撤销；无匹配不修改正文、不制造 dirty', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('h');
    setQuery('hello');
    setReplace('hi');
    const view = editorView();

    act(() => {
      replaceAll(view as EditorView);
    });
    expect(editorDoc()).toBe('hi world\nhi again');
    expect(saveButton().disabled).toBe(false);

    // 单次撤销恢复全部
    act(() => {
      undo(view as EditorView);
    });
    expect(editorDoc()).toBe('hello world\nhello again');

    // 保存后无匹配替换：正文不变、不制造 dirty
    pressModKey('s');
    await act(async () => {});
    expect(saveButton().disabled).toBe(true);
    setQuery('zzz');
    act(() => {
      replaceAll(view as EditorView);
    });
    expect(editorDoc()).toBe('hello world\nhello again');
    expect(saveButton().disabled).toBe(true);
  });
});

describe('查找会话隔离与清理（第 4.2 节）', () => {
  it('多标签查找状态、选区和历史隔离：切换标签不串状态', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again', 'b.txt': 'nothing here' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');
    await openFile('b.txt');

    // 回到 a.txt：打开查找面板、设置查询并选中第一个匹配
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'a.txt' }));
    });
    pressModKey('f');
    setQuery('hello');
    const view = editorView();
    act(() => {
      findNext(view as EditorView);
    });
    expect(selectionRange()).toEqual([0, 5]);

    // 切到 b.txt：无查找面板，b 的正文不受影响
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'b.txt' }));
    });
    expect(searchPanel()).toBeNull();
    expect(editorDoc()).toBe('nothing here');

    // 切回 a.txt：面板、查询与选区全部恢复
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'a.txt' }));
    });
    expect(searchPanel()).not.toBeNull();
    expect(panelInput('search').value).toBe('hello');
    expect(selectionRange()).toEqual([0, 5]);
    expect(editorDoc()).toBe('hello world\nhello again');
  });

  it('关闭标签后重开：查找会话随编辑器会话清理', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    pressModKey('f');
    setQuery('hello');
    expect(searchPanel()).not.toBeNull();

    // 关闭标签（clean，无需确认）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    });
    expect(screen.queryByText('关闭 a.txt')).toBeNull();

    // 重新打开：新会话，查找面板不复现
    fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    await openFile('a.txt');
    expect(searchPanel()).toBeNull();
    expect(editorDoc()).toBe('hello world\nhello again');
  });
});

describe('快捷键回归（第 8.6 节）', () => {
  it('Ctrl+W 仍关闭标签；输入、撤销与重做不受查找扩展影响', async () => {
    mockDesktop({ 'a.txt': 'hello world\nhello again' });
    render(<App />);
    await openWorkspace();
    await openFile('a.txt');

    const view = editorView();
    // 输入
    act(() => {
      view?.dispatch({
        changes: { from: 0, insert: 'X' },
        selection: { anchor: 1 },
      });
    });
    expect(editorDoc()).toBe('Xhello world\nhello again');
    expect(saveButton().disabled).toBe(false);

    // 撤销/重做
    act(() => {
      undo(view as EditorView);
    });
    expect(editorDoc()).toBe('hello world\nhello again');
    act(() => {
      redo(view as EditorView);
    });
    expect(editorDoc()).toBe('Xhello world\nhello again');

    // Ctrl+W 关闭标签（走 App 统一入口）
    await act(async () => {
      fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    });
    expect(screen.queryByRole('tab', { name: 'a.txt' })).toBeNull();
  });
});
