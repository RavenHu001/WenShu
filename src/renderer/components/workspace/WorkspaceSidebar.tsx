/**
 * 工作区文件侧栏 —— 纯展示组件（TASK-006 WP4）。
 *
 * 打开 / 刷新 / 错误状态由 `useWorkspace` controller 持有并注入，
 * 本组件只负责按状态渲染文件树与操作按钮，不再自行调用 IPC。
 * 切换活动栏时本组件保持挂载（App 用 hidden 切换），文件树展开状态不丢失。
 */

import { FileTree } from './FileTree';
import type { WorkspaceUiState } from '../../lib/use-workspace';

interface WorkspaceSidebarProps {
  /** 工作区可渲染状态（来自 useWorkspace）。 */
  readonly state: WorkspaceUiState;
  /** 打开文件夹入口（App 已执行未保存守卫）。 */
  readonly onOpenWorkspace: () => void | Promise<void>;
  /** 刷新当前工作区入口。 */
  readonly onRefreshWorkspace: () => void | Promise<void>;
  /** 用户选择工作区内的 TXT / DOCX 文件时报告其相对路径；由 App/文档容器处理读取。 */
  readonly onFileOpen: (relativePath: string) => void;
  /** 当前选中的文件相对路径，用于文件树的选中高亮。 */
  readonly selectedFilePath: string | null;
}

export function WorkspaceSidebar({
  state,
  onOpenWorkspace,
  onRefreshWorkspace,
  onFileOpen,
  selectedFilePath,
}: WorkspaceSidebarProps): React.JSX.Element {
  const busy = state.status === 'loading' || state.status === 'refreshing';
  const showIdle = state.status === 'idle';

  return (
    <>
      <div className="section-label">工作区</div>

      {showIdle && (
        <div className="ws-idle">
          <div className="folder-icon" aria-hidden="true" />
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

      {state.workspace &&
        (state.status === 'loading' ||
          state.status === 'loaded' ||
          state.status === 'refreshing' ||
          state.status === 'error') && (
          <>
            <div className="ws-info">
              <div className="ws-info-name">{state.workspace.rootName}</div>
              <div className="ws-info-path" title={state.workspace.rootPath}>
                {state.workspace.rootPath}
              </div>
              <div className="ws-info-actions">
                <button className="ws-btn" onClick={() => void onOpenWorkspace()} disabled={busy}>
                  打开文件夹
                </button>
                <button
                  className="ws-btn"
                  onClick={() => void onRefreshWorkspace()}
                  disabled={busy}
                >
                  {state.status === 'refreshing' ? '刷新中…' : '刷新'}
                </button>
              </div>
            </div>

            {state.status === 'refreshing' && <div className="ws-status">正在刷新…</div>}
            {state.status === 'loading' && <div className="ws-status">正在读取新工作区…</div>}

            {state.status === 'error' && (
              <div className="ws-error-banner">无法读取工作区：{state.error?.message}</div>
            )}

            {state.workspace.entries.length === 0 && state.status !== 'refreshing' && (
              <div className="ws-empty">此文件夹为空</div>
            )}

            {state.workspace.entries.length > 0 && (
              <FileTree
                entries={state.workspace.entries}
                onFileSelect={onFileOpen}
                selectedRelativePath={selectedFilePath}
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
    </>
  );
}
