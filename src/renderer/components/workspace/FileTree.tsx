import { FileTreeNode } from './FileTreeNode';
import type { WorkspaceEntry } from '../../../shared/workspace';

export function FileTree({
  entries,
  onFileSelect,
  selectedRelativePath,
  managementSelectedPath,
  expandedDirs,
  onToggleDir,
  onSelectEntry,
}: {
  readonly entries: readonly WorkspaceEntry[];
  /** 用户通过鼠标或键盘激活一个受支持的 TXT 文件时报告其相对路径。 */
  readonly onFileSelect?: (relativePath: string) => void;
  /** 当前选中的文件相对路径（活动文档高亮），用于可辨识的选中状态。 */
  readonly selectedRelativePath?: string | null;
  /** 文件管理选择（与活动文档分离；普通文件/目录均可选中）。 */
  readonly managementSelectedPath?: string | null;
  /** 集中展开目录集合（受控模式；缺省为节点内部状态）。 */
  readonly expandedDirs?: ReadonlySet<string>;
  readonly onToggleDir?: (relativePath: string) => void;
  /** 单击选择任意普通条目（目录与普通文件）；TXT/DOCX 仍同时打开。 */
  readonly onSelectEntry?: (relativePath: string) => void;
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
          {...(managementSelectedPath !== undefined ? { managementSelectedPath } : {})}
          {...(expandedDirs !== undefined ? { expandedDirs } : {})}
          {...(onToggleDir !== undefined ? { onToggleDir } : {})}
          {...(onSelectEntry !== undefined ? { onSelectEntry } : {})}
        />
      ))}
    </div>
  );
}
