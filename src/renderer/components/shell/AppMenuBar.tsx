import { useRef, useState } from 'react';
import { MenuSurface, type MenuCommand } from '../common/MenuSurface';

type MenuId = 'file' | 'edit' | 'view' | 'help';

export interface AppMenuActions {
  readonly openWorkspace: () => void;
  readonly createText: () => void;
  readonly createDocx: () => void;
  readonly createDirectory: () => void;
  readonly save: () => void;
  readonly saveAs: () => void;
  readonly closeTab: () => void;
  readonly find: () => void;
  readonly replace: () => void;
  readonly workspaceSearch: () => void;
  readonly toggleSidebar: () => void;
  readonly about: () => void;
}

export interface AppMenuCapabilities {
  readonly hasWorkspace: boolean;
  readonly hasActiveTab: boolean;
  readonly canSave: boolean;
  readonly canSaveAs: boolean;
  readonly sidebarCollapsed: boolean;
}

const menuLabels: Readonly<Record<MenuId, string>> = {
  file: '文件',
  edit: '编辑',
  view: '视图',
  help: '帮助',
};

function menuItems(
  id: MenuId,
  actions: AppMenuActions,
  capabilities: AppMenuCapabilities,
): readonly MenuCommand[] {
  switch (id) {
    case 'file':
      return [
        {
          id: 'open-workspace',
          label: '打开文件夹…',
          icon: 'folder-open',
          shortcut: 'Ctrl+O',
          onSelect: actions.openWorkspace,
        },
        {
          id: 'new-text',
          label: '新建 TXT…',
          icon: 'new-file',
          disabled: !capabilities.hasWorkspace,
          separatorBefore: true,
          onSelect: actions.createText,
        },
        {
          id: 'new-docx',
          label: '新建 DOCX…',
          icon: 'new-file',
          disabled: !capabilities.hasWorkspace,
          onSelect: actions.createDocx,
        },
        {
          id: 'new-directory',
          label: '新建文件夹…',
          icon: 'new-folder',
          disabled: !capabilities.hasWorkspace,
          onSelect: actions.createDirectory,
        },
        {
          id: 'save',
          label: '保存',
          icon: 'save',
          shortcut: 'Ctrl+S',
          disabled: !capabilities.canSave,
          separatorBefore: true,
          onSelect: actions.save,
        },
        {
          id: 'save-as',
          label: '另存为…',
          icon: 'save',
          shortcut: 'Ctrl+Shift+S',
          disabled: !capabilities.canSaveAs,
          onSelect: actions.saveAs,
        },
        {
          id: 'close-tab',
          label: '关闭标签',
          icon: 'close',
          shortcut: 'Ctrl+W',
          disabled: !capabilities.hasActiveTab,
          separatorBefore: true,
          onSelect: actions.closeTab,
        },
      ];
    case 'edit':
      return [
        {
          id: 'find',
          label: '在当前文档中查找',
          icon: 'search',
          shortcut: 'Ctrl+F',
          disabled: !capabilities.hasActiveTab,
          onSelect: actions.find,
        },
        {
          id: 'replace',
          label: '在当前文档中替换',
          icon: 'search',
          shortcut: 'Ctrl+H',
          disabled: !capabilities.hasActiveTab,
          onSelect: actions.replace,
        },
        {
          id: 'workspace-search',
          label: '搜索工作区',
          icon: 'search',
          shortcut: 'Ctrl+Shift+F',
          disabled: !capabilities.hasWorkspace,
          separatorBefore: true,
          onSelect: actions.workspaceSearch,
        },
      ];
    case 'view':
      return [
        {
          id: 'toggle-sidebar',
          label: capabilities.sidebarCollapsed ? '展开侧栏' : '折叠侧栏',
          icon: 'collapse',
          shortcut: 'Ctrl+B',
          onSelect: actions.toggleSidebar,
        },
      ];
    case 'help':
      return [{ id: 'about', label: '关于文枢', icon: 'info', onSelect: actions.about }];
  }
}

export function AppMenuBar({
  actions,
  capabilities,
}: {
  readonly actions: AppMenuActions;
  readonly capabilities: AppMenuCapabilities;
}): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const triggerRefs = useRef(new Map<MenuId, HTMLButtonElement>());
  const trigger = openMenu === null ? null : (triggerRefs.current.get(openMenu) ?? null);
  const position =
    trigger === null
      ? undefined
      : { x: trigger.getBoundingClientRect().left, y: trigger.getBoundingClientRect().bottom + 2 };
  const ids: readonly MenuId[] = ['file', 'edit', 'view', 'help'];

  return (
    <nav aria-label="应用菜单" className="app-menu-bar">
      {ids.map((id) => (
        <button
          aria-expanded={openMenu === id}
          aria-haspopup="menu"
          className={`app-menu-trigger${openMenu === id ? ' is-open' : ''}`}
          key={id}
          onClick={() => setOpenMenu((current) => (current === id ? null : id))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpenMenu(id);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              const index = ids.indexOf(id);
              const next =
                (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
              const nextId = ids[next]!;
              triggerRefs.current.get(nextId)?.focus();
              if (openMenu !== null) setOpenMenu(nextId);
            }
          }}
          ref={(element) => {
            if (element === null) triggerRefs.current.delete(id);
            else triggerRefs.current.set(id, element);
          }}
          type="button"
        >
          {menuLabels[id]}
        </button>
      ))}
      {openMenu !== null && trigger !== null && position !== undefined && (
        <MenuSurface
          className="app-menu-surface"
          items={menuItems(openMenu, actions, capabilities)}
          label={`${menuLabels[openMenu]}菜单`}
          onClose={() => setOpenMenu(null)}
          position={position}
          restoreFocusTo={trigger}
        />
      )}
    </nav>
  );
}
