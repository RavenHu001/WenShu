import { useCallback, useEffect, useState } from 'react';
import { FileTreeNode } from './FileTreeNode';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import type { WorkspaceEntry } from '../../../shared/workspace';
import type { FileManagementController } from '../../lib/use-file-management';
import {
  clampContextMenuPosition,
  evaluateFileTreeDrop,
  findWorkspaceEntry,
  type FileTreeContextTarget,
  type FileTreeDragSource,
  type FileTreeDropDecision,
} from '../../lib/file-tree-interactions';

interface OpenContextMenu {
  readonly target: FileTreeContextTarget;
  readonly position: { readonly x: number; readonly y: number };
  readonly trigger: HTMLElement | null;
}

export function FileTree({
  entries,
  onFileSelect,
  selectedRelativePath,
  managementSelectedPath,
  expandedDirs,
  onToggleDir,
  onSelectEntry,
  fileManagement,
  workspaceEpoch = 0,
  onRefresh,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly onFileSelect?: (relativePath: string) => void;
  readonly selectedRelativePath?: string | null;
  readonly managementSelectedPath?: string | null;
  readonly expandedDirs?: ReadonlySet<string>;
  readonly onToggleDir?: (relativePath: string) => void;
  readonly onSelectEntry?: (relativePath: string) => void;
  readonly fileManagement?: FileManagementController;
  readonly workspaceEpoch?: number;
  readonly onRefresh?: () => void;
}): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);
  const [dragSource, setDragSource] = useState<FileTreeDragSource | null>(null);
  const [dropDecision, setDropDecision] = useState<
    (FileTreeDropDecision & { readonly targetParentRelativePath?: string }) | null
  >(null);
  const [dropPending, setDropPending] = useState(false);
  const effectiveSelectEntry = onSelectEntry ?? fileManagement?.selectEntry;

  const clearDrag = useCallback((): void => {
    setDragSource(null);
    setDropDecision(null);
  }, []);

  useEffect(() => {
    setContextMenu(null);
    clearDrag();
    setDropPending(false);
  }, [clearDrag, workspaceEpoch]);

  useEffect(() => {
    if (
      contextMenu?.target.kind === 'entry' &&
      findWorkspaceEntry(entries, contextMenu.target.entry.relativePath) === null
    ) {
      setContextMenu(null);
    }
  }, [contextMenu, entries]);

  useEffect(() => {
    if (dragSource === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearDrag();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearDrag, dragSource]);

  const openContextMenu = useCallback(
    (target: FileTreeContextTarget, x: number, y: number, trigger: HTMLElement | null): void => {
      if (target.kind === 'root') effectiveSelectEntry?.('');
      else effectiveSelectEntry?.(target.entry.relativePath);
      setContextMenu({
        target,
        position: clampContextMenuPosition(x, y, window.innerWidth, window.innerHeight),
        trigger,
      });
    },
    [effectiveSelectEntry],
  );

  const decisionFor = useCallback(
    (targetParentRelativePath: string): FileTreeDropDecision => {
      if (dragSource === null) return { status: 'forbidden', reason: '没有应用内拖拽源' };
      return evaluateFileTreeDrop({
        source: dragSource,
        targetParentRelativePath,
        entries,
        currentWorkspaceEpoch: workspaceEpoch,
        saving: fileManagement?.isPathSaving(dragSource.relativePath) ?? false,
      });
    },
    [dragSource, entries, fileManagement, workspaceEpoch],
  );

  const handleDragOver = useCallback(
    (targetParentRelativePath: string, event: React.DragEvent<HTMLElement>): void => {
      if (dragSource === null || dropPending) return;
      event.preventDefault();
      const decision = decisionFor(targetParentRelativePath);
      event.dataTransfer.dropEffect = decision.status === 'allowed' ? 'move' : 'none';
      setDropDecision({ ...decision, targetParentRelativePath });
    },
    [decisionFor, dragSource, dropPending],
  );

  const handleDrop = useCallback(
    async (
      targetParentRelativePath: string,
      event: React.DragEvent<HTMLElement>,
    ): Promise<void> => {
      event.preventDefault();
      event.stopPropagation();
      if (dragSource === null || fileManagement === undefined || dropPending) return;
      const source = dragSource;
      const decision = decisionFor(targetParentRelativePath);
      clearDrag();
      if (decision.status !== 'allowed') return;
      setDropPending(true);
      try {
        await fileManagement.relocateByDrop(
          source.relativePath,
          decision.targetParentRelativePath,
          source.workspaceEpoch,
        );
      } finally {
        setDropPending(false);
      }
    },
    [clearDrag, decisionFor, dragSource, dropPending, fileManagement],
  );

  const contextTargetPath =
    contextMenu?.target.kind === 'entry' ? contextMenu.target.entry.relativePath : '';
  const contextSaving =
    contextTargetPath !== '' && fileManagement?.isPathSaving(contextTargetPath) === true;
  const rootDropStatus = dropDecision?.targetParentRelativePath === '' ? dropDecision.status : null;

  return (
    <>
      <div
        aria-busy={dropPending || undefined}
        aria-label="工作区文件树"
        className={`ft-tree${rootDropStatus === null ? '' : ` ft-root-drop--${rootDropStatus}`}`}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          openContextMenu({ kind: 'root' }, event.clientX, event.clientY, event.currentTarget);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropDecision(null);
        }}
        onDragOver={(event) => handleDragOver('', event)}
        onDrop={(event) => void handleDrop('', event)}
        onKeyDownCapture={(event) => {
          if (event.key === 'F5' && onRefresh !== undefined) {
            event.preventDefault();
            onRefresh();
          } else if (
            event.target === event.currentTarget &&
            ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openContextMenu({ kind: 'root' }, rect.left + 24, rect.top + 24, event.currentTarget);
          }
        }}
        role="tree"
        tabIndex={0}
      >
        {entries.length === 0 && (
          <div className="ft-empty-root">
            <span>此文件夹为空</span>
            <span> · 右键可新建</span>
          </div>
        )}
        {entries.map((entry) => (
          <FileTreeNode
            key={entry.relativePath}
            entry={entry}
            depth={0}
            dragSource={dragSource}
            dropDecision={dropDecision}
            dropPending={dropPending}
            onContextMenuRequest={openContextMenu}
            onDeleteRequest={(relativePath) => fileManagement?.beginDelete(relativePath)}
            onDragEnd={clearDrag}
            onDragOverDirectory={handleDragOver}
            onDragStart={(source, event) => {
              if (dropPending) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-wenshu-tree-entry', source.relativePath);
              event.dataTransfer.setData('text/plain', source.relativePath);
              event.dataTransfer.setDragImage(event.currentTarget, 14, 14);
              setDragSource(source);
            }}
            onDropDirectory={handleDrop}
            onRenameRequest={(relativePath) => fileManagement?.beginRename(relativePath)}
            workspaceEpoch={workspaceEpoch}
            {...(onFileSelect !== undefined ? { onFileSelect } : {})}
            {...(selectedRelativePath !== undefined ? { selectedRelativePath } : {})}
            {...(managementSelectedPath !== undefined ? { managementSelectedPath } : {})}
            {...(expandedDirs !== undefined ? { expandedDirs } : {})}
            {...(onToggleDir !== undefined ? { onToggleDir } : {})}
            {...(effectiveSelectEntry !== undefined ? { onSelectEntry: effectiveSelectEntry } : {})}
          />
        ))}
      </div>
      {contextMenu !== null && fileManagement !== undefined && (
        <FileTreeContextMenu
          busy={fileManagement.state.status === 'running'}
          onClose={() => setContextMenu(null)}
          onCreate={fileManagement.beginCreate}
          onMove={fileManagement.beginMove}
          onOpen={(relativePath) => onFileSelect?.(relativePath)}
          onRefresh={() => onRefresh?.()}
          onRename={fileManagement.beginRename}
          onReveal={
            contextMenu.target.kind === 'root'
              ? fileManagement.revealRoot
              : fileManagement.revealSelected
          }
          onTrash={fileManagement.beginDelete}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.trigger}
          saving={contextSaving}
          target={contextMenu.target}
        />
      )}
    </>
  );
}
