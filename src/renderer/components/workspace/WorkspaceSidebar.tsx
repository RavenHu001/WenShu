import { useRef, useState } from 'react';
import { FileTree } from './FileTree';
import type { WorkspaceUiState } from '../../lib/use-workspace';
import type { FileManagementController } from '../../lib/use-file-management';
import { Icon } from '../common/Icon';
import { IconButton } from '../common/IconButton';
import { MenuSurface, type MenuCommand } from '../common/MenuSurface';
import { SidebarResizeHandle } from '../shell/SidebarResizeHandle';

interface WorkspaceSidebarProps {
  readonly state: WorkspaceUiState;
  readonly onOpenWorkspace: () => void | Promise<void>;
  readonly onRefreshWorkspace: () => void | Promise<unknown>;
  readonly onFileOpen: (relativePath: string) => void;
  readonly selectedFilePath: string | null;
  readonly managementSelectedPath?: string | null;
  readonly expandedDirs?: ReadonlySet<string>;
  readonly onSelectEntry?: (relativePath: string) => void;
  readonly onToggleDir?: (relativePath: string) => void;
  readonly fileManagement?: FileManagementController;
  readonly workspaceEpoch?: number;
  readonly sidebarWidth?: number;
  readonly onSidebarWidthChange?: (width: number) => void;
  readonly onCollapse?: () => void;
}

export function WorkspaceSidebar({
  state,
  onOpenWorkspace,
  onRefreshWorkspace,
  onFileOpen,
  selectedFilePath,
  managementSelectedPath,
  expandedDirs,
  onSelectEntry,
  onToggleDir,
  fileManagement,
  workspaceEpoch = 0,
  sidebarWidth,
  onSidebarWidthChange,
  onCollapse,
}: WorkspaceSidebarProps): React.JSX.Element {
  const busy = state.status === 'loading' || state.status === 'refreshing';
  const showIdle = state.status === 'idle';
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newTriggerRef = useRef<HTMLButtonElement | null>(null);
  const newItems: readonly MenuCommand[] = [
    {
      id: 'text',
      label: '新建 TXT',
      icon: 'new-file',
      onSelect: () => fileManagement?.beginCreate('text'),
    },
    {
      id: 'docx',
      label: '新建 DOCX',
      icon: 'new-file',
      onSelect: () => fileManagement?.beginCreate('docx'),
    },
    {
      id: 'directory',
      label: '新建文件夹',
      icon: 'new-folder',
      onSelect: () => fileManagement?.beginCreate('directory'),
    },
  ];

  return (
    <>
      <div className="sidebar-heading">
        <span className="section-label">工作区</span>
        {onCollapse !== undefined && (
          <IconButton icon="collapse" label="折叠侧栏" onClick={onCollapse} size="compact" />
        )}
      </div>

      {showIdle && (
        <div className="ws-idle">
          <Icon name="folder" size={44} aria-hidden="true" />
          <p>尚未打开文件夹</p>
          <button
            className="ws-btn ws-btn-primary"
            onClick={() => void onOpenWorkspace()}
            disabled={busy}
          >
            打开文件夹
          </button>
        </div>
      )}

      {busy && !state.workspace && <div className="ws-status">正在读取工作区…</div>}

      {state.workspace !== null && (
        <>
          <div className="ws-info">
            <div className="ws-info-copy">
              <div className="ws-info-name" title={state.workspace.rootName}>
                {state.workspace.rootName}
              </div>
              <div className="ws-info-path" title={state.workspace.rootPath}>
                {state.workspace.rootPath}
              </div>
            </div>
            <div className="ws-info-actions">
              <button
                aria-label="打开文件夹"
                className="icon-button icon-button--compact"
                disabled={busy}
                onClick={() => void onOpenWorkspace()}
                title="打开文件夹"
                type="button"
              >
                <Icon name="folder-open" size={15} />
                <span className="sr-only">打开文件夹</span>
              </button>
              <button
                aria-label="刷新"
                className="icon-button icon-button--compact"
                disabled={busy}
                onClick={() => void onRefreshWorkspace()}
                title="刷新 (F5)"
                type="button"
              >
                <Icon name="refresh" size={15} />
                <span className="sr-only">刷新</span>
              </button>
              {fileManagement !== undefined && (
                <button
                  aria-expanded={newMenuOpen}
                  aria-haspopup="menu"
                  aria-label="新建"
                  className="icon-button icon-button--compact"
                  disabled={fileManagement.state.status === 'running'}
                  onClick={() => {
                    setNewMenuOpen((value) => !value);
                  }}
                  ref={newTriggerRef}
                  title="新建"
                  type="button"
                >
                  <Icon name="new-file" size={15} />
                </button>
              )}
            </div>
          </div>

          {state.status === 'refreshing' && <div className="ws-status">正在刷新…</div>}
          {state.status === 'loading' && <div className="ws-status">正在读取新工作区…</div>}
          {state.status === 'error' && (
            <div className="ws-error-banner" role="alert">
              无法读取工作区：{state.error?.message}
            </div>
          )}

          <FileTree
            entries={state.workspace.entries}
            onFileSelect={onFileOpen}
            onRefresh={() => void onRefreshWorkspace()}
            selectedRelativePath={selectedFilePath}
            workspaceEpoch={workspaceEpoch}
            {...(fileManagement !== undefined ? { fileManagement } : {})}
            {...(managementSelectedPath !== undefined ? { managementSelectedPath } : {})}
            {...(expandedDirs !== undefined ? { expandedDirs } : {})}
            {...(onToggleDir !== undefined ? { onToggleDir } : {})}
            {...(onSelectEntry !== undefined ? { onSelectEntry } : {})}
          />

          {newMenuOpen && newTriggerRef.current !== null && (
            <MenuSurface
              items={newItems}
              label="新建菜单"
              onClose={() => setNewMenuOpen(false)}
              position={{
                x: newTriggerRef.current.getBoundingClientRect().left,
                y: newTriggerRef.current.getBoundingClientRect().bottom + 2,
              }}
              restoreFocusTo={newTriggerRef.current}
            />
          )}
        </>
      )}

      {state.status === 'error' && !state.workspace && (
        <div className="ws-error-full">
          <p>无法打开工作区</p>
          <span>{state.error?.message}</span>
          <button
            className="ws-btn ws-btn-primary"
            onClick={() => void onOpenWorkspace()}
            disabled={busy}
          >
            重试
          </button>
        </div>
      )}

      {sidebarWidth !== undefined && onSidebarWidthChange !== undefined && (
        <SidebarResizeHandle width={sidebarWidth} onWidthChange={onSidebarWidthChange} />
      )}
    </>
  );
}
