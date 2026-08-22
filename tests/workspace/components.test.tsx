// @vitest-environment jsdom
/**
 * TASK-006 WP4 工作区状态所有权回归测试（任务第 8.5 节与第 4.10 节）。
 * 覆盖：useWorkspace controller 的打开/取消/失败/刷新语义与 epoch 递增；
 * WorkspaceSidebar 纯展示组件按状态渲染；文件树 TXT 选择与展开/折叠行为无回归。
 * 所有行为均通过真实 controller + 展示组件组合验证（与 App 的接线一致）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSidebar } from '../../src/renderer/components/workspace/WorkspaceSidebar';
import { useWorkspace, type WorkspaceController } from '../../src/renderer/lib/use-workspace';
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
  const candidate = buttons[0] ?? buttons[buttons.length - 1];
  const button = candidate?.closest('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('expected open-folder button');
  return button;
}

/** 与 App 相同的接线：useWorkspace controller + 纯展示 WorkspaceSidebar。 */
function SidebarHarness({
  onFileOpen = vi.fn(),
  selectedFilePath = null,
}: {
  onFileOpen?: (relativePath: string) => void;
  selectedFilePath?: string | null;
}): React.JSX.Element {
  const workspace = useWorkspace();
  return (
    <WorkspaceSidebar
      state={workspace.state}
      onOpenWorkspace={workspace.openWorkspace}
      onRefreshWorkspace={workspace.refreshWorkspace}
      onFileOpen={onFileOpen}
      selectedFilePath={selectedFilePath}
    />
  );
}

/** 暴露 controller 状态与 epoch 的测试宿主。 */
function ControllerHarness({
  onWorkspaceSelected,
}: {
  onWorkspaceSelected: () => void;
}): React.JSX.Element {
  const workspace = useWorkspace({ onWorkspaceSelected });
  return <WorkspaceSidebarView controller={workspace} />;
}

function WorkspaceSidebarView({
  controller,
}: {
  controller: WorkspaceController;
}): React.JSX.Element {
  return (
    <div>
      <output data-testid="epoch">{controller.epoch}</output>
      <output data-testid="ws-status">{controller.state.status}</output>
      <WorkspaceSidebar
        state={controller.state}
        onOpenWorkspace={controller.openWorkspace}
        onRefreshWorkspace={controller.refreshWorkspace}
        onFileOpen={vi.fn()}
        selectedFilePath={null}
      />
    </div>
  );
}

describe('useWorkspace 工作区状态所有权（第 4.10 节）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('初始：idle、epoch 为 0', () => {
    mockDesktop(vi.fn());
    render(<ControllerHarness onWorkspaceSelected={vi.fn()} />);
    expect(screen.getByTestId('ws-status').textContent).toBe('idle');
    expect(screen.getByTestId('epoch').textContent).toBe('0');
  });

  it('成功打开：epoch +1 并通知 onWorkspaceSelected', async () => {
    const onSelected = vi.fn();
    mockDesktop(
      vi
        .fn()
        .mockResolvedValue({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult),
    );
    render(<ControllerHarness onWorkspaceSelected={onSelected} />);

    await userEvent.click(openBtn());
    expect(screen.getByTestId('epoch').textContent).toBe('1');
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ws-status').textContent).toBe('loaded');
  });

  it('取消选择：保留原工作区、epoch 不变、不通知 onWorkspaceSelected', async () => {
    const onSelected = vi.fn();
    const open = vi
      .fn()
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({ status: 'cancelled' } as OpenWorkspaceResult);
    mockDesktop(open);
    render(<ControllerHarness onWorkspaceSelected={onSelected} />);

    await userEvent.click(openBtn());
    expect(screen.getByTestId('epoch').textContent).toBe('1');
    expect(screen.getByText('test-root')).toBeDefined();

    await userEvent.click(openBtn());
    expect(screen.getByTestId('epoch').textContent).toBe('1');
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(screen.getByText('test-root')).toBeDefined();
  });

  it('打开失败：保留原工作区、epoch 不变、不通知 onWorkspaceSelected', async () => {
    const onSelected = vi.fn();
    const open = vi
      .fn()
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'error',
        error: { message: '拒绝访问' },
      } as OpenWorkspaceResult);
    mockDesktop(open);
    render(<ControllerHarness onWorkspaceSelected={onSelected} />);

    await userEvent.click(openBtn());
    await userEvent.click(openBtn());
    expect(screen.getByTestId('epoch').textContent).toBe('1');
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(screen.getByText('test-root')).toBeDefined();
  });

  it('刷新成功替换快照但不递增 epoch、不通知 onWorkspaceSelected', async () => {
    const onSelected = vi.fn();
    mockDesktop(
      vi
        .fn()
        .mockResolvedValue({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult),
      vi.fn().mockResolvedValue({
        status: 'refreshed',
        workspace: snapshot({ entries: [f('new.txt', 'new.txt')] }),
      } as RefreshWorkspaceResult),
    );
    render(<ControllerHarness onWorkspaceSelected={onSelected} />);

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByText('刷新'));
    expect(screen.getByText('new.txt')).toBeDefined();
    expect(screen.getByTestId('epoch').textContent).toBe('1');
    expect(onSelected).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceSidebar 纯展示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  it('initial state shows open folder button and idle prompt', () => {
    mockDesktop(vi.fn());
    render(<SidebarHarness />);
    expect(screen.getByText('打开文件夹')).toBeDefined();
    expect(screen.getByText('尚未打开文件夹')).toBeDefined();
  });

  it('cancelling dialog keeps idle state', async () => {
    const open = vi.fn().mockResolvedValue({ status: 'cancelled' } as OpenWorkspaceResult);
    mockDesktop(open);
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    expect(screen.getByText('尚未打开文件夹')).toBeDefined();
  });

  it('successful open shows workspace root name and path', async () => {
    const snap = snapshot({ entries: [f('readme.txt', 'readme.txt')] });
    mockDesktop(
      vi.fn().mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult),
    );
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    expect(screen.getByText('test-root')).toBeDefined();
    expect(screen.getByText('/test-root')).toBeDefined();
    expect(screen.getByText('readme.txt')).toBeDefined();
  });

  it('empty workspace shows empty message', async () => {
    mockDesktop(
      vi
        .fn()
        .mockResolvedValue({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult),
    );
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    expect(screen.getByText('此文件夹为空')).toBeDefined();
  });

  it('top-level error shows error message with retry button', async () => {
    mockDesktop(
      vi.fn().mockResolvedValue({
        status: 'error',
        error: { message: '拒绝访问' },
      } as OpenWorkspaceResult),
    );
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    expect(screen.getByText('无法打开工作区')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();
  });

  it('loading state does not show the open button', async () => {
    const open = vi.fn().mockImplementation(() => new Promise<OpenWorkspaceResult>(() => {}));
    mockDesktop(open);
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    expect(screen.queryByText('打开文件夹')).toBeNull();
    expect(screen.getByText('正在读取工作区…')).toBeDefined();
  });

  it('keeps the current workspace visible and disables actions while opening a replacement', async () => {
    const snap = snapshot({ entries: [f('current.txt', 'current.txt')] });
    const open = vi
      .fn()
      .mockResolvedValueOnce({ status: 'selected', workspace: snap } as OpenWorkspaceResult)
      .mockImplementationOnce(() => new Promise<OpenWorkspaceResult>(() => {}));
    mockDesktop(open);
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    await userEvent.click(openBtn());

    expect(screen.getByText('current.txt')).toBeDefined();
    expect(screen.getByText('正在读取新工作区…')).toBeDefined();
    expect(openBtn().disabled).toBe(true);
    expect((screen.getByText('刷新').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a recoverable error when opening rejects unexpectedly', async () => {
    mockDesktop(vi.fn().mockRejectedValue(new Error('IPC 已断开')));
    render(<SidebarHarness />);

    await userEvent.click(openBtn());

    expect(screen.getByText('无法打开工作区')).toBeDefined();
    expect(screen.getByText('IPC 已断开')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();
  });

  it('keeps the current workspace when refresh rejects unexpectedly', async () => {
    const snap = snapshot({ entries: [f('current.txt', 'current.txt')] });
    mockDesktop(
      vi.fn().mockResolvedValue({ status: 'selected', workspace: snap } as OpenWorkspaceResult),
      vi.fn().mockRejectedValue(new Error('刷新失败')),
    );
    render(<SidebarHarness />);

    await userEvent.click(openBtn());
    await userEvent.click(screen.getByText('刷新'));

    expect(screen.getByText('current.txt')).toBeDefined();
    expect(screen.getByText('无法读取工作区：刷新失败')).toBeDefined();
  });
});

describe('文件树 TXT 选择（无回归）', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktop;
  });

  async function openWorkspaceWith(
    entries: readonly WorkspaceEntry[],
    onFileOpen: (relativePath: string) => void = vi.fn(),
    selectedFilePath: string | null = null,
  ): Promise<void> {
    mockDesktop(
      vi.fn().mockResolvedValue({
        status: 'selected',
        workspace: snapshot({ entries }),
      } as OpenWorkspaceResult),
    );
    render(<SidebarHarness onFileOpen={onFileOpen} selectedFilePath={selectedFilePath} />);
    await userEvent.click(openBtn());
  }

  it('TXT 文件节点可由鼠标点击选择并报告相对路径', async () => {
    const onOpen = vi.fn();
    await openWorkspaceWith([f('a.txt', 'a.txt'), f('b.txt', 'b.txt')], onOpen);

    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('a.txt');
  });

  it('TXT 文件节点可由键盘激活（Enter 与 Space）', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    await openWorkspaceWith([f('a.txt', 'a.txt')], onOpen);

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
    await openWorkspaceWith([f('a.txt', 'a.txt'), f('b.txt', 'b.txt')], onOpen, 'a.txt');

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
