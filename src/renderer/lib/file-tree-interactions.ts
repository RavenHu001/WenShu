import { isSameOrDescendantPath } from '../../shared/file-management';
import type { WorkspaceEntry } from '../../shared/workspace';

export type FileTreeContextTarget =
  { readonly kind: 'root' } | { readonly kind: 'entry'; readonly entry: WorkspaceEntry };

export interface FileTreeDragSource {
  readonly relativePath: string;
  readonly kind: 'file' | 'directory';
  readonly workspaceEpoch: number;
}

export type FileTreeDropDecision =
  | { readonly status: 'allowed'; readonly targetParentRelativePath: string }
  | { readonly status: 'noop'; readonly reason: string }
  | { readonly status: 'forbidden'; readonly reason: string };

export function parentRelativePath(relativePath: string): string {
  const lastSeparator = relativePath.lastIndexOf('/');
  return lastSeparator === -1 ? '' : relativePath.slice(0, lastSeparator);
}

export function basename(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath;
}

export function findWorkspaceEntry(
  entries: readonly WorkspaceEntry[],
  relativePath: string,
): WorkspaceEntry | null {
  for (const entry of entries) {
    if (entry.relativePath === relativePath) return entry;
    if (entry.children !== undefined) {
      const child = findWorkspaceEntry(entry.children, relativePath);
      if (child !== null) return child;
    }
  }
  return null;
}

function directoryChildren(
  entries: readonly WorkspaceEntry[],
  targetParentRelativePath: string,
): readonly WorkspaceEntry[] | null {
  if (targetParentRelativePath === '') return entries;
  const target = findWorkspaceEntry(entries, targetParentRelativePath);
  return target?.kind === 'directory' ? (target.children ?? []) : null;
}

export function evaluateFileTreeDrop({
  source,
  targetParentRelativePath,
  entries,
  currentWorkspaceEpoch,
  saving,
}: {
  readonly source: FileTreeDragSource;
  readonly targetParentRelativePath: string;
  readonly entries: readonly WorkspaceEntry[];
  readonly currentWorkspaceEpoch: number;
  readonly saving: boolean;
}): FileTreeDropDecision {
  if (source.workspaceEpoch !== currentWorkspaceEpoch) {
    return { status: 'forbidden', reason: '工作区已变化' };
  }
  if (saving) {
    return { status: 'forbidden', reason: '条目正在保存' };
  }
  const currentSource = findWorkspaceEntry(entries, source.relativePath);
  if (currentSource === null || currentSource.kind !== source.kind) {
    return { status: 'forbidden', reason: '源条目已变化' };
  }
  const children = directoryChildren(entries, targetParentRelativePath);
  if (children === null) {
    return { status: 'forbidden', reason: '投放目标不是普通目录' };
  }
  if (parentRelativePath(source.relativePath) === targetParentRelativePath) {
    return { status: 'noop', reason: '条目已在此目录中' };
  }
  if (
    source.kind === 'directory' &&
    isSameOrDescendantPath(source.relativePath, targetParentRelativePath)
  ) {
    return { status: 'forbidden', reason: '目录不能移动到自身或后代' };
  }
  const sourceName = basename(source.relativePath).toLocaleLowerCase('en-US');
  if (children.some((entry) => entry.name.toLocaleLowerCase('en-US') === sourceName)) {
    return { status: 'forbidden', reason: '目标目录中存在同名条目' };
  }
  return { status: 'allowed', targetParentRelativePath };
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { readonly x: number; readonly y: number } {
  const estimatedWidth = 264;
  const estimatedHeight = 330;
  return {
    x: Math.max(8, Math.min(x, viewportWidth - estimatedWidth - 8)),
    y: Math.max(8, Math.min(y, viewportHeight - estimatedHeight - 8)),
  };
}
