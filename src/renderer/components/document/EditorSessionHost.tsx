/**
 * 每标签 CodeMirror 编辑器宿主 —— TASK-005 WP3 / TASK-006 WP6（第 4.6 / 6.3 节）。
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
 * ## 配置范围（TASK-004 第 4.2 节 + TASK-006 第 4.2 节）
 *
 * 纯文本编辑、撤销重做、保存快捷键（Mod-s）与 CodeMirror 当前文件查找替换：
 * `Ctrl+F`（Mod-f）打开查找面板、`Ctrl+H`（Mod-h）打开面板并聚焦替换输入、
 * `F3` / `Mod-g` 下一个、`Shift-F3` / `Mod-Shift-g` 上一个、替换当前项与全部替换。
 * 查找面板、查询、大小写选项、选区与历史都保存在 EditorState 中，随会话缓存
 * 按 tabId 天然隔离；替换通过普通编辑事务进入撤销历史，不绕过编辑器。
 * 不加入语法高亮、自动补全或复杂快捷键体系。
 */

import { useEffect, useRef, type RefObject } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, panels, type KeyBinding } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { openSearchPanel, search, searchKeymap, searchPanelOpen } from '@codemirror/search';
import type { EditorSession, EditorSessions } from '../../lib/use-editor-sessions';

/** 搜索结果定位目标：由 App 校验通过后下发，宿主在视图就绪时应用选区并滚动聚焦。 */
export interface EditorLocateTarget {
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
}

export type EditorSearchMode = 'find' | 'replace';

/** 供左侧搜索栏按钮调用的当前编辑器查找入口。 */
export interface EditorSearchControls {
  readonly open: (mode: EditorSearchMode) => void;
}

export interface EditorSessionHostProps {
  /** 稳定标签 id：会话缓存键。 */
  readonly tabId: string;
  /** 外部正文（磁盘读取结果 / 已保存基线）；与编辑器当前内容不一致时视为外部替换。 */
  readonly content: string;
  /**
   * 编辑器内部使用的统一换行符。CodeMirror 的 Text 文档按行存储，必须通过
   * `EditorState.lineSeparator` 与 `sliceDoc()` 显式保持 CRLF；混合换行由调用方
   * 按既定 dominant 规则选择一种表示，原始 mixed 元数据仍保留在文档快照中。
   */
  readonly lineSeparator?: '\n' | '\r\n';
  /** 用户输入导致的正文变化回调。 */
  readonly onContentChange: (content: string) => void;
  /** Ctrl+S / Cmd+S 保存请求回调（目标标签由挂载中的宿主决定）。 */
  readonly onSaveRequest: () => void;
  /**
   * 待应用的搜索结果定位目标（仅当目标标签与本宿主一致时生效）。
   * 同一目标对象只应用一次（appliedLocateRef 守卫），防止普通 rerender 重复抢焦点（第 6.7 节）。
   */
  readonly locateTarget?: EditorLocateTarget | null;
  /** 每标签会话缓存。 */
  readonly sessions: EditorSessions;
  /** 搜索侧栏中的 CodeMirror 面板挂载点；避免面板继续占用编辑区底部。 */
  readonly searchPanelHostRef?: RefObject<HTMLElement | null>;
  /** 快捷键或鼠标请求打开当前文档查找时，通知 App 切换到搜索侧栏。 */
  readonly onSearchPanelRequest?: (mode: EditorSearchMode) => void;
  /** 活动编辑器挂载/卸载时暴露或清理鼠标查找入口。 */
  readonly onSearchControlsChange?: (controls: EditorSearchControls | null) => void;
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

/**
 * Ctrl+H（Mod-h）：打开查找/替换面板并聚焦替换输入。
 * CodeMirror 的搜索面板同时包含查找与替换界面（非只读时替换行始终渲染），
 * 这里只打开面板并聚焦替换字段，不使用私有 DOM 状态。
 */
function focusSearchField(view: EditorView, mode: EditorSearchMode): void {
  const fieldName = mode === 'replace' ? 'replace' : 'search';
  const field = view.dom.ownerDocument.querySelector<HTMLInputElement>(
    `.cm-search input[name="${fieldName}"]`,
  );
  field?.focus();
  field?.select();
}

/** 打开侧栏内的统一查找/替换面板，并按入口聚焦对应输入框。 */
function openSidebarSearchPanel(
  view: EditorView,
  mode: EditorSearchMode,
  session: EditorSession,
): boolean {
  session.requestSearchPanel(mode);
  if (!searchPanelOpen(view.state)) {
    openSearchPanel(view);
  }
  focusSearchField(view, mode);
  // 从文件侧栏切换过来时 React 会在本次事件后移除 hidden；再聚焦一次保证真实浏览器可用。
  window.setTimeout(() => {
    if (view.dom.isConnected) {
      focusSearchField(view, mode);
    }
  }, 0);
  return true;
}

/** 创建会话：编辑器状态的 updateListener 经 `session.notify` 上报最新内容。 */
function normalizeLineSeparators(doc: string, lineSeparator: '\n' | '\r\n'): string {
  const lfNormalized = doc.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return lineSeparator === '\n' ? lfNormalized : lfNormalized.replace(/\n/g, '\r\n');
}

function createEditorState(
  doc: string,
  lineSeparator: '\n' | '\r\n',
  session: EditorSession,
  searchPanelHost: HTMLElement | null,
): EditorState {
  const extensions: Extension[] = [
    EditorState.lineSeparator.of(lineSeparator),
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      {
        key: 'Mod-f',
        run: (view) => openSidebarSearchPanel(view, 'find', session),
      },
      {
        key: 'Mod-h',
        run: (view) => openSidebarSearchPanel(view, 'replace', session),
      },
      ...searchKeymap,
      saveBinding(() => session.requestSave()),
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        session.notify(update.state.sliceDoc());
      }
    }),
    // 当前文件查找替换：面板、查询与大小写选项保存在 EditorState 中，随会话缓存按 tabId 隔离
    search(),
    ...(searchPanelHost !== null ? [panels({ bottomContainer: searchPanelHost })] : []),
    EditorState.phrases.of({
      Find: '查找',
      Replace: '替换为',
      next: '下一个',
      previous: '上一个',
      all: '全选',
      'match case': '区分大小写',
      regexp: '正则表达式',
      'by word': '全字匹配',
      replace: '替换',
      'replace all': '全部替换',
      close: '关闭',
    }),
  ];
  return EditorState.create({ doc: normalizeLineSeparators(doc, lineSeparator), extensions });
}

/**
 * 新建会话：先占位再赋状态，使 updateListener 能够引用会话对象本身；
 * 之后宿主挂载会把 `notify` / `requestSave` 绑定到最新回调。
 */
function createSession(
  doc: string,
  lineSeparator: '\n' | '\r\n',
  notify: (content: string) => void,
  requestSave: () => void,
  requestSearchPanel: (mode: EditorSearchMode) => void,
  searchPanelHost: HTMLElement | null,
): EditorSession {
  const session: EditorSession = {
    // 立即在下一行赋值为真实状态：仅供 updateListener 引用会话对象
    state: undefined as unknown as EditorState,
    scrollAnchor: null,
    notify,
    requestSave,
    requestSearchPanel,
  };
  session.state = createEditorState(doc, lineSeparator, session, searchPanelHost);
  return session;
}

export function EditorSessionHost({
  tabId,
  content,
  lineSeparator = '\n',
  onContentChange,
  onSaveRequest,
  locateTarget = null,
  sessions,
  searchPanelHostRef,
  onSearchPanelRequest,
  onSearchControlsChange,
}: EditorSessionHostProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentChangeRef = useRef(onContentChange);
  const saveRequestRef = useRef(onSaveRequest);
  const searchPanelRequestRef = useRef(onSearchPanelRequest);
  const contentRef = useRef(content);
  const sessionsRef = useRef(sessions);
  /** 已应用过的定位目标：同一对象只应用一次（rerender 不重复抢焦点）。 */
  const appliedLocateRef = useRef<EditorLocateTarget | null>(null);

  useEffect(() => {
    contentChangeRef.current = onContentChange;
    saveRequestRef.current = onSaveRequest;
    searchPanelRequestRef.current = onSearchPanelRequest;
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
    const searchPanelHost = searchPanelHostRef?.current ?? null;
    const doc = contentRef.current;
    const existing = api.get(tabId);
    const expectedDoc = normalizeLineSeparators(doc, lineSeparator);
    const cachedValid =
      existing !== null &&
      existing.state.sliceDoc() === expectedDoc &&
      existing.state.lineBreak === lineSeparator;
    let session = existing;
    if (session === null || !cachedValid) {
      session = createSession(
        doc,
        lineSeparator,
        (text) => contentChangeRef.current(text),
        () => saveRequestRef.current(),
        (mode) => searchPanelRequestRef.current?.(mode),
        searchPanelHost,
      );
      api.register(tabId, session);
    }
    // 重新绑定出口：切换标签重新挂载后仍指向当前内容/保存回调
    session.notify = (text) => contentChangeRef.current(text);
    session.requestSave = () => saveRequestRef.current();
    session.requestSearchPanel = (mode) => searchPanelRequestRef.current?.(mode);
    const view = new EditorView({ state: session.state, parent: container });
    if (cachedValid && session.scrollAnchor !== null) {
      // 恢复滚动位置：scrollSnapshot() 返回的是滚动效果，经 dispatch 应用
      view.dispatch({ effects: session.scrollAnchor });
    }
    viewRef.current = view;
    onSearchControlsChange?.({
      open: (mode) => openSidebarSearchPanel(view, mode, session),
    });
    return () => {
      if (viewRef.current === view) {
        api.capture(tabId, view);
      }
      view.destroy();
      viewRef.current = null;
      onSearchControlsChange?.(null);
    };
  }, [tabId, lineSeparator]);

  // 外部正文替换：编辑器内容与 content 不一致时重建状态并清空撤销历史
  useEffect(() => {
    const view = viewRef.current;
    const expectedDoc = normalizeLineSeparators(content, lineSeparator);
    if (
      view === null ||
      (view.state.sliceDoc() === expectedDoc && view.state.lineBreak === lineSeparator)
    ) {
      return;
    }
    const api = sessionsRef.current;
    let session = api.get(tabId);
    if (session === null) {
      session = createSession(
        content,
        lineSeparator,
        (text) => contentChangeRef.current(text),
        () => saveRequestRef.current(),
        (mode) => searchPanelRequestRef.current?.(mode),
        searchPanelHostRef?.current ?? null,
      );
      api.register(tabId, session);
    }
    view.setState(
      createEditorState(content, lineSeparator, session, searchPanelHostRef?.current ?? null),
    );
  }, [content, lineSeparator, tabId]);

  // 搜索结果定位：视图就绪后校验当前正文范围，命中则设置选区、滚动到可视区域并聚焦。
  // 同一目标对象只应用一次（appliedLocateRef 守卫），普通 rerender 不会重复抢焦点（第 6.7 节）。
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || locateTarget === null || appliedLocateRef.current === locateTarget) {
      return;
    }
    appliedLocateRef.current = locateTarget;
    const doc = view.state.doc;
    const safeFrom = Math.max(0, Math.min(locateTarget.from, doc.length));
    const safeTo = Math.max(safeFrom, Math.min(locateTarget.to, doc.length));
    if (doc.sliceString(safeFrom, safeTo) !== locateTarget.matchedText) {
      // 实时正文与结果匹配文本不一致：不选中、不改正文
      return;
    }
    view.dispatch({
      selection: { anchor: safeFrom, head: safeTo },
      effects: EditorView.scrollIntoView(safeFrom, { y: 'center' }),
    });
    view.focus();
  }, [locateTarget, tabId]);

  return <div className="doc-editor" ref={containerRef} aria-label="TXT 编辑器" />;
}
