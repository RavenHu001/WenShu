/**
 * 工作区搜索 controller —— TASK-006 WP3（任务第 5.1 / 5.2 / 5.3 节与 WP0 冻结项 7/11）。
 *
 * ## 职责
 *
 * - 为每次搜索分配单调递增的 `requestId`，提交固定形状请求，不做其他状态假设；
 * - 结果文件分组携带 `kind`（`txt` / `docx`，主进程受控候选分类产生），controller
 *   只透传展示，不从文案猜测类型（TASK-008 第 4.6 节）；
 * - 同一时刻最多一个活动搜索：新搜索先取消旧搜索；主动取消立即作废在途请求；
 * - 结果提交前必须同时满足（第 5.3 节）：组件仍挂载、工作区 epoch 未变化、
 *   requestId 仍是当前活动请求、请求未被取消；
 * - 工作区 epoch 由外部（App）在成功切换时提供；epoch 变化时作废旧请求并清空旧结果；
 * - 不持有工作区根路径或绝对路径；无工作区时 submit 不发起 IPC。
 *
 * ## 状态不变量（第 5.2 节）
 *
 * 1. `searching` 状态必须存在唯一活动 `requestId`；非 searching 状态不得保留活动任务句柄；
 * 2. 只有 requestId 与工作区 epoch 同时匹配的结果可以提交；
 * 3. 取消、工作区成功切换或卸载后，旧结果不得恢复 searching 或覆盖新结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  validateWorkspaceTextSearchRequest,
  type WorkspaceTextSearchError,
  type WorkspaceTextSearchResult,
} from '../../shared/search';

/** 搜索状态机（任务第 5.1 节建议形状）。 */
export type WorkspaceSearchStatus = 'idle' | 'searching' | 'completed' | 'cancelled' | 'error';

/** 可渲染的搜索状态。 */
export interface WorkspaceSearchState {
  readonly status: WorkspaceSearchStatus;
  /** 已提交查询（结果标题以此为准，与输入框草稿分离）。 */
  readonly submittedQuery: string;
  /** 已提交的大小写选项。 */
  readonly caseSensitive: boolean;
  /** 当前活动请求编号；仅 `searching` 状态非 null（不变量 1）。 */
  readonly requestId: number | null;
  /** `completed` 时的完整结果（文件分组与统计）。 */
  readonly result: WorkspaceTextSearchResult | null;
  /** `error` 时的稳定错误。 */
  readonly error: WorkspaceTextSearchError | null;
}

export interface WorkspaceSearchController {
  readonly state: WorkspaceSearchState;
  /** 提交一次搜索：无工作区或非法查询时安全无操作；新请求先取消旧请求。 */
  readonly submitSearch: (query: string, caseSensitive: boolean) => void;
  /** 主动取消当前搜索：立即作废在途请求并进入 `cancelled`。 */
  readonly cancelSearch: () => void;
}

export interface UseWorkspaceSearchParams {
  /** 是否已打开工作区；false 时搜索入口不可用且不发起 IPC。 */
  readonly workspaceAvailable: boolean;
  /** 工作区 epoch：成功切换时递增；结果提交前必须与发起时一致。 */
  readonly workspaceEpoch: number;
}

function createIdleState(): WorkspaceSearchState {
  return {
    status: 'idle',
    submittedQuery: '',
    caseSensitive: false,
    requestId: null,
    result: null,
    error: null,
  };
}

export function useWorkspaceSearch({
  workspaceAvailable,
  workspaceEpoch,
}: UseWorkspaceSearchParams): WorkspaceSearchController {
  const [state, setState] = useState<WorkspaceSearchState>(createIdleState);
  const mountedRef = useRef(true);
  const workspaceAvailableRef = useRef(workspaceAvailable);
  /** 发起搜索时捕获的 epoch；提交结果前必须仍等于当前 epoch。 */
  const epochRef = useRef(workspaceEpoch);
  const previousEpochRef = useRef(workspaceEpoch);
  /** 当前活动请求编号；null 表示没有可提交结果的在途搜索。 */
  const activeRequestIdRef = useRef<number | null>(null);
  /** 请求编号：单调递增，不使用查询字符串作为身份。 */
  const requestCounterRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = activeRequestIdRef.current;
      if (current !== null) {
        activeRequestIdRef.current = null;
        void window.desktop.search.cancelTextWorkspace({ requestId: current });
      }
    };
  }, []);

  useEffect(() => {
    workspaceAvailableRef.current = workspaceAvailable;
  }, [workspaceAvailable]);

  // 工作区 epoch 变化（成功切换）：同步引用、作废在途请求并清空旧结果
  useEffect(() => {
    epochRef.current = workspaceEpoch;
    if (previousEpochRef.current === workspaceEpoch) {
      return;
    }
    previousEpochRef.current = workspaceEpoch;
    const current = activeRequestIdRef.current;
    if (current !== null) {
      activeRequestIdRef.current = null;
      void window.desktop.search.cancelTextWorkspace({ requestId: current });
    }
    setState(createIdleState());
  }, [workspaceEpoch]);

  const commit = useCallback(
    (
      result: WorkspaceTextSearchResult,
      requestId: number,
      epoch: number,
      submittedQuery: string,
      caseSensitive: boolean,
    ) => {
      // 第 5.3 节：组件挂载 + 工作区 epoch 未变化 + requestId 仍是当前活动请求
      if (!mountedRef.current) {
        return;
      }
      if (epochRef.current !== epoch || activeRequestIdRef.current !== requestId) {
        return;
      }
      activeRequestIdRef.current = null;
      if (result.status === 'completed') {
        setState({
          status: 'completed',
          submittedQuery,
          caseSensitive,
          requestId: null,
          result,
          error: null,
        });
      } else if (result.status === 'cancelled') {
        setState({
          status: 'cancelled',
          submittedQuery,
          caseSensitive,
          requestId: null,
          result: null,
          error: null,
        });
      } else {
        setState({
          status: 'error',
          submittedQuery,
          caseSensitive,
          requestId: null,
          result: null,
          error: result.error,
        });
      }
    },
    [],
  );

  const submitSearch = useCallback(
    (query: string, caseSensitive: boolean) => {
      if (!workspaceAvailableRef.current) {
        return;
      }
      // 防御性校验：空查询等非法输入由界面阻止，这里再次拒绝（requestId 0 仅为形状预检）
      const preflight = validateWorkspaceTextSearchRequest({
        requestId: 0,
        query,
        caseSensitive,
      });
      if (!preflight.ok) {
        return;
      }
      const previous = activeRequestIdRef.current;
      if (previous !== null) {
        void window.desktop.search.cancelTextWorkspace({ requestId: previous });
      }
      const requestId = ++requestCounterRef.current;
      activeRequestIdRef.current = requestId;
      const epoch = epochRef.current;
      setState({
        status: 'searching',
        submittedQuery: query,
        caseSensitive,
        requestId,
        result: null,
        error: null,
      });
      window.desktop.search
        .textWorkspace({ requestId, query, caseSensitive })
        .then((result) => commit(result, requestId, epoch, query, caseSensitive))
        .catch(() =>
          commit(
            {
              status: 'error',
              requestId,
              error: { code: 'SEARCH_FAILED', message: '搜索失败' },
            },
            requestId,
            epoch,
            query,
            caseSensitive,
          ),
        );
    },
    [commit],
  );

  const cancelSearch = useCallback(() => {
    const current = activeRequestIdRef.current;
    if (current === null) {
      return;
    }
    // 立即作废在途请求：迟到结果不再提交（不变量 3）
    activeRequestIdRef.current = null;
    void window.desktop.search.cancelTextWorkspace({ requestId: current });
    setState((prev) => ({
      status: 'cancelled',
      submittedQuery: prev.submittedQuery,
      caseSensitive: prev.caseSensitive,
      requestId: null,
      result: null,
      error: null,
    }));
  }, []);

  return { state, submitSearch, cancelSearch };
}
