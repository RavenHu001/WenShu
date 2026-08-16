import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRuntimeInfo } from './lib/runtime-info';
import { useDocuments } from './lib/use-documents';
import { useWorkspace } from './lib/use-workspace';
import { useWorkspaceSearch } from './lib/use-workspace-search';
import {
  activeTab,
  dirtyTabCount,
  hasDirtyTabs,
  hasSavingTabs,
  isDocxTab,
  isTextTab,
  tabById,
  type DocumentTabState,
} from './lib/document-tabs';
import { projectDocxModelSearchText } from '../shared/docx-search-text';
import type {
  EditorLocateTarget,
  EditorSearchControls,
  EditorSearchMode,
} from './components/document/EditorSessionHost';
import type { WorkspaceTextSearchFileResult, WorkspaceTextSearchMatch } from '../shared/search';
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar';
import { FileManagementDialogs } from './components/workspace/FileManagementDialogs';
import { SearchSidebar } from './components/search/SearchSidebar';
import { DocumentPane } from './components/document/DocumentPane';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { useFileManagement } from './lib/use-file-management';

/** 活动栏面板：文件 / 搜索为真实可访问入口；设置保持不可用占位（第 4.10 节）。 */
type ActivityPanel = 'files' | 'search';

/** App 层定位身份：编辑器目标外继续绑定来源搜索与标签。 */
type AppLocateTarget = EditorLocateTarget & {
  readonly requestId: number;
  readonly tabId: string;
};

const activityItems = [
  { id: 'files', label: '文', title: '文件' },
  { id: 'search', label: '搜', title: '搜索' },
  { id: 'settings', label: '设', title: '设置（未提供）', disabled: true },
] as const;

const MIXED_LINE_ENDINGS_CODE = 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED';

/**
 * 待确认的过渡：全部携带稳定目标（tabId 或聚合数量），
 * 确认时不得重新查询"当前活动标签"来决定目标（TASK-005 第 6.4 节）。
 * `saving-tab-blocked` 是 saving 标签破坏性过渡的安全提示（单按钮对话框），
 * `source` 记录发起上下文，关闭窗口场景需要复位主进程确认状态。
 */
type PendingDiscard =
  | { readonly kind: 'close-tab'; readonly tabId: string }
  | { readonly kind: 'switch-workspace'; readonly dirtyTabCount: number }
  | { readonly kind: 'close-window'; readonly dirtyTabCount: number }
  | { readonly kind: 'reload'; readonly tabId: string }
  | { readonly kind: 'mixed-line-endings'; readonly tabId: string }
  | {
      readonly kind: 'saving-tab-blocked';
      readonly tabId: string;
      readonly source: 'close-tab' | 'switch-workspace' | 'close-window';
    };

export const App = (): React.JSX.Element => {
  const runtimeLabel = formatRuntimeInfo(window.desktop.runtime);
  const {
    model,
    openFile,
    activateTab,
    editTab,
    editDocxTab,
    saveTab,
    saveDocxTab,
    confirmDocxCompatibility,
    reloadTab,
    closeTab,
    retryRead,
    invalidateWorkspace,
    saveAsTab,
    commitRelocateResult,
    commitTrashResult,
  } = useDocuments();
  // 工作区状态所有权上移：同一 epoch 同时供文档失效与搜索结果校验（WP0 冻结项 11）；
  // mutationEpoch 由文件管理操作确认成功后递增（TASK-009 §4.11）
  const workspace = useWorkspace({ onWorkspaceSelected: invalidateWorkspace });
  const search = useWorkspaceSearch({
    workspaceAvailable: workspace.state.workspace !== null,
    workspaceEpoch: workspace.epoch,
    mutationEpoch: workspace.mutationEpoch,
  });
  // 文件管理 controller（TASK-009 WP6）：选择/展开、新建/重命名/移动/删除/reveal/另存为
  const fileManagement = useFileManagement({
    workspace: workspace.state.workspace,
    workspaceEpoch: workspace.epoch,
    refreshWorkspace: workspace.refreshWorkspace,
    openFile,
    commitRelocate: commitRelocateResult,
    commitTrash: commitTrashResult,
    saveAsTab,
    tabs: model.state.tabs,
    onMutationCommitted: workspace.notifyMutationCommitted,
  });
  const completedSearchRequestId =
    search.state.result?.status === 'completed' ? search.state.result.requestId : null;
  /** 当前可定位的 completed 搜索身份；异步链始终读最新值。 */
  const completedSearchRequestIdRef = useRef<number | null>(completedSearchRequestId);
  completedSearchRequestIdRef.current = completedSearchRequestId;
  const [activity, setActivity] = useState<ActivityPanel>('files');
  const [searchFocusTarget, setSearchFocusTarget] = useState<'workspace' | 'current-document'>(
    'workspace',
  );
  const currentDocumentSearchPanelHostRef = useRef<HTMLDivElement | null>(null);
  const editorSearchControlsRef = useRef<EditorSearchControls | null>(null);
  /** 待应用的搜索结果定位目标（App 校验通过后下发给编辑器宿主）。 */
  const [locateTarget, setLocateTarget] = useState<AppLocateTarget | null>(null);
  /** 非破坏性"搜索结果已过期"提示文案。 */
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  /** 定位请求编号：全局单调递增，新定位请求作废旧请求（第 4.9.7 节）。 */
  const locateCounterRef = useRef(0);
  /** 最新定位请求编号：异步完成时校验仍是最新请求。 */
  const latestLocateIdRef = useRef(0);
  /** 最新定位所属的搜索 requestId；新搜索/取消会使旧定位失效。 */
  const latestLocateSearchRequestIdRef = useRef<number | null>(null);
  /** 最新定位所属的工作区 epoch；宿主迟到回报也必须复验。 */
  const latestLocateEpochRef = useRef<number | null>(null);
  /** 发起定位时的工作区 epoch 快照。 */
  const workspaceEpochRef = useRef(workspace.epoch);
  workspaceEpochRef.current = workspace.epoch;

  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const pendingRef = useRef<PendingDiscard | null>(null);
  /** 切换工作区守卫的 Promise 解析器；确认/取消后只能 resolve 一次。 */
  const guardResolveRef = useRef<((allow: boolean) => void) | null>(null);
  /** 最新模型：异步回调（窗口关闭询问、Ctrl+W）必须读最新值。 */
  const modelRef = useRef(model);
  /** 最新 dirty 状态：窗口关闭询问可能在任何时刻到达，必须读最新值。 */
  const dirtyRef = useRef(false);
  /** 最新未保存标签数量，供关闭窗口确认文案使用。 */
  const dirtyCountRef = useRef(0);
  /** 最新 saving 状态：存在在途保存时禁止破坏性过渡。 */
  const savingRef = useRef(false);
  /** 最新活动标签，供 Ctrl+W 使用。 */
  const activeTabIdRef = useRef<string | null>(null);
  /** 上一次渲染的标签快照：识别"新进入混合换行保存错误"的转移。 */
  const prevTabsRef = useRef<readonly DocumentTabState[]>([]);

  const dirtyCount = dirtyTabCount(model);
  const hasDirty = hasDirtyTabs(model);
  const hasSaving = hasSavingTabs(model);

  // 关闭询问回调需要最新状态，不能依赖可能过期的闭包
  useEffect(() => {
    modelRef.current = model;
    dirtyRef.current = hasDirty;
    dirtyCountRef.current = dirtyCount;
    savingRef.current = hasSaving;
    activeTabIdRef.current = model.state.activeTabId;
  }, [model, hasDirty, dirtyCount, hasSaving]);

  // 窗口关闭协调：上报全部标签聚合的 dirty 状态，并订阅主进程的关闭询问
  useEffect(() => {
    void window.desktop.window.setDirtyState(hasDirty);
  }, [hasDirty]);

  useEffect(() => {
    const unsubscribe = window.desktop.window.onCloseRequested(() => {
      if (pendingRef.current !== null) {
        // 已有确认流程在途：不覆盖尚未处理的目标，复位主进程询问状态
        void window.desktop.window.cancelClose();
        return;
      }
      if (!dirtyRef.current) {
        void window.desktop.window.requestClose();
        return;
      }
      if (savingRef.current) {
        const savingTab = modelRef.current.state.tabs.find((tab) => tab.saving);
        pendingRef.current = {
          kind: 'saving-tab-blocked',
          tabId: savingTab?.id ?? '',
          source: 'close-window',
        };
        setPending(pendingRef.current);
        return;
      }
      pendingRef.current = { kind: 'close-window', dirtyTabCount: dirtyCountRef.current };
      setPending(pendingRef.current);
    });
    return unsubscribe;
  }, []);

  // 切换工作区守卫：有确认在途先拒绝；saving 标签存在时提示等待；
  // 存在未保存标签时先聚合确认；取消则不得打开原生目录选择器
  const handleOpenWorkspaceGuard = useCallback(async (): Promise<boolean> => {
    if (pendingRef.current !== null) {
      return false;
    }
    const current = modelRef.current;
    if (hasSavingTabs(current)) {
      const savingTab = current.state.tabs.find((tab) => tab.saving);
      pendingRef.current = {
        kind: 'saving-tab-blocked',
        tabId: savingTab?.id ?? '',
        source: 'switch-workspace',
      };
      setPending(pendingRef.current);
      return new Promise<boolean>((resolve) => {
        guardResolveRef.current = resolve;
      });
    }
    if (hasDirtyTabs(current)) {
      return new Promise<boolean>((resolve) => {
        guardResolveRef.current = resolve;
        pendingRef.current = { kind: 'switch-workspace', dirtyTabCount: dirtyTabCount(current) };
        setPending(pendingRef.current);
      });
    }
    return true;
  }, []);

  // 标签关闭统一入口（关闭按钮与 Ctrl+W 共用）：
  // clean 直接关闭；dirty 弹"放弃/取消"确认；saving 提示等待保存完成
  const handleCloseTabRequest = useCallback(
    (tabId: string) => {
      if (pendingRef.current !== null) {
        return;
      }
      const tab = tabById(modelRef.current, tabId);
      if (tab === null) {
        return;
      }
      if (tab.saving) {
        pendingRef.current = { kind: 'saving-tab-blocked', tabId, source: 'close-tab' };
        setPending(pendingRef.current);
        return;
      }
      if (tab.dirty) {
        pendingRef.current = { kind: 'close-tab', tabId };
        setPending(pendingRef.current);
        return;
      }
      closeTab(tabId);
    },
    [closeTab],
  );

  // Ctrl+W 与关闭按钮走同一关闭入口
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        const tabId = activeTabIdRef.current;
        if (tabId !== null) {
          event.preventDefault();
          handleCloseTabRequest(tabId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleCloseTabRequest]);

  // 混合换行确认：保存被拒后弹出确认（绑定发起保存的 tabId；只在状态转移时触发一次）
  useEffect(() => {
    const prev = prevTabsRef.current;
    prevTabsRef.current = model.state.tabs;
    if (pendingRef.current !== null) {
      return;
    }
    for (const tab of model.state.tabs) {
      const wasMixed = prev.some(
        (previous) =>
          previous.id === tab.id &&
          previous.status === 'save-error' &&
          previous.error?.code === MIXED_LINE_ENDINGS_CODE,
      );
      if (!wasMixed && tab.status === 'save-error' && tab.error?.code === MIXED_LINE_ENDINGS_CODE) {
        pendingRef.current = { kind: 'mixed-line-endings', tabId: tab.id };
        setPending(pendingRef.current);
        break;
      }
    }
  }, [model.state.tabs]);

  // 冲突重新读取请求：确认目标绑定发起请求的 tabId
  const handleReloadRequest = useCallback((tabId: string) => {
    if (pendingRef.current !== null) {
      return;
    }
    pendingRef.current = { kind: 'reload', tabId };
    setPending(pendingRef.current);
  }, []);

  // 保存统一入口：TXT 的原始磁盘快照为 mixed 时须先确认换行规范化再调用保存 IPC；
  // DOCX 直接走 DOCX 保存（degraded 未确认由模型层拒绝，UI 经兼容性提示确认）。
  const handleSaveRequest = useCallback(
    (tabId: string) => {
      if (pendingRef.current !== null) {
        return;
      }
      const tab = tabById(modelRef.current, tabId);
      if (tab === null) {
        return;
      }
      if (isDocxTab(tab)) {
        saveDocxTab(tabId);
        return;
      }
      if (tab?.dirty && !tab.saving && tab.document?.lineEnding === 'mixed') {
        pendingRef.current = { kind: 'mixed-line-endings', tabId };
        setPending(pendingRef.current);
        return;
      }
      saveTab(tabId);
    },
    [saveTab, saveDocxTab],
  );

  const confirmPending = useCallback(() => {
    const current = pendingRef.current;
    if (current === null) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    if (current.kind === 'switch-workspace') {
      guardResolveRef.current?.(true);
      guardResolveRef.current = null;
    } else if (current.kind === 'close-window') {
      void window.desktop.window.requestClose();
    } else if (current.kind === 'reload') {
      reloadTab(current.tabId);
    } else if (current.kind === 'mixed-line-endings') {
      saveTab(current.tabId, true);
    } else if (current.kind === 'close-tab') {
      closeTab(current.tabId);
    } else if (current.kind === 'saving-tab-blocked') {
      // 等待保存完成提示：不执行任何破坏性过渡
      guardResolveRef.current?.(false);
      guardResolveRef.current = null;
      if (current.source === 'close-window') {
        void window.desktop.window.cancelClose();
      }
    }
  }, [reloadTab, saveTab, closeTab]);

  const cancelPending = useCallback(() => {
    const current = pendingRef.current;
    if (current === null) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    if (current.kind === 'switch-workspace') {
      guardResolveRef.current?.(false);
      guardResolveRef.current = null;
    } else if (current.kind === 'close-window') {
      // 复位主进程确认状态，后续关闭可再次发起询问
      void window.desktop.window.cancelClose();
    } else if (current.kind === 'saving-tab-blocked' && current.source === 'close-window') {
      void window.desktop.window.cancelClose();
    }
  }, []);

  const pendingMessage = (current: PendingDiscard): string => {
    switch (current.kind) {
      case 'close-tab': {
        const name = tabById(model, current.tabId)?.name ?? '当前文件';
        return `放弃对 ${name} 的未保存修改并关闭标签？`;
      }
      case 'switch-workspace': {
        const label =
          current.dirtyTabCount === 1 ? '1 个未保存标签' : `${current.dirtyTabCount} 个未保存标签`;
        return `放弃对 ${label}的修改，并切换工作区？`;
      }
      case 'close-window': {
        const label =
          current.dirtyTabCount === 1 ? '1 个未保存标签' : `${current.dirtyTabCount} 个未保存标签`;
        return `放弃对 ${label}的修改，并关闭窗口？`;
      }
      case 'reload': {
        const name = tabById(model, current.tabId)?.name ?? '当前文件';
        return `文件已被外部修改。放弃对 ${name} 的本地修改并重新读取磁盘内容？`;
      }
      case 'mixed-line-endings':
        return '文件包含混合换行。保存时将按主要换行风格（LF 或 CRLF）统一规范化。确认保存？';
      case 'saving-tab-blocked': {
        const name = tabById(model, current.tabId)?.name ?? '当前文件';
        return `${name} 正在保存，请等待保存完成后再继续。`;
      }
    }
  };

  // 工作区成功切换 → 清空全部标签并使旧工作区未完成的结果失效（useWorkspace 已调用）
  const handleOpenWorkspace = useCallback(async (): Promise<void> => {
    // 未保存修改保护：守卫拒绝时不得打开原生目录选择器
    if (!(await handleOpenWorkspaceGuard())) {
      return;
    }
    await workspace.openWorkspace();
  }, [handleOpenWorkspaceGuard, workspace.openWorkspace]);

  // 手工刷新：成功替换工作区快照才递增 mutationEpoch 作废搜索结果（§4.11）；
  // 刷新失败保留原快照，不错误使有效结果失效
  const handleManualRefresh = useCallback(async (): Promise<void> => {
    const refreshed = await workspace.refreshWorkspace();
    if (refreshed) {
      workspace.notifyMutationCommitted();
    }
  }, [workspace]);

  // Ctrl+Shift+F：打开搜索侧栏并聚焦搜索输入
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchFocusTarget('workspace');
        setActivity('search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleCurrentDocumentSearchRequest = useCallback((): void => {
    setSearchFocusTarget('current-document');
    setActivity('search');
  }, []);

  const handleOpenCurrentDocumentSearch = useCallback((mode: EditorSearchMode): void => {
    editorSearchControlsRef.current?.open(mode);
  }, []);

  // 工作区成功切换：清空挂起的定位目标与过期提示（旧工作区的定位请求作废）；
  // 磁盘变更（mutationEpoch）后旧搜索结果的定位目标与过期提示同样清空（§4.11）
  useEffect(() => {
    setLocateTarget(null);
    setStaleNotice(null);
  }, [workspace.epoch, workspace.mutationEpoch]);

  // 新搜索、取消或搜索结果替换时，立即作废仍在等待文件读取/宿主回报的旧定位。
  useEffect(() => {
    const locateRequestId = latestLocateSearchRequestIdRef.current;
    if (locateRequestId !== null && locateRequestId !== completedSearchRequestId) {
      latestLocateIdRef.current = ++locateCounterRef.current;
      latestLocateSearchRequestIdRef.current = null;
      latestLocateEpochRef.current = null;
      setLocateTarget(null);
    }
  }, [completedSearchRequestId]);

  /**
   * 定位请求是否仍有效：同时绑定工作区 epoch、搜索 requestId 与最新 locateId
   * （第 5.3 节），任一身份变化均不得提交旧定位。
   */
  const isLocateCurrent = useCallback(
    (locateId: number, epoch: number, requestId: number): boolean =>
      workspaceEpochRef.current === epoch &&
      latestLocateIdRef.current === locateId &&
      latestLocateEpochRef.current === epoch &&
      latestLocateSearchRequestIdRef.current === requestId &&
      completedSearchRequestIdRef.current === requestId,
    [],
  );

  /**
   * 搜索结果点击 → "打开/激活 → 验证 → 定位"闭环（第 4.8 / 4.9 节）：
   * 通用 `openFile` 打开或激活唯一标签并等待读取完成；kind、revision、实时正文/
   * 规范投影范围与实际匹配文本全部有效时下发带 locateId 的定位目标，由编辑器宿主
   * 二次校验并设置选区、滚动与聚焦；任何过期情况只提示，不选中、不改正文。
   */
  const handleMatchActivate = useCallback(
    (file: WorkspaceTextSearchFileResult, match: WorkspaceTextSearchMatch) => {
      const result = search.state.result;
      // 只允许点击当前已完成搜索结果的分组（绑定搜索 requestId 与发起时 epoch）
      if (result === null || result.status !== 'completed') {
        return;
      }
      // 参数必须仍是当前 completed 结果中的原始分组与匹配，不接受旧渲染或伪造对象。
      if (!result.files.includes(file) || !file.matches.includes(match)) {
        return;
      }
      const locateId = ++locateCounterRef.current;
      latestLocateIdRef.current = locateId;
      latestLocateSearchRequestIdRef.current = result.requestId;
      const requestId = result.requestId;
      const epoch = workspace.epoch;
      latestLocateEpochRef.current = epoch;
      const relativePath = file.relativePath;
      setStaleNotice(null);
      setLocateTarget(null); // 新定位请求作废旧定位目标

      void (async () => {
        // 1. 通用打开或激活唯一标签（按扩展名分派 TXT / DOCX）；新标签等待读取完成
        const tab = await openFile(relativePath);
        if (!isLocateCurrent(locateId, epoch, requestId)) {
          return; // 新定位请求或工作区切换已作废本次定位
        }
        if (tab === null) {
          return; // 标签已关闭或工作区已失效
        }
        // 2. read-error 标签保留错误状态，不能伪造定位成功（第 4.8 节步骤 3）
        if (tab.status === 'read-error' || tab.document === null) {
          setStaleNotice(`搜索结果已过期：${tab.name} 读取失败。`);
          return;
        }
        if (!isLocateCurrent(locateId, epoch, requestId)) {
          return;
        }
        // 3. 搜索结果 kind 必须与实际标签类型一致（第 4.8 节步骤 3）
        if (file.kind === 'docx' ? !isDocxTab(tab) : !isTextTab(tab)) {
          setStaleNotice(`搜索结果已过期：${tab.name} 的类型已变化。`);
          return;
        }
        // 4. 磁盘基线 revision 必须与结果一致（外部修改后只提示过期）
        if (tab.document.revision !== file.revision) {
          setStaleNotice(`搜索结果已过期：${tab.name} 的内容已被外部修改。`);
          return;
        }
        if (!isLocateCurrent(locateId, epoch, requestId)) {
          return;
        }
        // 5. 按类型校验实时正文 / 规范投影范围与匹配文本（第 4.9 节）：
        //    dirty 但原范围仍一致时允许定位；匹配前插入/删除正文、结构变化、
        //    范围越界或文本不符一律判为过期
        if (file.kind === 'docx') {
          if (!isDocxTab(tab) || tab.model === null) {
            setStaleNotice(`搜索结果已过期：${tab.name} 读取失败。`);
            return;
          }
          const projection = projectDocxModelSearchText(tab.model);
          if (
            match.from < 0 ||
            match.to > projection.text.length ||
            match.to < match.from ||
            projection.text.slice(match.from, match.to) !== match.matchedText
          ) {
            setStaleNotice(`搜索结果已过期：${tab.name} 的匹配位置已失效。`);
            return;
          }
        } else {
          if (!isTextTab(tab)) {
            setStaleNotice(`搜索结果已过期：${tab.name} 的类型已变化。`);
            return;
          }
          if (
            match.from < 0 ||
            match.to > tab.content.length ||
            match.to < match.from ||
            tab.content.slice(match.from, match.to) !== match.matchedText
          ) {
            setStaleNotice(`搜索结果已过期：${tab.name} 的匹配位置已失效。`);
            return;
          }
        }
        if (!isLocateCurrent(locateId, epoch, requestId)) {
          return;
        }
        // 6. 下发定位目标（带 locateId）：TXT / DOCX 宿主各自做二次校验与应用。
        //    目标绑定稳定 tabId（路径迁移后仍指向同一标签，TASK-009 WP1 第 4.5 节）
        setLocateTarget({
          tabId: tab.id,
          locateId,
          requestId,
          from: match.from,
          to: match.to,
          matchedText: match.matchedText,
        });
      })();
    },
    [openFile, search.state.result, workspace.epoch, isLocateCurrent],
  );

  /**
   * 宿主定位结果回报（第 4.8 节步骤 12-13）：只接收当前定位请求的回报，
   * 迟到回报不污染最新定位状态；宿主二次校验失败（App 校验后到宿主应用前发生
   * 编辑/结构变化）时显示非破坏性过期提示。
   */
  const handleLocateOutcome = useCallback((locateId: number, outcome: 'applied' | 'stale') => {
    const requestId = latestLocateSearchRequestIdRef.current;
    if (
      locateId !== latestLocateIdRef.current ||
      requestId === null ||
      latestLocateEpochRef.current !== workspaceEpochRef.current ||
      completedSearchRequestIdRef.current !== requestId
    ) {
      return;
    }
    if (outcome === 'stale') {
      setStaleNotice('搜索结果已过期：匹配位置已失效。');
    }
  }, []);

  const selectedFilePath = activeTab(model)?.relativePath ?? null;
  // 另存为入口：活动标签必须稳定加载且可保存（TXT 或非 read-only DOCX）
  const activeDocumentTabForSaveAs = activeTab(model);
  const saveAsDisabled =
    activeDocumentTabForSaveAs === null ||
    activeDocumentTabForSaveAs.document === null ||
    activeDocumentTabForSaveAs.status === 'loading' ||
    (isDocxTab(activeDocumentTabForSaveAs) && activeDocumentTabForSaveAs.status === 'read-only');
  const handleSaveAsActive = (): void => {
    const tab = activeTab(model);
    if (tab !== null && !saveAsDisabled) {
      fileManagement.beginSaveAs(tab.id);
    }
  };
  // 活动文档类型（TASK-008 第 4.10 节）：查找替换仅支持 TXT，活动 DOCX 时侧栏显示不可用说明。
  const activeDocumentTab = activeTab(model);
  const currentDocumentKind: 'txt' | 'docx' | null =
    activeDocumentTab === null ? null : isDocxTab(activeDocumentTab) ? 'docx' : 'txt';
  const currentDocumentAvailable =
    currentDocumentKind === 'txt' && activeDocumentTab?.document != null;

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="brand-mark">文枢</span>
        <nav aria-label="应用菜单" className="menu-placeholder">
          <span>文件</span>
          <span>编辑</span>
          <span>视图</span>
          <span>帮助</span>
        </nav>
      </header>

      <main className="workspace">
        <aside aria-label="活动栏" className="activity-bar">
          {activityItems.map((item) => {
            const isSettings = item.id === 'settings';
            return (
              <button
                type="button"
                key={item.id}
                className={`activity-item${activity === item.id ? ' active' : ''}`}
                title={item.title}
                aria-pressed={isSettings ? undefined : activity === item.id}
                aria-disabled={isSettings ? true : undefined}
                disabled={isSettings}
                onClick={() => {
                  if (!isSettings) {
                    if (item.id === 'search') {
                      setSearchFocusTarget('workspace');
                    }
                    setActivity(item.id);
                  }
                }}
              >
                {item.label}
              </button>
            );
          })}
        </aside>

        <aside aria-label="侧栏" className="sidebar">
          {/* 两个侧栏保持挂载，用 hidden 切换：切换活动栏不丢失工作区或文件树展开状态 */}
          <div className="sidebar-panel sidebar-panel-files" hidden={activity !== 'files'}>
            <WorkspaceSidebar
              state={workspace.state}
              onOpenWorkspace={handleOpenWorkspace}
              onRefreshWorkspace={handleManualRefresh}
              onFileOpen={openFile}
              selectedFilePath={selectedFilePath}
              managementSelectedPath={fileManagement.state.selectedPath}
              expandedDirs={fileManagement.state.expandedDirs}
              onSelectEntry={fileManagement.selectEntry}
              onToggleDir={fileManagement.toggleDir}
              fileManagement={fileManagement}
              onSaveAsActive={handleSaveAsActive}
              saveAsDisabled={saveAsDisabled}
            />
          </div>
          <div className="sidebar-panel sidebar-panel-search" hidden={activity !== 'search'}>
            <SearchSidebar
              search={search}
              workspaceAvailable={workspace.state.workspace !== null}
              active={activity === 'search'}
              focusTarget={searchFocusTarget}
              onFocusTargetChange={setSearchFocusTarget}
              currentDocumentPanelHostRef={currentDocumentSearchPanelHostRef}
              currentDocumentKind={currentDocumentKind}
              currentDocumentAvailable={currentDocumentAvailable}
              onOpenCurrentDocumentSearch={handleOpenCurrentDocumentSearch}
              onMatchActivate={handleMatchActivate}
            />
          </div>
        </aside>

        <section className="editor-area">
          <DocumentPane
            tabs={model.state.tabs}
            activeTabId={model.state.activeTabId}
            onActivateTab={activateTab}
            onCloseTab={handleCloseTabRequest}
            onRetryRead={retryRead}
            onContentChange={editTab}
            onDocxContentChange={editDocxTab}
            onSave={handleSaveRequest}
            onConfirmCompatibility={confirmDocxCompatibility}
            onReloadRequest={handleReloadRequest}
            locateTarget={locateTarget}
            locateNotice={staleNotice}
            onDismissLocateNotice={() => setStaleNotice(null)}
            onLocateOutcome={handleLocateOutcome}
            searchPanelHostRef={currentDocumentSearchPanelHostRef}
            onSearchPanelRequest={handleCurrentDocumentSearchRequest}
            onSearchControlsChange={(controls) => {
              editorSearchControlsRef.current = controls;
            }}
          />
        </section>
      </main>

      <footer className="statusbar">
        <span>就绪</span>
        <span className="runtime-status">{runtimeLabel}</span>
      </footer>

      {pending === null && (
        <FileManagementDialogs
          state={fileManagement.state}
          workspace={workspace.state.workspace}
          onSetInputName={fileManagement.setInputName}
          onSubmitInput={fileManagement.submitInput}
          onPickTarget={fileManagement.pickTarget}
          onConfirmTarget={fileManagement.confirmTarget}
          onConfirmOverwrite={fileManagement.confirmOverwrite}
          onConfirmTrash={fileManagement.confirmTrash}
          onCancel={fileManagement.cancel}
          onDismissMessage={fileManagement.dismissMessage}
        />
      )}

      {pending !== null && (
        <ConfirmDialog
          title={
            pending.kind === 'mixed-line-endings'
              ? '确认换行规范化'
              : pending.kind === 'saving-tab-blocked'
                ? '等待保存完成'
                : '放弃未保存修改'
          }
          message={pendingMessage(pending)}
          confirmLabel={
            pending.kind === 'mixed-line-endings'
              ? '确认保存'
              : pending.kind === 'saving-tab-blocked'
                ? '知道了'
                : '放弃修改'
          }
          {...(pending.kind === 'saving-tab-blocked' ? {} : { cancelLabel: '取消' })}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
};
