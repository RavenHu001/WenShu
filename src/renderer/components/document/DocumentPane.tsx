/**
 * 中央文档区 —— TASK-005 WP3：多标签渲染与每标签 CodeMirror 会话。
 *
 * - 标签栏与正文使用同一份 activeTabId 快照，避免标签标题与正文错位；
 * - 无标签时显示欢迎页（不创建伪文档标签）；
 * - 活动标签正文按状态渲染：loading 提示、read-error 错误面板/横幅、
 *   CodeMirror 编辑器宿主（每标签会话缓存，见 use-editor-sessions.ts）；
 * - 编辑器只挂载活动标签，切换时卸载/挂载并由会话缓存保存与恢复
 *   光标、选区、滚动位置与撤销历史；
 * - 保存工具条与冲突流程由 WP4 接入。
 */

import { useMemo } from 'react';
import { TabBar } from './TabBar';
import { EditorSessionHost } from './EditorSessionHost';
import { useEditorSessions } from '../../lib/use-editor-sessions';
import type { TextDocumentTabState } from '../../lib/text-document-tabs';

export function DocumentPane({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onRetryRead,
  onContentChange,
}: {
  readonly tabs: readonly TextDocumentTabState[];
  readonly activeTabId: string | null;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  /** read-error 标签的重试入口（目标标签绑定 tabId）。 */
  readonly onRetryRead: (tabId: string) => void;
  /** 编辑器正文变化：目标标签绑定 tabId。 */
  readonly onContentChange: (tabId: string, content: string) => void;
}): React.JSX.Element {
  const liveTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const sessions = useEditorSessions(liveTabIds);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={onActivateTab}
        onCloseRequest={onCloseTab}
      />
      {activeTab === null ? (
        <WelcomePanel />
      ) : (
        <TabBody
          tab={activeTab}
          sessions={sessions}
          onRetryRead={onRetryRead}
          onContentChange={onContentChange}
        />
      )}
    </>
  );
}

function WelcomePanel(): React.JSX.Element {
  return (
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
  );
}

function TabBody({
  tab,
  sessions,
  onRetryRead,
  onContentChange,
}: {
  readonly tab: TextDocumentTabState;
  readonly sessions: ReturnType<typeof useEditorSessions>;
  readonly onRetryRead: (tabId: string) => void;
  readonly onContentChange: (tabId: string, content: string) => void;
}): React.JSX.Element {
  if (tab.status === 'loading') {
    return <div className="doc-pane-body doc-loading">正在读取 {tab.name}…</div>;
  }

  const showErrorPanel = tab.status === 'read-error' && tab.document === null;
  if (showErrorPanel) {
    return (
      <div className="doc-pane-body doc-error-panel">
        <p>无法读取文件 {tab.name}</p>
        <span>{tab.error?.message}</span>
        <span>请在工作区文件树中选择其他 TXT 文件重试。</span>
        <button className="ws-btn" type="button" onClick={() => onRetryRead(tab.id)}>
          重试
        </button>
      </div>
    );
  }

  const errorBannerText =
    tab.status === 'read-error' && tab.error !== null
      ? `读取 ${tab.name} 失败：${tab.error.message}`
      : null;

  return (
    <div className="doc-pane-body">
      {errorBannerText !== null && (
        <div className="doc-error-banner">
          <span>{errorBannerText}</span>
          <button
            className="ws-btn doc-reload-btn"
            type="button"
            onClick={() => onRetryRead(tab.id)}
          >
            重试
          </button>
        </div>
      )}
      <EditorSessionHost
        key={tab.id}
        tabId={tab.id}
        content={tab.content}
        sessions={sessions}
        onContentChange={(content) => onContentChange(tab.id, content)}
      />
    </div>
  );
}
