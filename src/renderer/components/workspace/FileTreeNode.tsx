import { useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspace';

function kindLabel(kind: WorkspaceEntry['kind']): string {
  if (kind === 'directory') return 'D';
  if (kind === 'symbolic-link') return 'L';
  if (kind === 'other') return '·';
  return 'F';
}

const paddingStep = 16;

export function FileTreeNode({
  entry,
  depth,
}: {
  readonly entry: WorkspaceEntry;
  readonly depth: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const isDir = entry.kind === 'directory';
  const hasChildren = isDir && entry.children !== undefined && entry.children.length > 0;
  const indent = depth * paddingStep;

  const toggle = (): void => {
    if (isDir) {
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div className="ft-node" role="treeitem" aria-expanded={isDir ? expanded : undefined}>
      <div
        className={`ft-row ${isDir ? 'ft-row--dir' : ''} ${entry.error ? 'ft-row--error' : ''}`}
        style={{ paddingLeft: 14 + indent }}
        onClick={toggle}
      >
        {isDir && (
          <span className={`ft-arrow ${expanded ? 'ft-arrow--open' : ''}`} aria-hidden="true">
            &#9654;
          </span>
        )}
        <span className={`ft-kind ft-kind--${entry.kind}`}>{kindLabel(entry.kind)}</span>
        <span className="ft-name">{entry.name}</span>
        {entry.error ? <span className="ft-error-mark" title={entry.error.message} /> : null}
      </div>

      {hasChildren && expanded && (
        <div className="ft-children" role="group">
          {entry.children!.map((child) => (
            <FileTreeNode key={child.relativePath} entry={child} depth={depth + 1} />
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
