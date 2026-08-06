/**
 * 多 TXT 标签页纯状态模型与不变量校验 —— TASK-005 WP0 骨架。
 *
 * ## WP0 范围
 *
 * - 只定义 TASK-005 第 5 节固定下来的类型模型与不变量校验，不实现任何状态转移；
 * - 不接入 React、IPC、CodeMirror 或持久化；不修改既有产品功能代码；
 * - WP1 在此骨架基础上实现打开占位、去重、激活、目标标签更新、关闭与工作区失效
 *   转移，并把不变量校验接入 reducer 测试；本模块的纯函数与模型不变，转移代码
 *   不得破坏校验器可见的状态约束。
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
