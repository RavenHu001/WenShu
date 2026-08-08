/**
 * 多 TXT 标签页 controller —— TASK-005 WP2。
 *
 * 在 WP1 纯状态转移之上组合异步读取：controller 持有 `TextTabsModel`
 * （可渲染标签 + 运行时元数据），异步结果通过目标标签更新提交。
 *
 * ## 职责
 *
 * - `openTextFile`：文件树选择 → "打开或激活"；同路径去重（含 loading/error 态），
 *   新路径创建 loading 占位标签并发起唯一一次读取；
 * - 每标签独立读取请求：请求编号全局单调递增，结果提交前必须通过
 *   不变量 6 的三重校验（工作区会话 / 目标标签 / 请求编号），任一失效即忽略；
 * - `retryRead`：错误标签重试（编号递增，旧请求结果自动作废）；
 * - `activateTab` / `closeTab`：纯转移的直接入口；
 * - `invalidateWorkspace`：工作区成功切换时失效旧会话并清空全部标签与运行时。
 *
 * ## 边界
 *
 * - 不持有工作区根路径或绝对路径；标签只使用规范相对路径；
 * - 不新增 IPC / preload 能力，复用 `document.readText` / `document.saveText`
 *   固定窄协议，不改动 Task 4 安全保存、revision 冲突与混合换行协议；
 * - `editTab` 经 WP1 纯转移更新目标标签（dirty / 编辑修订号 / latestContent），
 *   由 WP3 编辑器宿主上报正文变化；
 * - `saveTab` / `reloadTab`（WP4）以目标标签运行时状态实现每标签保存竞态与
 *   绑定 tabId 的冲突重读；混合换行确认与冲突确认由界面层绑定 tabId 完成；
 * - 组件卸载后不再提交任何异步结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../shared/document';
import type { TextTabsModel, TextDocumentTabState } from './text-document-tabs';
import {
  activeTab,
  activateTab as activateTabState,
  asyncResultStillValid,
  closeTab as closeTabState,
  createEmptyModel,
  editTab as editTabState,
  invalidateWorkspace as invalidateTabsModel,
  openTab,
  saveCompletionClearsDirty,
  tabById,
  updateTab,
  updateTabRuntime,
} from './text-document-tabs';

const MIXED_LINE_ENDINGS_ERROR = {
  code: 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
  message: '文件包含混合换行，需要确认规范化规则',
} as const;

export interface TextDocumentsController {
  readonly model: TextTabsModel;
  /**
   * 从文件树选择 TXT：打开或激活对应标签，并在新标签上发起读取。
   * 返回的 Promise 在标签读取稳定后结算（加载完成 / 读取失败 / 关闭或工作区失效为 null），
   * 供搜索结果定位等待读取完成（TASK-006 4.9.2）；文件树调用方可忽略返回值。
   */
  readonly openTextFile: (relativePath: string) => Promise<TextDocumentTabState | null>;
  /** 点击标签切换活动标签。 */
  readonly activateTab: (tabId: string) => void;
  /** 编辑器正文变化：只更新目标标签（正文实际变化才标记 dirty 并递增修订号）。 */
  readonly editTab: (tabId: string, content: string) => void;
  /**
   * 保存目标标签：未修改或已有在途保存时无操作；保存请求捕获目标标签、
   * 正文、编辑修订号与已保存 revision；成功只有修订号仍匹配时才清除 dirty。
   * 传 `confirmMixedLineEndingNormalization: true` 表示用户已确认混合换行规范化。
   */
  readonly saveTab: (tabId: string, confirmMixedLineEndingNormalization?: boolean) => void;
  /** 冲突确认放弃后调用：丢弃本地修改并重新读取目标标签。 */
  readonly reloadTab: (tabId: string) => void;
  /** 关闭标签（未保存确认由界面层完成，见 WP5）。 */
  readonly closeTab: (tabId: string) => void;
  /** 错误标签重试：发起新一轮读取并作废旧请求。 */
  readonly retryRead: (tabId: string) => void;
  /** 工作区成功切换：清空全部标签与运行时，使旧工作区结果失效。 */
  readonly invalidateWorkspace: () => void;
}

/** 为一个标签写入带读取请求编号的运行时条目（读取开始时调用）。 */
function withReadRequest(
  model: TextTabsModel,
  tabId: string,
  requestId: number,
  latestContent: string,
): TextTabsModel {
  const runtime = new Map(model.runtime);
  runtime.set(tabId, {
    editRevision: 0,
    readRequestId: requestId,
    saveInFlight: false,
    latestContent,
  });
  return { state: model.state, runtime };
}

export function useTextDocuments(): TextDocumentsController {
  const [model, setModel] = useState<TextTabsModel>(createEmptyModel);
  const modelRef = useRef(model);
  /** 工作区会话编号：成功切换时递增，旧会话的迟到结果全部失效。 */
  const epochRef = useRef(0);
  /** 读取请求编号：全局单调递增，避免关闭后重开标签的请求编号碰撞。 */
  const readRequestCounterRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback((next: TextTabsModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  /**
   * 打开流程的等待者：按 tabId 收集，标签读取完成（或关闭/工作区失效）时统一结算。
   * 用于搜索结果定位：新标签需等读取完成后才能执行 revision / 范围校验（TASK-006 4.9.2）。
   */
  const openWaitersRef = useRef(new Map<string, Set<(tab: TextDocumentTabState | null) => void>>());

  const resolveOpenWaiters = useCallback((tabId: string, tab: TextDocumentTabState | null) => {
    const waiters = openWaitersRef.current.get(tabId);
    if (waiters === undefined) {
      return;
    }
    openWaitersRef.current.delete(tabId);
    for (const resolve of waiters) {
      resolve(tab);
    }
  }, []);

  const waitForTabLoad = useCallback(
    (tabId: string): Promise<TextDocumentTabState | null> =>
      new Promise((resolve) => {
        const waiters = openWaitersRef.current.get(tabId);
        if (waiters === undefined) {
          openWaitersRef.current.set(tabId, new Set([resolve]));
        } else {
          waiters.add(resolve);
        }
      }),
    [],
  );

  const commitReadResult = useCallback(
    (result: ReadTextDocumentResult, tabId: string, requestId: number, epoch: number) => {
      if (!mountedRef.current) {
        return;
      }
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      // 不变量 6：工作区会话、目标标签、请求编号三重校验，任一失效都忽略
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.readRequestId === requestId,
      });
      if (!valid || tab === null) {
        return;
      }
      if (result.status === 'loaded') {
        const document = result.document;
        const nextTab: TextDocumentTabState = {
          ...tab,
          status: 'loaded-clean',
          name: document.name,
          document,
          content: document.content,
          dirty: false,
          saving: false,
          error: null,
        };
        commit(
          updateTabRuntime(
            updateTab(current, tabId, () => nextTab),
            tabId,
            (runtimeEntry) => ({
              ...runtimeEntry,
              editRevision: 0,
              latestContent: document.content,
            }),
          ),
        );
        // 打开流程等待者以最终标签状态结算（定位校验依据）
        resolveOpenWaiters(tabId, nextTab);
      } else {
        // 读取失败：目标标签进入 read-error；已有快照时保留正文、dirty 与已保存快照
        const nextTab: TextDocumentTabState = {
          ...tab,
          status: 'read-error',
          error: result.error,
        };
        commit(updateTab(current, tabId, () => nextTab));
        resolveOpenWaiters(tabId, nextTab);
      }
    },
    [commit, resolveOpenWaiters],
  );

  const readPath = useCallback(
    (relativePath: string, tabId: string, requestId: number) => {
      const epoch = epochRef.current;
      window.desktop.document
        .readText(relativePath)
        .then((result) => commitReadResult(result, tabId, requestId, epoch))
        .catch(() =>
          commitReadResult(
            { status: 'error', error: { code: 'READ_FAILED', message: '读取文件失败' } },
            tabId,
            requestId,
            epoch,
          ),
        );
    },
    [commitReadResult],
  );

  /**
   * 打开或激活标签（TASK-006 WP5 扩展）：
   * 返回的 Promise 在标签读取稳定后结算——新标签等待本次读取完成（loaded 或 read-error），
   * 已加载标签立即以当前状态结算；标签被关闭或工作区失效时以 null 结算。
   * 文件树调用方可忽略返回值（void 化），搜索结果定位依赖该结算时机（第 4.9.2 节）。
   */
  const openTextFile = useCallback(
    (relativePath: string): Promise<TextDocumentTabState | null> => {
      const current = modelRef.current;
      const opened = openTab(current, relativePath);
      const tab = activeTab(opened);
      if (tab === null) {
        return Promise.resolve(null);
      }
      // 新创建的 loading 占位标签没有运行时条目：发起唯一一次读取；
      // 已存在标签（含 loading 中）只激活，不发起读取
      if (tab.status === 'loading' && opened.runtime.get(tab.id) === undefined) {
        const requestId = ++readRequestCounterRef.current;
        commit(withReadRequest(opened, tab.id, requestId, ''));
        readPath(tab.relativePath, tab.id, requestId);
      } else {
        commit(opened);
      }
      if (tab.status === 'loading') {
        // 读取在途（新建或重复点击）：等待原读取完成后结算，不创建第二标签
        return waitForTabLoad(tab.id);
      }
      return Promise.resolve(tab);
    },
    [commit, readPath, waitForTabLoad],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      commit(activateTabState(modelRef.current, tabId));
    },
    [commit],
  );

  const editTab = useCallback(
    (tabId: string, content: string) => {
      commit(editTabState(modelRef.current, tabId, content));
    },
    [commit],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      // 关闭后结算打开流程等待者（null：标签已不存在，定位流程不再继续）
      resolveOpenWaiters(tabId, null);
      commit(closeTabState(modelRef.current, tabId));
    },
    [commit, resolveOpenWaiters],
  );

  const retryRead = useCallback(
    (tabId: string) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      if (tab === null) {
        return;
      }
      const requestId = ++readRequestCounterRef.current;
      const entry = current.runtime.get(tabId);
      // 重试/重新读取期间进入不可编辑 loading 状态，防止请求完成后覆盖期间的新输入。
      const reading = updateTab(current, tabId, (target) => ({
        ...target,
        status: 'loading',
        error: null,
      }));
      const next =
        entry === undefined
          ? withReadRequest(reading, tabId, requestId, tab.content)
          : updateTabRuntime(reading, tabId, (runtimeEntry) => ({
              ...runtimeEntry,
              readRequestId: requestId,
            }));
      commit(next);
      readPath(tab.relativePath, tabId, requestId);
    },
    [commit, readPath],
  );

  const commitSaveResult = useCallback(
    (
      result: SaveTextDocumentResult,
      tabId: string,
      captured: { editRevision: number },
      epoch: number,
    ) => {
      if (!mountedRef.current) {
        return;
      }
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      // 不变量 6：工作区会话、目标标签、在途保存一致才允许提交
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.saveInFlight,
      });
      if (!valid || tab === null || entry === undefined) {
        return;
      }
      if (result.status === 'saved') {
        const savedDocument = result.document;
        // 不变量 5：只有当前编辑修订号仍等于捕获值时才清除 dirty
        const stillClean = saveCompletionClearsDirty(captured.editRevision, entry.editRevision);
        commit(
          updateTabRuntime(
            updateTab(current, tabId, (target) => ({
              ...target,
              status: stillClean ? 'loaded-clean' : 'loaded-dirty',
              saving: false,
              document: savedDocument,
              dirty: !stillClean,
              error: null,
            })),
            tabId,
            (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
          ),
        );
      } else {
        const conflict = result.error.code === 'CONFLICT';
        commit(
          updateTabRuntime(
            updateTab(current, tabId, (target) => ({
              ...target,
              status: conflict ? 'conflict' : 'save-error',
              saving: false,
              dirty: true,
              error: result.error,
            })),
            tabId,
            (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
          ),
        );
      }
    },
    [commit],
  );

  const saveTab = useCallback(
    (tabId: string, confirmMixedLineEndingNormalization?: boolean) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      const target = tab?.document ?? null;
      // 目标不存在、无运行时条目、已有在途保存或未修改时都不发起写入
      if (tab === null || entry === undefined || entry.saveInFlight || target === null) {
        return;
      }
      if (tab.status === 'loaded-clean') {
        return;
      }
      // UI 会在正常入口提前确认；controller 仍保留这一门禁，避免快捷键与 React
      // 状态同步交界处的极短竞态绕过 mixed 换行确认并直接写盘。
      if (target.lineEnding === 'mixed' && confirmMixedLineEndingNormalization !== true) {
        commit(
          updateTab(current, tabId, (targetTab) => ({
            ...targetTab,
            status: 'save-error',
            dirty: true,
            saving: false,
            error: MIXED_LINE_ENDINGS_ERROR,
          })),
        );
        return;
      }
      const captured = {
        relativePath: tab.relativePath,
        content: entry.latestContent,
        editRevision: entry.editRevision,
        expectedRevision: target.revision,
        confirmMixedLineEndingNormalization:
          confirmMixedLineEndingNormalization === true ? true : undefined,
      };
      const epoch = epochRef.current;
      commit(
        updateTabRuntime(
          updateTab(current, tabId, (targetTab) => ({
            ...targetTab,
            status: 'saving',
            saving: true,
            error: null,
          })),
          tabId,
          (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: true }),
        ),
      );
      window.desktop.document
        .saveText({
          relativePath: captured.relativePath,
          content: captured.content,
          expectedRevision: captured.expectedRevision,
          ...(captured.confirmMixedLineEndingNormalization !== undefined
            ? { confirmMixedLineEndingNormalization: true }
            : {}),
        })
        .then((result) => commitSaveResult(result, tabId, captured, epoch))
        .catch(() =>
          commitSaveResult(
            { status: 'error', error: { code: 'WRITE_FAILED', message: '写入文件失败' } },
            tabId,
            captured,
            epoch,
          ),
        );
    },
    [commit, commitSaveResult],
  );

  const reloadTab = useCallback(
    (tabId: string) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      if (tab === null) {
        return;
      }
      const requestId = ++readRequestCounterRef.current;
      const reading = updateTab(current, tabId, (target) => ({
        ...target,
        status: 'loading',
        error: null,
      }));
      const entry = current.runtime.get(tabId);
      commit(
        entry === undefined
          ? withReadRequest(reading, tabId, requestId, tab.content)
          : updateTabRuntime(reading, tabId, (runtimeEntry) => ({
              ...runtimeEntry,
              readRequestId: requestId,
            })),
      );
      readPath(tab.relativePath, tabId, requestId);
    },
    [commit, readPath],
  );

  const invalidateWorkspace = useCallback(() => {
    epochRef.current += 1;
    // 工作区失效：全部打开流程等待者以 null 结算（定位流程不再继续）
    const waiters = openWaitersRef.current;
    for (const [tabId, resolves] of waiters) {
      waiters.delete(tabId);
      for (const resolve of resolves) {
        resolve(null);
      }
    }
    commit(invalidateTabsModel());
  }, [commit]);

  return {
    model,
    openTextFile,
    activateTab,
    editTab,
    saveTab,
    reloadTab,
    closeTab,
    retryRead,
    invalidateWorkspace,
  };
}
