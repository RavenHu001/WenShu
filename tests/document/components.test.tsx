// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { App } from '../../src/renderer/App';
import { EditorSessionHost } from '../../src/renderer/components/document/EditorSessionHost';
import { useEditorSessions } from '../../src/renderer/lib/use-editor-sessions';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type { ReadTextDocumentResult } from '../../src/shared/document';

type ReadTextFn = (relativePath: string) => Promise<ReadTextDocumentResult>;

/** 窗口协调 API mock：可捕获关闭询问回调并手动触发。 */
function makeWindowApi() {
  let closeRequestedCallback: (() => void) | null = null;
  const windowApi = {
    setDirtyState: vi.fn(async () => undefined),
    requestClose: vi.fn(async () => undefined),
    cancelClose: vi.fn(async () => undefined),
    onCloseRequested: vi.fn((callback: () => void) => {
      closeRequestedCallback = callback;
      return () => {
        closeRequestedCallback = null;
      };
    }),
    triggerCloseRequested: () => {
      closeRequestedCallback?.();
    },
  };
  return windowApi;
}

// CodeMirror 6 在 jsdom 中没有 ResizeObserver，提供最小桩
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
  // jsdom 未实现 Range 的几何测量，CodeMirror 测量文本尺寸时需要这些桩
  if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
  }
  if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }) as DOMRect;
  }
});

function mockDesktop(
  readText: ReadTextFn,
  open?: () => Promise<OpenWorkspaceResult>,
  refresh?: () => Promise<RefreshWorkspaceResult>,
  windowApi: ReturnType<typeof makeWindowApi> = makeWindowApi(),
) {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: open ?? vi.fn(),
      refresh: refresh ?? vi.fn(),
    },
    document: { readText, saveText: vi.fn() },
    window: {
      setDirtyState: windowApi.setDirtyState,
      requestClose: windowApi.requestClose,
      cancelClose: windowApi.cancelClose,
      onCloseRequested: windowApi.onCloseRequested,
    },
  };
  return windowApi;
}

function f(name: string, relativePath: string): WorkspaceEntry {
  return { name, relativePath, kind: 'file' };
}

function d(
  name: string,
  relativePath: string,
  children?: readonly WorkspaceEntry[],
): WorkspaceEntry {
  return {
    name,
    relativePath,
    kind: 'directory',
    ...(children !== undefined ? { children } : {}),
  };
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [], ...overrides };
}

function selectedOpen(workspace: WorkspaceSnapshot): () => Promise<OpenWorkspaceResult> {
  return vi.fn().mockResolvedValue({ status: 'selected', workspace } as OpenWorkspaceResult);
}

function openBtn(): HTMLButtonElement {
  const buttons = screen.getAllByText('打开文件夹');
  return (buttons[0] ?? buttons[buttons.length - 1]) as HTMLButtonElement;
}

function loadedDoc(relativePath: string, content = `内容:${relativePath}`): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision: 'a'.repeat(64),
      hasUtf8Bom: false,
      lineEnding: 'none',
    },
  };
}

async function openWorkspaceWith(entries: readonly WorkspaceEntry[]): Promise<void> {
  mockDesktop(vi.fn<ReadTextFn>(), selectedOpen(snapshot({ entries })));
  render(<App />);
  await userEvent.click(openBtn());
}

/** 在文件树中点击 TXT 文件（标签栏按钮与文件树按钮同名，必须限定作用域）。 */
async function openTextFile(name: string): Promise<void> {
  await userEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
}

/**
 * 按相对路径取标签按钮。标签名可能带未保存标记，且同名不同路径并存，
 * 因此按稳定的 title（完整相对路径）查找，而不是按可访问名称。
 */
function tabByName(path: string): HTMLElement {
  const node = Array.from(document.querySelectorAll<HTMLElement>('.tab-label')).find(
    (button) => button.getAttribute('title') === path,
  );
  if (node === undefined) {
    throw new Error(`找不到标签 ${path}`);
  }
  return node;
}

async function clickTab(path: string): Promise<void> {
  await userEvent.click(tabByName(path));
}

function tabIsActive(path: string): boolean {
  return tabByName(path).getAttribute('aria-selected') === 'true';
}

/** 标签栏中的全部标签名。 */
function tabNames(): string[] {
  return Array.from(document.querySelectorAll('.tab .tab-name')).map(
    (node) => node.textContent ?? '',
  );
}

function tabCount(): number {
  return document.querySelectorAll('.tab').length;
}

/** 当前挂载的 CodeMirror 编辑器视图；无编辑器时返回 null。 */
function editorView(): EditorView | null {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  return content === null ? null : EditorView.findFromDOM(content);
}

/** 编辑器当前正文；无编辑器时返回空字符串。 */
function editorDoc(): string {
  return editorView()?.state.doc.toString() ?? '';
}

/** 在编辑器末尾插入文本（模拟输入 / 粘贴）。 */
async function insertAtEnd(text: string): Promise<void> {
  await insertAt(-1, text);
}

/** 在指定位置插入文本；位置 -1 表示末尾。 */
async function insertAt(position: number, text: string): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    const end = view.state.doc.length;
    const from = position === -1 ? end : Math.min(position, end);
    view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
    });
  });
}

/** 撤销一次编辑（CodeMirror history）。 */
async function undoEdit(): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    undo(view);
  });
}

/** 将光标移动到指定位置（无选区）。 */
async function placeCursorAt(position: number): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    view.dispatch({ selection: { anchor: position } });
  });
}

/** 文件树当前高亮的文件名。 */
function treeSelectedName(): string | null {
  return (
    document.querySelector('[role="tree"] [role="treeitem"][aria-selected="true"] .ft-name')
      ?.textContent ?? null
  );
}

describe('中央文档区（WP2 多标签读取回归）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('未选择文档时显示欢迎内容且标签栏为空', async () => {
    await openWorkspaceWith([]);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(tabCount()).toBe(0);
  });

  it('选择 TXT 后先显示加载状态与对应标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(() => new Promise<ReadTextDocumentResult>(() => {})),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    expect(screen.getByText('正在读取 a.txt…')).toBeDefined();
    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
  });

  it('读取成功后显示文件名标签与可编辑正文', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'hello\n世界')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');

    expect(tabNames()).toEqual(['a.txt']);
    expect(editorDoc()).toBe('hello\n世界');
    expect(document.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true');
    expect(screen.queryByText('本地多文档工作台')).toBeNull();
  });

  it('空文件显示空正文区且保留标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('empty.txt', '')),
      selectedOpen(snapshot({ entries: [f('empty.txt', 'empty.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('empty.txt');

    expect(tabNames()).toEqual(['empty.txt']);
    expect(editorDoc()).toBe('');
    expect(document.querySelector('.cm-content')).not.toBeNull();
  });

  it('连续打开两个 TXT 生成两个标签，第二个激活，正文互不干扰', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');

    expect(tabNames()).toEqual(['a.txt', 'b.txt']);
    expect(tabIsActive('b.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:b.txt');

    await clickTab('a.txt');
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('打开第二个文件不再要求放弃修改，也无需任何确认对话框', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tabCount()).toBe(2);
    expect(tabIsActive('b.txt')).toBe(true);
  });

  it('再次打开已打开路径只激活原标签，不重复读取、不重置正文', async () => {
    const readText = vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath));
    mockDesktop(
      readText,
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    expect(readText).toHaveBeenCalledTimes(2);

    await openTextFile('a.txt');

    expect(readText).toHaveBeenCalledTimes(2);
    expect(tabCount()).toBe(2);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('同路径仍在 loading 时再次点击只激活原标签，不发起第二次读取', async () => {
    const readText = vi.fn<ReadTextFn>(() => new Promise<ReadTextDocumentResult>(() => {}));
    mockDesktop(readText, selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })));
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('a.txt');

    expect(readText).toHaveBeenCalledTimes(1);
    expect(tabCount()).toBe(1);
  });

  it('同名不同路径可以并存，标题与路径提示可区分', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(
        snapshot({ entries: [f('a.txt', 'a.txt'), d('sub', 'sub', [f('a.txt', 'sub/a.txt')])] }),
      ),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    const directoryButton = within(screen.getByRole('tree')).getByRole('button', { name: 'sub' });
    directoryButton.focus();
    await userEvent.keyboard('{Enter}');
    const nestedButtons = within(screen.getByRole('tree')).getAllByRole('button', {
      name: 'a.txt',
    });
    await userEvent.click(nestedButtons[1]!);

    expect(tabCount()).toBe(2);
    expect(tabNames()).toEqual(['a.txt', 'a.txt']);
    expect(tabByName('a.txt').getAttribute('title')).toBe('a.txt');
    expect(tabByName('sub/a.txt').getAttribute('title')).toBe('sub/a.txt');
    expect(editorDoc()).toBe('内容:sub/a.txt');
  });

  it('点击标签切换活动标签，正文随动且文件树高亮跟随', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    expect(treeSelectedName()).toBe('b.txt');

    await clickTab('a.txt');

    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt');
    expect(treeSelectedName()).toBe('a.txt');
  });

  it('关闭非活动标签不改变当前活动标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    await clickTab('a.txt');

    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));

    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('关闭活动标签优先激活右侧标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(
        snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt'), f('c.txt', 'c.txt')] }),
      ),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    await openTextFile('c.txt');
    expect(tabIsActive('c.txt')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '关闭 c.txt' }));
    expect(tabIsActive('b.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:b.txt');

    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));
    expect(tabIsActive('a.txt')).toBe(true);
  });

  it('没有右侧标签时关闭活动标签激活左侧标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));

    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(treeSelectedName()).toBe('a.txt');
  });

  it('关闭最后一个标签后回到欢迎页，文件树不再高亮', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));

    expect(tabCount()).toBe(0);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(treeSelectedName()).toBeNull();
  });

  it('读取失败显示错误标签与错误面板，应用不崩溃', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => ({
        status: 'error',
        error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
      })),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');

    expect(tabNames()).toEqual(['a.txt']);
    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();
    expect(screen.getByText('文件不存在或已被移除')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
    expect(document.querySelector('.cm-content')).toBeNull();
  });

  it('一个标签读取失败不影响其他已加载标签', async () => {
    mockDesktop(
      vi
        .fn<ReadTextFn>()
        .mockResolvedValueOnce(loadedDoc('a.txt'))
        .mockResolvedValueOnce({
          status: 'error',
          error: { code: 'INVALID_UTF8', message: '文件不是合法的 UTF-8 编码' },
        }),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');

    expect(tabNames()).toEqual(['a.txt', 'b.txt']);
    expect(tabIsActive('b.txt')).toBe(true);
    expect(screen.getByText('无法读取文件 b.txt')).toBeDefined();

    await clickTab('a.txt');
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('错误标签重试成功后原位变为可编辑标签', async () => {
    const readText = vi
      .fn<ReadTextFn>()
      .mockResolvedValueOnce({
        status: 'error',
        error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
      })
      .mockResolvedValueOnce(loadedDoc('a.txt', '重试成功'));
    mockDesktop(readText, selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })));
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(readText).toHaveBeenCalledTimes(2);
    expect(readText).toHaveBeenLastCalledWith('a.txt');
    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('重试成功');
    expect(screen.queryByText('无法读取文件 a.txt')).toBeNull();
  });

  it('IPC Promise 意外拒绝转换为错误标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>().mockRejectedValue(new Error('bridge down')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');

    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();
    expect(screen.getByText('读取文件失败')).toBeDefined();
    expect(screen.queryByText('bridge down')).toBeNull();
  });

  it('A、B 并行打开且 B 先返回：结果仍各自进入正确标签', async () => {
    const resolvers: Array<(result: ReadTextDocumentResult) => void> = [];
    mockDesktop(
      vi.fn<ReadTextFn>(
        () =>
          new Promise<ReadTextDocumentResult>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');

    await act(async () => {
      resolvers[1]!(loadedDoc('b.txt'));
    });
    expect(tabCount()).toBe(2);
    expect(tabIsActive('b.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:b.txt');

    // a 仍在加载：激活其标签只显示加载状态，正文区不出现
    await clickTab('a.txt');
    expect(screen.getByText('正在读取 a.txt…')).toBeDefined();

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });
    expect(tabCount()).toBe(2);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.queryByText('正在读取 a.txt…')).toBeNull();
  });

  it('标签关闭后的迟到读取结果被忽略', async () => {
    const resolvers: Array<(result: ReadTextDocumentResult) => void> = [];
    const readText = vi.fn<ReadTextFn>(
      () =>
        new Promise<ReadTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(readText, selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })));
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    expect(screen.getByText('本地多文档工作台')).toBeDefined();

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });

    expect(readText).toHaveBeenCalledTimes(1);
    expect(tabCount()).toBe(0);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
  });

  it('工作区切换后的旧读取结果被忽略', async () => {
    const resolvers: Array<(result: ReadTextDocumentResult) => void> = [];
    mockDesktop(
      vi.fn<ReadTextFn>(
        () =>
          new Promise<ReadTextDocumentResult>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
        } as OpenWorkspaceResult)
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('c.txt', 'c.txt')] }),
        } as OpenWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await userEvent.click(openBtn());
    expect(screen.getByText('本地多文档工作台')).toBeDefined();

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });

    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(tabCount()).toBe(0);
    expect(screen.getByRole('button', { name: 'c.txt' })).toBeDefined();
  });

  it('成功切换工作区清除全部标签回到欢迎页', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
        } as OpenWorkspaceResult)
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('c.txt', 'c.txt')] }),
        } as OpenWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    expect(editorDoc()).toBe('内容:a.txt');

    await userEvent.click(openBtn());

    expect(tabCount()).toBe(0);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(screen.getByRole('button', { name: 'c.txt' })).toBeDefined();
  });

  it('取消切换工作区保留全部标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] }),
        } as OpenWorkspaceResult)
        .mockResolvedValueOnce({ status: 'cancelled' } as OpenWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await openTextFile('b.txt');

    await userEvent.click(openBtn());

    expect(tabCount()).toBe(2);
    expect(tabIsActive('b.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:b.txt');
  });

  it('刷新工作区保留已打开标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      vi.fn().mockResolvedValue({
        status: 'refreshed',
        workspace: snapshot({ entries: [f('b.txt', 'b.txt')] }),
      } as RefreshWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await userEvent.click(screen.getByText('刷新'));

    expect(tabNames()).toEqual(['a.txt']);
    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.getByRole('button', { name: 'b.txt' })).toBeDefined();
  });

  it('非 TXT 与目录节点不触发正文读取，不创建标签', async () => {
    const readText = vi.fn<ReadTextFn>();
    mockDesktop(
      readText,
      selectedOpen(
        snapshot({
          entries: [
            f('notes.md', 'notes.md'),
            d('src', 'src', [f('index.txt', 'src/index.txt')]),
            { name: 'link.txt', relativePath: 'link.txt', kind: 'symbolic-link' },
          ],
        }),
      ),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(within(screen.getByRole('tree')).getByText('notes.md'));
    await userEvent.click(within(screen.getByRole('tree')).getByText('link.txt'));
    const src = within(screen.getByRole('tree')).getByRole('button', { name: 'src' });
    src.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(screen.getByRole('tree')).getByText('src'));

    expect(readText).not.toHaveBeenCalled();
    expect(tabCount()).toBe(0);
  });

  it('关闭询问：无未保存修改时直接放行，不弹确认', async () => {
    const windowApi = makeWindowApi();
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      windowApi,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await act(async () => {
      windowApi.triggerCloseRequested();
    });

    expect(windowApi.requestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('窗口 dirty 上报跟随编辑变化', async () => {
    const windowApi = makeWindowApi();
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      windowApi,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(false);

    await insertAtEnd('+编辑');
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(true);
  });
});

describe('每标签 CodeMirror 编辑会话（WP3，第 8.4 节）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('A、B 编辑内容相互独立，dirty 标记各自独立', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+X');
    await openTextFile('b.txt');
    await insertAtEnd('+Y');

    expect(screen.getAllByLabelText('未保存')).toHaveLength(2);

    await clickTab('a.txt');
    expect(editorDoc()).toBe('内容:a.txt+X');
    await clickTab('b.txt');
    expect(editorDoc()).toBe('内容:b.txt+Y');
  });

  it('A 中建立撤销历史，切换 B 编辑后再回 A，A 的撤销仍只作用于 A', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    // 两次编辑位于不同位置，CodeMirror 历史不会合并为同一撤销组
    await insertAtEnd('+a1');
    await insertAt(2, 'X');
    await undoEdit();
    expect(editorDoc()).toBe('内容:a.txt+a1');

    await openTextFile('b.txt');
    await insertAtEnd('+b1');
    await undoEdit();
    // B 只撤销自己的编辑：若继承了 A 的历史会先弹掉 A 的步骤
    expect(editorDoc()).toBe('内容:b.txt');

    await clickTab('a.txt');
    expect(editorDoc()).toBe('内容:a.txt+a1');
    await undoEdit();
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('标签切换恢复光标和选区', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await placeCursorAt(3);
    await openTextFile('b.txt');
    await placeCursorAt(1);

    await clickTab('a.txt');
    expect(editorView()?.state.selection.main.anchor).toBe(3);

    await clickTab('b.txt');
    expect(editorView()?.state.selection.main.anchor).toBe(1);
  });

  it('普通标签切换不触发内容变化、不产生 dirty、不清空历史', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');

    await clickTab('a.txt');
    await clickTab('b.txt');
    await clickTab('a.txt');

    expect(screen.queryByLabelText('未保存')).toBeNull();
    expect(editorDoc()).toBe('内容:a.txt');

    // 切换本身没有向历史添加任何步骤：一次编辑后撤销即回到原文
    await insertAtEnd('+z');
    await undoEdit();
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('关闭标签清理对应缓存，再次打开从磁盘创建新状态', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+X');
    expect(editorDoc()).toBe('内容:a.txt+X');

    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    await openTextFile('a.txt');
    expect(editorDoc()).toBe('内容:a.txt');

    // 新会话无旧撤销历史：撤销无效果
    await undoEdit();
    expect(editorDoc()).toBe('内容:a.txt');
  });

  it('工作区切换清理全部缓存，重开同路径不残留旧撤销历史', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] }),
        } as OpenWorkspaceResult)
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
        } as OpenWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+X');
    await openTextFile('b.txt');
    await insertAtEnd('+Y');

    // 两个未保存标签：切换工作区需先确认放弃
    await userEvent.click(openBtn());
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(screen.getByText('本地多文档工作台')).toBeDefined();

    await openTextFile('a.txt');
    expect(editorDoc()).toBe('内容:a.txt');

    await insertAtEnd('+Z');
    await undoEdit();
    expect(editorDoc()).toBe('内容:a.txt');
  });
});

describe('编辑器宿主会话边界（WP3，第 8.4 节）', () => {
  afterEach(() => {
    cleanup();
  });

  /** 直接渲染宿主：可在不依赖 App 的情况下模拟切换与外部正文替换。 */
  function EditorHostHarness(): React.JSX.Element {
    const sessions = useEditorSessions(['a.txt', 'b.txt']);
    const [tabId, setTabId] = useState('a.txt');
    const [content, setContent] = useState('v1');
    return (
      <>
        <EditorSessionHost
          key={tabId}
          tabId={tabId}
          content={content}
          sessions={sessions}
          onContentChange={setContent}
        />
        <button type="button" onClick={() => setTabId('b.txt')}>
          切到B
        </button>
        <button type="button" onClick={() => setTabId('a.txt')}>
          切到A
        </button>
        <button type="button" onClick={() => setContent('v2')}>
          外部替换
        </button>
      </>
    );
  }

  it('普通切换保留撤销历史', async () => {
    render(<EditorHostHarness />);
    expect(editorDoc()).toBe('v1');

    await insertAtEnd('+X');
    await userEvent.click(screen.getByRole('button', { name: '切到B' }));
    await userEvent.click(screen.getByRole('button', { name: '切到A' }));

    expect(editorDoc()).toBe('v1+X');
    await undoEdit();
    expect(editorDoc()).toBe('v1');
  });

  it('外部正文替换只重建目标标签的编辑器状态并清空旧撤销历史', async () => {
    render(<EditorHostHarness />);
    await insertAtEnd('+X');
    expect(editorDoc()).toBe('v1+X');

    // 切走后正文被外部替换（磁盘重读结果）
    await userEvent.click(screen.getByRole('button', { name: '切到B' }));
    await userEvent.click(screen.getByRole('button', { name: '外部替换' }));
    await userEvent.click(screen.getByRole('button', { name: '切到A' }));

    // 缓存会话与正文不一致：以磁盘正文创建新状态
    expect(editorDoc()).toBe('v2');
    await undoEdit();
    expect(editorDoc()).toBe('v2');

    // 新状态可继续编辑并建立自己的撤销历史
    await insertAtEnd('+Y');
    expect(editorDoc()).toBe('v2+Y');
    await undoEdit();
    expect(editorDoc()).toBe('v2');
  });
});
