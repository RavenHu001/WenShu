import { FileTreeNode } from './FileTreeNode';
import type { WorkspaceEntry } from '../../../shared/workspace';

export function FileTree({
  entries,
}: {
  readonly entries: readonly WorkspaceEntry[];
}): React.JSX.Element {
  return (
    <div className="ft-tree" role="tree">
      {entries.map((entry) => (
        <FileTreeNode key={entry.relativePath} entry={entry} depth={0} />
      ))}
    </div>
  );
}
