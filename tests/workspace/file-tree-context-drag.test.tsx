// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTree } from '../../src/renderer/components/workspace/FileTree';
import type {
  FileManagementController,
  FileManagementUiState,
} from '../../src/renderer/lib/use-file-management';
import type { WorkspaceEntry } from '../../src/shared/workspace';

const entries: readonly WorkspaceEntry[] = [
  { name: 'a.txt', relativePath: 'a.txt', kind: 'file' },
  { name: 'binary.bin', relativePath: 'binary.bin', kind: 'file' },
  {
    name: 'docs',
    relativePath: 'docs',
    kind: 'directory',
    children: [
      { name: 'inside.txt', relativePath: 'docs/inside.txt', kind: 'file' },
      { name: 'nested', relativePath: 'docs/nested', kind: 'directory', children: [] },
    ],
  },
  { name: 'target', relativePath: 'target', kind: 'directory', children: [] },
];

const idleState: FileManagementUiState = {
  status: 'idle',
  mode: null,
  selectedPath: null,
  expandedDirs: new Set(['docs']),
  parentRelativePath: '',
  inputName: '',
  saveAsTabId: null,
  pendingOverwrite: null,
  pendingTrash: null,
  runningMutationId: null,
  error: null,
  message: null,
};

function controller(overrides: Partial<FileManagementController> = {}): FileManagementController {
  return {
    state: idleState,
    selectEntry: vi.fn(),
    toggleDir: vi.fn(),
    beginCreate: vi.fn(),
    beginRename: vi.fn(),
    beginMove: vi.fn(),
    beginSaveAs: vi.fn(),
    beginDelete: vi.fn(),
    revealSelected: vi.fn(),
    revealRoot: vi.fn(),
    isPathSaving: vi.fn(() => false),
    relocateByDrop: vi.fn(async () => undefined),
    setInputName: vi.fn(),
    submitInput: vi.fn(),
    pickTarget: vi.fn(),
    confirmTarget: vi.fn(),
    confirmOverwrite: vi.fn(),
    confirmTrash: vi.fn(),
    cancel: vi.fn(),
    dismissMessage: vi.fn(),
    ...overrides,
  };
}

function dataTransfer() {
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

afterEach(cleanup);

describe('file-tree context menu', () => {
  it('shows root, ordinary file and folder command sets with dangerous action last', async () => {
    const user = userEvent.setup();
    const fm = controller();
    const view = render(
      <FileTree entries={entries} fileManagement={fm} workspaceEpoch={3} onFileSelect={vi.fn()} />,
    );
    const tree = screen.getByRole('tree', { name: '工作区文件树' });
    fireEvent.contextMenu(tree, { clientX: 20, clientY: 20 });
    expect(screen.getByRole('menuitem', { name: '新建 TXT' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '在资源管理器中显示工作区' })).toBeDefined();
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.txt' }));
    expect(screen.getByRole('menuitem', { name: '打开或激活' })).toBeDefined();
    const fileItems = screen.getAllByRole('menuitem');
    expect(fileItems.at(-1)?.textContent).toContain('删除到回收站');
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'docs' }));
    expect(screen.getByRole('menuitem', { name: '在此处新建文件夹' })).toBeDefined();
    view.unmount();
  });

  it('supports Shift+F10, Arrow keys, Enter, Escape and focus restoration', async () => {
    const user = userEvent.setup();
    const fm = controller();
    render(<FileTree entries={entries} fileManagement={fm} workspaceEpoch={3} />);
    const file = screen.getByRole('button', { name: 'a.txt' });
    file.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByRole('menu', { name: 'a.txt 文件菜单' })).toBeDefined();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(fm.beginRename).toHaveBeenCalledTimes(1);

    file.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(file);
  });

  it('routes F2/Delete with the stable relative path and disables mutations while saving', async () => {
    const user = userEvent.setup();
    const fm = controller({ isPathSaving: vi.fn((path) => path === 'a.txt') });
    render(<FileTree entries={entries} fileManagement={fm} workspaceEpoch={3} />);
    const file = screen.getByRole('button', { name: 'a.txt' });
    file.focus();
    await user.keyboard('{F2}');
    expect(fm.beginRename).toHaveBeenCalledWith('a.txt');
    await user.keyboard('{Delete}');
    expect(fm.beginDelete).toHaveBeenCalledWith('a.txt');
    fireEvent.contextMenu(file);
    expect((screen.getByRole('menuitem', { name: '重命名' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('menuitem', { name: '删除到回收站' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('file-tree internal drag', () => {
  it('moves a file to a directory and a directory to the root using relocate only', async () => {
    const relocateByDrop = vi.fn(async () => undefined);
    const fm = controller({ relocateByDrop });
    render(<FileTree entries={entries} fileManagement={fm} workspaceEpoch={7} />);
    const transfer = dataTransfer();
    const file = screen.getByRole('button', { name: 'a.txt' });
    fireEvent.dragStart(file, { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'a.txt' }).className).toContain('dragging');
    fireEvent.dragOver(screen.getByRole('button', { name: 'target' }), { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'target' }).className).toContain('drop-allowed');
    fireEvent.drop(screen.getByRole('button', { name: 'target' }), { dataTransfer: transfer });
    await Promise.resolve();
    expect(relocateByDrop).toHaveBeenCalledWith('a.txt', 'target', 7);
    await waitFor(() =>
      expect(
        screen.getByRole('tree', { name: '工作区文件树' }).getAttribute('aria-busy'),
      ).toBeNull(),
    );

    const docs = screen.getByRole('button', { name: 'docs' });
    fireEvent.click(docs);
    const nested = screen.getByRole('button', { name: 'nested' });
    fireEvent.dragStart(nested, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole('tree', { name: '工作区文件树' }), {
      dataTransfer: transfer,
    });
    fireEvent.drop(screen.getByRole('tree', { name: '工作区文件树' }), {
      dataTransfer: transfer,
    });
    await Promise.resolve();
    expect(relocateByDrop).toHaveBeenLastCalledWith('docs/nested', '', 7);
  });

  it('rejects descendant/no-op/saving targets and clears decorations on Escape or epoch change', async () => {
    const relocateByDrop = vi.fn(async () => undefined);
    const fm = controller({
      relocateByDrop,
      isPathSaving: vi.fn((path) => path === 'a.txt'),
    });
    const view = render(
      <FileTree
        entries={entries}
        expandedDirs={new Set(['docs'])}
        fileManagement={fm}
        workspaceEpoch={7}
      />,
    );
    const transfer = dataTransfer();
    const file = screen.getByRole('button', { name: 'a.txt' });
    const target = screen.getByRole('button', { name: 'target' });
    fireEvent.dragStart(file, { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'a.txt' }).className).toContain('dragging');
    fireEvent.dragOver(screen.getByRole('button', { name: 'target' }), { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'target' }).className).toContain('drop-forbidden');
    fireEvent.drop(screen.getByRole('button', { name: 'target' }), { dataTransfer: transfer });
    expect(relocateByDrop).not.toHaveBeenCalled();

    const docs = screen.getByRole('button', { name: 'docs' });
    const nestedFile = screen.getByRole('button', { name: 'inside.txt' });
    fireEvent.dragStart(docs, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole('button', { name: 'docs' }), { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'docs' }).className).toContain('drop-forbidden');
    fireEvent.dragEnd(screen.getByRole('button', { name: 'docs' }), { dataTransfer: transfer });

    fireEvent.dragStart(nestedFile, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole('button', { name: 'docs' }), { dataTransfer: transfer });
    expect(screen.getByRole('button', { name: 'docs' }).className).toContain('drop-noop');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'docs' }).className).not.toContain('drop-noop');

    fireEvent.dragStart(docs, { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByRole('button', { name: 'target' }), { dataTransfer: transfer });
    view.rerender(
      <FileTree
        entries={entries}
        expandedDirs={new Set(['docs'])}
        fileManagement={fm}
        workspaceEpoch={8}
      />,
    );
    expect(target.className).not.toContain('drop-allowed');
  });
});
