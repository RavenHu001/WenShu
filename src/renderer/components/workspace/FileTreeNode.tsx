import { useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspace';

function kindLabel(kind: WorkspaceEntry['kind']): string {
  if (kind === 'directory') return 'D';
  if (kind === 'symbolic-link') return 'L';
  if (kind === 'other') return '·';
  return 'F';
}

/**
 * 扩展名判断只决定界面交互（是否渲染为可激活按钮），
 * 不替代主进程的完整类型、路径与内容校验。
 * 只接受普通 `.txt` 与 `.docx`（大小写不敏感），不接受 `.docm`、`.dotm`、`.rtf`
 * 或伪装扩展名（第 4.5 节）。
 */
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
}: {
  readonly entry: WorkspaceEntry;
  readonly depth: number;
  /** 用户通过鼠标或键盘激活一个受支持的 TXT 文件时报告其相对路径。 */
  readonly onFileSelect?: (relativePath: string) => void;
  /** 当前选中的文件相对路径（活动文档高亮），用于可辨识的选中状态。 */
  readonly selectedRelativePath?: string | null;
  /** 文件管理选择（与活动文档分离；普通条目均可选中）。 */
  readonly managementSelectedPath?: string | null;
  /** 集中展开集合（受控模式）；缺省为节点内部状态。 */
  readonly expandedDirs?: ReadonlySet<string>;
  readonly onToggleDir?: (relativePath: string) => void;
  readonly onSelectEntry?: (relativePath: string) => void;
}): React.JSX.Element {
  const [localExpanded, setLocalExpanded] = useState(false);
  // 受控模式（集中展开状态）下由外部集合决定；非受控模式保持既有内部状态行为。
  const expanded =
    expandedDirs !== undefined ? expandedDirs.has(entry.relativePath) : localExpanded;

  const isDir = entry.kind === 'directory';
  const hasChildren = isDir && entry.children !== undefined && entry.children.length > 0;
  const indent = depth * paddingStep;

  // 只有普通 .txt / .docx 文件可作为打开目标；目录、符号链接、其他类型节点不触发正文读取。
  const isOpenableFile = entry.kind === 'file' && isOpenableFileName(entry.name);
  // 管理选择：任意普通文件/目录都可选中（符号链接与其他类型不可选中）。
  const isSelectable = entry.kind === 'file' || entry.kind === 'directory';
  // 文档高亮（既有语义：活动文档路径）与管理选择分离：
  // aria-selected 保持文档高亮（既有测试/无障碍语义），管理选择用 aria-current + 独立类。
  const isDocSelected = isOpenableFile && selectedRelativePath === entry.relativePath;
  const isManagedSelected =
    managementSelectedPath !== undefined && managementSelectedPath === entry.relativePath;

  const toggle = (): void => {
    if (onToggleDir !== undefined) {
      onToggleDir(entry.relativePath);
    } else {
      setLocalExpanded((prev) => !prev);
    }
    onSelectEntry?.(entry.relativePath);
  };

  const select = (): void => {
    onFileSelect?.(entry.relativePath);
    onSelectEntry?.(entry.relativePath);
  };

  const rowContents = (
    <>
      {isDir && (
        <span className={`ft-arrow ${expanded ? 'ft-arrow--open' : ''}`} aria-hidden="true">
          &#9654;
        </span>
      )}
      <span className={`ft-kind ft-kind--${entry.kind}`}>{kindLabel(entry.kind)}</span>
      <span className="ft-name">{entry.name}</span>
      {entry.error ? (
        <span className="ft-error-message" title={entry.error.message}>
          无法读取
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className="ft-node"
      role="treeitem"
      aria-expanded={isDir ? expanded : undefined}
      aria-selected={isDocSelected ? true : undefined}
      aria-current={isManagedSelected ? true : undefined}
    >
      {isDir ? (
        <button
          type="button"
          className={`ft-row ft-row--dir ${entry.error ? 'ft-row--error' : ''} ${isManagedSelected ? 'ft-row--managed' : ''}`}
          style={{ paddingLeft: 14 + indent }}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={entry.name}
          data-testid={`ft-${entry.relativePath}`}
        >
          {rowContents}
        </button>
      ) : isOpenableFile ? (
        <button
          type="button"
          className={`ft-row ft-row--file ${isDocSelected ? 'ft-row--selected' : ''} ${isManagedSelected ? 'ft-row--managed' : ''}`}
          style={{ paddingLeft: 14 + indent }}
          onClick={select}
          aria-label={entry.name}
          data-testid={`ft-${entry.relativePath}`}
        >
          {rowContents}
        </button>
      ) : isSelectable && onSelectEntry !== undefined ? (
        <button
          type="button"
          className={`ft-row ft-row--selectable ${isDocSelected ? 'ft-row--selected' : ''} ${isManagedSelected ? 'ft-row--managed' : ''}`}
          style={{ paddingLeft: 14 + indent }}
          onClick={() => onSelectEntry(entry.relativePath)}
          aria-label={entry.name}
          data-testid={`ft-${entry.relativePath}`}
        >
          {rowContents}
        </button>
      ) : (
        <div className="ft-row" style={{ paddingLeft: 14 + indent }}>
          {rowContents}
        </div>
      )}

      {hasChildren && expanded && (
        <div className="ft-children" role="group">
          {entry.children!.map((child) => (
            <FileTreeNode
              key={child.relativePath}
              entry={child}
              depth={depth + 1}
              {...(onFileSelect !== undefined ? { onFileSelect } : {})}
              {...(selectedRelativePath !== undefined ? { selectedRelativePath } : {})}
              {...(managementSelectedPath !== undefined ? { managementSelectedPath } : {})}
              {...(expandedDirs !== undefined ? { expandedDirs } : {})}
              {...(onToggleDir !== undefined ? { onToggleDir } : {})}
              {...(onSelectEntry !== undefined ? { onSelectEntry } : {})}
            />
          ))}
        </div>
      )}

      {isDir && entry.children !== undefined && entry.children.length === 0 && expanded && (
        <div className="ft-empty-dir" style={{ paddingLeft: 14 + indent + paddingStep }}>
          (空)
        </div>
      )}
    </div>
  );
}
