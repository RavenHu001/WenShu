import { useCallback, useState } from 'react';
import { FileTree } from './FileTree';
import type { WorkspaceEntryError, WorkspaceSnapshot } from '../../../shared/workspace';

type Status = 'idle' | 'loading' | 'loaded' | 'error' | 'refreshing';

interface State {
  status: Status;
  workspace: WorkspaceSnapshot | null;
  error: WorkspaceEntryError | null;
}

interface WorkspaceSidebarProps {
  /** 用户选择工作区内的 TXT 文件时报告其相对路径；由 App/文档容器处理读取。 */
  readonly onTextFileOpen: (relativePath: string) => void;
  /** 当前选中的文件相对路径，用于文件树的选中高亮。 */
  readonly selectedTextFilePath: string | null;
  /** 工作区成功切换（新工作区扫描成功）时通知；用于清除旧文档并失效旧读取。 */
  readonly onWorkspaceSelected: () => void;
  /**
   * 打开文件夹前的守卫：返回 false 时中止打开（不弹出原生目录选择器）。
   * 用于有未保存修改时先完成"放弃/取消"确认；不传则直接打开。
   */
  readonly onOpenWorkspaceGuard?: () => boolean | Promise<boolean>;
}

function toWorkspaceEntryError(error: unknown): WorkspaceEntryError {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function WorkspaceSidebar({
  onTextFileOpen,
  selectedTextFilePath,
  onWorkspaceSelected,
  onOpenWorkspaceGuard,
}: WorkspaceSidebarProps): React.JSX.Element {
  const [state, setState] = useState<State>({
    status: 'idle',
    workspace: null,
    error: null,
  });

  const handleOpen = useCallback(async () => {
    // 未保存修改保护：守卫返回 false 时不得打开原生目录选择器
    if (onOpenWorkspaceGuard !== undefined && !(await onOpenWorkspaceGuard())) {
      return;
    }
    const prevWorkspace = state.workspace;
    setState({ status: 'loading', workspace: prevWorkspace, error: null });

    try {
      const result = await window.desktop.workspace.open();

      if (result.status === 'selected') {
        setState({ status: 'loaded', workspace: result.workspace, error: null });
        // 扫描成功才通知文档状态重置；取消或失败保持旧工作区和旧文档
        onWorkspaceSelected();
      } else if (result.status === 'cancelled') {
        setState({
          status: prevWorkspace ? 'loaded' : 'idle',
          workspace: prevWorkspace,
          error: null,
        });
      } else {
        setState({
          status: 'error',
          workspace: prevWorkspace,
          error: result.error,
        });
      }
    } catch (error) {
      setState({
        status: 'error',
        workspace: prevWorkspace,
        error: toWorkspaceEntryError(error),
      });
    }
  }, [state.workspace, onWorkspaceSelected, onOpenWorkspaceGuard]);

  const handleRefresh = useCallback(async () => {
    if (!state.workspace) {
      return;
    }
    setState((prev) => ({ ...prev, status: 'refreshing' as const }));

    try {
      const result = await window.desktop.workspace.refresh();

      if (result.status === 'refreshed') {
        setState({ status: 'loaded', workspace: result.workspace, error: null });
      } else if (result.status === 'error') {
        setState((prev) => ({
          status: 'error',
          workspace: prev.workspace,
          error: result.error,
        }));
      } else {
        setState((prev) => ({
          status: 'loaded',
          workspace: prev.workspace,
          error: null,
        }));
      }
    } catch (error) {
      setState((prev) => ({
        status: 'error',
        workspace: prev.workspace,
        error: toWorkspaceEntryError(error),
      }));
    }
  }, [state.workspace]);

  const busy = state.status === 'loading' || state.status === 'refreshing';
  const showIdle = state.status === 'idle';

  return (
    <aside className="sidebar">
      <div className="section-label">工作区</div>

      {showIdle && (
        <div className="ws-idle">
          <div className="folder-icon" aria-hidden="true" />
          <p>尚未打开文件夹</p>
          <button
            className="ws-btn ws-btn-primary"
            onClick={() => void handleOpen()}
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
                <button className="ws-btn" onClick={() => void handleOpen()} disabled={busy}>
                  打开文件夹
                </button>
                <button className="ws-btn" onClick={() => void handleRefresh()} disabled={busy}>
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
                onFileSelect={onTextFileOpen}
                selectedRelativePath={selectedTextFilePath}
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
            onClick={() => void handleOpen()}
            disabled={busy}
          >
            重试
          </button>
        </div>
      )}
    </aside>
  );
}
