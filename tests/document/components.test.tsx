import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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

function mockDesktop(
  readText: ReadTextFn,
  open?: () => Promise<OpenWorkspaceResult>,
  refresh?: () => Promise<RefreshWorkspaceResult>,
) {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: open ?? vi.fn(),
      refresh: refresh ?? vi.fn(),
    },
    document: { readText },
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

function textareaValue(): string {
  const area = document.querySelector('textarea') as HTMLTextAreaElement | null;
  return area?.value ?? '';
}

function loadedDoc(relativePath: string): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content: `内容:${relativePath}`,
      byteLength: 4,
    },
  };
}

async function openWorkspaceWith(entries: readonly WorkspaceEntry[]): Promise<void> {
  mockDesktop(vi.fn<ReadTextFn>(), selectedOpen(snapshot({ entries })));
  render(<App />);
  await userEvent.click(openBtn());
}

describe('中央只读文档区（WP4）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('未选择文档时显示欢迎内容', async () => {
    await openWorkspaceWith([]);
    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(document.querySelector('textarea')).toBeNull();
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

  it('读取成功后显示文件名、单个活动标签和只读正文', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => ({
        status: 'loaded',
        document: { name: 'a.txt', relativePath: 'a.txt', content: 'hello\n世界', byteLength: 10 },
      })),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

    expect(document.querySelector('.editor-tabs .tab')?.textContent).toBe('a.txt');
    expect(document.querySelectorAll('.editor-tabs .tab').length).toBe(1);
    expect(textareaValue()).toBe('hello\n世界');
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.readOnly).toBe(true);
    expect(screen.queryByText('本地多文档工作台')).toBeNull();
  });

  it('空文件显示空正文区且保留标签', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async () => ({
        status: 'loaded',
        document: { name: 'empty.txt', relativePath: 'empty.txt', content: '', byteLength: 0 },
      })),
      selectedOpen(snapshot({ entries: [f('empty.txt', 'empty.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(screen.getByRole('button', { name: 'empty.txt' }));

    expect(document.querySelector('.editor-tabs .tab')?.textContent).toBe('empty.txt');
    expect(textareaValue()).toBe('');
  });

  it('选择第二个文件替换第一个文件（仍为单个标签）', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>(async (relativePath) => loadedDoc(relativePath)),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    await userEvent.click(screen.getByRole('button', { name: 'b.txt' }));

    expect(textareaValue()).toBe('内容:b.txt');
    expect(document.querySelectorAll('.editor-tabs .tab').length).toBe(1);
    expect(screen.queryByText('内容:a.txt')).toBeNull();
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

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();
    expect(screen.getByText('文件不存在或已被移除')).toBeDefined();
    expect(screen.getByText(/请在工作区文件树中选择其他 TXT 文件重试/)).toBeDefined();
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

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    await userEvent.click(screen.getByRole('button', { name: 'b.txt' }));

    expect(textareaValue()).toBe('内容:a.txt');
    expect(screen.getByText('读取 b.txt 失败：文件不是合法的 UTF-8 编码')).toBeDefined();
  });

  it('IPC Promise 意外拒绝被转换为界面错误', async () => {
    mockDesktop(
      vi.fn<ReadTextFn>().mockRejectedValue(new Error('bridge down')),
      selectedOpen(snapshot({ entries: [f('a.txt', 'a.txt')] })),
    );
    render(<App />);
    await userEvent.click(openBtn());

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

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
    expect(textareaValue()).toBe('');
    expect(screen.getByText('正在读取 b.txt…')).toBeDefined();

    await act(async () => {
      resolvers[1]!(loadedDoc('b.txt'));
    });
    expect(textareaValue()).toBe('内容:b.txt');
    expect(screen.queryByText('内容:a.txt')).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    expect(textareaValue()).toBe('内容:a.txt');

    await userEvent.click(openBtn());

    expect(screen.getByText('本地多文档工作台')).toBeDefined();
    expect(textareaValue()).toBe('');
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
    expect(textareaValue()).toBe('');
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
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

    await userEvent.click(openBtn());

    expect(textareaValue()).toBe('内容:a.txt');
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
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));

    await userEvent.click(screen.getByText('刷新'));

    expect(textareaValue()).toBe('内容:a.txt');
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
});
