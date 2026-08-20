/**
 * TASK-010 WP2 ProseMirror current-search 插件与每标签 controller（任务第 6.2 节）。
 *
 * ## 结构
 *
 * - PluginKey「wenshu-current-search」持有每 editor 的查找状态（open/query/caseSensitive/
 *   matches/currentIndex/truncated/validationError/decorations/generation）；
 * - DecorationSet 直接存入插件状态：普通/当前匹配使用不同 class，文档事务经
 *   「value.decorations.map(tr.mapping, newState.doc)」安全更新，重算后整体替换；
 * - 重算调度采用 WP0 冻结的最小刷新策略：编辑事务/输入变化后**每 tick 只调度一次**
 *   （「scheduled」合并），执行时同步全量重算（投影 + 扫描 + 映射 + 装饰），并带
 *   generation 与销毁守卫；不引入 debounce 定时器、worker、索引或持久缓存；
 * - 每 editor 一个插件实例 + 一个 controller；controller 提供快照订阅
 *   （useSyncExternalStore 兼容）、open/close/setQuery/setCaseSensitive/next/previous，
 *   全部只 dispatch 非文档事务（selection + meta），不修改 doc、不 dirty、不进撤销历史；
 * - 本模块不接 SearchSidebar/App，不实现替换 transaction，不新增依赖/IPC/preload。
 */

import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import {
  CURRENT_SEARCH_INPUT_ERROR_MESSAGES,
  nextCurrentIndex,
  pickInitialCurrentIndex,
  pickRecentCurrentIndex,
  previousCurrentIndex,
  projectPmTextblocks,
  searchCurrentDocProjection,
  validateCurrentSearchQuery,
  type PmMatch,
  type PmTextBlock,
} from './docx-current-search';

/** 普通匹配装饰 class。 */
export const CURRENT_SEARCH_MATCH_CLASS = 'wenshu-search-match';
/** 当前匹配装饰 class（与普通 class 同时存在，不只依赖颜色区分）。 */
export const CURRENT_SEARCH_CURRENT_CLASS = 'wenshu-search-current';

/** 项目自有 PluginKey：每 editor 一个插件实例（稳定 tabId 由 controller 绑定）。 */
export const currentSearchPluginKey = new PluginKey<CurrentSearchPluginState>(
  'wenshu-current-search',
);

/** 插件持有的查找状态（运行时对象，不跨 IPC；doc 变化时由 apply 映射装饰、由重算刷新）。 */
export interface CurrentSearchPluginState {
  readonly open: boolean;
  readonly query: string;
  /** 替换输入（WP4 使用；WP2 只保存不实现替换）。 */
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly PmMatch[];
  readonly currentIndex: number | null;
  readonly truncated: boolean;
  readonly validationError: string | null;
  readonly decorations: DecorationSet;
  /** 每次状态变更/重算递增：快照通知与异步回调的陈旧性判断基准。 */
  readonly generation: number;
}

/** controller 暴露给 UI 的只读快照（任务第 5.1 节形状，不含 DecorationSet）。 */
export interface DocxCurrentSearchSnapshot {
  readonly open: boolean;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly PmMatch[];
  readonly currentIndex: number | null;
  readonly truncated: boolean;
  readonly validationError: string | null;
  readonly generation: number;
}

/** 插件回调钩子：controller 绑定状态通知；测试可注入重算计数。 */
export interface CurrentSearchPluginHooks {
  /** 插件状态变化（含 meta-only 事务与重算）后调用；destroy 后置回 null。 */
  onStateChange: ((state: CurrentSearchPluginState) => void) | null;
  /** 每次实际重算完成后调用（WP2 调度成本观察用）。 */
  onRecompute: ((state: CurrentSearchPluginState) => void) | null;
}

function emptyPluginState(): CurrentSearchPluginState {
  return {
    open: false,
    query: '',
    replacement: '',
    caseSensitive: false,
    matches: [],
    currentIndex: null,
    truncated: false,
    validationError: null,
    decorations: DecorationSet.empty,
    generation: 0,
  };
}

function toSnapshot(state: CurrentSearchPluginState): DocxCurrentSearchSnapshot {
  return {
    open: state.open,
    query: state.query,
    replacement: state.replacement,
    caseSensitive: state.caseSensitive,
    matches: state.matches,
    currentIndex: state.currentIndex,
    truncated: state.truncated,
    validationError: state.validationError,
    generation: state.generation,
  };
}

const EMPTY_SNAPSHOT: DocxCurrentSearchSnapshot = {
  open: false,
  query: '',
  replacement: '',
  caseSensitive: false,
  matches: [],
  currentIndex: null,
  truncated: false,
  validationError: null,
  generation: 0,
};

/** 从实时 PM 文档按公开节点 API 深度优先收集 textblock（顺序与模型投影一致）。 */
export function collectPmTextblocks(doc: PmNode): readonly PmTextBlock[] {
  const blocks: PmTextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ text: node.textContent, pos });
    }
    return true;
  });
  return blocks;
}

/** 由匹配列表构建普通/当前匹配 DecorationSet（当前项同时带两个 class）。 */
export function buildCurrentSearchDecorations(
  doc: PmNode,
  matches: readonly PmMatch[],
  currentIndex: number | null,
): DecorationSet {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.pmFrom, match.pmTo, {
      class:
        index === currentIndex
          ? CURRENT_SEARCH_MATCH_CLASS + ' ' + CURRENT_SEARCH_CURRENT_CLASS
          : CURRENT_SEARCH_MATCH_CLASS,
    }),
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * 创建项目自有 current-search 插件（每 editor 安装一次）。
 *
 * 重算调度：编辑事务或输入/开关变化后，每个微任务 tick 只排队一次重算
 * （「scheduled」合并）；执行时读取**当时**的最新 doc/query（快速输入天然只采用
 * 最新结果），同步完成投影-扫描-映射-装饰并通过 meta 事务写回插件状态。
 * 异步回调带「requestGeneration」与销毁守卫：旧 editor/旧计算绝不回报。
 */
export function createCurrentSearchPlugin(
  hooks: CurrentSearchPluginHooks,
): Plugin<CurrentSearchPluginState> {
  let disposed = false;
  let scheduled = false;
  let requestGeneration = 0;
  const hooksRef = { current: hooks };

  const schedule = (view: EditorView): void => {
    if (disposed || scheduled) {
      return;
    }
    scheduled = true;
    const capturedGeneration = ++requestGeneration;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed || view.isDestroyed) {
        return;
      }
      if (capturedGeneration !== requestGeneration) {
        return; // 期间又调度过：只提交最新请求
      }
      const state = currentSearchPluginKey.getState(view.state);
      if (state === undefined || !state.open) {
        return;
      }
      recompute(view, state);
    });
  };

  const recompute = (view: EditorView, prev: CurrentSearchPluginState): void => {
    const doc = view.state.doc;
    const projection = projectPmTextblocks(collectPmTextblocks(doc));
    const validation = validateCurrentSearchQuery(prev.query);
    let matches: readonly PmMatch[] = [];
    let truncated = false;
    let validationError: string | null = null;
    if (validation.ok) {
      const outcome = searchCurrentDocProjection(projection, prev.query, prev.caseSensitive);
      matches = outcome.matches;
      truncated = outcome.truncated;
    } else {
      validationError = CURRENT_SEARCH_INPUT_ERROR_MESSAGES[validation.error];
    }
    let currentIndex: number | null = null;
    if (matches.length > 0) {
      const previousAnchor =
        prev.currentIndex !== null &&
        prev.currentIndex >= 0 &&
        prev.currentIndex < prev.matches.length
          ? prev.matches[prev.currentIndex]!.pmFrom
          : null;
      currentIndex =
        previousAnchor === null
          ? pickInitialCurrentIndex(matches, view.state.selection.from)
          : pickRecentCurrentIndex(matches, previousAnchor);
    }
    const decorations = buildCurrentSearchDecorations(doc, matches, currentIndex);
    const next: CurrentSearchPluginState = {
      ...prev,
      matches,
      currentIndex,
      truncated,
      validationError,
      decorations,
      generation: prev.generation + 1,
    };
    view.dispatch(view.state.tr.setMeta(currentSearchPluginKey, next));
    hooksRef.current.onRecompute?.(next);
  };

  return new Plugin({
    key: currentSearchPluginKey,
    state: {
      init: () => emptyPluginState(),
      apply: (tr, value, _oldState, newState) => {
        const meta = tr.getMeta(currentSearchPluginKey);
        if (meta !== undefined) {
          return meta as CurrentSearchPluginState;
        }
        if (!tr.docChanged) {
          return value;
        }
        const decorations = value.decorations.map(tr.mapping, newState.doc);
        if (!value.open) {
          // 外部 setContent/编辑发生在面板关闭时：保留 query/选项，清空过期匹配与装饰
          // （generation +1：清空也是可观察状态变化，快照订阅必须收到通知）
          return {
            ...value,
            decorations,
            matches: [],
            currentIndex: null,
            truncated: false,
            generation: value.generation + 1,
          };
        }
        return { ...value, decorations };
      },
    },
    props: {
      decorations(state) {
        return currentSearchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view: () => ({
      update: (view, prevState) => {
        const prev = currentSearchPluginKey.getState(prevState);
        const next = currentSearchPluginKey.getState(view.state);
        if (prev === undefined || next === undefined || prev === next) {
          return;
        }
        hooksRef.current.onStateChange?.(next);
        const docChanged = prevState.doc !== view.state.doc;
        const inputChanged =
          prev.open !== next.open ||
          prev.query !== next.query ||
          prev.caseSensitive !== next.caseSensitive;
        if (next.open && (docChanged || inputChanged)) {
          schedule(view);
        }
      },
      destroy: () => {
        disposed = true;
        hooksRef.current.onStateChange = null;
        hooksRef.current.onRecompute = null;
      },
    }),
  });
}

/**
 * 每稳定 tabId 的查找 controller：窄接口 + 快照订阅。
 *
 * - 「tabId」只作身份标签（不推导 editor/路径）；controller 与 editor 一一对应；
 * - 所有写操作只 dispatch 非文档事务（meta 或 selection+meta），不修改正文、
 *   不 dirty、不进撤销历史；
 * - 异步回调经插件 generation/销毁守卫；controller.destroy 后不再通知/不再 dispatch。
 */
export class DocxCurrentSearchController {
  private readonly hooks: CurrentSearchPluginHooks;
  private readonly listeners = new Set<() => void>();
  private lastSnapshot: DocxCurrentSearchSnapshot | null = null;
  private disposed = false;

  constructor(
    readonly tabId: string,
    private readonly editor: Editor,
    hooks: CurrentSearchPluginHooks,
  ) {
    this.hooks = hooks;
    this.hooks.onStateChange = (state) => this.handleStateChange(state);
  }

  getSnapshot(): DocxCurrentSearchSnapshot {
    const state = this.readState();
    if (state !== undefined) {
      const snapshot = toSnapshot(state);
      if (this.lastSnapshot === null || !snapshotsEqual(this.lastSnapshot, snapshot)) {
        this.lastSnapshot = snapshot;
      }
    }
    return this.lastSnapshot ?? EMPTY_SNAPSHOT;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(mode: 'find' | 'replace'): void {
    // WP2 只切换打开状态；mode 供 WP3 决定聚焦查找/替换输入框
    void mode;
    this.update((state) => ({ ...state, open: true, generation: state.generation + 1 }));
  }

  close(): void {
    this.update((state) => ({
      ...state,
      open: false,
      decorations: DecorationSet.empty,
      generation: state.generation + 1,
    }));
  }

  setQuery(query: string): void {
    this.update((state) => ({ ...state, query, generation: state.generation + 1 }));
  }

  setCaseSensitive(value: boolean): void {
    this.update((state) => ({ ...state, caseSensitive: value, generation: state.generation + 1 }));
  }

  selectNext(): void {
    this.navigate(1);
  }

  selectPrevious(): void {
    this.navigate(-1);
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.hooks.onStateChange = null;
    this.listeners.clear();
  }

  private readState(): CurrentSearchPluginState | undefined {
    if (this.disposed) {
      return undefined;
    }
    return currentSearchPluginKey.getState(this.editor.view.state);
  }

  private update(updater: (state: CurrentSearchPluginState) => CurrentSearchPluginState): void {
    if (this.disposed) {
      return;
    }
    const view = this.editor.view;
    const state = currentSearchPluginKey.getState(view.state);
    if (state === undefined) {
      return;
    }
    view.dispatch(view.state.tr.setMeta(currentSearchPluginKey, updater(state)));
  }

  private navigate(direction: 1 | -1): void {
    if (this.disposed) {
      return;
    }
    const view = this.editor.view;
    const state = currentSearchPluginKey.getState(view.state);
    if (state === undefined || !state.open || state.matches.length === 0) {
      return;
    }
    const currentIndex =
      direction === 1
        ? nextCurrentIndex(state.matches, state.currentIndex)
        : previousCurrentIndex(state.matches, state.currentIndex);
    if (currentIndex === null) {
      return;
    }
    const match = state.matches[currentIndex]!;
    const decorations = buildCurrentSearchDecorations(view.state.doc, state.matches, currentIndex);
    const tr = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, match.pmFrom, match.pmTo))
      .setMeta(currentSearchPluginKey, {
        ...state,
        currentIndex,
        decorations,
        generation: state.generation + 1,
      });
    view.dispatch(tr);
    // 滚动与聚焦：公开命令；read-only 视图 focus 为安全 no-op（WP0 F7）
    this.editor.commands.scrollIntoView();
    this.editor.commands.focus();
  }

  private handleStateChange(state: CurrentSearchPluginState): void {
    if (this.disposed) {
      return;
    }
    const snapshot = toSnapshot(state);
    if (this.lastSnapshot !== null && snapshotsEqual(this.lastSnapshot, snapshot)) {
      return;
    }
    this.lastSnapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** 快照相等：generation 与全部可观察字段（matches 用引用比较，重算必然换新数组）。 */
function snapshotsEqual(a: DocxCurrentSearchSnapshot, b: DocxCurrentSearchSnapshot): boolean {
  return (
    a.generation === b.generation &&
    a.open === b.open &&
    a.query === b.query &&
    a.replacement === b.replacement &&
    a.caseSensitive === b.caseSensitive &&
    a.currentIndex === b.currentIndex &&
    a.truncated === b.truncated &&
    a.validationError === b.validationError &&
    a.matches === b.matches
  );
}
