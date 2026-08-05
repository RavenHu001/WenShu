/**
 * 单 TXT 文档编辑与保存状态管理 —— React hook，不引入全局状态库。
 *
 * ## 状态模型（TASK-004 第 7.2 节）
 *
 * - `welcome`：尚未选择文档；
 * - `loading`：正在读取；
 * - `loaded-clean`：正文与磁盘一致；
 * - `loaded-dirty`：存在未保存修改；
 * - `saving`：有保存请求在途（保存期间允许继续编辑）；
 * - `save-error`：保存失败，正文与 dirty 保留；
 * - `conflict`：磁盘内容已被外部修改，保存被拒绝，正文保留；
 * - `read-error`：读取失败；已有成功文档时保留原正文并可继续编辑。
 *
 * ## 保存竞态（TASK-004 第 4.3 / 7.2 节）
 *
 * - 同一文档同一时刻最多一个保存请求在途；
 * - 保存请求捕获发起时的正文与编辑修订编号；
 * - 保存成功清除 dirty 的充分条件：结果仍属于当前文档，且当前编辑修订编号
 *   仍等于该请求捕获的编号；否则只更新已保存基线，不清除后来产生的修改；
 * - 未修改（clean）时触发保存不调用 IPC；
 * - 文档已切换后返回的旧保存结果整体忽略。
 *
 * ## 读取竞态
 *
 * - 递增请求编号：先点 A、后点 B，即使 A 最后返回，也只能显示 B；
 * - 工作区成功切换时调用 `invalidate()`，使旧工作区未完成的结果失效；
 * - IPC Promise 意外拒绝转换为固定界面错误；
 * - 组件卸载后不再提交结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReadTextDocumentResult,
  SaveTextDocumentError,
  SaveTextDocumentResult,
  TextDocumentError,
  TextDocumentSnapshot,
} from '../../shared/document';

export type TextDocumentStatus =
  | 'welcome'
  | 'loading'
  | 'loaded-clean'
  | 'loaded-dirty'
  | 'saving'
  | 'save-error'
  | 'conflict'
  | 'read-error';

export interface TextDocumentUiState {
  readonly status: TextDocumentStatus;
  /** 文件树当前高亮的路径。 */
  readonly selectedRelativePath: string | null;
  /** 标签标题用文件名。 */
  readonly tabName: string | null;
  /** 最后一次成功读取 / 保存的已保存基线快照。 */
  readonly document: TextDocumentSnapshot | null;
  /** 编辑器当前正文（与编辑器状态同步）。 */
  readonly content: string;
  /** 是否存在未保存修改。 */
  readonly dirty: boolean;
  /** 是否有保存请求在途。 */
  readonly saving: boolean;
  /** 最近一次读取或保存错误；新的成功操作会清空。 */
  readonly error: TextDocumentError | SaveTextDocumentError | null;
}

const initialUiState: TextDocumentUiState = {
  status: 'welcome',
  selectedRelativePath: null,
  tabName: null,
  document: null,
  content: '',
  dirty: false,
  saving: false,
  error: null,
};

function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
}

export interface TextDocumentController {
  readonly state: TextDocumentUiState;
  /** 用户从文件树选择 TXT 时调用：发起受控读取并处理竞态。
   *  未保存修改的"放弃/取消"确认由界面层（App）在调用前完成。 */
  readonly openTextFile: (relativePath: string) => void;
  /** 编辑器正文变化时调用；只有真正变化才递增修订编号并标记 dirty。 */
  readonly editContent: (content: string) => void;
  /** 保存按钮与 Ctrl+S 共用入口：未修改或已有在途保存时无操作。
   *  传 `confirmMixedLineEndingNormalization: true` 表示用户已确认混合换行规范化。 */
  readonly save: (confirmMixedLineEndingNormalization?: boolean) => void;
  /** 冲突确认放弃后调用：丢弃本地修改并重新读取当前文档。 */
  readonly reload: () => void;
  /** 工作区成功切换时调用：清除旧文档并使未完成结果失效。 */
  readonly invalidate: () => void;
}

export function useTextDocument(): TextDocumentController {
  const [state, setState] = useState<TextDocumentUiState>(initialUiState);
  const readRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  /** 编辑修订编号：每次正文实际变化 +1，用于判定旧保存结果是否仍有效。 */
  const editRevisionRef = useRef(0);
  /** 当前文档相对路径快照，用于判定保存结果是否仍属于当前文档。 */
  const currentPathRef = useRef<string | null>(null);
  /** 是否有保存请求在途，防止同一文档并发保存。 */
  const saveInFlightRef = useRef(false);
  /** 最新的编辑正文与修订编号，供保存回调捕获（避免闭包过期）。 */
  const latestRef = useRef({ content: '', editRevision: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readPath = useCallback((relativePath: string) => {
    const requestId = ++readRequestIdRef.current;
    const failedName = fileNameFromRelativePath(relativePath);
    setState((prev) => ({
      ...prev,
      status: 'loading',
      selectedRelativePath: relativePath,
      tabName: failedName,
      error: null,
    }));

    const settle = (result: ReadTextDocumentResult): void => {
      if (!mountedRef.current || requestId !== readRequestIdRef.current) {
        return;
      }
      if (result.status === 'loaded') {
        const document = result.document;
        currentPathRef.current = document.relativePath;
        editRevisionRef.current = 0;
        latestRef.current = { content: document.content, editRevision: 0 };
        setState({
          ...initialUiState,
          status: 'loaded-clean',
          selectedRelativePath: document.relativePath,
          tabName: document.name,
          document,
          content: document.content,
        });
      } else {
        // 读取失败：保留已打开文档的正文与 dirty 状态，显示非阻塞错误
        setState((prev) => ({
          ...prev,
          status: 'read-error',
          selectedRelativePath: prev.document?.relativePath ?? relativePath,
          tabName: failedName,
          error: result.error,
        }));
      }
    };

    window.desktop.document
      .readText(relativePath)
      .then(settle)
      .catch(() =>
        settle({
          status: 'error',
          error: { code: 'READ_FAILED', message: '读取文件失败' },
        }),
      );
  }, []);

  const openTextFile = useCallback(
    (relativePath: string) => {
      readPath(relativePath);
    },
    [readPath],
  );

  const reload = useCallback(() => {
    const path = currentPathRef.current;
    if (path !== null) {
      readPath(path);
    }
  }, [readPath]);

  const editContent = useCallback(
    (content: string) => {
      const prev = state;
      const editable =
        prev.status === 'loaded-clean' ||
        prev.status === 'loaded-dirty' ||
        prev.status === 'saving' ||
        prev.status === 'save-error' ||
        prev.status === 'conflict' ||
        (prev.status === 'read-error' && prev.document !== null);
      if (!editable || prev.content === content) {
        return;
      }
      // 同步更新修订编号与最新正文：紧随其后的 save() 能捕获到本次编辑
      editRevisionRef.current += 1;
      latestRef.current = { content, editRevision: editRevisionRef.current };
      setState({
        ...prev,
        status: prev.status === 'loaded-clean' ? 'loaded-dirty' : prev.status,
        content,
        dirty: true,
        error: prev.status === 'save-error' || prev.status === 'conflict' ? null : prev.error,
      });
    },
    [state],
  );

  const save = useCallback(
    (confirmMixedLineEndingNormalization?: boolean) => {
      const path = currentPathRef.current;
      const base = latestRef.current;
      if (path === null || saveInFlightRef.current) {
        return;
      }
      const target = state.document;
      if (target === null) {
        return;
      }
      // 未修改文档触发保存时不执行磁盘写入
      if (state.status === 'loaded-clean') {
        return;
      }

      saveInFlightRef.current = true;
      const captured = {
        relativePath: path,
        content: base.content,
        editRevision: base.editRevision,
      };
      setState((prev) => ({ ...prev, status: 'saving', saving: true, error: null }));

      const settle = (result: SaveTextDocumentResult): void => {
        saveInFlightRef.current = false;
        if (!mountedRef.current) {
          return;
        }
        setState((prev) => {
          // 保存期间文档已被切换：旧结果整体忽略，不更新任何状态
          if (prev.selectedRelativePath !== captured.relativePath) {
            return prev;
          }
          if (result.status === 'saved') {
            const savedDocument = result.document;
            const stillClean = editRevisionRef.current === captured.editRevision;
            return {
              ...prev,
              status: stillClean ? 'loaded-clean' : 'loaded-dirty',
              saving: false,
              document: savedDocument,
              dirty: !stillClean,
              error: null,
              // 已保存基线版本更新，但正文保持用户当前输入
              content: prev.content,
            };
          }
          const conflict = result.error.code === 'CONFLICT';
          return {
            ...prev,
            status: conflict ? 'conflict' : 'save-error',
            saving: false,
            dirty: true,
            error: result.error,
          };
        });
      };

      window.desktop.document
        .saveText({
          relativePath: captured.relativePath,
          content: captured.content,
          expectedRevision: target.revision,
          ...(confirmMixedLineEndingNormalization === true
            ? { confirmMixedLineEndingNormalization: true }
            : {}),
        })
        .then(settle)
        .catch(() =>
          settle({
            status: 'error',
            error: { code: 'WRITE_FAILED', message: '写入文件失败' },
          }),
        );
    },
    [state.document, state.status],
  );

  const invalidate = useCallback(() => {
    readRequestIdRef.current += 1;
    saveInFlightRef.current = false;
    currentPathRef.current = null;
    editRevisionRef.current = 0;
    latestRef.current = { content: '', editRevision: 0 };
    setState(initialUiState);
  }, []);

  return { state, openTextFile, editContent, save, reload, invalidate };
}
