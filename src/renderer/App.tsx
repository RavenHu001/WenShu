import { useCallback } from 'react';
import { formatRuntimeInfo } from './lib/runtime-info';
import { useTextDocument } from './lib/use-text-document';
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar';
import { DocumentPane } from './components/document/DocumentPane';

const activityItems = ['文', '搜', '设'];

export const App = (): React.JSX.Element => {
  const runtimeLabel = formatRuntimeInfo(window.desktop.runtime);
  const { state: documentState, openTextFile, invalidate } = useTextDocument();

  // 文件树选择 → 发起受控读取；读取结果与竞态由 useTextDocument 处理
  const handleTextFileOpen = useCallback(
    (relativePath: string) => {
      openTextFile(relativePath);
    },
    [openTextFile],
  );

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
        />

        <section className="editor-area">
          <DocumentPane state={documentState} />
        </section>
      </main>

      <footer className="statusbar">
        <span>就绪</span>
        <span className="runtime-status">{runtimeLabel}</span>
      </footer>
    </div>
  );
};
