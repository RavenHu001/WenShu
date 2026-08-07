// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
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

beforeAll(() => {
  // jsdom 未实现 Range 的几何测量；保留桩以避免未来 CodeMirror 会话测试报错
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

/** 标签栏中的全部标签名。 */
function tabNames(): string[] {
  return Array.from(document.querySelectorAll('.tab .tab-name')).map(
    (node) => node.textContent ?? '',
  );
}

function tabIsActive(name: string): boolean {
  return screen.getByRole('tab', { name }).getAttribute('aria-selected') === 'true';
}

function tabCount(): number {
  return document.querySelectorAll('.tab').length;
}

/** 只读正文区显示的内容；无正文区时返回 null。 */
function shownContent(): string | null {
  const node = document.querySelector('.doc-readonly-content');
  return node === null ? null : (node.textContent ?? '');
}

/** 文件树当前高亮的文件名。 */
function treeSelectedName(): string | null {
  return (
    document.querySelector('[role="tree"] [role="treeitem"][aria-selected="true"] .ft-name')
      ?.textContent ?? null
  );
}

describe('中央文档区（WP2 多标签读取）', () => {
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

  it('读取成功后显示文件名标签与只读正文', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => loadedDoc('a.txt', 'hello\n世界')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await openTextFile('a.txt');

    expect(tabNames()).toEqual(['a.txt']);
    expect(shownContent()).toBe('hello\n世界');
    expect(document.querySelector('.cm-content')).toBeNull();
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
    expect(shownContent()).toBe('');
    expect(document.querySelector('.doc-readonly-content')).not.toBeNull();
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
    expect(shownContent()).toBe('内容:b.txt');

    await userEvent.click(screen.getByRole('tab', { name: 'a.txt' }));
    expect(shownContent()).toBe('内容:a.txt');
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
    expect(shownContent()).toBe('内容:a.txt');
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
    const bothTabs = screen.getAllByRole('tab', { name: 'a.txt' });
    expect(bothTabs[0]?.getAttribute('title')).toBe('a.txt');
    expect(bothTabs[1]?.getAttribute('title')).toBe('sub/a.txt');
    expect(shownContent()).toBe('内容:sub/a.txt');
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

    await userEvent.click(screen.getByRole('tab', { name: 'a.txt' }));

    expect(tabIsActive('a.txt')).toBe(true);
    expect(shownContent()).toBe('内容:a.txt');
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
    await userEvent.click(screen.getByRole('tab', { name: 'a.txt' }));

    await userEvent.click(screen.getByRole('button', { name: '关闭 b.txt' }));

    expect(tabNames()).toEqual(['a.txt']);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(shownContent()).toBe('内容:a.txt');
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
    expect(shownContent()).toBe('内容:b.txt');

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
    expect(shownContent()).toBeNull();
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

    await userEvent.click(screen.getByRole('tab', { name: 'a.txt' }));
    expect(shownContent()).toBe('内容:a.txt');
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
    expect(shownContent()).toBe('重试成功');
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
    expect(shownContent()).toBe('内容:b.txt');

    // a 仍在加载：激活其标签只显示加载状态，正文区不出现
    await userEvent.click(screen.getByRole('tab', { name: 'a.txt' }));
    expect(screen.getByText('正在读取 a.txt…')).toBeDefined();

    await act(async () => {
      resolvers[0]!(loadedDoc('a.txt'));
    });
    expect(tabCount()).toBe(2);
    expect(tabIsActive('a.txt')).toBe(true);
    expect(shownContent()).toBe('内容:a.txt');
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
    expect(shownContent()).toBe('内容:a.txt');

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
    expect(shownContent()).toBe('内容:b.txt');
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
    expect(shownContent()).toBe('内容:a.txt');
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

  it('窗口 dirty 上报为全部标签聚合值（WP2 无编辑，恒为 false）', async () => {
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
    await openTextFile('b.txt');

    expect(windowApi.setDirtyState).toHaveBeenLastCalledWith(false);
  });
});
