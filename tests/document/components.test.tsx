// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
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

type ReadTextFn = (relativePath: string) => Promise<ReadTextDocumentResult>;
type SaveTextFn = (request: SaveTextDocumentRequest) => Promise<SaveTextDocumentResult>;

// CodeMirror 6 在 jsdom 中没有 ResizeObserver，提供最小桩
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
});

function mockDesktop(
  readText: ReadTextFn,
  open?: () => Promise<OpenWorkspaceResult>,
  refresh?: () => Promise<RefreshWorkspaceResult>,
  saveText: SaveTextFn = vi.fn<SaveTextFn>(async () => ({
    status: 'error',
    error: { code: 'WRITE_FAILED', message: '写入文件失败' },
  })),
) {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: open ?? vi.fn(),
      refresh: refresh ?? vi.fn(),
    },
    document: { readText, saveText },
  };
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

function savedDoc(relativePath: string, content: string, revision: string): SaveTextDocumentResult {
  return {
    status: 'saved',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision,
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

async function openTextFile(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }));
}

function editorView(): EditorView | null {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  return content === null ? null : EditorView.findFromDOM(content);
}

function editorDoc(): string {
  return editorView()?.state.doc.toString() ?? '';
}

/** 在编辑器末尾插入文本（模拟输入 / 粘贴）。 */
async function insertAtEnd(text: string): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, insert: text },
      selection: { anchor: end + text.length },
    });
  });
}

/** 删除指定区间（模拟删除操作）。 */
async function deleteRange(from: number, to: number): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    view.dispatch({ changes: { from, to }, selection: { anchor: from } });
  });
}

async function undoEdit(): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    undo(view);
  });
}

async function redoEdit(): Promise<void> {
  await act(async () => {
    const view = editorView();
    if (view === null) {
      throw new Error('no editor');
    }
    redo(view);
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

describe('中央文档区（WP4 编辑与保存）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('未选择文档时显示欢迎内容', async () => {
    await openWorkspaceWith([]);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(document.querySelector('.cm-content')).toBeNull();
  });

  it('选择 TXT 后先显示加载状态', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(() => new Promise<ReadTextDocumentResult>(() => {})),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    expect(screen.getByText('正在读取 a.txt…')).toBeDefined();
  });

  it('读取成功后显示文件名、单个活动标签和可编辑 CodeMirror 正文', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'hello\n世界')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');

    expect(document.querySelector('.editor-tabs .tab')?.textContent).toContain('a.txt');
    expect(document.querySelectorAll('.editor-tabs .tab').length).toBe(1);
    expect(editorDoc()).toBe('hello\n世界');
    const content = document.querySelector('.cm-content') as HTMLElement;
    expect(content.getAttribute('contenteditable')).toBe('true');
    expect(screen.queryByText('本地多文档工作台')).toBeNull();
  });

  it('空文件显示空正文区且保留标签，可正常获得焦点并输入', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('empty.txt', '')),
      selectedOpen(snapshot({ entries: [f('empty.txt', 'empty.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('empty.txt');

    expect(document.querySelector('.editor-tabs .tab')?.textContent).toContain('empty.txt');
    expect(editorDoc()).toBe('');

    await insertAtEnd('新内容');
    expect(editorDoc()).toBe('新内容');
    expect(screen.getByLabelText('未保存')).toBeDefined();
  });

  it('选择第二个文件替换第一个文件（仍为单个标签，撤销历史不串档）', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');
    await insertAtEnd('X');
    expect(editorDoc()).toBe('内容:a.txtX');

    await openTextFile('b.txt');
    expect(editorDoc()).toBe('内容:b.txt');
    expect(document.querySelectorAll('.editor-tabs .tab').length).toBe(1);

    // 撤销只作用于新文档，不把上一文档的历史带进来
    await undoEdit();
    expect(editorDoc()).toBe('内容:b.txt');
  });

  it('读取失败显示错误面板且应用不崩溃', async () => {
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

    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();
    expect(screen.getByText('文件不存在或已被移除')).toBeDefined();
    expect(document.querySelector('.cm-content')).toBeNull();
  });

  it('已有文档时新读取失败保留原正文并显示非阻塞提示', async () => {
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
    const aNode = screen.getByRole('button', { name: 'a.txt' }).closest('[role="treeitem"]');
    const bNode = screen.getByRole('button', { name: 'b.txt' }).closest('[role="treeitem"]');
    await openTextFile('b.txt');

    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.getByText('读取 b.txt 失败：文件不是合法的 UTF-8 编码')).toBeDefined();
    expect(aNode?.getAttribute('aria-selected')).toBe('true');
    expect(bNode?.getAttribute('aria-selected')).toBeNull();
  });

  it('IPC Promise 意外拒绝被转换为界面错误', async () => {
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

  it('A/B 请求乱序返回时只显示 B', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    await userEvent.click(screen.getByRole('button', { name: 'b.txt' }));

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });
    expect(editorDoc()).toBe('');
    expect(screen.getByText('正在读取 b.txt…')).toBeDefined();

    await act(async () => {
      resolvers[1]!(loadedDoc('b.txt'));
    });
    expect(editorDoc()).toBe('内容:b.txt');
  });

  it('成功切换工作区清除旧文档', async () => {
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

    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(document.querySelector('.cm-content')).toBeNull();
    expect(screen.getByRole('button', { name: 'c.txt' })).toBeDefined();
  });

  it('切换工作区时旧工作区未完成的读取结果不会重新出现', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

    await userEvent.click(openBtn());
    expect(screen.getByText('本地多文档工作台')).toBeDefined();

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });

    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(document.querySelector('.cm-content')).toBeNull();
  });

  it('取消切换工作区保留旧文档', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 'selected',
          workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
        } as OpenWorkspaceResult)
        .mockResolvedValueOnce({ status: 'cancelled' } as OpenWorkspaceResult),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await userEvent.click(openBtn());

    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.queryByText('本地多文档工作台')).toBeNull();
  });

  it('刷新工作区保留当前文档快照', async () => {
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

    expect(editorDoc()).toBe('内容:a.txt');
    expect(screen.getByRole('button', { name: 'b.txt' })).toBeDefined();
  });

  it('非 TXT 与目录节点不触发正文读取', async () => {
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

    await userEvent.click(screen.getByText('notes.md'));
    await userEvent.click(screen.getByText('link.txt'));
    const src = screen.getByRole('button', { name: 'src' });
    src.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByText('src'));

    expect(readText).not.toHaveBeenCalled();
  });

  it('输入、删除、粘贴、撤销和重做更新正文', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'abcdef')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('GH'); // 输入
    expect(editorDoc()).toBe('abcdefGH');

    await insertAtEnd('IJ'); // 粘贴
    expect(editorDoc()).toBe('abcdefGHIJ');

    await deleteRange(2, 4); // 删除
    expect(editorDoc()).toBe('abefGHIJ');

    await undoEdit(); // 撤销删除
    expect(editorDoc()).toBe('abcdefGHIJ');

    await redoEdit(); // 重做删除
    expect(editorDoc()).toBe('abefGHIJ');
  });

  it('首次修改显示未保存标记与状态文本', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    expect(screen.getByText('已保存')).toBeDefined();
    expect(screen.queryByLabelText('未保存')).toBeNull();

    await insertAtEnd('x');
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(screen.getByText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('内容:a.txtx');
  });

  it('clean 状态触发保存不调用 IPC（保存按钮禁用，Ctrl+S 无操作）', async () => {
    const saveText = vi.fn<SaveTextFn>();
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await pressCtrlS();
    expect(saveText).not.toHaveBeenCalled();
  });

  it('保存按钮与 Ctrl+S 发起同一保存流程', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+btn');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]).toEqual({
      relativePath: 'a.txt',
      content: 'original+btn',
      expectedRevision: 'a'.repeat(64),
    });

    await insertAtEnd('+shortcut');
    await pressCtrlS();
    expect(saveText).toHaveBeenCalledTimes(2);
    expect(saveText.mock.calls[1]?.[0]).toEqual({
      relativePath: 'a.txt',
      content: 'original+btn+shortcut',
      expectedRevision: 'b'.repeat(64),
    });
  });

  it('保存期间显示正在保存状态，重复保存不并发', async () => {
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
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('x');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('正在保存…')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await pressCtrlS();
    expect(saveText).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', '内容:a.txtx', 'c'.repeat(64)));
    });
    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('保存成功且期间无新编辑时清除 dirty', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+saved');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('已保存')).toBeDefined();
    expect(screen.queryByLabelText('未保存')).toBeNull();
    expect(editorDoc()).toBe('original+saved');
    expect(screen.queryByText('保存失败')).toBeNull();
  });

  it('保存期间继续编辑：旧保存成功后仍保持 dirty，且基线版本已更新', async () => {
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
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+first');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[0]?.content).toBe('original+first');

    // 保存期间继续编辑
    await insertAtEnd('+second');
    expect(screen.getByText('正在保存…')).toBeDefined();

    await act(async () => {
      resolvers[0]!(savedDoc('a.txt', 'original+first', 'b'.repeat(64)));
    });

    // 旧保存结果不会清除后来产生的修改
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(screen.getByText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+first+second');

    // 再次保存应基于新的已保存版本
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(saveText).toHaveBeenCalledTimes(2);
    expect(saveText.mock.calls[1]?.[0]?.expectedRevision).toBe('b'.repeat(64));
    expect(saveText.mock.calls[1]?.[0]?.content).toBe('original+first+second');
  });

  it('保存失败保留正文与未保存标记', async () => {
    const saveText = vi.fn<SaveTextFn>(async () => ({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: '写入文件失败' },
    }));
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+edit');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('保存失败')).toBeDefined();
    expect(screen.getByText('保存失败：写入文件失败')).toBeDefined();
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+edit');
  });

  it('IPC Promise 拒绝保留正文与未保存标记', async () => {
    const saveText = vi.fn<SaveTextFn>().mockRejectedValue(new Error('bridge down'));
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+edit');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('保存失败')).toBeDefined();
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+edit');
    expect(screen.queryByText('bridge down')).toBeNull();
  });

  it('冲突保留本地正文且不自动重读', async () => {
    const readText = vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original'));
    const saveText = vi.fn<SaveTextFn>(async () => ({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    }));
    mockDesktop(
      readText,
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');
    expect(readText).toHaveBeenCalledTimes(1);

    await insertAtEnd('+local');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('外部冲突')).toBeDefined();
    expect(screen.getByText('保存失败：文件已被外部修改，保存被拒绝')).toBeDefined();
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+local');
    // 冲突不自动触发放弃或重新读取
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('保存成功后继续编辑会重新出现未保存标记', async () => {
    const saveText = vi.fn<SaveTextFn>(async (request) =>
      savedDoc(request.relativePath, request.content, 'b'.repeat(64)),
    );
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'original')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
      undefined,
      saveText,
    );
    render(<App />);
    await userEvent.click(openBtn());
    await openTextFile('a.txt');

    await insertAtEnd('+one');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.queryByLabelText('未保存')).toBeNull();

    await insertAtEnd('+two');
    expect(screen.getByLabelText('未保存')).toBeDefined();
    expect(editorDoc()).toBe('original+one+two');
  });
});
