import { formatRuntimeInfo } from './lib/runtime-info';

const activityItems = ['文', '搜', '设'];

export const App = (): React.JSX.Element => {
  const runtimeLabel = formatRuntimeInfo(window.desktop.runtime);

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

        <aside className="sidebar">
          <div className="section-label">工作区</div>
          <div className="empty-tree">
            <div className="folder-icon" aria-hidden="true" />
            <p>尚未打开文件夹</p>
            <span>工作区与文件树将在下一任务中提供</span>
          </div>
        </aside>

        <section className="editor-area">
          <div className="editor-tabs">
            <div className="tab active">欢迎</div>
          </div>
          <div className="welcome-panel">
            <div className="welcome-copy">
              <div className="eyebrow">本地多文档工作台</div>
              <h1>文枢</h1>
              <p>让相关文档集中于一处，让创作和资料维护保持清晰。</p>
              <div className="scope-note">
                <strong>工程骨架已就绪</strong>
                <span>当前页面用于验证 Electron、React、样式与安全桥接链路。</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <span>就绪</span>
        <span className="runtime-status">{runtimeLabel}</span>
      </footer>
    </div>
  );
};
