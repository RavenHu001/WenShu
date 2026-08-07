/**
 * 每标签 CodeMirror 会话缓存 —— TASK-005 WP3（第 4.6 / 6.3 节）。
 *
 * 会话是 renderer 内的非序列化引用（`EditorState`、滚动位置快照），
 * 不得进入共享 IPC 契约、持久化数据或 React 状态。
 *
 * ## 生命周期
 *
 * - 宿主挂载时 `register` 会话（恢复缓存或新建），切出时 `capture`
 *   保存当前状态与滚动位置；
 * - 标签关闭或工作区失效后，已不在活动标签集合中的会话由本 hook 自动释放，
 *   不保留不可达的编辑器对象或闭包；
 * - DocumentPane 卸载（窗口关闭）时释放全部会话。
 *
 * ## 通知出口
 *
 * 同一标签的所有编辑器状态共用会话上的 `notify` 出口：宿主挂载时绑定
 * 当前内容回调，编辑器状态的 updateListener 经 `session.notify` 上报，
 * 因此切换标签重新挂载后仍指向最新回调，不残留组件闭包。
 */

import { useEffect, useRef } from 'react';
import type { EditorState, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** 单个标签的编辑器会话。 */
export interface EditorSession {
  /**
   * 编辑器状态（含正文、选区与撤销/重做历史）。
   * 运行时引用，只存在于 renderer；新建会话时先占位后赋真实状态。
   */
  state: EditorState;
  /** 最近一次切出时保存的滚动位置快照（`view.scrollSnapshot()` 的效果）。 */
  readonly scrollAnchor: StateEffect<unknown> | null;
  /**
   * 内容变化通知出口（可变）：宿主挂载时绑定当前内容回调；
   * 所有为该标签创建的编辑器状态都经它上报，保证不残留旧组件闭包。
   */
  notify: (content: string) => void;
  /** 保存请求出口（Ctrl+S，可变）：宿主挂载时绑定当前保存回调。 */
  requestSave: () => void;
}

/** 会话缓存操作：只暴露 Map 的最小子集。 */
export interface EditorSessions {
  readonly get: (tabId: string) => EditorSession | null;
  /** 宿主挂载时注册（新建会话或恢复缓存后重新绑定通知出口）。 */
  readonly register: (tabId: string, session: EditorSession) => void;
  /** 宿主切出时捕获视图状态与滚动位置。 */
  readonly capture: (tabId: string, view: EditorView) => void;
  /** 关闭标签时释放对应会话。 */
  readonly drop: (tabId: string) => void;
  /** 工作区失效 / 组件卸载时释放全部会话。 */
  readonly dropAll: () => void;
}

/**
 * 按 tabId 隔离的 CodeMirror 会话缓存。
 *
 * @param liveTabIds 当前仍存活的标签 id 集合（关闭标签 / 工作区失效后，
 *                   不在集合中的会话被自动释放）。
 */
export function useEditorSessions(liveTabIds: readonly string[]): EditorSessions {
  const sessionsRef = useRef(new Map<string, EditorSession>());

  // 关闭标签 / 工作区失效：释放已不在活动标签集合中的会话
  useEffect(() => {
    const live = new Set(liveTabIds);
    const sessions = sessionsRef.current;
    for (const tabId of [...sessions.keys()]) {
      if (!live.has(tabId)) {
        sessions.delete(tabId);
      }
    }
  }, [liveTabIds]);

  // DocumentPane 卸载（窗口关闭）：释放全部会话
  useEffect(() => {
    const sessions = sessionsRef.current;
    return () => {
      sessions.clear();
    };
  }, []);

  const api: EditorSessions = {
    get: (tabId) => sessionsRef.current.get(tabId) ?? null,
    register: (tabId, session) => {
      sessionsRef.current.set(tabId, session);
    },
    capture: (tabId, view) => {
      const existing = sessionsRef.current.get(tabId);
      sessionsRef.current.set(tabId, {
        state: view.state,
        scrollAnchor: view.scrollSnapshot(),
        notify: existing?.notify ?? (() => {}),
        requestSave: existing?.requestSave ?? (() => {}),
      });
    },
    drop: (tabId) => {
      sessionsRef.current.delete(tabId);
    },
    dropAll: () => {
      sessionsRef.current.clear();
    },
  };
  return api;
}
