// @vitest-environment jsdom
/**
 * TASK-009 WP6：文件管理 controller + 文件树 + 对话框 UI 集成测试。
 * 覆盖：普通条目独立选择与打开行为保持、新建（名称输入/Enter/打开标签/错误保留输入）、
 * 重命名（标签迁移）、删除（dirty 计数确认/取消不发 IPC）、重复提交禁用、
 * 取消恢复焦点、partial failure 强制刷新。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '../../src/renderer/lib/use-workspace';
import { useDocuments } from '../../src/renderer/lib/use-documents';
import { useFileManagement } from '../../src/renderer/lib/use-file-management';
import { WorkspaceSidebar } from '../../src/renderer/components/workspace/WorkspaceSidebar';
import { FileManagementDialogs } from '../../src/renderer/components/workspace/FileManagementDialogs';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { WorkspaceSnapshot } from '../../src/shared/workspace';

function snapshotOf(): WorkspaceSnapshot {
  return {
    rootName: 'ws',
    rootPath: 'C:\\ws',
    entries: [
      { name: 'a.txt', relativePath: 'a.txt', kind: 'file' },
      { name: 'note.bin', relativePath: 'note.bin', kind: 'file' },
      {
        name: 'sub',
        relativePath: 'sub',
        kind: 'directory',
        children: [{ name: 'c.txt', relativePath: 'sub/c.txt', kind: 'file' }],
      },
    ],
  };
}

function loadedText(relativePath: string) {
  return {
    status: 'loaded' as const,
    document: {
      name: relativePath.split('/').at(-1)!,
      relativePath,
      content: 'hello',
      byteLength: 5,
      revision: 'r1',
      hasUtf8Bom: false,
      lineEnding: 'lf' as const,
    },
  };
}

interface DesktopOverrides {
  createText?: ReturnType<typeof vi.fn>;
  relocate?: ReturnType<typeof vi.fn>;
  trash?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
}

function mockDesktop(overrides: DesktopOverrides = {}): {
  createText: ReturnType<typeof vi.fn>;
  relocate: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
} {
  const refresh =
    overrides.refresh ?? vi.fn(async () => ({ status: 'refreshed', workspace: snapshotOf() }));
  const createText =
    overrides.createText ??
    vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'new.txt',
      kind: 'text',
    }));
  const relocate =
    overrides.relocate ??
    vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'renamed.txt',
      kind: 'text',
    }));
  const trash =
    overrides.trash ??
    vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'a.txt',
      kind: 'text',
    }));
  const readText = vi.fn(async (path: string) => loadedText(path));
  (window as unknown as { desktop: DesktopApi }).desktop = {
    runtime: { platform: 'win32', electronVersion: '37.0.0' },
    workspace: {
      open: vi.fn(async () => ({ status: 'selected', workspace: snapshotOf() })),
      refresh,
      createText,
      createDocx: vi.fn(),
      createDirectory: vi.fn(),
      reveal: vi.fn(async () => ({ status: 'revealed' })),
      relocate,
      trash,
    },
    document: {
      readText,
      saveText: vi.fn(),
      readDocx: vi.fn(),
      saveDocx: vi.fn(),
      saveTextAs: vi.fn(),
      saveDocxAs: vi.fn(),
    },
    search: { textWorkspace: vi.fn(), cancelTextWorkspace: vi.fn() },
    window: {
      setDirtyState: vi.fn(),
      requestClose: vi.fn(),
      cancelClose: vi.fn(),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  } as unknown as DesktopApi;
  return { createText, relocate, trash, refresh, readText };
}

function Harness(): React.JSX.Element {
  const workspace = useWorkspace();
  const documents = useDocuments();
  const fm = useFileManagement({
    workspace: workspace.state.workspace,
    workspaceEpoch: workspace.epoch,
    refreshWorkspace: workspace.refreshWorkspace,
    openFile: documents.openFile,
    commitRelocate: documents.commitRelocateResult,
    commitTrash: documents.commitTrashResult,
    saveAsTab: documents.saveAsTab,
    tabs: documents.model.state.tabs,
  });
  return (
    <>
      <WorkspaceSidebar
        state={workspace.state}
        onOpenWorkspace={workspace.openWorkspace}
        onRefreshWorkspace={workspace.refreshWorkspace}
        onFileOpen={documents.openFile}
        selectedFilePath={null}
        managementSelectedPath={fm.state.selectedPath}
        expandedDirs={fm.state.expandedDirs}
        onSelectEntry={fm.selectEntry}
        onToggleDir={fm.toggleDir}
        fileManagement={fm}
        onSaveAsActive={() => undefined}
        saveAsDisabled={false}
      />
      <FileManagementDialogs
        state={fm.state}
        workspace={workspace.state.workspace}
        onSetInputName={fm.setInputName}
        onSubmitInput={fm.submitInput}
        onPickTarget={fm.pickTarget}
        onConfirmTarget={fm.confirmTarget}
        onConfirmOverwrite={fm.confirmOverwrite}
        onConfirmTrash={fm.confirmTrash}
        onCancel={fm.cancel}
        onDismissMessage={fm.dismissMessage}
      />
      <output data-testid="fm-status">{fm.state.status}</output>
      <output data-testid="fm-selected">{fm.state.selectedPath ?? ''}</output>
    </>
  );
}

async function openWorkspace(): Promise<void> {
  await userEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
}

afterEach(() => {
  cleanup();
});

describe('文件树选择与打开行为', () => {
  it('TXT 单击：打开并同时成为管理选择；普通文件仅选择不打开', async () => {
    const { readText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();

    await userEvent.click(screen.getByTestId('ft-a.txt'));
    expect(screen.getByTestId('fm-selected').textContent).toBe('a.txt');
    expect(readText).toHaveBeenCalledWith('a.txt');

    readText.mockClear();
    await userEvent.click(screen.getByTestId('ft-note.bin'));
    expect(screen.getByTestId('fm-selected').textContent).toBe('note.bin');
    expect(readText).not.toHaveBeenCalledWith('note.bin');
  });

  it('目录单击：切换展开并成为选择', async () => {
    mockDesktop();
    render(<Harness />);
    await openWorkspace();
    expect(screen.queryByTestId('ft-sub/c.txt')).toBeNull();
    await userEvent.click(screen.getByTestId('ft-sub'));
    expect(screen.getByTestId('ft-sub/c.txt')).toBeDefined();
    expect(screen.getByTestId('fm-selected').textContent).toBe('sub');
  });
});

describe('新建与名称输入', () => {
  it('新建 TXT：输入名称 Enter 提交 → createText → 打开唯一标签', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();

    await userEvent.click(screen.getByTestId('fm-create-text'));
    const input = screen.getByTestId('fm-name-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, 'brand-new.txt{Enter}');
    expect(createText).toHaveBeenCalledWith({
      mutationId: 1,
      parentRelativePath: '',
      name: 'brand-new.txt',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getByText('已创建 brand-new.txt')).toBeDefined();
  });

  it('非法名称：错误保留输入，可修改重试', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('fm-create-text'));
    const input = screen.getByTestId('fm-name-input') as HTMLInputElement;
    await userEvent.type(input, 'CON{Enter}');
    expect(screen.getByTestId('fm-status').textContent).toBe('error');
    expect(createText).not.toHaveBeenCalled();
    expect((screen.getByTestId('fm-name-input') as HTMLInputElement).value).toBe('CON');
  });

  it('running 期间提交按钮禁用（重复提交阻止）', async () => {
    let resolveCreate!: (r: unknown) => void;
    const createText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    mockDesktop({ createText });
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('fm-create-text'));
    await userEvent.type(screen.getByTestId('fm-name-input'), 'x.txt{Enter}');
    expect(screen.getByTestId('fm-status').textContent).toBe('running');
    expect((screen.getByTestId('fm-input-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('fm-create-text') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveCreate({ status: 'succeeded', mutationId: 1, relativePath: 'x.txt', kind: 'text' });
    });
  });
});

describe('重命名与删除', () => {
  it('重命名：确认后 relocate IPC 并迁移已打开标签', async () => {
    const { relocate } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await userEvent.click(screen.getByTestId('fm-rename'));
    const input = screen.getByTestId('fm-name-input') as HTMLInputElement;
    expect(input.value).toBe('a.txt');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'renamed.txt' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'a.txt',
      parentRelativePath: '',
      name: 'renamed.txt',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getAllByText('renamed.txt').length).toBeGreaterThan(0);
  });

  it('删除：确认对话框含类型与未保存计数；确认后 trash IPC 并关闭标签', async () => {
    const { trash } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await userEvent.click(screen.getByTestId('fm-delete'));
    expect(screen.getByText(/将删除 .*a\.txt.*Windows 回收站/)).toBeDefined();
    expect(screen.getByText(/没有未保存的标签/)).toBeDefined();
    await userEvent.click(screen.getByTestId('fm-trash-confirm'));
    expect(trash).toHaveBeenCalledWith({ mutationId: 1, relativePath: 'a.txt' });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
  });

  it('删除取消：不发 IPC', async () => {
    const { trash } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-note.bin'));
    await userEvent.click(screen.getByTestId('fm-delete'));
    await userEvent.click(screen.getByTestId('fm-trash-cancel'));
    expect(trash).not.toHaveBeenCalled();
    expect(screen.getByTestId('fm-status').textContent).toBe('idle');
  });
});

describe('取消焦点恢复与 partial failure', () => {
  it('取消名称输入：焦点恢复到操作栏按钮', async () => {
    mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('fm-create-text'));
    await userEvent.click(screen.getByTestId('fm-input-cancel'));
    expect(screen.getByTestId('fm-status').textContent).toBe('idle');
    expect(document.activeElement).toBe(screen.getByTestId('fm-create-text'));
  });

  it('partial failure：强制刷新并显示部分完成对话框', async () => {
    const refresh = vi.fn(async () => ({ status: 'refreshed', workspace: snapshotOf() }));
    const trash = vi.fn(async () => ({
      status: 'error',
      mutationId: 1,
      error: { code: 'PARTIAL_FAILURE', message: '操作部分完成，请刷新后重试' },
    }));
    mockDesktop({ trash, refresh });
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await userEvent.click(screen.getByTestId('fm-delete'));
    await userEvent.click(screen.getByTestId('fm-trash-confirm'));
    expect(screen.getByTestId('fm-status').textContent).toBe('partial-failure');
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText('操作部分完成')).toBeDefined();
  });
});
