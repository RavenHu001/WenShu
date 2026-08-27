// @vitest-environment jsdom
/**
 * TASK-009 WP6：文件管理 controller + 文件树 + 对话框 UI 集成测试。
 * 覆盖：普通条目独立选择与打开行为保持、新建（名称输入/Enter/打开标签/错误保留输入）、
 * 重命名（标签迁移）、删除（dirty 计数确认/取消不发 IPC）、重复提交禁用、
 * 取消恢复焦点、partial failure 强制刷新。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '../../src/renderer/lib/use-workspace';
import { useDocuments } from '../../src/renderer/lib/use-documents';
import {
  completeDocumentExtensionName,
  useFileManagement,
} from '../../src/renderer/lib/use-file-management';
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
  createDocx?: ReturnType<typeof vi.fn>;
  relocate?: ReturnType<typeof vi.fn>;
  trash?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
}

function mockDesktop(overrides: DesktopOverrides = {}): {
  createText: ReturnType<typeof vi.fn>;
  createDocx: ReturnType<typeof vi.fn>;
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
  const createDocx =
    overrides.createDocx ??
    vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'new.docx',
      kind: 'docx',
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
  const readDocx = vi.fn(async (path: string) => ({
    status: 'loaded' as const,
    document: {
      kind: 'docx' as const,
      name: path.split('/').at(-1)!,
      relativePath: path,
      revision: 'r1',
      size: 1,
      model: {
        schemaVersion: 1,
        blocks: [{ kind: 'paragraph' as const, alignment: null, runs: [] }],
      },
      compatibility: { level: 'supported' as const, warnings: [] },
    },
  }));
  (window as unknown as { desktop: DesktopApi }).desktop = {
    runtime: { platform: 'win32', electronVersion: '37.0.0' },
    workspace: {
      open: vi.fn(async () => ({ status: 'selected', workspace: snapshotOf() })),
      refresh,
      createText,
      createDocx,
      createDirectory: vi.fn(),
      reveal: vi.fn(async () => ({ status: 'revealed' })),
      relocate,
      trash,
    },
    document: {
      readText,
      saveText: vi.fn(),
      readDocx,
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
  return { createText, createDocx, relocate, trash, refresh, readText };
}

function Harness({ onMutationCommitted }: { onMutationCommitted?: () => void }): React.JSX.Element {
  const workspace = useWorkspace();
  const documents = useDocuments();
  const fm = useFileManagement({
    workspace: workspace.state.workspace,
    workspaceEpoch: workspace.epoch,
    refreshWorkspace: () => workspace.refreshWorkspace({ background: true }),
    openFile: documents.openFile,
    commitRelocate: documents.commitRelocateResult,
    commitTrash: documents.commitTrashResult,
    saveAsTab: documents.saveAsTab,
    tabs: documents.model.state.tabs,
    onMutationCommitted,
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
      <output data-testid="fm-message">{fm.state.message ?? ''}</output>
    </>
  );
}

async function openWorkspace(): Promise<void> {
  await userEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
}

async function beginCreate(label: '新建 TXT' | '新建 DOCX' | '新建文件夹'): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '新建' }));
  await userEvent.click(screen.getByRole('menuitem', { name: label }));
}

async function runSelectedContextCommand(
  label: '重命名' | '移动到…' | '删除到回收站' | '在资源管理器中显示',
): Promise<void> {
  const selected = document.querySelector<HTMLButtonElement>(
    '[role="treeitem"][aria-current="true"] button',
  );
  if (selected === null) throw new Error('expected selected tree row');
  fireEvent.contextMenu(selected, { clientX: 30, clientY: 30 });
  await userEvent.click(screen.getByRole('menuitem', { name: label }));
}

afterEach(() => {
  cleanup();
});

describe('文件树选择与打开行为', () => {
  it('文件操作后的后台刷新不插入状态行或重建文件树', async () => {
    let resolveRefresh!: (result: { status: 'refreshed'; workspace: WorkspaceSnapshot }) => void;
    const refresh = vi.fn(
      () =>
        new Promise<{ status: 'refreshed'; workspace: WorkspaceSnapshot }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    mockDesktop({ refresh });
    render(<Harness />);
    await openWorkspace();
    const tree = screen.getByRole('tree', { name: '工作区文件树' });

    await beginCreate('新建 TXT');
    fireEvent.change(screen.getByTestId('fm-name-input'), { target: { value: 'new.txt' } });
    await userEvent.click(screen.getByTestId('fm-input-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(screen.queryByText('正在刷新…')).toBeNull();
    expect(screen.getByRole('tree', { name: '工作区文件树' })).toBe(tree);

    await act(async () => {
      resolveRefresh({ status: 'refreshed', workspace: snapshotOf() });
    });
    await waitFor(() => expect(screen.getByTestId('fm-status').textContent).toBe('succeeded'));
  });

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
    expect(screen.getByTestId('ft-sub').classList.contains('ft-row--managed')).toBe(true);
  });
});

describe('新建与名称输入', () => {
  it('新建 TXT：输入名称 Enter 提交 → createText → 打开唯一标签', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();

    await beginCreate('新建 TXT');
    const input = screen.getByTestId('fm-name-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, 'brand-new.txt{Enter}');
    expect(createText).toHaveBeenCalledWith({
      mutationId: 1,
      parentRelativePath: '',
      name: 'brand-new.txt',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getByTestId('fm-message').textContent).toBe('已创建 brand-new.txt');
  });

  it('非法名称：错误保留输入，可修改重试', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await beginCreate('新建 TXT');
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
    await beginCreate('新建 TXT');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'x.txt{Enter}');
    expect(screen.getByTestId('fm-status').textContent).toBe('running');
    expect((screen.getByTestId('fm-input-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '新建' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveCreate({ status: 'succeeded', mutationId: 1, relativePath: 'x.txt', kind: 'text' });
    });
  });

  it('新建 TXT：名称无扩展名时自动补全 .txt 提交', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await beginCreate('新建 TXT');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'brand-new{Enter}');
    expect(createText).toHaveBeenCalledWith({
      mutationId: 1,
      parentRelativePath: '',
      name: 'brand-new.txt',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getByTestId('fm-message').textContent).toBe('已创建 brand-new.txt');
  });

  it('新建 DOCX：名称无扩展名时自动补全 .docx 提交', async () => {
    const { createDocx } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await beginCreate('新建 DOCX');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'brand-new{Enter}');
    expect(createDocx).toHaveBeenCalledWith({
      mutationId: 1,
      parentRelativePath: '',
      name: 'brand-new.docx',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getByTestId('fm-message').textContent).toBe('已创建 brand-new.docx');
  });

  it('新建 TXT：名称带其他扩展名时拒绝且不发 IPC', async () => {
    const { createText } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await beginCreate('新建 TXT');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'brand-new.md{Enter}');
    expect(screen.getByTestId('fm-status').textContent).toBe('error');
    expect(createText).not.toHaveBeenCalled();
    // 错误横幅在操作栏与对话框各展示一份（现有 UI 设计）
    expect(screen.getAllByText('TXT 文件名必须以 .txt 结尾').length).toBeGreaterThan(0);
    expect((screen.getByTestId('fm-name-input') as HTMLInputElement).value).toBe('brand-new.md');
  });
});

describe('重命名与删除', () => {
  it('重命名：确认后 relocate IPC 并迁移已打开标签', async () => {
    const { relocate } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('重命名');
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

  it('重命名：输入名称无扩展名时自动保留原 .txt 扩展名', async () => {
    const { relocate } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('重命名');
    await act(async () => {
      fireEvent.change(screen.getByTestId('fm-name-input'), { target: { value: 'renamed' } });
      fireEvent.keyDown(screen.getByTestId('fm-name-input'), { key: 'Enter' });
    });
    expect(relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'a.txt',
      parentRelativePath: '',
      name: 'renamed.txt',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(screen.getByTestId('fm-message').textContent).toBe('已重命名为 renamed.txt');
  });

  it('重命名：改为其他扩展名时拒绝（TYPE_CHANGE_NOT_ALLOWED）且不发 IPC', async () => {
    const { relocate } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('重命名');
    await act(async () => {
      fireEvent.change(screen.getByTestId('fm-name-input'), { target: { value: 'renamed.md' } });
      fireEvent.keyDown(screen.getByTestId('fm-name-input'), { key: 'Enter' });
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('error');
    expect(relocate).not.toHaveBeenCalled();
    // 错误横幅在操作栏与对话框各展示一份（现有 UI 设计）
    expect(screen.getAllByText('不允许改变文件类型').length).toBeGreaterThan(0);
    expect((screen.getByTestId('fm-name-input') as HTMLInputElement).value).toBe('renamed.md');
  });

  it('重命名：普通文件（非 TXT/DOCX）不自动补扩展名', async () => {
    const { relocate } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-note.bin'));
    await runSelectedContextCommand('重命名');
    await act(async () => {
      fireEvent.change(screen.getByTestId('fm-name-input'), { target: { value: 'renamed' } });
      fireEvent.keyDown(screen.getByTestId('fm-name-input'), { key: 'Enter' });
    });
    expect(relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'note.bin',
      parentRelativePath: '',
      name: 'renamed',
    });
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
  });

  it('删除：确认对话框含类型与未保存计数；确认后 trash IPC 并关闭标签', async () => {
    const { trash } = mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('删除到回收站');
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
    await runSelectedContextCommand('删除到回收站');
    await userEvent.click(screen.getByTestId('fm-trash-cancel'));
    expect(trash).not.toHaveBeenCalled();
    expect(screen.getByTestId('fm-status').textContent).toBe('idle');
  });
});

describe('取消焦点恢复与 partial failure', () => {
  it('取消名称输入：焦点恢复到紧凑新建入口', async () => {
    mockDesktop();
    render(<Harness />);
    await openWorkspace();
    await beginCreate('新建 TXT');
    await userEvent.click(screen.getByTestId('fm-input-cancel'));
    expect(screen.getByTestId('fm-status').textContent).toBe('idle');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新建' }));
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
    await runSelectedContextCommand('删除到回收站');
    await userEvent.click(screen.getByTestId('fm-trash-confirm'));
    expect(screen.getByTestId('fm-status').textContent).toBe('partial-failure');
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText('操作部分完成')).toBeDefined();
  });
});

describe('completeDocumentExtensionName（§4.3 扩展名补全纯函数）', () => {
  it('已带目标扩展名：原样返回（大小写不敏感）', () => {
    expect(completeDocumentExtensionName('a.txt', 'text')).toBe('a.txt');
    expect(completeDocumentExtensionName('a.TXT', 'text')).toBe('a.TXT');
    expect(completeDocumentExtensionName('a.docx', 'docx')).toBe('a.docx');
    expect(completeDocumentExtensionName('a.DocX', 'docx')).toBe('a.DocX');
    expect(completeDocumentExtensionName('archive.tar.txt', 'text')).toBe('archive.tar.txt');
  });

  it('无扩展名：自动追加目标扩展名', () => {
    expect(completeDocumentExtensionName('a', 'text')).toBe('a.txt');
    expect(completeDocumentExtensionName('a', 'docx')).toBe('a.docx');
    expect(completeDocumentExtensionName('会议纪要', 'text')).toBe('会议纪要.txt');
  });

  it('带其他扩展名：返回 null（类型不匹配）', () => {
    expect(completeDocumentExtensionName('a.md', 'text')).toBeNull();
    expect(completeDocumentExtensionName('a.md', 'docx')).toBeNull();
    expect(completeDocumentExtensionName('a.txt', 'docx')).toBeNull();
    expect(completeDocumentExtensionName('a.docx', 'text')).toBeNull();
    expect(completeDocumentExtensionName('.gitignore', 'text')).toBeNull();
  });
});

describe('onMutationCommitted（TASK-009 §4.11 mutationEpoch 通知）', () => {
  it('新建 TXT 成功：通知一次；失败与取消不通知', async () => {
    const onMutationCommitted = vi.fn();
    const { createText } = mockDesktop();
    render(<Harness onMutationCommitted={onMutationCommitted} />);
    await openWorkspace();
    await beginCreate('新建 TXT');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'brand-new.txt{Enter}');
    expect(createText).toHaveBeenCalled();
    expect(onMutationCommitted).toHaveBeenCalledTimes(1);

    // 失败：不通知
    onMutationCommitted.mockClear();
    createText.mockResolvedValueOnce({
      status: 'error',
      mutationId: 2,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    });
    await beginCreate('新建 TXT');
    await userEvent.type(screen.getByTestId('fm-name-input'), 'fail.txt{Enter}');
    expect(screen.getByTestId('fm-status').textContent).toBe('error');
    expect(onMutationCommitted).not.toHaveBeenCalled();

    // 取消：不通知
    onMutationCommitted.mockClear();
    await beginCreate('新建 TXT');
    await userEvent.click(screen.getByTestId('fm-input-cancel'));
    expect(onMutationCommitted).not.toHaveBeenCalled();
  });

  it('重命名与删除成功：通知；reveal 成功：不通知（不递增 mutationEpoch）', async () => {
    const onMutationCommitted = vi.fn();
    const { relocate, trash } = mockDesktop();
    render(<Harness onMutationCommitted={onMutationCommitted} />);
    await openWorkspace();

    // reveal 成功：不通知（§4.11 reveal 不递增）
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('在资源管理器中显示');
    expect(screen.getByTestId('fm-status').textContent).toBe('succeeded');
    expect(onMutationCommitted).not.toHaveBeenCalled();

    // 重命名成功：通知一次
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('重命名');
    await act(async () => {
      fireEvent.change(screen.getByTestId('fm-name-input'), { target: { value: 'renamed.txt' } });
      fireEvent.keyDown(screen.getByTestId('fm-name-input'), { key: 'Enter' });
    });
    expect(relocate).toHaveBeenCalled();
    expect(onMutationCommitted).toHaveBeenCalledTimes(1);

    // 删除成功：通知一次
    onMutationCommitted.mockClear();
    await userEvent.click(screen.getByTestId('ft-note.bin'));
    await runSelectedContextCommand('删除到回收站');
    await userEvent.click(screen.getByTestId('fm-trash-confirm'));
    expect(trash).toHaveBeenCalled();
    expect(onMutationCommitted).toHaveBeenCalledTimes(1);
  });

  it('删除 partial failure：通知（磁盘已部分改变，搜索结果必须作废）', async () => {
    const onMutationCommitted = vi.fn();
    const trash = vi.fn(async () => ({
      status: 'error',
      mutationId: 1,
      error: { code: 'PARTIAL_FAILURE', message: '操作部分完成，请刷新后重试' },
    }));
    mockDesktop({ trash });
    render(<Harness onMutationCommitted={onMutationCommitted} />);
    await openWorkspace();
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await runSelectedContextCommand('删除到回收站');
    await userEvent.click(screen.getByTestId('fm-trash-confirm'));
    expect(screen.getByTestId('fm-status').textContent).toBe('partial-failure');
    expect(onMutationCommitted).toHaveBeenCalledTimes(1);
  });
});
