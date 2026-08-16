/**
 * 多文档标签页 controller —— TXT/DOCX 判别联合（TASK-007 WP5）。
 *
 * 在 WP4 纯状态转移之上组合异步读取与保存：
 *
 * - `openFile`：文件树选择 → 按扩展名打开 TXT 或 DOCX；同路径去重（含 loading/error 态），
 *   新路径创建 loading 占位标签并发起唯一一次读取；
 * - 打开去重按规范相对路径，新标签分配稳定 tabId（不可由路径推导），
 *   重命名/移动/另存为路径变化不改变 tabId（TASK-009 WP1 第 4.5 节）；
 * - `openTextFile`：TXT 专用入口（Task 6 搜索结果定位复用），只返回 TXT 标签；
 * - 每标签独立读取请求：请求编号全局单调递增，结果提交前必须通过三重校验
 *   （工作区会话 / 目标标签 / 请求编号）；
 * - TXT 分支语义与 `use-text-documents.ts` 逐项一致（编辑修订号、混合换行确认、
 *   保存完成匹配清除 dirty、冲突重读）；
 * - DOCX 分支：读取结果经 `applyDocxReadResult` 提交（read-only 状态）、
 *   `editDocxTab` 编辑（degraded/read-only 门禁在模型层）、`saveDocxTab` 保存
 *   （degraded 未确认拒绝）、`confirmDocxCompatibility` 绑定 revision 确认、
 *   `reloadTab` / `retryRead` 按标签类型分派读取；
 * - 组件卸载后不再提交任何异步结果。
 *
 * ## 边界
 *
 * - 不持有工作区根路径或绝对路径；标签只使用规范相对路径；
 * - 复用 `document.readText/readDocx/saveText/saveDocx` 固定窄协议；
 * - TXT 行为与 Task 6 搜索定位协议不因联合抽象而改变。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../shared/document';
import type {
  DocxDocumentModel,
  ReadDocxDocumentResult,
  SaveDocxDocumentResult,
} from '../../shared/docx';
import {
  activateTab as activateTabState,
  applyDocxReadResult,
  asyncResultStillValid,
  closeTab as closeTabState,
  completeDocxSave,
  completeSaveAs as completeSaveAsState,
  confirmDocxCompatibility as confirmDocxCompatibilityState,
  createEmptyModel,
  editDocxTab as editDocxTabState,
  editTab as editTabState,
  failSaveAs as failSaveAsState,
  invalidateWorkspace as invalidateTabsModel,
  isDocxTab,
  isTextTab,
  openDocxTab,
  openTab,
  saveCompletionClearsDirty,
  startDocxSave,
  startSaveAs as startSaveAsState,
  tabById,
  tabByRelativePath,
  updateTab,
  updateTabRuntime,
  type DocumentTabRuntime,
  type DocumentTabsModel,
  type DocumentTabState,
} from './document-tabs';
import {
  FILE_MANAGEMENT_ERROR_MESSAGES,
  type FileManagementError,
  type SaveAsResult,
  type SaveDocxDocumentAsRequest,
  type SaveTextDocumentAsRequest,
  type WorkspaceTargetName,
} from '../../shared/file-management';
import type { TextDocumentTabState } from './text-document-tabs';

const MIXED_LINE_ENDINGS_ERROR = {
  code: 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
  message: '文件包含混合换行，需要确认规范化规则',
} as const;

const READ_FAILED_ERROR = {
  code: 'READ_FAILED',
  message: '读取文件失败',
} as const;

const WRITE_FAILED_ERROR = {
  code: 'WRITE_FAILED',
  message: '写入文件失败',
} as const;

export interface DocumentsController {
  readonly model: DocumentTabsModel;
  /** 从文件树选择文件：按扩展名打开 TXT 或 DOCX（返回标签读取稳定后的状态）。 */
  readonly openFile: (relativePath: string) => Promise<DocumentTabState | null>;
  /** TXT 专用打开入口（Task 6 搜索结果定位复用）：只返回 TXT 标签。 */
  readonly openTextFile: (relativePath: string) => Promise<TextDocumentTabState | null>;
  /** 点击标签切换活动标签。 */
  readonly activateTab: (tabId: string) => void;
  /** TXT 编辑器正文变化。 */
  readonly editTab: (tabId: string, content: string) => void;
  /** DOCX 编辑器模型变化（degraded/read-only 门禁在模型层）。 */
  readonly editDocxTab: (tabId: string, model: DocxDocumentModel) => void;
  /** TXT 保存（含混合换行确认）。 */
  readonly saveTab: (tabId: string, confirmMixedLineEndingNormalization?: boolean) => void;
  /** DOCX 保存（degraded 未确认被模型层拒绝）。 */
  readonly saveDocxTab: (tabId: string) => void;
  /** 确认 degraded 文档兼容性（绑定当前基线 revision）。 */
  readonly confirmDocxCompatibility: (tabId: string) => void;
  /** 冲突确认放弃后调用：丢弃本地修改并重新读取目标标签（按类型分派）。 */
  readonly reloadTab: (tabId: string) => void;
  /** 关闭标签（未保存确认由界面层完成）。 */
  readonly closeTab: (tabId: string) => void;
  /** 错误标签重试：发起新一轮读取并作废旧请求。 */
  readonly retryRead: (tabId: string) => void;
  /**
   * 另存为（TASK-009 WP4）：stable tabId 原地迁移 + 两阶段覆盖确认编排。
   * 返回 IPC 结果供调用方（WP6 UI）处理 target-exists → 确认 → 第二次调用；
   * 成功后当前标签迁移到目标路径（id/顺序/会话不变）。
   */
  readonly saveAsTab: (
    tabId: string,
    target: WorkspaceTargetName,
    options?: {
      readonly expectedTargetRevision?: string;
      readonly confirmMixedLineEndingNormalization?: boolean;
    },
  ) => Promise<SaveAsResult>;
  /** 工作区成功切换：清空全部标签与运行时，使旧工作区结果失效。 */
  readonly invalidateWorkspace: () => void;
}

function txtRuntimeEntry(): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 0,
    saveInFlight: false,
    latestContent: '',
    latestModel: null,
  };
}

function docxRuntimeEntry(): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 0,
    saveInFlight: false,
    latestContent: null,
    latestModel: null,
  };
}

function isDocxPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith('.docx');
}

/** 为一个标签写入带读取请求编号的运行时条目（读取开始时调用）。 */
function withReadRequest(
  model: DocumentTabsModel,
  tabId: string,
  requestId: number,
  runtime: DocumentTabRuntime,
): DocumentTabsModel {
  const next = new Map(model.runtime);
  next.set(tabId, { ...runtime, readRequestId: requestId });
  return { state: model.state, runtime: next };
}

export function useDocuments(): DocumentsController {
  const [model, setModel] = useState<DocumentTabsModel>(createEmptyModel);
  const modelRef = useRef(model);
  /** 工作区会话编号：成功切换时递增，旧会话的迟到结果全部失效。 */
  const epochRef = useRef(0);
  /** 读取请求编号：全局单调递增，避免关闭后重开标签的请求编号碰撞。 */
  const readRequestCounterRef = useRef(0);
  /**
   * 稳定 tabId 分配：单调递增、不可由路径推导（TASK-009 WP1 第 4.5 节）。
   * 工作区切换/标签关闭不重置计数，保证会话内 id 永不碰撞。
   */
  const tabIdCounterRef = useRef(0);
  const allocateTabId = useCallback(() => `tab-${++tabIdCounterRef.current}`, []);
  /** 文件操作 mutationId：renderer 单调递增，只用于界面迟到结果校验（§4.4）。 */
  const mutationIdCounterRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback((next: DocumentTabsModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  const openWaitersRef = useRef(new Map<string, Set<(tab: DocumentTabState | null) => void>>());

  const resolveOpenWaiters = useCallback((tabId: string, tab: DocumentTabState | null) => {
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
    (tabId: string): Promise<DocumentTabState | null> =>
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

  const commitTextReadResult = useCallback(
    (result: ReadTextDocumentResult, tabId: string, requestId: number, epoch: number) => {
      if (!mountedRef.current) {
        return;
      }
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.readRequestId === requestId,
      });
      if (!valid || tab === null || isDocxTab(tab)) {
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
            updateTab(current, tabId, (target) => {
              if (isDocxTab(target)) {
                return target;
              }
              return nextTab;
            }),
            tabId,
            (runtimeEntry) => ({
              ...runtimeEntry,
              editRevision: 0,
              latestContent: document.content,
            }),
          ),
        );
        resolveOpenWaiters(tabId, nextTab);
      } else {
        const nextTab: TextDocumentTabState = {
          ...tab,
          status: 'read-error',
          error: result.error,
        };
        commit(
          updateTab(current, tabId, (target) => {
            if (isDocxTab(target)) {
              return target;
            }
            return nextTab;
          }),
        );
        resolveOpenWaiters(tabId, nextTab);
      }
    },
    [commit, resolveOpenWaiters],
  );

  const commitDocxReadResult = useCallback(
    (result: ReadDocxDocumentResult, tabId: string, requestId: number, epoch: number) => {
      if (!mountedRef.current) {
        return;
      }
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.readRequestId === requestId,
      });
      if (!valid || tab === null || !isDocxTab(tab)) {
        return;
      }
      const next = applyDocxReadResult(current, tabId, result);
      commit(next);
      resolveOpenWaiters(tabId, tabById(next, tabId));
    },
    [commit, resolveOpenWaiters],
  );

  const readPath = useCallback(
    (relativePath: string, tabId: string, requestId: number, docx: boolean) => {
      const epoch = epochRef.current;
      if (docx) {
        window.desktop.document
          .readDocx(relativePath)
          .then((result) => commitDocxReadResult(result, tabId, requestId, epoch))
          .catch(() =>
            commitDocxReadResult(
              { status: 'error', error: READ_FAILED_ERROR },
              tabId,
              requestId,
              epoch,
            ),
          );
      } else {
        window.desktop.document
          .readText(relativePath)
          .then((result) => commitTextReadResult(result, tabId, requestId, epoch))
          .catch(() =>
            commitTextReadResult(
              { status: 'error', error: READ_FAILED_ERROR },
              tabId,
              requestId,
              epoch,
            ),
          );
      }
    },
    [commitDocxReadResult, commitTextReadResult],
  );

  /**
   * 打开或激活标签（按扩展名分派 TXT / DOCX）：
   * 返回的 Promise 在标签读取稳定后结算；文件树调用方可忽略返回值。
   */
  const openFile = useCallback(
    (relativePath: string): Promise<DocumentTabState | null> => {
      const current = modelRef.current;
      const docx = isDocxPath(relativePath);
      // 打开去重按规范相对路径（与稳定 tabId 解耦）：已存在标签只激活原 id；
      // 新路径才分配新的稳定 tabId（不可由路径推导）
      const existing = tabByRelativePath(current, relativePath);
      const opened =
        existing !== null
          ? activateTabState(current, existing.id)
          : docx
            ? openDocxTab(current, relativePath, allocateTabId())
            : openTab(current, relativePath, allocateTabId());
      const tab = tabByRelativePath(opened, relativePath) ?? null;
      if (tab === null) {
        return Promise.resolve(null);
      }
      // 新创建的 loading 占位标签没有运行时条目：发起唯一一次读取；
      // 已存在标签（含 loading 中）只激活，不发起读取
      if (tab.status === 'loading' && opened.runtime.get(tab.id) === undefined) {
        const requestId = ++readRequestCounterRef.current;
        commit(
          withReadRequest(opened, tab.id, requestId, docx ? docxRuntimeEntry() : txtRuntimeEntry()),
        );
        readPath(tab.relativePath, tab.id, requestId, docx);
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

  /** TXT 专用打开入口（搜索结果定位）：只返回 TXT 标签。 */
  const openTextFile = useCallback(
    async (relativePath: string): Promise<TextDocumentTabState | null> => {
      const tab = await openFile(relativePath);
      return tab !== null && isTextTab(tab) ? tab : null;
    },
    [openFile],
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

  const editDocxTab = useCallback(
    (tabId: string, nextModel: DocxDocumentModel) => {
      commit(editDocxTabState(modelRef.current, tabId, nextModel));
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
      const docx = isDocxTab(tab);
      const requestId = ++readRequestCounterRef.current;
      const entry = current.runtime.get(tabId);
      const reading = updateTab(current, tabId, (target) => ({
        ...target,
        status: 'loading',
        error: null,
      }));
      const next =
        entry === undefined
          ? withReadRequest(
              reading,
              tabId,
              requestId,
              docx ? docxRuntimeEntry() : txtRuntimeEntry(),
            )
          : updateTabRuntime(reading, tabId, (runtimeEntry) => ({
              ...runtimeEntry,
              readRequestId: requestId,
            }));
      commit(next);
      readPath(tab.relativePath, tabId, requestId, docx);
    },
    [commit, readPath],
  );

  const commitTextSaveResult = useCallback(
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
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.saveInFlight,
      });
      if (!valid || tab === null || isDocxTab(tab) || entry === undefined) {
        return;
      }
      if (result.status === 'saved') {
        const savedDocument = result.document;
        const stillClean = saveCompletionClearsDirty(captured.editRevision, entry.editRevision);
        commit(
          updateTabRuntime(
            updateTab(current, tabId, (target) => {
              if (isDocxTab(target)) {
                return target;
              }
              return {
                ...target,
                status: stillClean ? 'loaded-clean' : 'loaded-dirty',
                saving: false,
                document: savedDocument,
                dirty: !stillClean,
                error: null,
              };
            }),
            tabId,
            (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
          ),
        );
      } else {
        const conflict = result.error.code === 'CONFLICT';
        commit(
          updateTabRuntime(
            updateTab(current, tabId, (target) => {
              if (isDocxTab(target)) {
                return target;
              }
              return {
                ...target,
                status: conflict ? 'conflict' : 'save-error',
                saving: false,
                dirty: true,
                error: result.error,
              };
            }),
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
      // 目标不存在、无运行时条目、已有在途保存、未修改或非 TXT 时都不发起写入
      if (tab === null || isDocxTab(tab) || entry === undefined || entry.saveInFlight) {
        return;
      }
      const target = tab.document;
      if (target === null) {
        return;
      }
      if (tab.status === 'loaded-clean') {
        return;
      }
      if (target.lineEnding === 'mixed' && confirmMixedLineEndingNormalization !== true) {
        commit(
          updateTab(current, tabId, (targetTab) => {
            if (isDocxTab(targetTab)) {
              return targetTab;
            }
            return {
              ...targetTab,
              status: 'save-error',
              dirty: true,
              saving: false,
              error: MIXED_LINE_ENDINGS_ERROR,
            };
          }),
        );
        return;
      }
      const captured = {
        relativePath: tab.relativePath,
        content: entry.latestContent ?? tab.content,
        editRevision: entry.editRevision,
        expectedRevision: target.revision,
        confirmMixedLineEndingNormalization:
          confirmMixedLineEndingNormalization === true ? true : undefined,
      };
      const epoch = epochRef.current;
      commit(
        updateTabRuntime(
          updateTab(current, tabId, (targetTab) => {
            if (isDocxTab(targetTab)) {
              return targetTab;
            }
            return {
              ...targetTab,
              status: 'saving',
              saving: true,
              error: null,
            };
          }),
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
        .then((result) => commitTextSaveResult(result, tabId, captured, epoch))
        .catch(() =>
          commitTextSaveResult(
            { status: 'error', error: WRITE_FAILED_ERROR },
            tabId,
            captured,
            epoch,
          ),
        );
    },
    [commit, commitTextSaveResult],
  );

  const commitDocxSaveResult = useCallback(
    (
      result: SaveDocxDocumentResult,
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
      const valid = asyncResultStillValid({
        workspaceSessionValid: epochRef.current === epoch,
        tabExists: tab !== null,
        requestIdCurrent: entry !== undefined && entry.saveInFlight,
      });
      if (!valid || tab === null || !isDocxTab(tab) || entry === undefined) {
        return;
      }
      commit(completeDocxSave(current, tabId, captured.editRevision, result));
    },
    [commit],
  );

  const saveDocxTab = useCallback(
    (tabId: string) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      if (tab === null || !isDocxTab(tab) || entry === undefined || entry.saveInFlight) {
        return;
      }
      if (tab.document === null || tab.model === null) {
        return;
      }
      if (tab.status === 'loaded-clean' || tab.status === 'read-only') {
        return;
      }
      const captured = {
        editRevision: entry.editRevision,
        expectedRevision: tab.document.revision,
        model: entry.latestModel ?? tab.model,
        confirmationRevision: tab.compatibilityConfirmationRevision ?? undefined,
      };
      // 模型层门禁：degraded 未确认 → save-error（COMPATIBILITY_CONFIRMATION_REQUIRED）
      const next = startDocxSave(current, tabId);
      const savingTab = tabById(next, tabId);
      if (savingTab === null || !isDocxTab(savingTab) || !savingTab.saving) {
        commit(next);
        return;
      }
      const epoch = epochRef.current;
      commit(next);
      window.desktop.document
        .saveDocx({
          relativePath: tab.relativePath,
          expectedRevision: captured.expectedRevision,
          model: captured.model,
          ...(captured.confirmationRevision !== undefined
            ? { compatibilityConfirmationRevision: captured.confirmationRevision }
            : {}),
        })
        .then((result) => commitDocxSaveResult(result, tabId, captured, epoch))
        .catch(() =>
          commitDocxSaveResult(
            { status: 'error', error: WRITE_FAILED_ERROR },
            tabId,
            captured,
            epoch,
          ),
        );
    },
    [commit, commitDocxSaveResult],
  );

  const confirmDocxCompatibility = useCallback(
    (tabId: string) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      if (tab === null || !isDocxTab(tab) || tab.document === null) {
        return;
      }
      commit(confirmDocxCompatibilityState(current, tabId, tab.document.revision));
    },
    [commit],
  );

  const saveAsTab = useCallback(
    async (
      tabId: string,
      target: WorkspaceTargetName,
      options: {
        readonly expectedTargetRevision?: string;
        readonly confirmMixedLineEndingNormalization?: boolean;
      } = {},
    ): Promise<SaveAsResult> => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      const entry = current.runtime.get(tabId);
      if (tab === null || entry === undefined || entry.saveInFlight || tab.document === null) {
        return {
          status: 'error',
          mutationId: 0,
          error: { code: 'INVALID_REQUEST', message: '无效的保存请求' },
        };
      }
      if (isDocxTab(tab) && tab.status === 'read-only') {
        return {
          status: 'error',
          mutationId: 0,
          error: {
            code: 'READ_ONLY_DOCUMENT',
            message: FILE_MANAGEMENT_ERROR_MESSAGES.READ_ONLY_DOCUMENT,
          },
        };
      }
      // 目标由另一标签打开：renderer 不发请求（TARGET_OPEN 为产品状态，主进程不信任）
      const targetPath =
        target.parentRelativePath === ''
          ? target.name
          : `${target.parentRelativePath}/${target.name}`;
      const opener = tabByRelativePath(current, targetPath);
      if (opener !== null && opener.id !== tabId) {
        const targetOpenError = {
          code: 'TARGET_OPEN' as const,
          message: FILE_MANAGEMENT_ERROR_MESSAGES.TARGET_OPEN,
        };
        commit(
          updateTab(current, tabId, (targetTab) => {
            if (isDocxTab(targetTab)) {
              return {
                ...targetTab,
                status: 'save-error',
                dirty: true,
                error: targetOpenError as never,
              };
            }
            return {
              ...targetTab,
              status: 'save-error',
              dirty: true,
              error: targetOpenError as never,
            };
          }),
        );
        return {
          status: 'error',
          mutationId: 0,
          error: targetOpenError,
        };
      }

      // startSaveAs 门禁：loading/read-error/save-error/read-only/saving/无快照/degraded 未确认
      const started = startSaveAsState(current, tabId);
      const savingTab = tabById(started, tabId);
      if (savingTab === null || !savingTab.saving) {
        commit(started);
        const error = (savingTab?.error ?? {
          code: 'INVALID_REQUEST',
          message: '无效的保存请求',
        }) as FileManagementError;
        return { status: 'error', mutationId: 0, error };
      }
      const captured = {
        editRevision: entry.editRevision,
        sourceRevision: tab.document.revision,
        content: entry.latestContent ?? ('content' in tab ? tab.content : ''),
        model: entry.latestModel ?? ('model' in tab && tab.model !== null ? tab.model : null),
      };
      const epoch = epochRef.current;
      const mutationId = ++mutationIdCounterRef.current;
      commit(started);

      const complete = (result: SaveAsResult): SaveAsResult => {
        const latest = modelRef.current;
        const latestEntry = latest.runtime.get(tabId);
        const valid = asyncResultStillValid({
          workspaceSessionValid: epochRef.current === epoch,
          tabExists: tabById(latest, tabId) !== null,
          requestIdCurrent: latestEntry !== undefined && latestEntry.saveInFlight,
        });
        if (!valid) {
          return {
            status: 'error',
            mutationId,
            error: { code: 'WRITE_FAILED', message: '写入失败' },
          };
        }
        if (result.status === 'saved') {
          commit(
            completeSaveAsState(
              latest,
              tabId,
              captured.editRevision,
              result.relativePath,
              result.document,
              result.backupRelativePath,
            ),
          );
        } else if (result.status === 'target-exists') {
          // 第一阶段冲突：恢复原标签状态（非错误，保留保存期间的新编辑），
          // 返回受控目标 revision 供调用方确认覆盖后二次提交
          commit(
            updateTabRuntime(
              updateTab(latest, tabId, (targetTab) => {
                if (isDocxTab(targetTab)) {
                  return {
                    ...targetTab,
                    status: isDocxTab(tab) ? tab.status : 'loaded-dirty',
                    saving: false,
                    error: null,
                  };
                }
                return {
                  ...targetTab,
                  status: isDocxTab(tab) ? 'loaded-dirty' : tab.status,
                  saving: false,
                  error: null,
                };
              }),
              tabId,
              (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
            ),
          );
        } else {
          commit(failSaveAsState(latest, tabId, result.error));
        }
        return result;
      };

      if (isDocxTab(tab)) {
        if (captured.model === null) {
          return {
            status: 'error',
            mutationId,
            error: { code: 'INVALID_REQUEST', message: '无效的保存请求' },
          };
        }
        const request: SaveDocxDocumentAsRequest = {
          mutationId,
          tabId,
          sourceRelativePath: tab.relativePath,
          target,
          model: captured.model,
          expectedSourceRevision: captured.sourceRevision,
          ...(options.expectedTargetRevision !== undefined
            ? { expectedTargetRevision: options.expectedTargetRevision as string }
            : {}),
          ...(tab.compatibilityConfirmationRevision !== null
            ? { compatibilityConfirmationRevision: tab.compatibilityConfirmationRevision }
            : {}),
        };
        return window.desktop.document
          .saveDocxAs(request)
          .then(complete)
          .catch(() =>
            complete({
              status: 'error',
              mutationId,
              error: { code: 'WRITE_FAILED', message: '写入失败' },
            }),
          );
      }
      const request: SaveTextDocumentAsRequest = {
        mutationId,
        tabId,
        sourceRelativePath: tab.relativePath,
        target,
        content: captured.content,
        expectedSourceRevision: captured.sourceRevision,
        ...(options.expectedTargetRevision !== undefined
          ? { expectedTargetRevision: options.expectedTargetRevision as string }
          : {}),
        ...(options.confirmMixedLineEndingNormalization === true
          ? { confirmMixedLineEndingNormalization: true as const }
          : {}),
      };
      return window.desktop.document
        .saveTextAs(request)
        .then(complete)
        .catch(() =>
          complete({
            status: 'error',
            mutationId,
            error: { code: 'WRITE_FAILED', message: '写入失败' },
          }),
        );
    },
    [commit, completeSaveAsState, failSaveAsState, startSaveAsState],
  );

  const reloadTab = useCallback(
    (tabId: string) => {
      const current = modelRef.current;
      const tab = tabById(current, tabId);
      if (tab === null) {
        return;
      }
      const docx = isDocxTab(tab);
      const requestId = ++readRequestCounterRef.current;
      const reading = updateTab(current, tabId, (target) => ({
        ...target,
        status: 'loading',
        error: null,
      }));
      const entry = current.runtime.get(tabId);
      commit(
        entry === undefined
          ? withReadRequest(
              reading,
              tabId,
              requestId,
              docx ? docxRuntimeEntry() : txtRuntimeEntry(),
            )
          : updateTabRuntime(reading, tabId, (runtimeEntry) => ({
              ...runtimeEntry,
              readRequestId: requestId,
            })),
      );
      readPath(tab.relativePath, tabId, requestId, docx);
    },
    [commit, readPath],
  );

  const invalidateWorkspace = useCallback(() => {
    epochRef.current += 1;
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
    openFile,
    openTextFile,
    activateTab,
    editTab,
    editDocxTab,
    saveTab,
    saveDocxTab,
    confirmDocxCompatibility,
    reloadTab,
    closeTab,
    retryRead,
    saveAsTab,
    invalidateWorkspace,
  };
}
