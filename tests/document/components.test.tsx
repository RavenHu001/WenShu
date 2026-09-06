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
import { useTextDocuments } from '../../src/renderer/lib/use-text-documents';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type {
  LineEnding,
  ReadTextDocumentResult,
  SaveTextDocumentRequest,
  SaveTextDocumentResult,
} from '../../src/shared/document';

type ReadTextFn = (relativePath: string) => Promise<ReadTextDocumentResult>;
type SaveTextFn = (request: SaveTextDocumentRequest) => Promise<SaveTextDocumentResult>;

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
  saveText: SaveTextFn = async () => ({
    status: 'error',
    error: { code: 'WRITE_FAILED', message: '写入文件失败' },
  }),
) {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9', appVersion: '0.1.0-alpha.1' },
    workspace: {
      open: open ?? vi.fn(),
      refresh: refresh ?? vi.fn(),
    },
    document: { readText, saveText },
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

function loadedDoc(
  relativePath: string,
  content = `内容:${relativePath}`,
  lineEnding: LineEnding = 'none',
): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision: 'a'.repeat(64),
      hasUtf8Bom: false,
      lineEnding,
    },
  };
}

function savedDoc(
  relativePath: string,
  content: string,
  revision: string,
  lineEnding: LineEnding = 'none',
): SaveTextDocumentResult {
  return {
    status: 'saved',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision,
      hasUtf8Bom: false,
      lineEnding,
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

/** 按编辑器配置的换行符序列化正文（用于验证 LF/CRLF 保存语义）。 */
function serializedEditorDoc(): string {
  return editorView()?.state.sliceDoc() ?? '';
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

/** 向编辑器派发 Ctrl+S 键盘事件，走 CodeMirror keymap 的保存快捷键路径。 */
async function pressCtrlS(): Promise<void> {
  await act(async () => {
    const content = document.querySelector('.cm-content') as HTMLElement | null;
    if (content === null) {
      throw new Error('no editor');
    }
    content.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** 点击保存工具条按钮。 */
async function clickSaveButton(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
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
    expect(screen.getByRole('tab', { name: 'a.txt' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'sub/a.txt' })).toBeDefined();
    expect(screen.getByRole('button', { name: '关闭 sub/a.txt' })).toBeDefined();
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

  it('CRLF 标签切换保留会话，保存请求继续使用 CRLF', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64), 'crlf'),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) =>
        relativePath === 'a.txt'
          ? loadedDoc('a.txt', '第一行\r\n第二行', 'crlf')
          : loadedDoc(relativePath),
      ),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+编辑');
    const anchor = editorView()?.state.selection.main.anchor;
    expect(serializedEditorDoc()).toBe('第一行\r\n第二行+编辑');

    await openTextFile('b.txt');
    await clickTab('a.txt');
    expect(editorView()?.state.selection.main.anchor).toBe(anchor);
    expect(serializedEditorDoc()).toBe('第一行\r\n第二行+编辑');

    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]?.content).toBe('第一行\r\n第二行+编辑');
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
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
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
          onSaveRequest={() => {}}
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

describe('每标签保存、冲突与延迟确认（WP4，第 8.5 节）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('保存按钮与 Ctrl+S 只保存活动标签，clean 标签不调用保存 IPC', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+x');
    await openTextFile('b.txt');
    // B 为 clean：保存按钮禁用，Ctrl+S 也不发起写入
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    await pressCtrlS();
    expect(saveText).not.toHaveBeenCalled();

    // 活动标签 A 通过 Ctrl+S 保存
    await clickTab('a.txt');
    await pressCtrlS();
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]).toEqual({
      relativePath: 'a.txt',
      content: '内容:a.txt+x',
      expectedRevision: 'a'.repeat(64),
    });

    // 再次通过保存按钮发起同一流程
    await insertAtEnd('+y');
    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(2);
    expect(saveText.mock.calls[1]?.[0]?.relativePath).toBe('a.txt');
  });

  it('保存期间显示正在保存，同一标签重复保存被抑制', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+x');

    await clickSaveButton();
    expect(screen.getByText('正在保存…')).toBeDefined();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);

    await clickSaveButton();
    await pressCtrlS();
    expect(saveText).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+x', 'b'.repeat(64)));
    });
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('A、B 可各有一个保存请求在途', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(1);

    await openTextFile('b.txt');
    await insertAtEnd('+b');
    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+a', 'c'.repeat(64)));
      resolvers[1]!(savedDoc('b.txt', '内容:b.txt+b', 'd'.repeat(64)));
    });

    await clickTab('a.txt');
    expect(screen.getByText('已保存')).toBeDefined();
    await clickTab('b.txt');
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('A 保存结果不改变 B 的正文、状态与 revision', async () => {
    const saveText = vi
      .fn<SaveTextFn>()
      .mockImplementationOnce(async (request) =>
        savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
      )
      .mockImplementation(async (request) =>
        savedDoc(request.relativePath, request.content, 'e'.repeat(64)),
      );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await clickSaveButton();

    await openTextFile('b.txt');
    await insertAtEnd('+b');
    // B 仍为未保存，正文与 revision 不受 A 保存影响
    expect(screen.getByText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('内容:b.txt+b');

    await clickSaveButton();
    expect(saveText.mock.calls[1]?.[0]).toEqual({
      relativePath: 'b.txt',
      content: '内容:b.txt+b',
      expectedRevision: 'a'.repeat(64),
    });
  });

  it('A 保存期间继续编辑：旧成功结果不清除 A 的新 dirty，基线版本已更新', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+first');
    await clickSaveButton();
    expect(saveText.mock.calls[0]?.[0]?.content).toBe('original+first');

    await insertAtEnd('+second');
    expect(screen.getByText('正在保存…')).toBeDefined();

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', 'original+first', 'b'.repeat(64)));
    });

    expect(screen.getByText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+first+second');

    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(2);
    expect(saveText.mock.calls[1]?.[0]?.expectedRevision).toBe('b'.repeat(64));
    expect(saveText.mock.calls[1]?.[0]?.content).toBe('original+first+second');
  });

  it('用户切到 B 后 A 保存完成：结果提交到 A 且不抢占活动标签', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await clickSaveButton();
    await openTextFile('b.txt');
    expect(tabIsActive('b.txt')).toBe(true);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+a', 'c'.repeat(64)));
    });

    // 活动标签仍是 B；A 的 dirty 已被清除
    expect(tabIsActive('b.txt')).toBe(true);
    expect(screen.getByText('已保存')).toBeDefined();
    await clickTab('a.txt');
    expect(screen.queryByLabelText('未保存')).toBeNull();
    expect(editorDoc()).toBe('内容:a.txt+a');
  });

  it('保存失败只影响目标标签，其他标签仍可正常保存', async () => {
    const saveText = vi
      .fn<SaveTextFn>()
      .mockImplementationOnce(async () => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      }))
      .mockImplementation(async (request) =>
        savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
      );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await clickSaveButton();

    expect(screen.getByText('写入错误')).toBeDefined();
    expect(screen.getByText('保存失败：写入文件失败')).toBeDefined();
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('内容:a.txt+a');

    // B 不受影响，可正常保存
    await openTextFile('b.txt');
    await insertAtEnd('+b');
    await clickSaveButton();
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('冲突只影响目标标签，B 仍可保存', async () => {
    const saveText = vi
      .fn<SaveTextFn>()
      .mockImplementationOnce(async () => ({
        status: 'error',
        error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
      }))
      .mockImplementation(async (request) =>
        savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
      );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await clickSaveButton();

    expect(screen.getByText('磁盘冲突')).toBeDefined();
    expect(screen.getByText('保存失败：文件已被外部修改，保存被拒绝')).toBeDefined();
    expect(screen.getByRole('button', { name: '重新读取' })).toBeDefined();
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('内容:a.txt+a');

    await openTextFile('b.txt');
    await insertAtEnd('+b');
    await clickSaveButton();
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('混合换行确认绑定原标签：切换标签后确认仍只保存原标签', async () => {
    const saveText = vi
      .fn<SaveTextFn>()
      .mockResolvedValueOnce({
        status: 'error',
        error: {
          code: 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
          message: '文件包含混合换行，需要确认规范化规则',
        },
      })
      .mockImplementation(async (request) => savedDoc('a.txt', request.content, 'b'.repeat(64)));
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]).not.toHaveProperty('confirmMixedLineEndingNormalization');
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText(/按主要换行风格/)).toBeDefined();

    // 对话框打开时切换标签，确认目标不变
    await openTextFile('b.txt');
    await userEvent.click(screen.getByRole('button', { name: '确认保存' }));

    expect(saveText).toHaveBeenCalledTimes(2);
    expect(saveText.mock.calls[1]?.[0]?.relativePath).toBe('a.txt');
    expect(saveText.mock.calls[1]?.[0]?.confirmMixedLineEndingNormalization).toBe(true);

    await clickTab('a.txt');
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('磁盘快照为混合换行时先确认，再按 dominant 风格提交规范化正文', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64), 'crlf'),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', '一\r\n二\n三', 'mixed')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+编辑');
    expect(serializedEditorDoc()).toBe('一\r\n二\r\n三+编辑');

    await clickSaveButton();
    expect(saveText).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '确认保存' }));
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]).toMatchObject({
      relativePath: 'a.txt',
      content: '一\r\n二\r\n三+编辑',
      confirmMixedLineEndingNormalization: true,
    });
  });

  it('混合换行取消：不重试，原标签保持保存失败', async () => {
    const saveText = vi.fn<SaveTextFn>(async () => ({
      status: 'error',
      error: {
        code: 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
        message: '文件包含混合换行，需要确认规范化规则',
      },
    }));
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+edit');
    await clickSaveButton();
    expect(await screen.findByRole('dialog')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(saveText).toHaveBeenCalledTimes(1);
    expect(screen.getByText('写入错误')).toBeDefined();
    expect(editorDoc()).toBe('original+edit');
    expect(screen.getByLabelText('未保存')).toBeDefined();
  });

  it('冲突重新读取绑定原标签：确认后只替换目标标签', async () => {
    const readText = vi
      .fn<ReadTextFn>()
      .mockResolvedValueOnce(loadedDoc('a.txt', 'original'))
      .mockResolvedValueOnce(loadedDoc('b.txt'))
      .mockResolvedValueOnce(loadedDoc('a.txt', '磁盘新版本'));
    const saveText = vi.fn<SaveTextFn>(async () => ({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    }));
    mockDesktop(
      readText,
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+local');
    await clickSaveButton();
    expect(screen.getByText('磁盘冲突')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/放弃对 a.txt 的本地修改/)).toBeDefined();

    // 对话框打开时切换到 B，确认仍只重读 A
    await openTextFile('b.txt');
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(readText).toHaveBeenCalledTimes(3);
    expect(readText).toHaveBeenLastCalledWith('a.txt');

    await clickTab('a.txt');
    expect(editorDoc()).toBe('磁盘新版本');
    expect(screen.queryByLabelText('未保存')).toBeNull();
    expect(screen.queryByText('磁盘冲突')).toBeNull();
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('冲突重新读取在请求完成前禁用编辑，避免迟到结果覆盖新输入', async () => {
    let resolveReload!: (result: ReadTextDocumentResult) => void;
    const readText = vi
      .fn<ReadTextFn>()
      .mockResolvedValueOnce(loadedDoc('a.txt', 'original'))
      .mockImplementationOnce(
        () =>
          new Promise<ReadTextDocumentResult>((resolve) => {
            resolveReload = resolve;
          }),
      );
    const saveText = vi.fn<SaveTextFn>(async () => ({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    }));
    mockDesktop(
      readText,
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+local');
    await clickSaveButton();
    await userEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(screen.getByText('正在读取 a.txt…')).toBeDefined();
    expect(editorView()).toBeNull();

    await act(async () => {
      resolveReload(loadedDoc('a.txt', '磁盘新版本'));
    });
    expect(editorDoc()).toBe('磁盘新版本');
    expect(screen.queryByLabelText('未保存')).toBeNull();
  });

  it('saving 标签存在时切换工作区被安全阻止，等待保存完成后保留全部标签', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const open = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
      } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ entries: [f('c.txt', 'c.txt')] }),
      } as OpenWorkspaceResult);
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      open,
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await clickSaveButton();
    expect(saveText).toHaveBeenCalledTimes(1);

    // saving 标签存在：切换工作区被阻止，不打开目录选择器
    await userEvent.click(openBtn());
    expect(screen.getByText('等待保存完成')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(open).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+edit', 'b'.repeat(64)));
    });
    expect(tabCount()).toBe(1);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(screen.getByText('已保存')).toBeDefined();
  });
});

describe('关闭、工作区与窗口保护（WP5，第 8.6 节）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('dirty 标签关闭：取消分支保留标签、正文与未保存标记', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/放弃对 a.txt 的未保存修改并关闭标签/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(tabCount()).toBe(1);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt+edit');
    expect(screen.getByLabelText('未保存')).toBeDefined();
  });

  it('dirty 标签关闭：放弃分支关闭标签并激活相邻标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    await insertAtEnd('+edit');
    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.queryByLabelText('未保存')).toBeNull();
  });

  it('非活动 dirty 标签的关闭按钮：确认目标不因活动标签变化而错位', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    await insertAtEnd('+b');
    await clickTab('a.txt');
    // 在 B 未激活的状态下点击 B 的关闭按钮
    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/放弃对 b.txt 的未保存修改并关闭标签/)).toBeDefined();

    // 对话框打开期间切换到 B：确认目标仍为 B
    await clickTab('b.txt');
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
  });

  it('Ctrl+W 与关闭按钮走同一关闭入口：clean 直接关闭，dirty 弹确认', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    async function pressCtrlW(): Promise<void> {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }),
        );
      });
    }

    // clean 标签：Ctrl+W 直接关闭
    await openTextFile('a.txt');
    await pressCtrlW();
    expect(tabCount()).toBe(0);

    // dirty 标签：Ctrl+W 弹确认，取消保留
    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await pressCtrlW();
    expect(screen.getByRole('dialog')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(tabCount()).toBe(1);

    // 再次 Ctrl+W，放弃后关闭
    await pressCtrlW();
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(tabCount()).toBe(0);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
  });

  it('多个 dirty 标签切换工作区：聚合确认后取消目录选择仍保留全部标签', async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] }),
      } as OpenWorkspaceResult)
      .mockResolvedValueOnce({ status: 'cancelled' } as OpenWorkspaceResult);
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      open,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await openTextFile('b.txt');
    await insertAtEnd('+b');

    await userEvent.click(openBtn());
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/放弃对 2 个未保存标签的修改，并切换工作区/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(open).toHaveBeenCalledTimes(2);

    // 目录选择取消：全部标签与 dirty 保留
    expect(tabCount()).toBe(2);
    expect(screen.getAllByLabelText('未保存')).toHaveLength(2);
    await clickTab('a.txt');
    expect(editorDoc()).toBe('内容:a.txt+a');
  });

  it('取消聚合确认不打开目录选择器', async () => {
    const open = vi.fn().mockResolvedValueOnce({
      status: 'selected',
      workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
    } as OpenWorkspaceResult);
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      open,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(tabCount()).toBe(1);
    expect(editorDoc()).toBe('内容:a.txt+edit');
  });

  it('只有工作区成功切换才清空标签', async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
      } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ entries: [f('c.txt', 'c.txt')] }),
      } as OpenWorkspaceResult);
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      open,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    // 新工作区选择成功：标签清空，回到欢迎页
    expect(open).toHaveBeenCalledTimes(2);
    expect(tabCount()).toBe(0);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(screen.getByRole('button', { name: 'c.txt' })).toBeDefined();
  });

  it('window.setDirtyState 等于全部标签 dirty 的聚合值', async () => {
    const windowApi = makeWindowApi();
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      windowApi,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await openTextFile('b.txt');
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(false);

    await insertAtEnd('+a');
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(true);
    await openTextFile('a.txt');
    await insertAtEnd('+b');
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(true);

    await clickTab('b.txt');
    await clickSaveButton();
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(true);
    await clickTab('a.txt');
    await clickSaveButton();
    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(false);
  });

  it('窗口关闭提示包含未保存标签数量：放弃后请求关闭，取消后复位', async () => {
    const windowApi = makeWindowApi();
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      windowApi,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+a');
    await openTextFile('b.txt');
    await insertAtEnd('+b');

    await act(async () => {
      windowApi.triggerCloseRequested();
    });
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/放弃对 2 个未保存标签的修改，并关闭窗口/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(windowApi.cancelClose).toHaveBeenCalledTimes(1);
    expect(windowApi.requestClose).not.toHaveBeenCalled();

    await act(async () => {
      windowApi.triggerCloseRequested();
    });
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(windowApi.requestClose).toHaveBeenCalledTimes(1);
  });

  it('saving 标签关闭被安全阻止：提示等待保存完成，标签保留', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await clickSaveButton();

    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    expect(screen.getByText('等待保存完成')).toBeDefined();
    expect(screen.getByText(/a.txt 正在保存/)).toBeDefined();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(tabCount()).toBe(1);
    expect(screen.getByText('正在保存…')).toBeDefined();

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+edit', 'b'.repeat(64)));
    });
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('saving 标签存在时窗口关闭被安全阻止：复位主进程且不请求关闭', async () => {
    const windowApi = makeWindowApi();
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      windowApi,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');
    await clickSaveButton();

    await act(async () => {
      windowApi.triggerCloseRequested();
    });
    expect(screen.getByText('等待保存完成')).toBeDefined();
    expect(windowApi.requestClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(windowApi.cancelClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+edit', 'b'.repeat(64)));
    });
  });

  it('关闭确认打开时收到窗口关闭询问：不覆盖原确认目标并复位主进程', async () => {
    const windowApi = makeWindowApi();
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
      undefined,
      windowApi,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    await insertAtEnd('+edit');

    await userEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    expect(screen.getByText(/放弃对 a.txt 的未保存修改并关闭标签/)).toBeDefined();

    await act(async () => {
      windowApi.triggerCloseRequested();
    });
    expect(windowApi.cancelClose).toHaveBeenCalledTimes(1);
    // 原确认对话框保持不变
    expect(screen.getByText(/放弃对 a.txt 的未保存修改并关闭标签/)).toBeDefined();
    expect(screen.queryByText(/并关闭窗口/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(tabCount()).toBe(1);
    expect(editorDoc()).toBe('内容:a.txt+edit');
  });
});

describe('controller 竞态防御（WP5，第 8.6 节）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  /** 直接暴露 controller 命令，绕过 UI 确认流程测试迟到结果防御。 */
  function ControllerHarness(): React.JSX.Element {
    const { model, openTextFile, editTab, saveTab, invalidateWorkspace } = useTextDocuments();
    return (
      <>
        <span data-testid="tab-count">{model.state.tabs.length}</span>
        <span data-testid="tab-status">{model.state.tabs[0]?.status ?? 'none'}</span>
        <button type="button" onClick={() => openTextFile('a.txt')}>
          打开A
        </button>
        <button type="button" onClick={() => editTab('a.txt', '内容:a.txt+edit')}>
          编辑A
        </button>
        <button type="button" onClick={() => saveTab('a.txt')}>
          保存A
        </button>
        <button type="button" onClick={() => invalidateWorkspace()}>
          失效工作区
        </button>
      </>
    );
  }

  it('工作区失效后的迟到保存结果不更新新会话', async () => {
    const resolvers: Array<(result: SaveTextDocumentResult) => void> = [];
    const saveText = vi.fn<SaveTextFn>(
      () =>
        new Promise<SaveTextDocumentResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    (window as unknown as Record<string, unknown>).desktop = {
      runtime: { platform: 'win32', electronVersion: '99.9.9', appVersion: '0.1.0-alpha.1' },
      workspace: { open: vi.fn(), refresh: vi.fn() },
      document: {
        readText: vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
        saveText,
      },
      window: {
        setDirtyState: vi.fn(async () => undefined),
        requestClose: vi.fn(async () => undefined),
        cancelClose: vi.fn(async () => undefined),
        onCloseRequested: vi.fn(() => () => {}),
      },
    };
    render(<ControllerHarness />);

    await userEvent.click(screen.getByRole('button', { name: '打开A' }));
    await userEvent.click(screen.getByRole('button', { name: '编辑A' }));
    await userEvent.click(screen.getByRole('button', { name: '保存A' }));
    expect(saveText).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '失效工作区' }));
    expect(screen.getByTestId('tab-count').textContent).toBe('0');

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txt+edit', 'b'.repeat(64)));
    });

    expect(screen.getByTestId('tab-count').textContent).toBe('0');
  });

  it('controller 纵深门禁拒绝未确认的 mixed 换行保存', async () => {
    const saveText = vi.fn<SaveTextFn>();
    (window as unknown as Record<string, unknown>).desktop = {
      runtime: { platform: 'win32', electronVersion: '99.9.9', appVersion: '0.1.0-alpha.1' },
      workspace: { open: vi.fn(), refresh: vi.fn() },
      document: {
        readText: vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', '一\r\n二\n三', 'mixed')),
        saveText,
      },
      window: {
        setDirtyState: vi.fn(async () => undefined),
        requestClose: vi.fn(async () => undefined),
        cancelClose: vi.fn(async () => undefined),
        onCloseRequested: vi.fn(() => () => {}),
      },
    };
    render(<ControllerHarness />);

    await userEvent.click(screen.getByRole('button', { name: '打开A' }));
    await userEvent.click(screen.getByRole('button', { name: '编辑A' }));
    await userEvent.click(screen.getByRole('button', { name: '保存A' }));

    expect(saveText).not.toHaveBeenCalled();
    expect(screen.getByTestId('tab-status').textContent).toBe('save-error');
  });
});
