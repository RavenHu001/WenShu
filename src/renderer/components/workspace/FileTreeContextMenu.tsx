import { MenuSurface, type MenuCommand } from '../common/MenuSurface';
import type { FileTreeContextTarget } from '../../lib/file-tree-interactions';

function isOpenableName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.txt') || lower.endsWith('.docx');
}

export function FileTreeContextMenu({
  target,
  position,
  restoreFocusTo,
  busy,
  saving,
  onClose,
  onOpen,
  onCreate,
  onRename,
  onMove,
  onReveal,
  onTrash,
  onRefresh,
}: {
  readonly target: FileTreeContextTarget;
  readonly position: { readonly x: number; readonly y: number };
  readonly restoreFocusTo: HTMLElement | null;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onOpen: (relativePath: string) => void;
  readonly onCreate: (kind: 'text' | 'docx' | 'directory') => void;
  readonly onRename: () => void;
  readonly onMove: () => void;
  readonly onReveal: () => void;
  readonly onTrash: () => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  let label = '工作区菜单';
  let items: readonly MenuCommand[];
  if (target.kind === 'root') {
    items = [
      {
        id: 'new-text',
        label: '新建 TXT',
        icon: 'new-file',
        disabled: busy,
        onSelect: () => onCreate('text'),
      },
      {
        id: 'new-docx',
        label: '新建 DOCX',
        icon: 'new-file',
        disabled: busy,
        onSelect: () => onCreate('docx'),
      },
      {
        id: 'new-directory',
        label: '新建文件夹',
        icon: 'new-folder',
        disabled: busy,
        onSelect: () => onCreate('directory'),
      },
      {
        id: 'refresh',
        label: '刷新',
        icon: 'refresh',
        shortcut: 'F5',
        disabled: busy,
        separatorBefore: true,
        onSelect: onRefresh,
      },
      { id: 'reveal-root', label: '在资源管理器中显示工作区', icon: 'reveal', onSelect: onReveal },
    ];
  } else if (target.entry.kind === 'directory') {
    label = `${target.entry.name} 文件夹菜单`;
    items = [
      {
        id: 'new-text',
        label: '在此处新建 TXT',
        icon: 'new-file',
        disabled: busy,
        onSelect: () => onCreate('text'),
      },
      {
        id: 'new-docx',
        label: '在此处新建 DOCX',
        icon: 'new-file',
        disabled: busy,
        onSelect: () => onCreate('docx'),
      },
      {
        id: 'new-directory',
        label: '在此处新建文件夹',
        icon: 'new-folder',
        disabled: busy,
        onSelect: () => onCreate('directory'),
      },
      {
        id: 'rename',
        label: '重命名',
        icon: 'rename',
        shortcut: 'F2',
        disabled: busy || saving,
        separatorBefore: true,
        onSelect: onRename,
      },
      { id: 'move', label: '移动到…', icon: 'move', disabled: busy || saving, onSelect: onMove },
      { id: 'reveal', label: '在资源管理器中显示', icon: 'reveal', onSelect: onReveal },
      {
        id: 'trash',
        label: '删除到回收站',
        icon: 'trash',
        shortcut: 'Delete',
        danger: true,
        disabled: busy || saving,
        separatorBefore: true,
        onSelect: onTrash,
      },
    ];
  } else {
    label = `${target.entry.name} 文件菜单`;
    items = [
      {
        id: 'open',
        label: '打开或激活',
        icon: 'file',
        disabled: !isOpenableName(target.entry.name),
        onSelect: () => onOpen(target.entry.relativePath),
      },
      {
        id: 'rename',
        label: '重命名',
        icon: 'rename',
        shortcut: 'F2',
        disabled: busy || saving,
        separatorBefore: true,
        onSelect: onRename,
      },
      { id: 'move', label: '移动到…', icon: 'move', disabled: busy || saving, onSelect: onMove },
      { id: 'reveal', label: '在资源管理器中显示', icon: 'reveal', onSelect: onReveal },
      {
        id: 'trash',
        label: '删除到回收站',
        icon: 'trash',
        shortcut: 'Delete',
        danger: true,
        disabled: busy || saving,
        separatorBefore: true,
        onSelect: onTrash,
      },
    ];
  }

  return (
    <MenuSurface
      items={items}
      label={label}
      onClose={onClose}
      position={position}
      restoreFocusTo={restoreFocusTo}
    />
  );
}
