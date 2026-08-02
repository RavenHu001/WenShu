/**
 * 单只读 TXT 文档状态管理 —— React hook，不引入全局状态库。
 *
 * ## 竞态保护
 *
 * - 递增请求编号：先点 A、后点 B，即使 A 最后返回，也只能显示 B；
 * - 工作区成功切换时调用 `invalidate()`，使旧工作区尚未完成的读取结果失效；
 * - IPC Promise 意外拒绝转换为固定界面错误，不产生未处理 rejection；
 * - 组件卸载后（mountedRef）不再提交过期结果。
 *
 * ## 状态语义
 *
 * - `lastDocument` 保留最后一次成功读取的快照：新读取失败时正文不丢失；
 * - `tabName` 始终表示用户最近一次选择/读取的文件名；
 * - 新的成功读取清除旧错误。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReadTextDocumentResult,
  TextDocumentError,
  TextDocumentSnapshot,
} from '../../shared/document';

export type TextDocumentStatus = 'welcome' | 'loading' | 'loaded' | 'error';

export interface TextDocumentUiState {
  readonly status: TextDocumentStatus;
  /** 文件树当前高亮的路径；失败并保留旧正文时回退到上一次成功文档。 */
  readonly selectedRelativePath: string | null;
  /** 用户最近一次选择/读取的文件名（不含路径），用于标签页标题与提示。 */
  readonly tabName: string | null;
  /** 最后一次成功读取的文档快照；读取失败时保留。 */
  readonly lastDocument: TextDocumentSnapshot | null;
  /** 最近一次读取的错误；新的成功读取会清空。 */
  readonly error: TextDocumentError | null;
}

const initialUiState: TextDocumentUiState = {
  status: 'welcome',
  selectedRelativePath: null,
  tabName: null,
  lastDocument: null,
  error: null,
};

function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
}

export interface TextDocumentController {
  readonly state: TextDocumentUiState;
  /** 用户从文件树选择 TXT 时调用：发起受控读取并处理竞态。 */
  readonly openTextFile: (relativePath: string) => void;
  /** 工作区成功切换时调用：清除旧文档并使未完成读取失效。 */
  readonly invalidate: () => void;
}

export function useTextDocument(): TextDocumentController {
  const [state, setState] = useState<TextDocumentUiState>(initialUiState);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openTextFile = useCallback((relativePath: string) => {
    const requestId = ++requestIdRef.current;
    const failedName = fileNameFromRelativePath(relativePath);
    setState((prev) => ({
      status: 'loading',
      selectedRelativePath: relativePath,
      tabName: failedName,
      lastDocument: prev.lastDocument,
      error: null,
    }));

    const settle = (result: ReadTextDocumentResult): void => {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      if (result.status === 'loaded') {
        setState({
          status: 'loaded',
          selectedRelativePath: result.document.relativePath,
          tabName: result.document.name,
          lastDocument: result.document,
          error: null,
        });
      } else {
        setState((prev) => ({
          status: 'error',
          selectedRelativePath: prev.lastDocument?.relativePath ?? relativePath,
          tabName: failedName,
          lastDocument: prev.lastDocument,
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

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
    setState(initialUiState);
  }, []);

  return { state, openTextFile, invalidate };
}
