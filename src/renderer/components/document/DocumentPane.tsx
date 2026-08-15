/**
 * 中央文档区 —— 多类型标签渲染（TASK-007 WP5）：每标签 CodeMirror（TXT）/
 * Tiptap（DOCX）会话与保存工具条。
 *
 * - 标签栏与正文使用同一份 activeTabId 快照；
 * - 无标签时显示欢迎页；
 * - TXT 标签沿用 CodeMirror 宿主与会话缓存；DOCX 标签使用 Tiptap 宿主，
 *   全部 DOCX 宿主保持挂载（非活动标签以 `hidden` 隐藏），切换不销毁会话，
 *   选择/滚动/撤销历史天然隔离；
 * - DOCX 兼容性提示与格式工具栏只对活动 DOCX 标签显示；
 * - 保存工具条（保存按钮与状态文本）、失败/冲突横幅与重新读取入口
 *   全部从目标标签状态派生，目标标签绑定 tabId。
 */

import { useMemo, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocxDocumentModel } from '../../../shared/docx';
import { TabBar } from './TabBar';
import {
  EditorSessionHost,
  type EditorLocateOutcome,
  type EditorLocateTarget,
  type EditorSearchControls,
  type EditorSearchMode,
} from './EditorSessionHost';
import { useEditorSessions } from '../../lib/use-editor-sessions';
import {
  isDocxTab,
  type DocxDocumentTabState,
  type DocumentTabState,
} from '../../lib/document-tabs';
import type { TextDocumentTabState } from '../../lib/text-document-tabs';
import { DocxEditorSessionHost } from './DocxEditorSessionHost';
import { DocxToolbar } from './DocxToolbar';
import { DocxCompatibilityNotice } from './DocxCompatibilityNotice';

export function DocumentPane({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onRetryRead,
  onContentChange,
  onDocxContentChange,
  onSave,
  onConfirmCompatibility,
  onReloadRequest,
  locateTarget,
  locateNotice,
  onDismissLocateNotice,
  onLocateOutcome,
  searchPanelHostRef,
  onSearchPanelRequest,
  onSearchControlsChange,
}: {
  readonly tabs: readonly DocumentTabState[];
  readonly activeTabId: string | null;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  /** read-error 标签的重试入口（目标标签绑定 tabId）。 */
  readonly onRetryRead: (tabId: string) => void;
  /** TXT 编辑器正文变化：目标标签绑定 tabId。 */
  readonly onContentChange: (tabId: string, content: string) => void;
  /** DOCX 编辑器模型变化：目标标签绑定 tabId。 */
  readonly onDocxContentChange: (tabId: string, model: DocxDocumentModel) => void;
  /** 保存按钮共用入口：只保存活动标签（按类型分派，目标标签绑定 tabId）。 */
  readonly onSave: (tabId: string) => void;
  /** degraded 文档的兼容性确认（绑定当前基线 revision）。 */
  readonly onConfirmCompatibility: (tabId: string) => void;
  /** 冲突状态下请求"放弃本地修改并重新读取"（确认由 App 绑定 tabId 完成）。 */
  readonly onReloadRequest: (tabId: string) => void;
  /** 待应用的搜索结果定位目标（含目标 tabId；只对匹配的 TXT / DOCX 标签生效）。 */
  readonly locateTarget?: (EditorLocateTarget & { readonly tabId: string }) | null;
  /** 非破坏性"搜索结果已过期"提示文案；null 不显示。 */
  readonly locateNotice?: string | null;
  readonly onDismissLocateNotice?: () => void;
  /** 定位结果回报（applied / stale，携带 locateId；App 只接收当前定位请求的回报）。 */
  readonly onLocateOutcome?: (locateId: number, outcome: EditorLocateOutcome) => void;
  readonly searchPanelHostRef?: RefObject<HTMLElement | null>;
  readonly onSearchPanelRequest?: (mode: EditorSearchMode) => void;
  readonly onSearchControlsChange?: (controls: EditorSearchControls | null) => void;
}): React.JSX.Element {
  const liveTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const sessions = useEditorSessions(liveTabIds);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const editable = activeTab !== null && isEditable(activeTab);
  /** 活动 DOCX 标签的编辑器实例注册表（状态驱动：注册/注销触发工具栏重渲染）。 */
  const [docxEditors, setDocxEditors] = useState<ReadonlyMap<string, Editor>>(() => new Map());

  const registerDocxEditor = (tabId: string, editor: Editor | null): void => {
    setDocxEditors((previous) => {
      const next = new Map(previous);
      if (editor === null) {
        next.delete(tabId);
      } else {
        next.set(tabId, editor);
      }
      return next;
    });
  };

  const activeDocxEditor =
    activeTab !== null && isDocxTab(activeTab) ? (docxEditors.get(activeTab.id) ?? null) : null;

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
      {activeTab !== null && isDocxTab(activeTab) && (
        <div className="docx-editor-header">
          <DocxCompatibilityNotice tab={activeTab} onConfirm={onConfirmCompatibility} />
          <DocxToolbar editor={activeDocxEditor} disabled={!editable} />
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
          locateTarget={
            locateTarget !== null &&
            locateTarget !== undefined &&
            locateTarget.tabId === activeTab.id
              ? {
                  locateId: locateTarget.locateId,
                  from: locateTarget.from,
                  to: locateTarget.to,
                  matchedText: locateTarget.matchedText,
                }
              : null
          }
          locateNotice={locateNotice}
          onDismissLocateNotice={onDismissLocateNotice}
          onLocateOutcome={onLocateOutcome}
          searchPanelHostRef={searchPanelHostRef}
          onSearchPanelRequest={onSearchPanelRequest}
          onSearchControlsChange={onSearchControlsChange}
        />
      )}
      {/* 全部已加载 DOCX 标签的宿主保持挂载（非活动以 hidden 隐藏），
          切换标签不销毁会话，选择/滚动/撤销历史隔离；
          可见宿主承担编辑器区域剩余高度并内部滚动（见 .docx-editor-host 样式） */}
      {tabs
        .filter(
          (tab): tab is DocxDocumentTabState =>
            isDocxTab(tab) && tab.model !== null && tab.status !== 'loading',
        )
        .map((tab) => (
          <div key={tab.id} className="docx-editor-host" hidden={tab.id !== activeTabId}>
            <DocxEditorSessionHost
              tab={tab}
              editable={isEditable(tab)}
              onContentChange={onDocxContentChange}
              onSaveRequest={onSave}
              onEditorRegister={registerDocxEditor}
              locateTarget={
                locateTarget !== null && locateTarget !== undefined && locateTarget.tabId === tab.id
                  ? {
                      locateId: locateTarget.locateId,
                      from: locateTarget.from,
                      to: locateTarget.to,
                      matchedText: locateTarget.matchedText,
                    }
                  : null
              }
              {...(onLocateOutcome !== undefined ? { onLocateOutcome } : {})}
            />
          </div>
        ))}
    </>
  );
}

/** 可编辑状态：TXT 沿用 TASK-004 判定；DOCX 为 loaded/saving/save-error/conflict 与带快照的 read-error。 */
function isEditable(tab: DocumentTabState): boolean {
  if (
    tab.status === 'loaded-clean' ||
    tab.status === 'loaded-dirty' ||
    tab.status === 'saving' ||
    tab.status === 'save-error' ||
    tab.status === 'conflict'
  ) {
    return true;
  }
  if (tab.status === 'read-error') {
    return tab.document !== null;
  }
  return false;
}

function saveStatusLabel(tab: DocumentTabState): string {
  switch (tab.status) {
    case 'loaded-clean':
      // 备份提示：DOCX 保存成功后展示本次滚动备份文件名
      return isDocxTab(tab) && tab.lastBackupRelativePath !== null
        ? `已保存（备份 ${tab.lastBackupRelativePath}）`
        : '已保存';
    case 'loaded-dirty':
      return '未保存';
    case 'saving':
      return '正在保存…';
    case 'save-error':
      return '保存失败';
    case 'conflict':
      return '外部冲突';
    case 'read-only':
      return '只读';
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
  locateTarget,
  locateNotice,
  onDismissLocateNotice,
  onLocateOutcome,
  searchPanelHostRef,
  onSearchPanelRequest,
  onSearchControlsChange,
}: {
  readonly tab: DocumentTabState;
  readonly sessions: ReturnType<typeof useEditorSessions>;
  readonly onRetryRead: (tabId: string) => void;
  readonly onContentChange: (tabId: string, content: string) => void;
  readonly onReloadRequest: (tabId: string) => void;
  readonly onSave: (tabId: string) => void;
  readonly locateTarget: EditorLocateTarget | null;
  readonly locateNotice: string | null | undefined;
  readonly onDismissLocateNotice: (() => void) | undefined;
  readonly onLocateOutcome: ((locateId: number, outcome: EditorLocateOutcome) => void) | undefined;
  readonly searchPanelHostRef: RefObject<HTMLElement | null> | undefined;
  readonly onSearchPanelRequest: ((mode: EditorSearchMode) => void) | undefined;
  readonly onSearchControlsChange: ((controls: EditorSearchControls | null) => void) | undefined;
}): React.JSX.Element {
  if (tab.status === 'loading') {
    return <div className="doc-pane-body doc-loading">正在读取 {tab.name}…</div>;
  }

  const showErrorPanel = tab.status === 'read-error' && tab.document === null;
  if (showErrorPanel) {
    return (
      <div className="doc-pane-body doc-error-panel">
        {locateNotice !== null && locateNotice !== undefined && (
          <div className="doc-locate-banner" role="status">
            <span>{locateNotice}</span>
            {onDismissLocateNotice !== undefined && (
              <button
                type="button"
                className="doc-locate-dismiss"
                aria-label="关闭提示"
                onClick={onDismissLocateNotice}
              >
                ×
              </button>
            )}
          </div>
        )}
        <p>无法读取文件 {tab.name}</p>
        <span>{tab.error?.message}</span>
        <span>请在工作区文件树中选择其他文件重试。</span>
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

  const bannerFragment = (): React.JSX.Element => (
    <>
      {locateNotice !== null && locateNotice !== undefined && (
        <div className="doc-locate-banner" role="status">
          <span>{locateNotice}</span>
          {onDismissLocateNotice !== undefined && (
            <button
              type="button"
              className="doc-locate-dismiss"
              aria-label="关闭提示"
              onClick={onDismissLocateNotice}
            >
              ×
            </button>
          )}
        </div>
      )}
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
    </>
  );

  if (isDocxTab(tab)) {
    // 已加载 DOCX 标签的编辑器宿主在 DocumentPane 的稳定列表中渲染
    // （docx-editor-host 承担剩余高度并内部滚动）；此处只渲染横幅，
    // 不参与 flex 高度竞争。loading / read-error（无快照）已在上方提前返回。
    return <div className="docx-banner-host">{bannerFragment()}</div>;
  }

  return (
    <div className="doc-pane-body">
      {bannerFragment()}
      <EditorSessionHost
        key={tab.id}
        tabId={tab.id}
        content={tab.content}
        lineSeparator={editorLineSeparator(tab)}
        sessions={sessions}
        onContentChange={(content) => onContentChange(tab.id, content)}
        onSaveRequest={() => onSave(tab.id)}
        {...(locateTarget !== null ? { locateTarget } : {})}
        {...(onLocateOutcome !== undefined ? { onLocateOutcome } : {})}
        {...(searchPanelHostRef !== undefined ? { searchPanelHostRef } : {})}
        {...(onSearchPanelRequest !== undefined ? { onSearchPanelRequest } : {})}
        {...(onSearchControlsChange !== undefined ? { onSearchControlsChange } : {})}
      />
    </div>
  );
}
