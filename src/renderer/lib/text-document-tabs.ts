/**
 * 多 TXT 标签页纯状态模型、不变量校验与状态转移 —— TASK-005。
 *
 * - WP0：类型模型、第 5 节不变量校验器与两个转换期规则纯函数；
 * - WP1：在模型之上实现打开占位、去重、激活、目标标签更新、关闭与工作区失效
 *   的纯状态转移与选择器（本文件后半部分）。
 *
 * ## WP1 范围
 *
 * - 转移是纯 TypeScript 函数：输入模型、输出新模型，不修改入参；
 * - 对不存在或已关闭的 tabId 一律安全无操作；无实际变化时返回原引用，
 *   便于 React 引用比较；
 * - 不接入 React、IPC、CodeMirror 或持久化；不发起任何读取/保存请求
 *   （读取/保存竞态由后续工作包的 controller 组合这些转移实现）；
 * - 不修改既有产品功能代码；Task 4 的 hook 与组件保持不变。
 *
 * ## 标签身份
 *
 * 以文件树提供并经既有规则规范化的 `relativePath` 作为稳定身份（第 4.2 节），
 * `id` 与 `relativePath` 相等；工作区会话内同路径唯一，故 id 天然唯一且稳定。
 * 数组下标只用于关闭时的相邻标签选择，不作为标签身份。
 *
 * ## 第 5 节固定不变量
 *
 * 1. `tabs` 中 `id` 和 `relativePath` 唯一（同一路径在 loading、已加载或错误状态下
 *    都只能存在一个标签）；
 * 2. `tabs` 为空时 `activeTabId === null`；
 * 3. `tabs` 非空时 `activeTabId` 必须引用现有标签；
 * 4. `saving === true` 时该标签存在且只有一个保存请求在途（由 runtime 的
 *    `saveInFlight` 表达，且与 `tab.saving` 双向一致）；
 * 5. dirty 的清除只能来自与当前编辑修订匹配的成功保存或明确放弃/重新读取
 *    （`saveCompletionClearsDirty` 表达匹配判定）；
 * 6. 任一异步结果提交前必须同时验证工作区会话、目标标签和请求编号仍有效
 *    （`asyncResultStillValid` 表达三重校验，由 controller 在提交结果前调用）。
 *
 * 校验函数只返回违反描述，不抛异常；空数组表示状态有效。违反描述为稳定字符串，
 * 可直接用于测试断言。
 */

import type {
  SaveTextDocumentError,
  TextDocumentError,
  TextDocumentSnapshot,
} from '../../shared/document';

/** 标签状态集合：以 const 数组作为联合类型的唯一来源。 */
const TEXT_TAB_STATUS_VALUES = [
  'loading',
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
  'read-error',
] as const;

export type TextTabStatus = (typeof TEXT_TAB_STATUS_VALUES)[number];

export const TEXT_TAB_STATUSES: readonly TextTabStatus[] = TEXT_TAB_STATUS_VALUES;

/** 单个 TXT 标签的可渲染状态（TASK-005 第 5 节）。 */
export interface TextDocumentTabState {
  /** 标签稳定身份；不使用数组下标。 */
  readonly id: string;
  /** 规范工作区相对路径，使用 `/` 分隔；同一会话内唯一。 */
  readonly relativePath: string;
  /** 标签标题用文件名。 */
  readonly name: string;
  readonly status: TextTabStatus;
  /** 最后一次成功读取或保存的已保存基线快照。 */
  readonly document: TextDocumentSnapshot | null;
  /** 编辑器当前正文。 */
  readonly content: string;
  /** 是否存在未保存修改。 */
  readonly dirty: boolean;
  /** 是否有保存请求在途（与 runtime.saveInFlight 双向一致）。 */
  readonly saving: boolean;
  /** 最近一次读取或保存错误；新的成功操作会清空。 */
  readonly error: TextDocumentError | SaveTextDocumentError | null;
}

/** 多标签 UI 顶层状态；"尚无标签"由空集合表达，不为欢迎页创建伪文档标签。 */
export interface TextDocumentsUiState {
  readonly tabs: readonly TextDocumentTabState[];
  readonly activeTabId: string | null;
}

/**
 * 与可渲染状态分离的运行时竞态元数据（TASK-005 第 5 节）。
 * 含函数、Promise 或计时器的引用不得进入共享 IPC 契约或持久化数据。
 */
export interface TextTabRuntime {
  /** 编辑修订号：每次正文实际变化 +1，判定旧保存结果是否仍有效。 */
  editRevision: number;
  /** 读取请求编号：同一标签内递增，只允许最新请求提交结果。 */
  readRequestId: number;
  /** 是否有保存请求在途：同一标签同一时刻最多一个。 */
  saveInFlight: boolean;
  /** 最新正文快照，供保存回调捕获（避免闭包过期）。 */
  latestContent: string;
}

/** 按 tabId 索引的运行时元数据；不允许保存中的条目引用不存在的标签。 */
export type TabRuntimeMap = ReadonlyMap<string, TextTabRuntime>;

/**
 * 校验第 5 节不变量 1-4 与状态形状；不变量 5、6 是转换期规则，由
 * `saveCompletionClearsDirty` / `asyncResultStillValid` 表达。
 * 返回违反描述列表；空数组表示状态有效。
 */
export function validateTextDocumentsState(
  state: TextDocumentsUiState,
  runtime: TabRuntimeMap = new Map(),
): readonly string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();

  for (const tab of state.tabs) {
    if (!TEXT_TAB_STATUSES.includes(tab.status)) {
      violations.push(`未知标签状态 ${String(tab.status)}`);
    }
    if (ids.has(tab.id)) {
      violations.push(`标签 id 重复: ${tab.id}`);
    } else {
      ids.add(tab.id);
    }
    if (paths.has(tab.relativePath)) {
      violations.push(`标签 relativePath 重复: ${tab.relativePath}`);
    } else {
      paths.add(tab.relativePath);
    }
  }

  if (state.tabs.length === 0) {
    if (state.activeTabId !== null) {
      violations.push('tabs 为空时 activeTabId 必须为 null');
    }
  } else if (state.activeTabId === null || !ids.has(state.activeTabId)) {
    violations.push(`activeTabId ${state.activeTabId ?? 'null'} 未引用现有标签`);
  }

  for (const tab of state.tabs) {
    const tabRuntime = runtime.get(tab.id);
    if (tab.saving && (tabRuntime === undefined || !tabRuntime.saveInFlight)) {
      violations.push(`标签 ${tab.id} 为 saving 但没有在途保存请求`);
    } else if (!tab.saving && tabRuntime !== undefined && tabRuntime.saveInFlight) {
      violations.push(`标签 ${tab.id} 非 saving 但 runtime 存在在途保存请求`);
    }
  }
  for (const [runtimeId, tabRuntime] of runtime) {
    if (tabRuntime.saveInFlight && !ids.has(runtimeId)) {
      violations.push(`runtime 在途保存引用了不存在的标签 ${runtimeId}`);
    }
  }

  return violations;
}

/**
 * 不变量 5 的匹配判定：成功保存清除 dirty 的充分条件是目标标签当前编辑修订号
 * 仍等于该请求捕获的修订号；保存期间的新编辑必须保留 dirty。
 */
export function saveCompletionClearsDirty(
  capturedEditRevision: number,
  currentEditRevision: number,
): boolean {
  return capturedEditRevision === currentEditRevision;
}

/** 不变量 6 的三重有效性校验输入：工作区会话、目标标签、请求编号。 */
export interface AsyncResultValidity {
  /** 结果所属工作区会话仍有效（工作区未成功切换）。 */
  readonly workspaceSessionValid: boolean;
  /** 目标标签仍存在（未被关闭）。 */
  readonly tabExists: boolean;
  /** 请求编号仍是最新（没有更新的读取/保存请求）。 */
  readonly requestIdCurrent: boolean;
}

/**
 * 不变量 6：任一异步结果提交前必须同时通过三项校验；
 * 任一项不满足都必须安全忽略结果。
 */
export function asyncResultStillValid(validity: AsyncResultValidity): boolean {
  return validity.workspaceSessionValid && validity.tabExists && validity.requestIdCurrent;
}

/* ======================= WP1：纯状态转移与选择器 ======================= */

/**
 * 纯状态模型：可渲染标签集合 + 运行时竞态元数据。
 * 两类数据保持分离字段，但由同一模型承载，使转移可以同时维护
 * 不变量 4（saving 与 saveInFlight 双向一致）与运行时清理。
 */
export interface TextTabsModel {
  readonly state: TextDocumentsUiState;
  readonly runtime: TabRuntimeMap;
}

/** 空模型：无标签、无活动标签、无运行时元数据（欢迎页状态）。 */
export function createEmptyModel(): TextTabsModel {
  return { state: { tabs: [], activeTabId: null }, runtime: new Map() };
}

/** 便捷校验：一次检查模型的状态与运行时是否满足全部可校验不变量。 */
export function validateTextTabsModel(model: TextTabsModel): readonly string[] {
  return validateTextDocumentsState(model.state, model.runtime);
}

function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
}

/**
 * 打开或激活标签（第 4.2 / 4.7 节）：
 *
 * - 同一 relativePath 已存在（无论 loading、已加载还是错误状态）时只激活原标签，
 *   不创建第二会话、不重置正文、不清除错误与撤销历史；
 * - 新路径追加到标签序列末尾并立即激活，创建 `loading` 占位标签；
 * - 占位标签的读取请求由 controller（WP2）发起，成功后经 `updateTab` 提交。
 */
export function openTab(model: TextTabsModel, relativePath: string): TextTabsModel {
  const existing = model.state.tabs.find((tab) => tab.relativePath === relativePath);
  if (existing !== undefined) {
    return activateTab(model, existing.id);
  }
  const tab: TextDocumentTabState = {
    id: relativePath,
    relativePath,
    name: fileNameFromRelativePath(relativePath),
    status: 'loading',
    document: null,
    content: '',
    dirty: false,
    saving: false,
    error: null,
  };
  return {
    state: { tabs: [...model.state.tabs, tab], activeTabId: tab.id },
    runtime: model.runtime,
  };
}

/**
 * 点击标签切换活动标签（第 4.3 节）：
 * 只改变活动标签，不触发读取、不产生 dirty、不清空撤销历史；
 * 未知 id 或已经是活动标签时返回原引用。
 */
export function activateTab(model: TextTabsModel, tabId: string): TextTabsModel {
  const exists = model.state.tabs.some((tab) => tab.id === tabId);
  if (!exists || model.state.activeTabId === tabId) {
    return model;
  }
  return { state: { ...model.state, activeTabId: tabId }, runtime: model.runtime };
}

/** 可编辑状态：沿用 TASK-004 的判定（read-error 仅在有成功快照时可编辑）。 */
const EDITABLE_STATUSES: readonly TextTabStatus[] = [
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
];

/**
 * 编辑正文（沿用 TASK-004 语义，只作用于目标标签）：
 *
 * - 正文实际变化才递增编辑修订号并标记 dirty；内容未变或不可编辑状态时无操作；
 * - `loaded-clean` 首次编辑转为 `loaded-dirty`，其余可编辑状态保持原状态；
 * - `save-error` / `conflict` 状态下编辑清除错误，正文与 dirty 保留；
 * - 同步更新目标标签的运行时 `editRevision` 与 `latestContent`。
 */
export function editTab(model: TextTabsModel, tabId: string, content: string): TextTabsModel {
  const index = model.state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return model;
  }
  const tab = model.state.tabs[index]!;
  const editable =
    EDITABLE_STATUSES.includes(tab.status) ||
    (tab.status === 'read-error' && tab.document !== null);
  if (!editable || tab.content === content) {
    return model;
  }
  const nextTab: TextDocumentTabState = {
    ...tab,
    status: tab.status === 'loaded-clean' ? 'loaded-dirty' : tab.status,
    content,
    dirty: true,
    error: tab.status === 'save-error' || tab.status === 'conflict' ? null : tab.error,
  };
  const runtime = updateRuntimeEntry(model.runtime, tabId, (entry) => ({
    ...entry,
    editRevision: entry.editRevision + 1,
    latestContent: content,
  }));
  return {
    state: {
      ...model.state,
      tabs: model.state.tabs.map((item, itemIndex) => (itemIndex === index ? nextTab : item)),
    },
    runtime,
  };
}

/**
 * 只更新目标标签的可渲染状态（读取/保存结果提交、错误标记等通用入口）：
 * 其他标签不受影响；未知 id 或 updater 返回原引用时无操作。
 */
export function updateTab(
  model: TextTabsModel,
  tabId: string,
  updater: (tab: TextDocumentTabState) => TextDocumentTabState,
): TextTabsModel {
  const index = model.state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return model;
  }
  const tab = model.state.tabs[index]!;
  const nextTab = updater(tab);
  if (nextTab === tab) {
    return model;
  }
  return {
    state: {
      ...model.state,
      tabs: model.state.tabs.map((item, itemIndex) => (itemIndex === index ? nextTab : item)),
    },
    runtime: model.runtime,
  };
}

/**
 * 只更新目标标签的运行时元数据（读取请求编号、在途保存标志、最新正文等）：
 * 未知 id 或 updater 返回原引用时无操作。
 */
export function updateTabRuntime(
  model: TextTabsModel,
  tabId: string,
  updater: (entry: TextTabRuntime) => TextTabRuntime,
): TextTabsModel {
  const runtime = updateRuntimeEntry(model.runtime, tabId, updater);
  if (runtime === model.runtime) {
    return model;
  }
  return { state: model.state, runtime };
}

function updateRuntimeEntry(
  runtime: TabRuntimeMap,
  tabId: string,
  updater: (entry: TextTabRuntime) => TextTabRuntime,
): TabRuntimeMap {
  const entry = runtime.get(tabId);
  if (entry === undefined) {
    return runtime;
  }
  const next = updater(entry);
  if (next === entry) {
    return runtime;
  }
  const nextMap = new Map(runtime);
  nextMap.set(tabId, next);
  return nextMap;
}

/**
 * 关闭标签（第 4.3 / 4.9 节）：
 *
 * - 关闭非活动标签不改变活动标签；
 * - 关闭活动标签优先激活其右侧标签；没有右侧标签时激活左侧标签；
 * - 关闭最后一个标签后回到欢迎页（`activeTabId === null`）；
 * - `saving === true` 的标签禁止关闭（在途写入不得被丢弃），返回原引用；
 * - 关闭同时释放该标签的运行时元数据；
 * - 未知 id 安全无操作。
 */
export function closeTab(model: TextTabsModel, tabId: string): TextTabsModel {
  const index = model.state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return model;
  }
  const tab = model.state.tabs[index]!;
  if (tab.saving) {
    return model;
  }
  const tabs = model.state.tabs.filter((item) => item.id !== tabId);
  let activeTabId = model.state.activeTabId;
  if (activeTabId === tabId) {
    const right = tabs[index];
    activeTabId = right?.id ?? tabs[index - 1]?.id ?? null;
  }
  const runtime = new Map(model.runtime);
  runtime.delete(tabId);
  return { state: { tabs, activeTabId }, runtime };
}

/** 工作区成功切换：一次清空全部标签、活动标签与全部运行时元数据。 */
export function invalidateWorkspace(): TextTabsModel {
  return createEmptyModel();
}

/** 按 tabId 取标签；不存在返回 null。 */
export function tabById(model: TextTabsModel, tabId: string): TextDocumentTabState | null {
  return model.state.tabs.find((tab) => tab.id === tabId) ?? null;
}

/** 当前活动标签；无标签或活动标签已被关闭时返回 null。 */
export function activeTab(model: TextTabsModel): TextDocumentTabState | null {
  if (model.state.activeTabId === null) {
    return null;
  }
  return tabById(model, model.state.activeTabId);
}

/** 是否存在至少一个 dirty 标签（窗口关闭协议上报值）。 */
export function hasDirtyTabs(model: TextTabsModel): boolean {
  return model.state.tabs.some((tab) => tab.dirty);
}

/** 未保存标签数量（聚合确认提示用）。 */
export function dirtyTabCount(model: TextTabsModel): number {
  return model.state.tabs.reduce((count, tab) => (tab.dirty ? count + 1 : count), 0);
}

/** 是否存在至少一个正在保存的标签（破坏性过渡阻止判定用）。 */
export function hasSavingTabs(model: TextTabsModel): boolean {
  return model.state.tabs.some((tab) => tab.saving);
}
