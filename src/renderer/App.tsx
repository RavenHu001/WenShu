import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRuntimeInfo } from './lib/runtime-info';
import { useTextDocument } from './lib/use-text-document';
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar';
import { DocumentPane } from './components/document/DocumentPane';
import { ConfirmDialog } from './components/common/ConfirmDialog';

const activityItems = ['文', '搜', '设'];

/** 待确认的"放弃未保存修改"或"混合换行规范化"过渡。 */
type PendingDiscard =
  | { readonly kind: 'open-file'; readonly relativePath: string }
  | { readonly kind: 'switch-workspace' }
  | { readonly kind: 'reload' }
  | { readonly kind: 'close-window' }
  | { readonly kind: 'mixed-line-endings' };

export const App = (): React.JSX.Element => {
  const runtimeLabel = formatRuntimeInfo(window.desktop.runtime);
  const {
    state: documentState,
    openTextFile,
    editContent,
    save,
    reload,
    invalidate,
  } = useTextDocument();

  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const pendingRef = useRef<PendingDiscard | null>(null);
  /** 切换工作区守卫的 Promise 解析器；确认/取消后只能 resolve 一次。 */
  const guardResolveRef = useRef<((allow: boolean) => void) | null>(null);
  /** 最新 dirty 状态：窗口关闭询问可能在任何时刻到达，必须读最新值。 */
  const dirtyRef = useRef(false);

  // 关闭询问回调需要最新 dirty 状态，不能依赖可能过期的闭包
  useEffect(() => {
    dirtyRef.current = documentState.dirty;
  }, [documentState.dirty]);

  // 窗口关闭协调：上报 dirty 状态，并订阅主进程的关闭询问
  useEffect(() => {
    void window.desktop.window.setDirtyState(documentState.dirty);
  }, [documentState.dirty]);

  useEffect(() => {
    const unsubscribe = window.desktop.window.onCloseRequested(() => {
      if (dirtyRef.current) {
        pendingRef.current = { kind: 'close-window' };
        setPending(pendingRef.current);
      } else {
        void window.desktop.window.requestClose();
      }
    });
    return unsubscribe;
  }, []);

  // 文件树选择 → 有未保存修改时先确认；取消不发起读取，放弃后才打开新文件
  const handleTextFileOpen = useCallback(
    (relativePath: string) => {
      if (
        documentState.dirty &&
        documentState.document !== null &&
        documentState.status !== 'loading'
      ) {
        pendingRef.current = { kind: 'open-file', relativePath };
        setPending(pendingRef.current);
        return;
      }
      openTextFile(relativePath);
    },
    [documentState.dirty, documentState.document, documentState.status, openTextFile],
  );

  // 切换工作区守卫：有未保存修改时先确认；取消则不得打开原生目录选择器
  const handleOpenWorkspaceGuard = useCallback(async (): Promise<boolean> => {
    if (
      documentState.dirty &&
      documentState.document !== null &&
      documentState.status !== 'loading'
    ) {
      return new Promise<boolean>((resolve) => {
        guardResolveRef.current = resolve;
        pendingRef.current = { kind: 'switch-workspace' };
        setPending(pendingRef.current);
      });
    }
    return true;
  }, [documentState.dirty, documentState.document, documentState.status]);

  const handleReloadRequest = useCallback(() => {
    if (documentState.document !== null) {
      pendingRef.current = { kind: 'reload' };
      setPending(pendingRef.current);
    }
  }, [documentState.document]);

  // 混合换行确认：保存被拒后弹出确认，用户确认才携带 confirm 重试
  useEffect(() => {
    if (
      documentState.status === 'save-error' &&
      documentState.error?.code === 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED'
    ) {
      pendingRef.current = { kind: 'mixed-line-endings' };
      setPending(pendingRef.current);
    }
  }, [documentState.status, documentState.error]);

  const confirmPending = useCallback(() => {
    const current = pendingRef.current;
    if (current === null) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    if (current.kind === 'open-file') {
      openTextFile(current.relativePath);
    } else if (current.kind === 'switch-workspace') {
      guardResolveRef.current?.(true);
      guardResolveRef.current = null;
    } else if (current.kind === 'reload') {
      reload();
    } else if (current.kind === 'close-window') {
      void window.desktop.window.requestClose();
    } else if (current.kind === 'mixed-line-endings') {
      save(true);
    }
  }, [openTextFile, reload, save]);

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
    const fileName = documentState.tabName ?? '当前文件';
    switch (current.kind) {
      case 'open-file':
        return `放弃对 ${fileName} 的未保存修改，并打开 ${current.relativePath}？`;
      case 'switch-workspace':
        return `放弃对 ${fileName} 的未保存修改，并切换工作区？`;
      case 'reload':
        return '文件已被外部修改。放弃本地修改并重新读取磁盘内容？';
      case 'close-window':
        return `放弃对 ${fileName} 的未保存修改，并关闭窗口？`;
      case 'mixed-line-endings':
        return '文件包含混合换行。保存时将按主要换行风格（LF 或 CRLF）统一规范化。确认保存？';
    }
  };

  // 工作区成功切换 → 清除旧文档并使旧工作区未完成的读取失效
  const handleWorkspaceSelected = useCallback(() => {
    invalidate();
  }, [invalidate]);

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
          onTextFileOpen={handleTextFileOpen}
          selectedTextFilePath={documentState.selectedRelativePath}
          onWorkspaceSelected={handleWorkspaceSelected}
          onOpenWorkspaceGuard={handleOpenWorkspaceGuard}
        />

        <section className="editor-area">
          <DocumentPane
            state={documentState}
            onContentChange={editContent}
            onSave={save}
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
          title={pending.kind === 'mixed-line-endings' ? '确认换行规范化' : '放弃未保存修改'}
          message={pendingMessage(pending)}
          confirmLabel={pending.kind === 'mixed-line-endings' ? '确认保存' : '放弃修改'}
          cancelLabel="取消"
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
};
