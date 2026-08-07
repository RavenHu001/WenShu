import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRuntimeInfo } from './lib/runtime-info';
import { useTextDocuments } from './lib/use-text-documents';
import { activeTab, dirtyTabCount, hasDirtyTabs } from './lib/text-document-tabs';
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar';
import { DocumentPane } from './components/document/DocumentPane';
import { ConfirmDialog } from './components/common/ConfirmDialog';

const activityItems = ['文', '搜', '设'];

/** 待确认的"放弃未保存修改"过渡（WP2：工作区切换与窗口关闭；关闭标签确认见 WP5）。 */
type PendingDiscard =
  | { readonly kind: 'switch-workspace'; readonly dirtyTabCount: number }
  | { readonly kind: 'close-window'; readonly dirtyTabCount: number };

export const App = (): React.JSX.Element => {
  const runtimeLabel = formatRuntimeInfo(window.desktop.runtime);
  const { model, openTextFile, activateTab, editTab, closeTab, retryRead, invalidateWorkspace } =
    useTextDocuments();

  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const pendingRef = useRef<PendingDiscard | null>(null);
  /** 切换工作区守卫的 Promise 解析器；确认/取消后只能 resolve 一次。 */
  const guardResolveRef = useRef<((allow: boolean) => void) | null>(null);
  /** 最新 dirty 状态：窗口关闭询问可能在任何时刻到达，必须读最新值。 */
  const dirtyRef = useRef(false);
  /** 最新未保存标签数量，供关闭窗口确认文案使用。 */
  const dirtyCountRef = useRef(0);

  const dirtyCount = dirtyTabCount(model);
  const hasDirty = hasDirtyTabs(model);

  // 关闭询问回调需要最新 dirty 状态，不能依赖可能过期的闭包
  useEffect(() => {
    dirtyRef.current = hasDirty;
    dirtyCountRef.current = dirtyCount;
  }, [hasDirty, dirtyCount]);

  // 窗口关闭协调：上报全部标签聚合的 dirty 状态，并订阅主进程的关闭询问
  useEffect(() => {
    void window.desktop.window.setDirtyState(hasDirty);
  }, [hasDirty]);

  useEffect(() => {
    const unsubscribe = window.desktop.window.onCloseRequested(() => {
      if (dirtyRef.current) {
        pendingRef.current = { kind: 'close-window', dirtyTabCount: dirtyCountRef.current };
        setPending(pendingRef.current);
      } else {
        void window.desktop.window.requestClose();
      }
    });
    return unsubscribe;
  }, []);

  // 切换工作区守卫：存在未保存标签时先确认；取消则不得打开原生目录选择器
  const handleOpenWorkspaceGuard = useCallback(async (): Promise<boolean> => {
    if (hasDirtyTabs(model)) {
      return new Promise<boolean>((resolve) => {
        guardResolveRef.current = resolve;
        pendingRef.current = { kind: 'switch-workspace', dirtyTabCount: dirtyTabCount(model) };
        setPending(pendingRef.current);
      });
    }
    return true;
  }, [model]);

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
    }
  }, []);

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
    }
  }, []);

  const pendingMessage = (current: PendingDiscard): string => {
    const label =
      current.dirtyTabCount === 1 ? '1 个未保存标签' : `${current.dirtyTabCount} 个未保存标签`;
    switch (current.kind) {
      case 'switch-workspace':
        return `放弃对 ${label}的修改，并切换工作区？`;
      case 'close-window':
        return `放弃对 ${label}的修改，并关闭窗口？`;
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
            onCloseTab={closeTab}
            onRetryRead={retryRead}
            onContentChange={editTab}
          />
        </section>
      </main>

      <footer className="statusbar">
        <span>就绪</span>
        <span className="runtime-status">{runtimeLabel}</span>
      </footer>

      {pending !== null && (
        <ConfirmDialog
          title="放弃未保存修改"
          message={pendingMessage(pending)}
          confirmLabel="放弃修改"
          cancelLabel="取消"
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
};
