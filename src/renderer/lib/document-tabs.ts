/**
 * 多类型标签页纯状态模型、不变量校验与状态转移 —— TXT/DOCX 判别联合（TASK-007 WP4）。
 *
 * ## 定位（第 5.2 / 5.3 节）
 *
 * - `DocumentTabState = TextDocumentTabState | DocxDocumentTabState`；
 *   共享字段：tabId（id）、relativePath、name、status、dirty、saving、error；
 *   TXT 分支与 `text-document-tabs.ts` 的既有形状一致（不携带 kind 判别字段），
 *   DOCX 分支携带 `kind: 'docx'` 与模型/兼容性/确认状态；
 * - TXT 专有的 lineEnding/BOM/纯文本内容与 CodeMirror runtime 不进入 DOCX 分支；
 *   DOCX 专有的结构化模型、兼容性报告、确认 revision 与 Tiptap runtime 不进入 TXT 分支；
 * - 本模块是 WP5+ controller 的多类型模型基座；`text-document-tabs.ts` 保持为
 *   TXT 分支的既有实现（TXT 全量回归不依赖本模块）。
 *
 * ## 状态转移（第 5.3 节不变量）
 *
 * - 同路径唯一、tabId 唯一、activeTabId 引用现存标签；
 * - DOCX 可编辑状态：loaded-clean / loaded-dirty / saving / save-error / conflict；
 *   read-error 仅在保留已保存快照时可编辑；read-only 不可编辑不可保存；
 * - degraded 文档未持有当前 revision 的兼容性确认时，编辑与保存都被模型层拒绝
 *   （不变量 10）；read-only 不得发起保存（不变量 11）；
 * - 保存完成只在编辑修订号仍匹配时清除 dirty（不变量 9）；同一标签不并发保存
 *   （不变量 7）；saving 标签禁止关闭（不变量 6 组合）。
 *
 * ## TXT 分支语义
 *
 * TXT 分支转移与 `text-document-tabs.ts` 逐项一致（编辑修订号、dirty、保存完成匹配、
 * 关闭邻接激活、工作区失效）；不修改既有 TXT 模块与 controller。
 */

import type { DocxDocumentModel, DocxDocumentError, DocxDocumentSnapshot } from '../../shared/docx';
import type { ReadDocxDocumentResult, SaveDocxDocumentResult } from '../../shared/docx';
import type { TextDocumentTabState, TextTabStatus } from './text-document-tabs';
import {
  asyncResultStillValid as textAsyncResultStillValid,
  saveCompletionClearsDirty as textSaveCompletionClearsDirty,
  type AsyncResultValidity,
} from './text-document-tabs';

/* ======================= DOCX 标签分支 ======================= */

const DOCX_TAB_STATUS_VALUES = [
  'loading',
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
  'read-error',
  'read-only',
] as const;

export type DocxTabStatus = (typeof DOCX_TAB_STATUS_VALUES)[number];

export const DOCX_TAB_STATUSES: readonly DocxTabStatus[] = DOCX_TAB_STATUS_VALUES;

/** 单个 DOCX 标签的可渲染状态（TASK-007 第 5.2 节）。 */
export interface DocxDocumentTabState {
  readonly kind: 'docx';
  /** 标签稳定身份；不使用数组下标。 */
  readonly id: string;
  /** 规范工作区相对路径，使用 `/` 分隔；同一会话内唯一。 */
  readonly relativePath: string;
  /** 标签标题用文件名。 */
  readonly name: string;
  readonly status: DocxTabStatus;
  /** 最后一次成功读取或保存的已保存基线快照。 */
  readonly document: DocxDocumentSnapshot | null;
  /** 编辑器当前结构化模型（编辑内容）；与 `document.model` 比较判定 dirty。 */
  readonly model: DocxDocumentModel | null;
  /** 是否存在未保存修改。 */
  readonly dirty: boolean;
  /** 是否有保存请求在途（与 runtime.saveInFlight 双向一致）。 */
  readonly saving: boolean;
  /** 最近一次读取或保存错误；新的成功操作会清空。 */
  readonly error: DocxDocumentError | null;
  /**
   * `degraded` 文档的用户确认绑定的 revision（第 4.2 节）；
   * 确认只对当前 revision 有效，重新读取不同 revision 后必须重新确认。
   */
  readonly compatibilityConfirmationRevision: string | null;
}

/* ======================= 判别联合与运行时 ======================= */

export type DocumentTabState = TextDocumentTabState | DocxDocumentTabState;
export type DocumentTabStatus = TextTabStatus | DocxTabStatus;

/** 多类型标签 UI 顶层状态；"尚无标签"由空集合表达。 */
export interface DocumentTabsUiState {
  readonly tabs: readonly DocumentTabState[];
  readonly activeTabId: string | null;
}

/**
 * 与可渲染状态分离的运行时竞态元数据（每标签）。
 * `latestContent` 只由 TXT 分支维护；`latestModel` 只由 DOCX 分支维护。
 */
export interface DocumentTabRuntime {
  /** 编辑修订号：每次正文/模型实际变化 +1，判定旧保存结果是否仍有效。 */
  readonly editRevision: number;
  /** 读取请求编号：同一标签内递增，只允许最新请求提交结果。 */
  readonly readRequestId: number;
  /** 是否有保存请求在途：同一标签同一时刻最多一个。 */
  readonly saveInFlight: boolean;
  /** 最新 TXT 正文快照（TXT 分支）；DOCX 分支恒为 null。 */
  readonly latestContent: string | null;
  /** 最新 DOCX 模型快照（DOCX 分支）；TXT 分支恒为 null。 */
  readonly latestModel: DocxDocumentModel | null;
}

/** 多类型标签模型：可渲染标签集合 + 运行时竞态元数据。 */
export interface DocumentTabsModel {
  readonly state: DocumentTabsUiState;
  readonly runtime: ReadonlyMap<string, DocumentTabRuntime>;
}

/** 空模型：无标签、无活动标签、无运行时元数据（欢迎页状态）。 */
export function createEmptyModel(): DocumentTabsModel {
  return { state: { tabs: [], activeTabId: null }, runtime: new Map() };
}

/* ======================= 类型守卫 ======================= */

export function isDocxTab(tab: DocumentTabState | null | undefined): tab is DocxDocumentTabState {
  return tab !== null && tab !== undefined && 'kind' in tab && tab.kind === 'docx';
}

export function isTextTab(tab: DocumentTabState | null | undefined): tab is TextDocumentTabState {
  return !isDocxTab(tab);
}

/* ======================= 不变量校验（第 5.3 节） ======================= */

const TEXT_TAB_STATUSES: readonly TextTabStatus[] = [
  'loading',
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
  'read-error',
];

const DOCX_EDITABLE_STATUSES: readonly DocxTabStatus[] = [
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
];

/**
 * 校验多类型标签状态与运行时不变量（第 5.3 节 1-11）。
 * 返回违反描述列表；空数组表示状态有效。
 */
export function validateDocumentTabsModel(model: DocumentTabsModel): readonly string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();

  for (const tab of model.state.tabs) {
    if (isDocxTab(tab)) {
      if (!DOCX_TAB_STATUSES.includes(tab.status)) {
        violations.push(`未知 DOCX 标签状态 ${String(tab.status)}`);
      }
    } else if (!TEXT_TAB_STATUSES.includes(tab.status)) {
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
    validateTabConsistency(tab, model.runtime.get(tab.id), violations);
  }

  if (model.state.tabs.length === 0) {
    if (model.state.activeTabId !== null) {
      violations.push('tabs 为空时 activeTabId 必须为 null');
    }
  } else if (model.state.activeTabId === null || !ids.has(model.state.activeTabId)) {
    violations.push(`activeTabId ${model.state.activeTabId ?? 'null'} 未引用现有标签`);
  }

  for (const [runtimeId, runtime] of model.runtime) {
    if (runtime.saveInFlight && !ids.has(runtimeId)) {
      violations.push(`runtime 在途保存引用了不存在的标签 ${runtimeId}`);
    }
  }

  return violations;
}

function validateTabConsistency(
  tab: DocumentTabState,
  runtime: DocumentTabRuntime | undefined,
  violations: string[],
): void {
  if (tab.saving && (runtime === undefined || !runtime.saveInFlight)) {
    violations.push(`标签 ${tab.id} 为 saving 但没有在途保存请求`);
  } else if (!tab.saving && runtime !== undefined && runtime.saveInFlight) {
    violations.push(`标签 ${tab.id} 非 saving 但 runtime 存在在途保存请求`);
  }
  if (isDocxTab(tab)) {
    // DOCX 分支一致性：模型与基线快照的存在性组合
    if (tab.document === null && tab.status !== 'loading' && tab.status !== 'read-error') {
      violations.push(`标签 ${tab.id} 非 loading/read-error 但没有基线快照`);
    }
    if (tab.dirty && tab.status === 'loaded-clean') {
      violations.push(`标签 ${tab.id} dirty 但状态为 loaded-clean`);
    }
    if (runtime !== undefined) {
      if (runtime.latestModel === null && tab.status !== 'loading') {
        violations.push(`DOCX 标签 ${tab.id} 缺少 latestModel 运行时快照`);
      }
      if (runtime.latestContent !== null) {
        violations.push(`DOCX 标签 ${tab.id} 运行时不得携带 latestContent`);
      }
    }
    // 不变量 10：degraded 未确认不得写入（saving 状态不允许出现）
    if (
      tab.saving &&
      tab.document !== null &&
      tab.document.compatibility.level === 'degraded' &&
      tab.compatibilityConfirmationRevision !== tab.document.revision
    ) {
      violations.push(`标签 ${tab.id} degraded 未确认即进入 saving`);
    }
    // 不变量 11：read-only 不得保存
    if (tab.saving && tab.status === 'read-only') {
      violations.push(`标签 ${tab.id} read-only 不得发起保存`);
    }
  } else if (runtime !== undefined) {
    if (runtime.latestContent === null && tab.status !== 'loading') {
      violations.push(`TXT 标签 ${tab.id} 缺少 latestContent 运行时快照`);
    }
    if (runtime.latestModel !== null) {
      violations.push(`TXT 标签 ${tab.id} 运行时不得携带 latestModel`);
    }
  }
}

/* ======================= 通用转移 ======================= */

function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
}

function updateRuntimeEntry(
  runtime: ReadonlyMap<string, DocumentTabRuntime>,
  tabId: string,
  updater: (entry: DocumentTabRuntime) => DocumentTabRuntime,
): ReadonlyMap<string, DocumentTabRuntime> {
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
 * 打开或激活 TXT 标签（与 `text-document-tabs.ts` 语义一致）：
 * 同一 relativePath 已存在时只激活原标签；新路径创建 loading 占位标签。
 */
export function openTab(model: DocumentTabsModel, relativePath: string): DocumentTabsModel {
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
 * 打开或激活 DOCX 标签：同一 relativePath 已存在（TXT 或 DOCX）时只激活原标签；
 * 新路径创建 DOCX loading 占位标签（模型、快照、确认均为空）。
 */
export function openDocxTab(model: DocumentTabsModel, relativePath: string): DocumentTabsModel {
  const existing = model.state.tabs.find((tab) => tab.relativePath === relativePath);
  if (existing !== undefined) {
    return activateTab(model, existing.id);
  }
  const tab: DocxDocumentTabState = {
    kind: 'docx',
    id: relativePath,
    relativePath,
    name: fileNameFromRelativePath(relativePath),
    status: 'loading',
    document: null,
    model: null,
    dirty: false,
    saving: false,
    error: null,
    compatibilityConfirmationRevision: null,
  };
  return {
    state: { tabs: [...model.state.tabs, tab], activeTabId: tab.id },
    runtime: model.runtime,
  };
}

/** 点击标签切换活动标签：只改变活动标签，不触发读取、不产生 dirty。 */
export function activateTab(model: DocumentTabsModel, tabId: string): DocumentTabsModel {
  const exists = model.state.tabs.some((tab) => tab.id === tabId);
  if (!exists || model.state.activeTabId === tabId) {
    return model;
  }
  return { state: { ...model.state, activeTabId: tabId }, runtime: model.runtime };
}

/** 只更新目标标签的可渲染状态；未知 id 或 updater 返回原引用时无操作。 */
export function updateTab(
  model: DocumentTabsModel,
  tabId: string,
  updater: (tab: DocumentTabState) => DocumentTabState,
): DocumentTabsModel {
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

/** 只更新目标标签的运行时元数据；未知 id 或 updater 返回原引用时无操作。 */
export function updateTabRuntime(
  model: DocumentTabsModel,
  tabId: string,
  updater: (entry: DocumentTabRuntime) => DocumentTabRuntime,
): DocumentTabsModel {
  const runtime = updateRuntimeEntry(model.runtime, tabId, updater);
  if (runtime === model.runtime) {
    return model;
  }
  return { state: model.state, runtime };
}

/**
 * 关闭标签：关闭非活动标签不改变活动标签；关闭活动标签优先激活右侧标签，
 * 没有右侧时激活左侧；关闭最后一个标签回到欢迎页；saving 标签禁止关闭。
 */
export function closeTab(model: DocumentTabsModel, tabId: string): DocumentTabsModel {
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
export function invalidateWorkspace(): DocumentTabsModel {
  return createEmptyModel();
}

/* ======================= TXT 分支转移（与 text-document-tabs.ts 语义一致） ======================= */

const TEXT_EDITABLE_STATUSES: readonly TextTabStatus[] = [
  'loaded-clean',
  'loaded-dirty',
  'saving',
  'save-error',
  'conflict',
];

/**
 * 编辑 TXT 标签正文（只作用于 TXT 分支；DOCX 标签无操作）：
 * 正文实际变化才递增编辑修订号并标记 dirty。
 */
export function editTab(
  model: DocumentTabsModel,
  tabId: string,
  content: string,
): DocumentTabsModel {
  const index = model.state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return model;
  }
  const tab = model.state.tabs[index]!;
  if (isDocxTab(tab)) {
    return model;
  }
  const editable =
    TEXT_EDITABLE_STATUSES.includes(tab.status) ||
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

/* ======================= DOCX 分支转移 ======================= */

/** DOCX 是否允许进入编辑：可编辑状态，且 read-error 仅在有快照时可编辑。 */
function docxEditable(tab: DocxDocumentTabState): boolean {
  if (DOCX_EDITABLE_STATUSES.includes(tab.status)) {
    return true;
  }
  return tab.status === 'read-error' && tab.document !== null;
}

/** degraded 文档是否已确认（确认 revision 绑定当前基线 revision）。 */
function docxCompatibilityConfirmed(tab: DocxDocumentTabState): boolean {
  if (tab.document === null) {
    return false;
  }
  if (tab.document.compatibility.level !== 'degraded') {
    return true;
  }
  return tab.compatibilityConfirmationRevision === tab.document.revision;
}

/**
 * 编辑 DOCX 标签模型（只作用于 DOCX 分支）：
 * 设置新模型、标记 dirty 并递增编辑修订号（不变量 9 的捕获基准）。
 * 调用方（Tiptap 宿主）负责在内容实际变化时调用（第 4.6 节：不做每次输入的无界深比较）；
 * degraded 未确认、read-only 与 read-error（无快照）时无操作（不变量 10-11）。
 */
export function editDocxTab(
  model: DocumentTabsModel,
  tabId: string,
  nextModel: DocxDocumentModel,
): DocumentTabsModel {
  const index = model.state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return model;
  }
  const tab = model.state.tabs[index]!;
  if (!isDocxTab(tab) || !docxEditable(tab) || !docxCompatibilityConfirmed(tab)) {
    return model;
  }
  const nextTab: DocxDocumentTabState = {
    ...tab,
    status: tab.status === 'loaded-clean' ? 'loaded-dirty' : tab.status,
    model: nextModel,
    dirty: true,
    error: tab.status === 'save-error' || tab.status === 'conflict' ? null : tab.error,
  };
  const runtime = updateRuntimeEntry(model.runtime, tabId, (entry) => ({
    ...entry,
    editRevision: entry.editRevision + 1,
    latestModel: nextModel,
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
 * 提交 DOCX 读取结果（controller 完成三重异步有效性校验后调用）：
 * - loaded：按兼容性等级进入 loaded-clean（read-only 文档 → read-only 状态），
 *   重置模型与 dirty；模型快照写入运行时；
 * - error：进入 read-error（已有快照时保留正文、dirty 与确认状态）。
 */
export function applyDocxReadResult(
  model: DocumentTabsModel,
  tabId: string,
  result: ReadDocxDocumentResult,
): DocumentTabsModel {
  const tab = tabById(model, tabId);
  if (tab === null || !isDocxTab(tab)) {
    return model;
  }
  if (result.status === 'loaded') {
    const document = result.document;
    const readOnly = document.compatibility.level === 'read-only';
    const nextTab: DocxDocumentTabState = {
      ...tab,
      status: readOnly ? 'read-only' : 'loaded-clean',
      name: document.name,
      document,
      model: document.model,
      dirty: false,
      saving: false,
      error: null,
      // 新 revision：旧确认失效（第 4.2 节：确认只对当前 revision 有效）
      compatibilityConfirmationRevision: null,
    };
    return updateTabRuntime(
      updateTab(model, tabId, () => nextTab),
      tabId,
      (runtimeEntry) => ({ ...runtimeEntry, editRevision: 0, latestModel: document.model }),
    );
  }
  const nextTab: DocxDocumentTabState = { ...tab, status: 'read-error', error: result.error };
  return updateTab(model, tabId, () => nextTab);
}

/** 确认 degraded 文档的兼容性：绑定当前基线 revision（第 4.2 节）。 */
export function confirmDocxCompatibility(
  model: DocumentTabsModel,
  tabId: string,
  revision: string,
): DocumentTabsModel {
  const tab = tabById(model, tabId);
  if (tab === null || !isDocxTab(tab)) {
    return model;
  }
  return updateTab(model, tabId, (target) => {
    if (!isDocxTab(target)) {
      return target;
    }
    const clearConfirmationError =
      target.status === 'save-error' &&
      target.error?.code === 'COMPATIBILITY_CONFIRMATION_REQUIRED';
    return {
      ...target,
      compatibilityConfirmationRevision: revision,
      ...(clearConfirmationError ? { status: 'loaded-dirty' as const, error: null } : {}),
    };
  });
}

/**
 * 发起 DOCX 保存（不变量 7/10/11 门禁）：
 * - 目标不存在、无运行时、已在保存、无基线快照或无模型时无操作；
 * - loaded-clean 不发起写入；
 * - read-only 不得保存（无操作）；
 * - degraded 未确认 → save-error（COMPATIBILITY_CONFIRMATION_REQUIRED），不进入 saving。
 */
export function startDocxSave(model: DocumentTabsModel, tabId: string): DocumentTabsModel {
  const tab = tabById(model, tabId);
  const runtime = model.runtime.get(tabId);
  if (tab === null || !isDocxTab(tab) || runtime === undefined || runtime.saveInFlight) {
    return model;
  }
  if (tab.document === null || tab.model === null) {
    return model;
  }
  if (tab.status === 'loaded-clean' || tab.status === 'read-only') {
    return model;
  }
  if (!docxCompatibilityConfirmed(tab)) {
    return updateTab(model, tabId, (target) => {
      if (!isDocxTab(target)) {
        return target;
      }
      return {
        ...target,
        status: 'save-error',
        saving: false,
        dirty: true,
        error: {
          code: 'COMPATIBILITY_CONFIRMATION_REQUIRED',
          message: '文档包含不受支持的内容，需要确认后保存',
        },
      };
    });
  }
  return updateTabRuntime(
    updateTab(model, tabId, (target) => {
      if (!isDocxTab(target)) {
        return target;
      }
      return { ...target, status: 'saving', saving: true, error: null };
    }),
    tabId,
    (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: true }),
  );
}

/**
 * 提交 DOCX 保存结果（controller 完成异步有效性校验后调用）：
 * - saved：编辑修订号仍匹配 → loaded-clean 并清除 dirty（不变量 9），
 *   基线快照与模型更新为保存产物；期间继续编辑 → 保留后续修改与 dirty；
 * - error：CONFLICT → conflict，其余 → save-error；dirty 保留。
 */
export function completeDocxSave(
  model: DocumentTabsModel,
  tabId: string,
  capturedEditRevision: number,
  result: SaveDocxDocumentResult,
): DocumentTabsModel {
  const tab = tabById(model, tabId);
  const runtime = model.runtime.get(tabId);
  if (tab === null || !isDocxTab(tab) || runtime === undefined) {
    return model;
  }
  if (result.status === 'saved') {
    const savedDocument = result.document;
    const stillClean = textSaveCompletionClearsDirty(capturedEditRevision, runtime.editRevision);
    return updateTabRuntime(
      updateTab(model, tabId, (target) => {
        if (!isDocxTab(target)) {
          return target;
        }
        return {
          ...target,
          status: stillClean ? 'loaded-clean' : 'loaded-dirty',
          saving: false,
          document: savedDocument,
          // 保存期间无新编辑：模型即产物；有新编辑：保留目标标签当前模型
          model: stillClean ? savedDocument.model : target.model,
          dirty: !stillClean,
          error: null,
        };
      }),
      tabId,
      (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
    );
  }
  const conflict = result.error.code === 'CONFLICT';
  return updateTabRuntime(
    updateTab(model, tabId, (target) => {
      if (!isDocxTab(target)) {
        return target;
      }
      return {
        ...target,
        status: conflict ? 'conflict' : 'save-error',
        saving: false,
        dirty: true,
        error: result.error,
      };
    }),
    tabId,
    (runtimeEntry) => ({ ...runtimeEntry, saveInFlight: false }),
  );
}

/* ======================= 选择器 ======================= */

/** 按 tabId 取标签；不存在返回 null。 */
export function tabById(model: DocumentTabsModel, tabId: string): DocumentTabState | null {
  return model.state.tabs.find((tab) => tab.id === tabId) ?? null;
}

/** 当前活动标签；无标签或活动标签已被关闭时返回 null。 */
export function activeTab(model: DocumentTabsModel): DocumentTabState | null {
  if (model.state.activeTabId === null) {
    return null;
  }
  return tabById(model, model.state.activeTabId);
}

/** 是否存在至少一个 dirty 标签（窗口关闭协议上报值）。 */
export function hasDirtyTabs(model: DocumentTabsModel): boolean {
  return model.state.tabs.some((tab) => tab.dirty);
}

/** 未保存标签数量（聚合确认提示用）。 */
export function dirtyTabCount(model: DocumentTabsModel): number {
  return model.state.tabs.reduce((count, tab) => (tab.dirty ? count + 1 : count), 0);
}

/** 是否存在至少一个正在保存的标签（破坏性过渡阻止判定用）。 */
export function hasSavingTabs(model: DocumentTabsModel): boolean {
  return model.state.tabs.some((tab) => tab.saving);
}

/** 复用 TXT 模块的异步结果三重有效性语义（工作区会话 / 目标标签 / 请求编号）。 */
export {
  textAsyncResultStillValid as asyncResultStillValid,
  textSaveCompletionClearsDirty as saveCompletionClearsDirty,
};
export type { AsyncResultValidity };
