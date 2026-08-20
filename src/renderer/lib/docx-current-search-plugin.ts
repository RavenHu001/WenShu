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
import type { Mark as PmMark, Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { tiptapJsonToDocxModel } from '../../shared/docx-convert';
import {
  CURRENT_SEARCH_INPUT_ERROR_MESSAGES,
  CURRENT_SEARCH_MAX_MATCHES,
  nextCurrentIndex,
  pickInitialCurrentIndex,
  pickRecentCurrentIndex,
  previousCurrentIndex,
  projectPmTextblocks,
  searchCurrentDocProjection,
  validateCurrentSearchQuery,
  validateCurrentSearchReplacement,
  type PmMatch,
  type PmMatchOutcome,
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
  /** 最近一次替换/操作反馈（成功数量或非破坏性拒绝原因）；查询/大小写变化时清除。 */
  readonly operationMessage: string | null;
  readonly decorations: DecorationSet;
  /** 替换当前项后，下次重算从替换区间末尾继续；重算完成后立即清空。 */
  readonly nextRecomputeAnchor: number | null;
  /** 每次状态变更/重算递增：快照通知与异步回调的陈旧性判断基准。 */
  readonly generation: number;
}

/** WP3+ 窄 controls：UI 只经此接口操作查找会话，不接触 Editor/EditorView（任务第 5.2 节）。 */
export interface DocxCurrentSearchControls {
  /** 稳定标签身份（不从路径/名称推导 editor）。 */
  readonly tabId: string;
  getSnapshot(): DocxCurrentSearchSnapshot;
  subscribe(listener: () => void): () => void;
  open(mode: 'find' | 'replace'): void;
  close(): void;
  setQuery(query: string): void;
  setReplacement(replacement: string): void;
  setCaseSensitive(value: boolean): void;
  selectNext(): void;
  selectPrevious(): void;
  /** 替换当前项：执行瞬间重新投影/复验；只 dispatch 一个文档事务。 */
  replaceCurrent(): void;
  /** 全部替换：≤2000 项逆序单事务；截断/模型失败整体拒绝。 */
  replaceAll(): void;
  /** 关闭面板后把焦点还给编辑器（read-only 为安全 no-op）。 */
  focusEditor(): void;
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
  readonly operationMessage: string | null;
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
    operationMessage: null,
    decorations: DecorationSet.empty,
    nextRecomputeAnchor: null,
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
    operationMessage: state.operationMessage,
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
  operationMessage: null,
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

/**
 * 起点字符 marks（WP0 F1 冻结）：匹配起点所在 text node 的 marks。
 * 「doc.resolve(from).marks()」在跨 marks 边界会返回边界前（上一 text node）的 marks，
 * 替换必须继承「起点字符」的格式，因此按包含 from 的 text 节点查找。
 */
export function startCharMarksAt(doc: PmNode, from: number): readonly PmMark[] {
  const $from = doc.resolve(from);
  let found: readonly PmMark[] = [];
  $from.parent.forEach((child, offset) => {
    const start = $from.start() + offset;
    if (child.isText && start <= from && from < start + child.nodeSize) {
      found = child.marks;
    }
  });
  if (found.length === 0) {
    const node = doc.nodeAt(from);
    if (node !== null && node.isText) {
      found = node.marks;
    }
  }
  return found;
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
        prev.nextRecomputeAnchor ??
        (prev.currentIndex !== null &&
        prev.currentIndex >= 0 &&
        prev.currentIndex < prev.matches.length
          ? prev.matches[prev.currentIndex]!.pmFrom
          : null);
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
      nextRecomputeAnchor: null,
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
        const nextRecomputeAnchor =
          value.nextRecomputeAnchor === null ? null : tr.mapping.map(value.nextRecomputeAnchor);
        if (!value.open) {
          // 外部 setContent/编辑发生在面板关闭时：保留 query/选项，清空过期匹配与装饰
          // （generation +1：清空也是可观察状态变化，快照订阅必须收到通知）
          return {
            ...value,
            decorations,
            matches: [],
            currentIndex: null,
            truncated: false,
            nextRecomputeAnchor,
            generation: value.generation + 1,
          };
        }
        return { ...value, decorations, nextRecomputeAnchor };
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
export class DocxCurrentSearchController implements DocxCurrentSearchControls {
  private readonly hooks: CurrentSearchPluginHooks;
  private readonly listeners = new Set<() => void>();
  private lastSnapshot: DocxCurrentSearchSnapshot | null = null;
  private disposed = false;
  /** 替换权限（宿主按标签状态派生：read-only/degraded 未确认关闭）；命令内防御性检查。 */
  private replaceEnabled = false;

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
      nextRecomputeAnchor: null,
      generation: state.generation + 1,
    }));
  }

  setQuery(query: string): void {
    this.update((state) => ({
      ...state,
      query,
      operationMessage: null,
      generation: state.generation + 1,
    }));
  }

  setReplacement(replacement: string): void {
    this.update((state) => ({ ...state, replacement, generation: state.generation + 1 }));
  }

  setCaseSensitive(value: boolean): void {
    this.update((state) => ({
      ...state,
      caseSensitive: value,
      operationMessage: null,
      generation: state.generation + 1,
    }));
  }

  /** 替换权限由宿主按标签状态派生（read-only/degraded 未确认 → false）。 */
  setReplaceEnabled(enabled: boolean): void {
    this.replaceEnabled = enabled;
  }

  selectNext(): void {
    this.navigate(1);
  }

  selectPrevious(): void {
    this.navigate(-1);
  }

  replaceCurrent(): void {
    if (this.disposed) {
      return;
    }
    const view = this.editor.view;
    const state = currentSearchPluginKey.getState(view.state);
    if (state === undefined || !state.open) {
      return;
    }
    if (state.currentIndex === null || state.matches.length === 0) {
      this.setOperationMessage('没有可替换的匹配');
      return;
    }
    const target = state.matches[state.currentIndex]!;
    // 执行瞬间重新投影并复验当前范围（不信任快照中的旧范围，第 4.6 节）
    const fresh = this.scanCurrentMatches(state.query, state.caseSensitive).matches.find(
      (match) => match.pmFrom === target.pmFrom && match.pmTo === target.pmTo,
    );
    if (fresh === undefined) {
      this.setOperationMessage('匹配已过期，请重新搜索');
      return;
    }
    this.applyReplace([fresh], state.replacement, 'current');
  }

  replaceAll(): void {
    if (this.disposed) {
      return;
    }
    const state = currentSearchPluginKey.getState(this.editor.view.state);
    if (state === undefined || !state.open) {
      return;
    }
    const outcome = this.scanCurrentMatches(state.query, state.caseSensitive);
    if (outcome.matches.length === 0) {
      return; // 0 匹配无操作：不 dispatch、不 dirty、不产生成功假提示
    }
    if (outcome.truncated || outcome.matches.length > CURRENT_SEARCH_MAX_MATCHES) {
      this.setOperationMessage('匹配超过 2000 处，全部替换已被禁用');
      return;
    }
    this.applyReplace(outcome.matches, state.replacement, 'all');
  }

  /** 关闭面板后把焦点还给编辑器（read-only 为安全 no-op，WP0 F7）。 */
  focusEditor(): void {
    if (this.disposed) {
      return;
    }
    this.editor.commands.focus();
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.hooks.onStateChange = null;
    this.listeners.clear();
  }

  /** 返回绑定 this 的窄接口（供 React/组件直接传递，避免方法解绑丢失 this）。 */
  asControls(): DocxCurrentSearchControls {
    return {
      tabId: this.tabId,
      getSnapshot: () => this.getSnapshot(),
      subscribe: (listener) => this.subscribe(listener),
      open: (mode) => this.open(mode),
      close: () => this.close(),
      setQuery: (query) => this.setQuery(query),
      setReplacement: (replacement) => this.setReplacement(replacement),
      setCaseSensitive: (value) => this.setCaseSensitive(value),
      selectNext: () => this.selectNext(),
      selectPrevious: () => this.selectPrevious(),
      replaceCurrent: () => this.replaceCurrent(),
      replaceAll: () => this.replaceAll(),
      focusEditor: () => this.focusEditor(),
    };
  }

  private scanCurrentMatches(query: string, caseSensitive: boolean): PmMatchOutcome {
    const doc = this.editor.view.state.doc;
    const projection = projectPmTextblocks(collectPmTextblocks(doc));
    return searchCurrentDocProjection(projection, query, caseSensitive);
  }

  private applyReplace(
    matches: readonly PmMatch[],
    replacement: string,
    kind: 'current' | 'all',
  ): void {
    // 防御性权限检查必须在 command 内存在，不能只依赖按钮 disabled（第 4.8 节）
    if (!this.replaceEnabled || !this.editor.isEditable) {
      this.setOperationMessage('当前文档不可替换');
      return;
    }
    const validation = validateCurrentSearchReplacement(replacement);
    if (!validation.ok) {
      this.setOperationMessage(CURRENT_SEARCH_INPUT_ERROR_MESSAGES[validation.error]);
      return;
    }
    const view = this.editor.view;
    const schema = this.editor.schema;
    let tr = view.state.tr;
    // 从末到前写入同一 transaction：前方位置不漂移（第 4.7 节）
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index]!;
      // 非空替换继承匹配起点字符 marks；空替换 = 删除（WP0 F1）
      const startMarks = startCharMarksAt(view.state.doc, match.pmFrom);
      if (replacement.length === 0) {
        tr = tr.delete(match.pmFrom, match.pmTo);
      } else {
        tr = tr.replaceWith(match.pmFrom, match.pmTo, schema.text(replacement, startMarks));
      }
    }
    // dispatch 前模型预验证（第 4.6 / 4.7 节）：结构/序列化预算任一失败 → 0 dispatch、0 dirty
    const converted = tiptapJsonToDocxModel(tr.doc.toJSON());
    if (converted.status !== 'ok') {
      this.setOperationMessage('替换结果超出文档模型预算或结构无效，已取消');
      return;
    }
    const pluginState = currentSearchPluginKey.getState(view.state);
    if (pluginState === undefined) {
      return;
    }
    const operationMessage = kind === 'all' ? '已替换 ' + matches.length + ' 处' : '已替换 1 处';
    const nextRecomputeAnchor = kind === 'current' ? matches[0]!.pmFrom + replacement.length : null;
    // 成功反馈与后续导航锚点随正文写入同一 transaction；先清空旧范围，微任务随后按实时
    // 文档重算。替换文本仍包含查询串时，从替换区间末尾继续，避免反复选中刚替换的内容。
    tr = tr.setMeta(currentSearchPluginKey, {
      ...pluginState,
      matches: [],
      currentIndex: null,
      truncated: false,
      decorations: DecorationSet.empty,
      operationMessage,
      nextRecomputeAnchor,
      generation: pluginState.generation + 1,
    } satisfies CurrentSearchPluginState);
    view.dispatch(tr);
  }

  private setOperationMessage(operationMessage: string): void {
    this.update((state) => ({ ...state, operationMessage, generation: state.generation + 1 }));
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
    a.operationMessage === b.operationMessage &&
    a.matches === b.matches
  );
}
