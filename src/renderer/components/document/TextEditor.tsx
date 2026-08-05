/**
 * CodeMirror 6 纯文本编辑器封装（TASK-004 第 7.3 节）。
 *
 * ## 职责
 *
 * - 编辑器实例的创建、替换与销毁全部封装在本组件内；
 * - 文档切换（外部 `content` 变化且与编辑器当前内容不同）时重建编辑器状态，
 *   不把上一文档的撤销历史带入下一文档；
 * - 用户输入只通过 `onContentChange` 上报，React 不感知每次按键的中间状态；
 * - `Mod-s`（Ctrl+S / Cmd+S）触发 `onSaveRequest`；
 * - 内容不通过 `innerHTML` 注入（CodeMirror 内部管理 contentDOM）；
 * - 空文件可正常获得焦点并输入；
 * - 组件卸载后销毁编辑器，不再提交任何状态。
 *
 * ## 配置范围（TASK-004 第 4.2 节）
 *
 * 仅纯文本编辑、原生选择复制剪切粘贴、撤销重做与保存快捷键；
 * 不加入语法高亮、查找替换、多光标定制、自动补全或复杂快捷键体系。
 */

import { useCallback, useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

export interface TextEditorProps {
  /** 外部正文：编辑器当前内容与之不同时视为文档切换，重建状态。 */
  readonly content: string;
  /** 用户输入导致的正文变化回调。 */
  readonly onContentChange: (content: string) => void;
  /** Ctrl+S / Cmd+S 快捷键回调。 */
  readonly onSaveRequest: () => void;
}

/** 保存快捷键绑定：run 必须返回 true，表示快捷键已被处理。 */
function saveBinding(saveRequest: () => void): KeyBinding {
  return {
    key: 'Mod-s',
    run: () => {
      saveRequest();
      return true;
    },
  };
}

/** 创建编辑器状态：纯文本编辑、撤销重做、保存快捷键、自动换行。 */
function createEditorState(
  doc: string,
  contentChange: (content: string) => void,
  saveRequest: () => void,
): EditorState {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, saveBinding(saveRequest)]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        contentChange(update.state.doc.toString());
      }
    }),
  ];
  return EditorState.create({ doc, extensions });
}

export function TextEditor({
  content,
  onContentChange,
  onSaveRequest,
}: TextEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentChangeRef = useRef(onContentChange);
  const saveRequestRef = useRef(onSaveRequest);
  /** 外部替换期间抑制 updateListener 上报，避免把文档切换误判为用户编辑。 */
  const suppressChangeRef = useRef(false);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
    saveRequestRef.current = onSaveRequest;
  });

  const createState = useCallback(
    (doc: string): EditorState =>
      createEditorState(
        doc,
        (text) => {
          if (!suppressChangeRef.current) {
            contentChangeRef.current(text);
          }
        },
        () => saveRequestRef.current(),
      ),
    [],
  );

  // 挂载时创建编辑器；卸载时销毁
  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }
    const view = new EditorView({
      state: createState(content),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 创建与销毁只依赖空依赖数组：编辑器生命周期与外部内容无关
  }, []);

  // 外部内容变化（文档切换 / 恢复）：与编辑器当前内容不同时替换状态，清空撤销历史
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === content) {
      return;
    }
    suppressChangeRef.current = true;
    view.setState(createState(content));
    suppressChangeRef.current = false;
  }, [content, createState]);

  return <div className="doc-editor" ref={containerRef} aria-label="TXT 编辑器" />;
}
