import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSidebar } from '../../src/renderer/components/workspace/WorkspaceSidebar';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';

function mockDesktop(
  openFn: () => Promise<OpenWorkspaceResult>,
  refreshFn?: () => Promise<RefreshWorkspaceResult>,
) {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: openFn,
      refresh: refreshFn ?? vi.fn(),
    },
  };
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

function f(name: string, relativePath: string): WorkspaceEntry {
  return { name, relativePath, kind: 'file' };
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [], ...overrides };
}

function openBtn(): HTMLButtonElement {
  const buttons = screen.getAllByText('打开文件夹');
  return (buttons[0] ?? buttons[buttons.length - 1]) as HTMLButtonElement;
}

function renderSidebar(
  onTextFileOpen: (relativePath: string) => void = vi.fn(),
  selectedTextFilePath: string | null = null,
  onWorkspaceSelected: () => void = vi.fn(),
): ReturnType<typeof render> {
  return render(
    <WorkspaceSidebar
      onTextFileOpen={onTextFileOpen}
      selectedTextFilePath={selectedTextFilePath}
      onWorkspaceSelected={onWorkspaceSelected}
    />,
  );
}

describe('WorkspaceSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('initial state shows open folder button', () => {
    mockDesktop(vi.fn());
    renderSidebar();
    expect(screen.getByText('打开文件夹')).toBeDefined();
  });

  it('shows idle prompt when no workspace is open', () => {
    mockDesktop(vi.fn());
    renderSidebar();
    expect(screen.getByText('尚未打开文件夹')).toBeDefined();
  });

  it('cancelling dialog keeps idle state and does not clear', async () => {
    const open = vi.fn().mockResolvedValue({ status: 'cancelled' } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('尚未打开文件夹')).toBeDefined();
  });

  it('successful open shows workspace root name and path', async () => {
    const snap = snapshot({ entries: [f('readme.txt', 'readme.txt')] });
    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('test-root')).toBeDefined();
    expect(screen.getByText('/test-root')).toBeDefined();
    expect(screen.getByText('readme.txt')).toBeDefined();
  });

  it('empty workspace shows empty message', async () => {
    const snap = snapshot({ entries: [] });
    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('此文件夹为空')).toBeDefined();
  });

  it('directories can expand and collapse', async () => {
    const snap = snapshot({
      entries: [d('src', 'src', [f('index.ts', 'src/index.ts')])],
    });
    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('src')).toBeDefined();
    expect(screen.queryByText('index.ts')).toBeNull();

    const directoryButton = screen.getByRole('button', { name: 'src' });
    directoryButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('index.ts')).toBeDefined();

    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('index.ts')).toBeNull();
  });

  it('top-level error shows error message with retry button', async () => {
    const open = vi.fn().mockResolvedValue({
      status: 'error',
      error: { message: '拒绝访问' },
    } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('无法打开工作区')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();
  });

  it('subdirectory error shows on node but does not prevent sibling display', async () => {
    const snap = snapshot({
      entries: [d('ok', 'ok', [f('good.txt', 'ok/good.txt')]), d('bad', 'bad', undefined)],
    });
    const entries = snap.entries.map((e) => {
      if (e.name === 'bad') {
        return { ...d('bad', 'bad', []), error: { message: '拒绝访问' } };
      }
      return e;
    });
    const modifiedSnap = { ...snap, entries };

    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: modifiedSnap } as OpenWorkspaceResult);
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('ok')).toBeDefined();
    expect(screen.getByText('bad')).toBeDefined();
    expect(screen.getByText('无法读取').getAttribute('title')).toBe('拒绝访问');
  });

  it('loading state does not show the open button', async () => {
    const open = vi.fn().mockImplementation(() => new Promise<OpenWorkspaceResult>(() => {}));
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.queryByText('打开文件夹')).toBeNull();
    expect(screen.getByText('正在读取工作区…')).toBeDefined();
  });

  it('refresh succeeds and replaces old snapshot', async () => {
    const snap1 = snapshot({ entries: [f('a.txt', 'a.txt')] });
    const snap2 = snapshot({ entries: [f('b.txt', 'b.txt')] });

    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: snap1 } as OpenWorkspaceResult);
    const refresh = vi
      .fn()
      .mockResolvedValue({ status: 'refreshed', workspace: snap2 } as RefreshWorkspaceResult);
    mockDesktop(open, refresh);
    renderSidebar();

    await userEvent.click(openBtn());
    expect(screen.getByText('a.txt')).toBeDefined();

    await userEvent.click(screen.getByText('刷新'));
    expect(screen.getByText('b.txt')).toBeDefined();
    expect(screen.queryByText('a.txt')).toBeNull();
  });

  it('keeps the current workspace visible and disables actions while opening a replacement', async () => {
    const snap = snapshot({ entries: [f('current.txt', 'current.txt')] });
    const open = vi
      .fn()
      .mockResolvedValueOnce({ status: 'selected', workspace: snap } as OpenWorkspaceResult)
      .mockImplementationOnce(() => new Promise<OpenWorkspaceResult>(() => {}));
    mockDesktop(open);
    renderSidebar();

    await userEvent.click(openBtn());
    await userEvent.click(openBtn());

    expect(screen.getByText('current.txt')).toBeDefined();
    expect(screen.getByText('正在读取新工作区…')).toBeDefined();
    expect(openBtn().disabled).toBe(true);
    expect((screen.getByText('刷新') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a recoverable error when opening rejects unexpectedly', async () => {
    mockDesktop(vi.fn().mockRejectedValue(new Error('IPC 已断开')));
    renderSidebar();

    await userEvent.click(openBtn());

    expect(screen.getByText('无法打开工作区')).toBeDefined();
    expect(screen.getByText('IPC 已断开')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();
  });

  it('keeps the current workspace when refresh rejects unexpectedly', async () => {
    const snap = snapshot({ entries: [f('current.txt', 'current.txt')] });
    const open = vi
      .fn()
      .mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult);
    mockDesktop(open, vi.fn().mockRejectedValue(new Error('刷新失败')));
    renderSidebar();

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByText('刷新'));

    expect(screen.getByText('current.txt')).toBeDefined();
    expect(screen.getByText('无法读取工作区：刷新失败')).toBeDefined();
  });
});

describe('文件树 TXT 选择（WP3）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  async function openWorkspaceWith(
    entries: readonly WorkspaceEntry[],
    onTextFileOpen: (relativePath: string) => void = vi.fn(),
    selectedTextFilePath: string | null = null,
  ): Promise<ReturnType<typeof render>> {
    const open = vi.fn().mockResolvedValue({
      status: 'selected',
      workspace: snapshot({ entries }),
    } as OpenWorkspaceResult);
    mockDesktop(open);
    const view = renderSidebar(onTextFileOpen, selectedTextFilePath);
    await userEvent.click(openBtn());
    return view;
  }

  it('TXT 文件节点可由鼠标点击选择并报告相对路径', async () => {
    const onOpen = vi.fn();
    mockDesktop(
      vi.fn().mockResolvedValue({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] }),
      } as OpenWorkspaceResult),
    );
    renderSidebar(onOpen);

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('a.txt');
  });

  it('TXT 文件节点可由键盘激活（Enter 与 Space）', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    mockDesktop(
      vi.fn().mockResolvedValue({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt')] }),
      } as OpenWorkspaceResult),
    );
    renderSidebar(onOpen);

    await user.click(openBtn());
    const fileButton = screen.getByRole('button', { name: 'a.txt' });
    fileButton.focus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith('a.txt');
  });

  it('嵌套目录中的 TXT 展开后可以选择并报告完整相对路径', async () => {
    const onOpen = vi.fn();
    await openWorkspaceWith([d('src', 'src', [f('deep.txt', 'src/deep.txt')])], onOpen);

    const directoryButton = screen.getByRole('button', { name: 'src' });
    directoryButton.focus();
    await userEvent.keyboard('{Enter}');

    await userEvent.click(screen.getByRole('button', { name: 'deep.txt' }));
    expect(onOpen).toHaveBeenCalledWith('src/deep.txt');
  });

  it('连续选择第二个 TXT 时报告新文件的相对路径', async () => {
    const onOpen = vi.fn();
    await openWorkspaceWith([f('a.txt', 'a.txt'), f('b.txt', 'b.txt')], onOpen);

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    await userEvent.click(screen.getByRole('button', { name: 'b.txt' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith('b.txt');
  });

  it('当前选中文件具有可辨识的选中状态', async () => {
    const onOpen = vi.fn();
    mockDesktop(
      vi.fn().mockResolvedValue({
        status: 'selected',
        workspace: snapshot({ entries: [f('a.txt', 'a.txt'), f('b.txt', 'b.txt')] }),
      } as OpenWorkspaceResult),
    );
    renderSidebar(onOpen, 'a.txt');

    await userEvent.click(openBtn());
    const selectedNode = screen.getByRole('button', { name: 'a.txt' }).closest('[role="treeitem"]');
    const otherNode = screen.getByRole('button', { name: 'b.txt' }).closest('[role="treeitem"]');
    expect(selectedNode?.getAttribute('aria-selected')).toBe('true');
    expect(otherNode?.getAttribute('aria-selected')).toBeNull();
  });

  it('非 TXT 文件节点不是按钮，点击不触发选择', async () => {
    const onOpen = vi.fn();
    await openWorkspaceWith([f('notes.md', 'notes.md'), f('LICENSE', 'LICENSE')]);

    expect(screen.queryByRole('button', { name: 'notes.md' })).toBeNull();
    await userEvent.click(screen.getByText('notes.md'));
    await userEvent.click(screen.getByText('LICENSE'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('目录节点保持原有展开/折叠行为且不触发文件选择', async () => {
    const onOpen = vi.fn();
    await openWorkspaceWith([d('src', 'src', [f('index.txt', 'src/index.txt')])]);

    const directoryButton = screen.getByRole('button', { name: 'src' });
    directoryButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('index.txt')).toBeDefined();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('符号链接节点不触发文件选择', async () => {
    const onOpen = vi.fn();
    const link: WorkspaceEntry = {
      name: 'link.txt',
      relativePath: 'link.txt',
      kind: 'symbolic-link',
    };
    await openWorkspaceWith([link]);

    expect(screen.queryByRole('button', { name: 'link.txt' })).toBeNull();
    await userEvent.click(screen.getByText('link.txt'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
