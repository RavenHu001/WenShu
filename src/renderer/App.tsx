import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRuntimeInfo } from './lib/runtime-info';
import { useTextDocuments } from './lib/use-text-documents';
import {
  activeTab,
  dirtyTabCount,
  hasDirtyTabs,
  hasSavingTabs,
  tabById,
  type TextDocumentTabState,
} from './lib/text-document-tabs';
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar';
import { DocumentPane } from './components/document/DocumentPane';
import { ConfirmDialog } from './components/common/ConfirmDialog';

const activityItems = ['文', '搜', '设'];

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
    openTextFile,
    activateTab,
    editTab,
    saveTab,
    reloadTab,
    closeTab,
    retryRead,
    invalidateWorkspace,
  } = useTextDocuments();

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
  const prevTabsRef = useRef<readonly TextDocumentTabState[]>([]);

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

  // 工作区成功切换 → 清空全部标签并使旧工作区未完成的结果失效
  const handleWorkspaceSelected = useCallback(() => {
    invalidateWorkspace();
  }, [invalidateWorkspace]);

  const selectedTextFilePath = activeTab(model)?.relativePath ?? null;

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
          {activityItems.map((item, index) => (
            <div className={index === 0 ? 'activity-item active' : 'activity-item'} key={item}>
              {item}
            </div>
          ))}
        </aside>

        <WorkspaceSidebar
          onTextFileOpen={openTextFile}
          selectedTextFilePath={selectedTextFilePath}
          onWorkspaceSelected={handleWorkspaceSelected}
          onOpenWorkspaceGuard={handleOpenWorkspaceGuard}
        />

        <section className="editor-area">
          <DocumentPane
            tabs={model.state.tabs}
            activeTabId={model.state.activeTabId}
            onActivateTab={activateTab}
            onCloseTab={handleCloseTabRequest}
            onRetryRead={retryRead}
            onContentChange={editTab}
            onSave={saveTab}
            onReloadRequest={handleReloadRequest}
          />
        </section>
      </main>

      <footer className="statusbar">
        <span>就绪</span>
        <span className="runtime-status">{runtimeLabel}</span>
      </footer>

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
