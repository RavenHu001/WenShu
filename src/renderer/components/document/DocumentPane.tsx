/**
 * 中央文档区 —— TASK-005 WP4：多标签渲染、每标签 CodeMirror 会话与保存工具条。
 *
 * - 标签栏与正文使用同一份 activeTabId 快照，避免标签标题与正文错位；
 * - 无标签时显示欢迎页（不创建伪文档标签）；
 * - 活动标签正文按状态渲染：loading 提示、read-error 错误面板/横幅、
 *   CodeMirror 编辑器宿主（每标签会话缓存，见 use-editor-sessions.ts）；
 * - 保存工具条（保存按钮与状态文本）、保存失败/冲突横幅与重新读取入口
 *   全部从目标标签状态派生，目标标签绑定 tabId；
 * - 编辑器只挂载活动标签，切换时卸载/挂载并由会话缓存保存与恢复
 *   光标、选区、滚动位置与撤销历史。
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
  onSave,
  onReloadRequest,
}: {
  readonly tabs: readonly TextDocumentTabState[];
  readonly activeTabId: string | null;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  /** read-error 标签的重试入口（目标标签绑定 tabId）。 */
  readonly onRetryRead: (tabId: string) => void;
  /** 编辑器正文变化：目标标签绑定 tabId。 */
  readonly onContentChange: (tabId: string, content: string) => void;
  /** 保存按钮与 Ctrl+S 共用入口：只保存活动标签（目标标签绑定 tabId）。 */
  readonly onSave: (tabId: string) => void;
  /** 冲突状态下请求"放弃本地修改并重新读取"（确认由 App 绑定 tabId 完成）。 */
  readonly onReloadRequest: (tabId: string) => void;
}): React.JSX.Element {
  const liveTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const sessions = useEditorSessions(liveTabIds);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const editable = activeTab !== null && isEditable(activeTab);

  return (
    <>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={onActivateTab}
        onCloseRequest={onCloseTab}
      />
      {activeTab !== null && editable && (
        <div className="doc-toolbar-row">
          <button
            className="doc-save-btn"
            type="button"
            disabled={!activeTab.dirty || activeTab.saving}
            onClick={() => onSave(activeTab.id)}
          >
            保存
          </button>
          {saveStatusLabel(activeTab) !== '' && (
            <span className={`doc-save-status${activeTab.saving ? ' is-saving' : ''}`}>
              {saveStatusLabel(activeTab)}
            </span>
          )}
        </div>
      )}
      {activeTab === null ? (
        <WelcomePanel />
      ) : (
        <TabBody
          tab={activeTab}
          sessions={sessions}
          onRetryRead={onRetryRead}
          onContentChange={onContentChange}
          onReloadRequest={onReloadRequest}
          onSave={onSave}
        />
      )}
    </>
  );
}

/** 可编辑状态：沿用 TASK-004 的判定（read-error 仅在有成功快照时可编辑）。 */
function isEditable(tab: TextDocumentTabState): boolean {
  return (
    tab.status === 'loaded-clean' ||
    tab.status === 'loaded-dirty' ||
    tab.status === 'saving' ||
    tab.status === 'save-error' ||
    tab.status === 'conflict' ||
    (tab.status === 'read-error' && tab.document !== null)
  );
}

function saveStatusLabel(tab: TextDocumentTabState): string {
  switch (tab.status) {
    case 'loaded-clean':
      return '已保存';
    case 'loaded-dirty':
      return '未保存';
    case 'saving':
      return '正在保存…';
    case 'save-error':
      return '保存失败';
    case 'conflict':
      return '外部冲突';
    default:
      return '';
  }
}

/** 与主进程 mixed 换行规范化规则一致：CR 系占优或平局时使用 CRLF。 */
function editorLineSeparator(tab: TextDocumentTabState): '\n' | '\r\n' {
  const document = tab.document;
  if (document?.lineEnding === 'crlf') {
    return '\r\n';
  }
  if (document?.lineEnding !== 'mixed') {
    return '\n';
  }
  let crStyle = 0;
  let lfStyle = 0;
  for (let index = 0; index < document.content.length; index += 1) {
    const code = document.content.charCodeAt(index);
    if (code === 0x0d) {
      crStyle += 1;
      if (index + 1 < document.content.length && document.content.charCodeAt(index + 1) === 0x0a) {
        index += 1;
      }
    } else if (code === 0x0a) {
      lfStyle += 1;
    }
  }
  return lfStyle > crStyle ? '\n' : '\r\n';
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
  onReloadRequest,
  onSave,
}: {
  readonly tab: TextDocumentTabState;
  readonly sessions: ReturnType<typeof useEditorSessions>;
  readonly onRetryRead: (tabId: string) => void;
  readonly onContentChange: (tabId: string, content: string) => void;
  readonly onReloadRequest: (tabId: string) => void;
  readonly onSave: (tabId: string) => void;
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

  const errorBanner =
    tab.status === 'conflict'
      ? {
          text: `保存失败：${tab.error?.message ?? ''}`,
          action: { label: '重新读取', target: onReloadRequest },
        }
      : tab.status === 'save-error'
        ? { text: `保存失败：${tab.error?.message ?? ''}`, action: null }
        : tab.status === 'read-error'
          ? {
              text: `读取 ${tab.name} 失败：${tab.error?.message ?? ''}`,
              action: { label: '重试', target: onRetryRead },
            }
          : null;

  return (
    <div className="doc-pane-body">
      {errorBanner !== null && (
        <div className="doc-error-banner">
          <span>{errorBanner.text}</span>
          {errorBanner.action !== null && (
            <button
              className="ws-btn doc-reload-btn"
              type="button"
              onClick={() => errorBanner.action.target(tab.id)}
            >
              {errorBanner.action.label}
            </button>
          )}
        </div>
      )}
      <EditorSessionHost
        key={tab.id}
        tabId={tab.id}
        content={tab.content}
        lineSeparator={editorLineSeparator(tab)}
        sessions={sessions}
        onContentChange={(content) => onContentChange(tab.id, content)}
        onSaveRequest={() => onSave(tab.id)}
      />
    </div>
  );
}
