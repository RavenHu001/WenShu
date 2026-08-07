/**
 * 每标签 CodeMirror 编辑器宿主 —— TASK-005 WP3（第 4.6 / 6.3 节）。
 *
 * ## 职责
 *
 * - 为当前活动标签挂载唯一一个编辑器视图；调用方以 `key={tabId}` 渲染本组件，
 *   标签切换即卸载/挂载，宿主在卸载前捕获状态与滚动位置、挂载时恢复；
 * - 首次加载、外部正文替换（重试成功、冲突确认后的重新读取等）创建
 *   新的编辑器状态并清除旧撤销历史；普通标签切换恢复缓存，不清空历史；
 * - 用户输入只通过 `onContentChange` 上报，切换与恢复不触发上报；
 * - 编辑器状态经会话缓存（`use-editor-sessions.ts`）持有，同一标签的所有状态
 *   共用会话通知出口，不残留组件闭包；
 * - 空文件可正常获得焦点并输入；组件卸载后销毁编辑器。
 *
 * ## 配置范围（TASK-004 第 4.2 节）
 *
 * 仅纯文本编辑、原生选择复制剪切粘贴、撤销重做与保存快捷键（Mod-s）；
 * 不加入语法高亮、查找替换、自动补全或复杂快捷键体系。
 */

import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { EditorSession, EditorSessions } from '../../lib/use-editor-sessions';

export interface EditorSessionHostProps {
  /** 稳定标签 id：会话缓存键。 */
  readonly tabId: string;
  /** 外部正文（磁盘读取结果 / 已保存基线）；与编辑器当前内容不一致时视为外部替换。 */
  readonly content: string;
  /** 用户输入导致的正文变化回调。 */
  readonly onContentChange: (content: string) => void;
  /** Ctrl+S / Cmd+S 保存请求回调（目标标签由挂载中的宿主决定）。 */
  readonly onSaveRequest: () => void;
  /** 每标签会话缓存。 */
  readonly sessions: EditorSessions;
}

/** 保存快捷键绑定：run 必须返回 true，表示快捷键已被处理。 */
function saveBinding(requestSave: () => void): KeyBinding {
  return {
    key: 'Mod-s',
    run: () => {
      requestSave();
      return true;
    },
  };
}

/** 创建会话：编辑器状态的 updateListener 经 `session.notify` 上报最新内容。 */
function createEditorState(doc: string, session: EditorSession): EditorState {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, saveBinding(() => session.requestSave())]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        session.notify(update.state.doc.toString());
      }
    }),
  ];
  return EditorState.create({ doc, extensions });
}

/**
 * 新建会话：先占位再赋状态，使 updateListener 能够引用会话对象本身；
 * 之后宿主挂载会把 `notify` / `requestSave` 绑定到最新回调。
 */
function createSession(
  doc: string,
  notify: (content: string) => void,
  requestSave: () => void,
): EditorSession {
  const session: EditorSession = {
    // 立即在下一行赋值为真实状态：仅供 updateListener 引用会话对象
    state: undefined as unknown as EditorState,
    scrollAnchor: null,
    notify,
    requestSave,
  };
  session.state = createEditorState(doc, session);
  return session;
}

export function EditorSessionHost({
  tabId,
  content,
  onContentChange,
  onSaveRequest,
  sessions,
}: EditorSessionHostProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentChangeRef = useRef(onContentChange);
  const saveRequestRef = useRef(onSaveRequest);
  const contentRef = useRef(content);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
    saveRequestRef.current = onSaveRequest;
  });
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    sessionsRef.current = sessions;
  });

  // 挂载：恢复缓存会话或创建新状态；卸载：捕获当前状态与滚动位置
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const api = sessionsRef.current;
    const doc = contentRef.current;
    const existing = api.get(tabId);
    const cachedValid = existing !== null && existing.state.doc.toString() === doc;
    let session = existing;
    if (session === null || !cachedValid) {
      session = createSession(
        doc,
        (text) => contentChangeRef.current(text),
        () => saveRequestRef.current(),
      );
      api.register(tabId, session);
    }
    // 重新绑定出口：切换标签重新挂载后仍指向当前内容/保存回调
    session.notify = (text) => contentChangeRef.current(text);
    session.requestSave = () => saveRequestRef.current();
    const view = new EditorView({ state: session.state, parent: container });
    if (cachedValid && session.scrollAnchor !== null) {
      // 恢复滚动位置：scrollSnapshot() 返回的是滚动效果，经 dispatch 应用
      view.dispatch({ effects: session.scrollAnchor });
    }
    viewRef.current = view;
    return () => {
      if (viewRef.current === view) {
        api.capture(tabId, view);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [tabId]);

  // 外部正文替换：编辑器内容与 content 不一致时重建状态并清空撤销历史
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === content) {
      return;
    }
    const api = sessionsRef.current;
    let session = api.get(tabId);
    if (session === null) {
      session = createSession(
        content,
        (text) => contentChangeRef.current(text),
        () => saveRequestRef.current(),
      );
      api.register(tabId, session);
    }
    view.setState(createEditorState(content, session));
  }, [content, tabId]);

  return <div className="doc-editor" ref={containerRef} aria-label="TXT 编辑器" />;
}
