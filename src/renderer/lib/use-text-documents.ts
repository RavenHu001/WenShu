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
 * - 不新增 IPC / preload 能力，复用 `document.readText` 固定窄协议；
 * - 编辑（CodeMirror 会话）与保存流程分别由 WP3、WP4 接入；
 * - 组件卸载后不再提交任何异步结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadTextDocumentResult } from '../../shared/document';
import type { TextTabsModel } from './text-document-tabs';
import {
  activeTab,
  activateTab as activateTabState,
  asyncResultStillValid,
  closeTab as closeTabState,
  createEmptyModel,
  invalidateWorkspace as invalidateTabsModel,
  openTab,
  tabById,
  updateTab,
  updateTabRuntime,
} from './text-document-tabs';

export interface TextDocumentsController {
  readonly model: TextTabsModel;
  /** 从文件树选择 TXT：打开或激活对应标签，并在新标签上发起读取。 */
  readonly openTextFile: (relativePath: string) => void;
  /** 点击标签切换活动标签。 */
  readonly activateTab: (tabId: string) => void;
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

  const commitReadResult = useCallback(
    (result: ReadTextDocumentResult, tabId: string, requestId: number, epoch: number) => {
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
        commit(
          updateTabRuntime(
            updateTab(current, tabId, (target) => ({
              ...target,
              status: 'loaded-clean',
              name: document.name,
              document,
              content: document.content,
              dirty: false,
              saving: false,
              error: null,
            })),
            tabId,
            (runtimeEntry) => ({
              ...runtimeEntry,
              editRevision: 0,
              latestContent: document.content,
            }),
          ),
        );
      } else {
        // 读取失败：目标标签进入 read-error；已有快照时保留正文、dirty 与已保存快照
        commit(
          updateTab(current, tabId, (target) => ({
            ...target,
            status: 'read-error',
            error: result.error,
          })),
        );
      }
    },
    [commit],
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

  const openTextFile = useCallback(
    (relativePath: string) => {
      const current = modelRef.current;
      const opened = openTab(current, relativePath);
      const tab = activeTab(opened);
      if (tab === null) {
        return;
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
    },
    [commit, readPath],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      commit(activateTabState(modelRef.current, tabId));
    },
    [commit],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      commit(closeTabState(modelRef.current, tabId));
    },
    [commit],
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
      const next =
        entry === undefined
          ? withReadRequest(current, tabId, requestId, tab.content)
          : updateTabRuntime(current, tabId, (runtimeEntry) => ({
              ...runtimeEntry,
              readRequestId: requestId,
            }));
      commit(next);
      readPath(tab.relativePath, tabId, requestId);
    },
    [commit, readPath],
  );

  const invalidateWorkspace = useCallback(() => {
    epochRef.current += 1;
    commit(invalidateTabsModel());
  }, [commit]);

  return { model, openTextFile, activateTab, closeTab, retryRead, invalidateWorkspace };
}
