import { useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspace';
import { Icon, type IconName } from '../common/Icon';
import type {
  FileTreeContextTarget,
  FileTreeDragSource,
  FileTreeDropDecision,
} from '../../lib/file-tree-interactions';

function entryIcon(entry: WorkspaceEntry, expanded: boolean): IconName {
  if (entry.kind === 'directory') return expanded ? 'folder-open' : 'folder';
  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.docx')) return 'docx';
  return 'file';
}

function isOpenableFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.txt') || lower.endsWith('.docx');
}

const paddingStep = 16;

export function FileTreeNode({
  entry,
  depth,
  onFileSelect,
  selectedRelativePath,
  managementSelectedPath,
  expandedDirs,
  onToggleDir,
  onSelectEntry,
  workspaceEpoch,
  dragSource,
  dropDecision,
  dropPending,
  onContextMenuRequest,
  onRenameRequest,
  onDeleteRequest,
  onDragStart,
  onDragOverDirectory,
  onDropDirectory,
  onDragEnd,
}: {
  readonly entry: WorkspaceEntry;
  readonly depth: number;
  readonly onFileSelect?: (relativePath: string) => void;
  readonly selectedRelativePath?: string | null;
  readonly managementSelectedPath?: string | null;
  readonly expandedDirs?: ReadonlySet<string>;
  readonly onToggleDir?: (relativePath: string) => void;
  readonly onSelectEntry?: (relativePath: string) => void;
  readonly workspaceEpoch: number;
  readonly dragSource: FileTreeDragSource | null;
  readonly dropDecision:
    (FileTreeDropDecision & { readonly targetParentRelativePath?: string }) | null;
  readonly dropPending: boolean;
  readonly onContextMenuRequest: (
    target: FileTreeContextTarget,
    x: number,
    y: number,
    trigger: HTMLElement | null,
  ) => void;
  readonly onRenameRequest: (relativePath: string) => void;
  readonly onDeleteRequest: (relativePath: string) => void;
  readonly onDragStart: (
    source: FileTreeDragSource,
    event: React.DragEvent<HTMLButtonElement>,
  ) => void;
  readonly onDragOverDirectory: (relativePath: string, event: React.DragEvent<HTMLElement>) => void;
  readonly onDropDirectory: (
    relativePath: string,
    event: React.DragEvent<HTMLElement>,
  ) => void | Promise<void>;
  readonly onDragEnd: () => void;
}): React.JSX.Element {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded =
    expandedDirs !== undefined ? expandedDirs.has(entry.relativePath) : localExpanded;
  const isDir = entry.kind === 'directory';
  const hasChildren = isDir && entry.children !== undefined && entry.children.length > 0;
  const isOpenableFile = entry.kind === 'file' && isOpenableFileName(entry.name);
  const isSelectable = entry.kind === 'file' || entry.kind === 'directory';
  const isInteractable = isOpenableFile || (isSelectable && onSelectEntry !== undefined);
  const isDocSelected = isOpenableFile && selectedRelativePath === entry.relativePath;
  const isManagedSelected = managementSelectedPath === entry.relativePath;
  const isDragging = dragSource?.relativePath === entry.relativePath;
  const directoryDropStatus =
    isDir && dropDecision?.targetParentRelativePath === entry.relativePath
      ? dropDecision.status
      : null;

  const selectManagement = (): void => onSelectEntry?.(entry.relativePath);
  const toggle = (): void => {
    if (onToggleDir !== undefined) onToggleDir(entry.relativePath);
    else setLocalExpanded((previous) => !previous);
    selectManagement();
  };
  const select = (): void => {
    onFileSelect?.(entry.relativePath);
    selectManagement();
  };

  const keyboard = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'F2') {
      event.preventDefault();
      selectManagement();
      onRenameRequest(entry.relativePath);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      selectManagement();
      onDeleteRequest(entry.relativePath);
    } else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      selectManagement();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenuRequest(
        { kind: 'entry', entry },
        rect.left + Math.min(28, rect.width),
        rect.top + Math.min(24, rect.height),
        event.currentTarget,
      );
    }
  };

  const rowContents = (
    <>
      {isDir && (
        <Icon className="ft-arrow" name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
      )}
      <span className={`ft-kind ft-kind--${entry.kind}`} aria-hidden="true">
        <Icon name={entryIcon(entry, expanded)} size={16} />
      </span>
      <span className="ft-name" title={entry.relativePath}>
        {entry.name}
      </span>
      {entry.error ? (
        <span className="ft-error-message" title={entry.error.message}>
          无法读取
        </span>
      ) : null}
    </>
  );

  const commonButtonProps = {
    draggable: isInteractable && !dropPending,
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      selectManagement();
      onContextMenuRequest(
        { kind: 'entry', entry },
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
    },
    onDragEnd,
    onDragStart: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!isInteractable) return;
      onDragStart(
        { relativePath: entry.relativePath, kind: isDir ? 'directory' : 'file', workspaceEpoch },
        event,
      );
    },
    onKeyDown: keyboard,
  };

  const rowClass = [
    'ft-row',
    isDir ? 'ft-row--dir' : isOpenableFile ? 'ft-row--file' : 'ft-row--selectable',
    entry.error ? 'ft-row--error' : '',
    isDocSelected ? 'ft-row--selected' : '',
    isManagedSelected ? 'ft-row--managed' : '',
    isDragging ? 'ft-row--dragging' : '',
    directoryDropStatus === null ? '' : `ft-row--drop-${directoryDropStatus}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      aria-current={isManagedSelected ? true : undefined}
      aria-expanded={isDir ? expanded : undefined}
      aria-selected={isDocSelected ? true : undefined}
      className="ft-node"
      role="treeitem"
    >
      {isDir ? (
        <button
          {...commonButtonProps}
          aria-expanded={expanded}
          aria-label={entry.name}
          className={rowClass}
          data-testid={`ft-${entry.relativePath}`}
          onClick={toggle}
          onDragOver={(event) => {
            event.stopPropagation();
            onDragOverDirectory(entry.relativePath, event);
          }}
          onDrop={(event) => void onDropDirectory(entry.relativePath, event)}
          style={{ paddingLeft: 10 + depth * paddingStep }}
          type="button"
        >
          {rowContents}
        </button>
      ) : isInteractable ? (
        <button
          {...commonButtonProps}
          aria-label={entry.name}
          className={rowClass}
          data-testid={`ft-${entry.relativePath}`}
          onClick={isOpenableFile ? select : selectManagement}
          style={{ paddingLeft: 10 + depth * paddingStep }}
          type="button"
        >
          {rowContents}
        </button>
      ) : (
        <div className="ft-row" style={{ paddingLeft: 10 + depth * paddingStep }}>
          {rowContents}
        </div>
      )}

      {hasChildren && expanded && (
        <div className="ft-children" role="group">
          {entry.children!.map((child) => (
            <FileTreeNode
              depth={depth + 1}
              dragSource={dragSource}
              dropDecision={dropDecision}
              dropPending={dropPending}
              entry={child}
              key={child.relativePath}
              onContextMenuRequest={onContextMenuRequest}
              onDeleteRequest={onDeleteRequest}
              onDragEnd={onDragEnd}
              onDragOverDirectory={onDragOverDirectory}
              onDragStart={onDragStart}
              onDropDirectory={onDropDirectory}
              onRenameRequest={onRenameRequest}
              workspaceEpoch={workspaceEpoch}
              {...(expandedDirs !== undefined ? { expandedDirs } : {})}
              {...(managementSelectedPath !== undefined ? { managementSelectedPath } : {})}
              {...(onFileSelect !== undefined ? { onFileSelect } : {})}
              {...(onSelectEntry !== undefined ? { onSelectEntry } : {})}
              {...(onToggleDir !== undefined ? { onToggleDir } : {})}
              {...(selectedRelativePath !== undefined ? { selectedRelativePath } : {})}
            />
          ))}
        </div>
      )}
      {isDir && entry.children?.length === 0 && expanded && (
        <div className="ft-empty-dir" style={{ paddingLeft: 10 + (depth + 1) * paddingStep }}>
          (空)
        </div>
      )}
    </div>
  );
}
