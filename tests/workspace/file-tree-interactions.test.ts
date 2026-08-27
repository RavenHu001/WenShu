import { describe, expect, it } from 'vitest';
import {
  clampContextMenuPosition,
  evaluateFileTreeDrop,
  type FileTreeDragSource,
} from '../../src/renderer/lib/file-tree-interactions';
import {
  clampSidebarWidth,
  keyboardSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../../src/renderer/lib/sidebar-size';
import type { WorkspaceEntry } from '../../src/shared/workspace';

const entries: readonly WorkspaceEntry[] = [
  { name: 'a.txt', relativePath: 'a.txt', kind: 'file' },
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

function source(relativePath: string, kind: 'file' | 'directory' = 'file'): FileTreeDragSource {
  return { relativePath, kind, workspaceEpoch: 4 };
}

function decide(
  dragSource: FileTreeDragSource,
  targetParentRelativePath: string,
  overrides: {
    currentWorkspaceEpoch?: number;
    saving?: boolean;
    tree?: readonly WorkspaceEntry[];
  } = {},
) {
  return evaluateFileTreeDrop({
    source: dragSource,
    targetParentRelativePath,
    entries: overrides.tree ?? entries,
    currentWorkspaceEpoch: overrides.currentWorkspaceEpoch ?? 4,
    saving: overrides.saving ?? false,
  });
}

describe('evaluateFileTreeDrop', () => {
  it('allows a file or directory to another ordinary directory and to root', () => {
    expect(decide(source('a.txt'), 'target')).toEqual({
      status: 'allowed',
      targetParentRelativePath: 'target',
    });
    expect(decide(source('docs/nested', 'directory'), '')).toEqual({
      status: 'allowed',
      targetParentRelativePath: '',
    });
  });

  it('treats the current parent as a no-op', () => {
    expect(decide(source('docs/inside.txt'), 'docs').status).toBe('noop');
  });

  it('rejects a directory dropped onto itself or descendants with segment boundaries', () => {
    expect(decide(source('docs', 'directory'), 'docs').status).toBe('forbidden');
    expect(decide(source('docs', 'directory'), 'docs/nested').status).toBe('forbidden');
    const siblingTree: readonly WorkspaceEntry[] = [
      ...entries,
      { name: 'docs2', relativePath: 'docs2', kind: 'directory', children: [] },
    ];
    expect(decide(source('docs', 'directory'), 'docs2', { tree: siblingTree }).status).toBe(
      'allowed',
    );
  });

  it('rejects same-name, saving, stale workspace, missing source and illegal target', () => {
    const withConflict: readonly WorkspaceEntry[] = entries.map((entry) =>
      entry.relativePath === 'target'
        ? {
            ...entry,
            children: [{ name: 'A.TXT', relativePath: 'target/A.TXT', kind: 'file' }],
          }
        : entry,
    );
    expect(decide(source('a.txt'), 'target', { tree: withConflict }).status).toBe('forbidden');
    expect(decide(source('a.txt'), 'target', { saving: true }).status).toBe('forbidden');
    expect(decide(source('a.txt'), 'target', { currentWorkspaceEpoch: 5 }).status).toBe(
      'forbidden',
    );
    expect(decide(source('missing.txt'), 'target').status).toBe('forbidden');
    expect(decide(source('a.txt'), 'a.txt').status).toBe('forbidden');
  });
});

describe('sidebar and context-menu geometry', () => {
  it('clamps pointer and keyboard widths to 180–420', () => {
    expect(clampSidebarWidth(20)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(keyboardSidebarWidth(SIDEBAR_MIN_WIDTH, 'ArrowLeft')).toBe(SIDEBAR_MIN_WIDTH);
    expect(keyboardSidebarWidth(SIDEBAR_MAX_WIDTH, 'ArrowRight')).toBe(SIDEBAR_MAX_WIDTH);
    expect(keyboardSidebarWidth(250, 'Home')).toBe(SIDEBAR_MIN_WIDTH);
    expect(keyboardSidebarWidth(250, 'End')).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('keeps context menus inside the visible viewport', () => {
    expect(clampContextMenuPosition(890, 590, 900, 600)).toEqual({ x: 628, y: 262 });
    expect(clampContextMenuPosition(-20, -10, 900, 600)).toEqual({ x: 8, y: 8 });
  });
});
