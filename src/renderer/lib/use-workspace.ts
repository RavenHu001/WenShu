/**
 * 工作区共享 controller —— TASK-006 WP4（任务第 4.10 节与 WP0 冻结项 11）。
 *
 * 把工作区打开 / 刷新 / 错误状态从 `WorkspaceSidebar` 的展示职责中分离，由 `App` 持有：
 * 文件侧栏与搜索侧栏共享同一工作区快照与打开 / 刷新状态；切换活动栏不丢失工作区或文件树。
 *
 * ## 语义保持（Task 2 / Task 5）
 *
 * - 打开失败或取消时保留原工作区（与原 `WorkspaceSidebar` 行为一致）；
 * - 刷新只操作已保存的当前工作区；刷新失败保留原快照并展示可恢复错误；
 * - 工作区成功切换时递增 `epoch` 并调用 `onWorkspaceSelected`：
 *   同一 epoch 同时供文档失效（App 清空标签）与搜索结果校验（use-workspace-search）使用，
 *   不重复计数（WP0 冻结项 11）；
 * - `mutationEpoch`（TASK-009 §4.11 / WP0 冻结）：磁盘文件管理操作（create/save-as/relocate/
 *   trash）确认成功后由调用方通过 `notifyMutationCommitted` 递增；变化时取消活动搜索、
 *   清空结果与定位。失败、用户取消、reveal 与工作区切换不递增（切换由 `epoch` 覆盖）。
 *
 * ## 边界
 *
 * - 不持有工作区根路径以外的文件系统信息；不新增 IPC 能力，复用
 *   `workspace.open()` / `workspace.refresh()` 固定窄协议；
 * - 未保存修改守卫由 App 在调用 `openWorkspace` 前执行（本模块不感知 dirty / saving）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEntryError, WorkspaceSnapshot } from '../../shared/workspace';

export type WorkspaceStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'refreshing';

/** 工作区可渲染状态（与原 WorkspaceSidebar 内部状态同构）。 */
export interface WorkspaceUiState {
  readonly status: WorkspaceStatus;
  readonly workspace: WorkspaceSnapshot | null;
  readonly error: WorkspaceEntryError | null;
}

export interface WorkspaceController {
  readonly state: WorkspaceUiState;
  /** 工作区会话编号：成功切换时 +1；供文档与搜索共享校验（WP0 冻结项 11）。 */
  readonly epoch: number;
  /**
   * 文件管理变更版本（TASK-009 §4.11）：create/save-as/relocate/trash 确认成功后 +1；
   * 失败、取消、reveal 与手工刷新（成功与否见返回值）不递增，由调用方显式通知。
   */
  readonly mutationEpoch: number;
  /** 磁盘文件管理操作确认成功后调用：递增 mutationEpoch（§4.11）。 */
  readonly notifyMutationCommitted: () => void;
  /** 打开文件夹：取消 / 失败保留原工作区；成功切换时递增 epoch。 */
  readonly openWorkspace: () => Promise<void>;
  /**
   * 刷新当前工作区：未打开或无变更时安全无操作；返回是否成功替换了工作区快照。
   * 文件管理成功后的对账刷新使用 `background`，保留 loaded 布局，避免短暂状态行引发布局跳动。
   */
  readonly refreshWorkspace: (options?: RefreshWorkspaceOptions) => Promise<boolean>;
}

export interface RefreshWorkspaceOptions {
  /** true 时不切换到 refreshing 展示态；磁盘扫描和快照替换语义不变。 */
  readonly background?: boolean;
}

export interface UseWorkspaceOptions {
  /** 工作区成功切换后调用（App 用它清空旧标签并使旧文档结果失效）。 */
  readonly onWorkspaceSelected?: () => void;
}

function toWorkspaceEntryError(error: unknown): WorkspaceEntryError {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function useWorkspace(options: UseWorkspaceOptions = {}): WorkspaceController {
  const [state, setState] = useState<WorkspaceUiState>({
    status: 'idle',
    workspace: null,
    error: null,
  });
  const [epoch, setEpoch] = useState(0);
  const [mutationEpoch, setMutationEpoch] = useState(0);
  const stateRef = useRef(state);
  const onWorkspaceSelectedRef = useRef(options.onWorkspaceSelected);
  /** 打开请求代次：切换工作区后，旧根目录的迟到刷新不得覆盖新快照。 */
  const workspaceGenerationRef = useRef(0);
  /** 同一窗口只允许一个刷新在途；手动刷新与后台对账共享结果，避免重复扫描与重复绘制。 */
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    onWorkspaceSelectedRef.current = options.onWorkspaceSelected;
  });

  /** 磁盘文件管理操作确认成功后调用：只递增 mutationEpoch（§4.11），不影响 epoch。 */
  const notifyMutationCommitted = useCallback(() => {
    setMutationEpoch((current) => current + 1);
  }, []);

  const openWorkspace = useCallback(async () => {
    const generation = ++workspaceGenerationRef.current;
    // 打开新工作区使旧根目录刷新失去单飞所有权；旧结果仍会完成，但会被 generation 丢弃。
    refreshInFlightRef.current = null;
    const prevWorkspace = stateRef.current.workspace;
    setState({ status: 'loading', workspace: prevWorkspace, error: null });

    try {
      const result = await window.desktop.workspace.open();
      if (generation !== workspaceGenerationRef.current) {
        return;
      }

      if (result.status === 'selected') {
        setState({ status: 'loaded', workspace: result.workspace, error: null });
        // 扫描成功才递增 epoch 并通知文档失效；取消或失败保持原工作区与旧搜索状态
        setEpoch((current) => current + 1);
        onWorkspaceSelectedRef.current?.();
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
      if (generation !== workspaceGenerationRef.current) {
        return;
      }
      setState({
        status: 'error',
        workspace: prevWorkspace,
        error: toWorkspaceEntryError(error),
      });
    }
  }, []);

  const refreshWorkspace = useCallback(
    (refreshOptions: RefreshWorkspaceOptions = {}): Promise<boolean> => {
      if (!stateRef.current.workspace) {
        return Promise.resolve(false);
      }
      const existing = refreshInFlightRef.current;
      if (existing !== null) {
        return existing;
      }
      const generation = workspaceGenerationRef.current;

      // 通过微任务启动，使 ref 先绑定 operation；即使 preload 同步抛错，finally 也能可靠清理。
      const operation = Promise.resolve().then(async (): Promise<boolean> => {
        if (refreshOptions.background !== true) {
          setState((prev) => ({ ...prev, status: 'refreshing' }));
        }

        try {
          const result = await window.desktop.workspace.refresh();
          if (generation !== workspaceGenerationRef.current) {
            return false;
          }

          if (result.status === 'refreshed') {
            setState({ status: 'loaded', workspace: result.workspace, error: null });
            return true;
          } else if (result.status === 'error') {
            setState((prev) => ({
              status: 'error',
              workspace: prev.workspace,
              error: result.error,
            }));
            return false;
          } else {
            setState((prev) => ({
              status: 'loaded',
              workspace: prev.workspace,
              error: null,
            }));
            return true;
          }
        } catch (error) {
          if (generation !== workspaceGenerationRef.current) {
            return false;
          }
          setState((prev) => ({
            status: 'error',
            workspace: prev.workspace,
            error: toWorkspaceEntryError(error),
          }));
          return false;
        } finally {
          if (refreshInFlightRef.current === operation) {
            refreshInFlightRef.current = null;
          }
        }
      });
      refreshInFlightRef.current = operation;
      return operation;
    },
    [],
  );

  return { state, epoch, mutationEpoch, notifyMutationCommitted, openWorkspace, refreshWorkspace };
}
