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
 */
function isTxtFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.txt');
}

const paddingStep = 16;

export function FileTreeNode({
  entry,
  depth,
  onFileSelect,
  selectedRelativePath,
}: {
  readonly entry: WorkspaceEntry;
  readonly depth: number;
  /** 用户通过鼠标或键盘激活一个受支持的 TXT 文件时报告其相对路径。 */
  readonly onFileSelect?: (relativePath: string) => void;
  /** 当前选中的文件相对路径，用于可辨识的选中状态。 */
  readonly selectedRelativePath?: string | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const isDir = entry.kind === 'directory';
  const hasChildren = isDir && entry.children !== undefined && entry.children.length > 0;
  const indent = depth * paddingStep;

  // 只有普通 .txt 文件可作为选择目标；目录、符号链接、其他类型节点不触发正文读取。
  const isSelectableTxt = entry.kind === 'file' && isTxtFileName(entry.name);
  const isSelected = isSelectableTxt && selectedRelativePath === entry.relativePath;

  const toggle = (): void => {
    setExpanded((prev) => !prev);
  };

  const select = (): void => {
    onFileSelect?.(entry.relativePath);
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
      aria-selected={isSelected ? true : undefined}
    >
      {isDir ? (
        <button
          type="button"
          className={`ft-row ft-row--dir ${entry.error ? 'ft-row--error' : ''}`}
          style={{ paddingLeft: 14 + indent }}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={entry.name}
        >
          {rowContents}
        </button>
      ) : isSelectableTxt ? (
        <button
          type="button"
          className={`ft-row ft-row--file ${isSelected ? 'ft-row--selected' : ''}`}
          style={{ paddingLeft: 14 + indent }}
          onClick={select}
          aria-label={entry.name}
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
