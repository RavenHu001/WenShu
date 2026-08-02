import { FileTreeNode } from './FileTreeNode';
import type { WorkspaceEntry } from '../../../shared/workspace';

export function FileTree({
  entries,
  onFileSelect,
  selectedRelativePath,
}: {
  readonly entries: readonly WorkspaceEntry[];
  /** 用户通过鼠标或键盘激活一个受支持的 TXT 文件时报告其相对路径。 */
  readonly onFileSelect?: (relativePath: string) => void;
  /** 当前选中的文件相对路径，用于可辨识的选中状态。 */
  readonly selectedRelativePath?: string | null;
}): React.JSX.Element {
  return (
    <div className="ft-tree" role="tree">
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.relativePath}
          entry={entry}
          depth={0}
          {...(onFileSelect !== undefined ? { onFileSelect } : {})}
          {...(selectedRelativePath !== undefined ? { selectedRelativePath } : {})}
        />
      ))}
    </div>
  );
}
