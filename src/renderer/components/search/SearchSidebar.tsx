/**
 * 工作区搜索侧栏 —— TASK-006 WP4 + TASK-008 WP3。
 *
 * 展示职责：搜索输入（草稿）、大小写选项、搜索 / 取消、状态、统计与分组结果；
 * 异步协调与迟到结果防护由 `useWorkspaceSearch` controller 负责。
 *
 * ## 边界（第 4.2 / 4.3 / 4.4 / 4.10 节）
 *
 * - 输入框内容只是草稿：输入变化不等于搜索完成结果，结果标题以已提交查询为准；
 * - 无工作区时显示明确空状态，不发起任何搜索 IPC；
 * - 一次查询搜索磁盘上已保存的 TXT 与 DOCX 规范正文；结果分组携带 kind 类型标识，
 *   DOCX 行列明确属于提取正文；
 * - 结果来自磁盘已保存快照，侧栏明确提示不包含未保存编辑；
 * - TASK-010 WP3：当前文档查找替换按活动 kind 判别——TXT 继续使用 CodeMirror 面板
 *   宿主（不重写 TXT matcher），DOCX 使用 DocxCurrentSearchPanel（WP2 controls）；
 *   同一时刻只显示活动 kind 的面板；loading / read-error（无快照）不显示假可用面板；
 * - 片段由 React 文本节点渲染，不使用 `dangerouslySetInnerHTML`；
 * - 本组件不调用 Node API，不从展示字符串解析路径、行列或匹配范围。
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EditorSearchMode } from '../document/EditorSessionHost';
import type { WorkspaceSearchController } from '../../lib/use-workspace-search';
import type {
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchResult,
} from '../../../shared/search';
import { SearchResults } from './SearchResults';
import { DocxCurrentSearchPanel, type DocxReplaceAvailability } from './DocxCurrentSearchPanel';
import type { DocxCurrentSearchControls } from '../../lib/docx-current-search-plugin';
import { Icon } from '../common/Icon';

interface SearchSidebarProps {
  readonly search: WorkspaceSearchController;
  /** 是否已打开工作区；false 时显示空状态且不发起 IPC。 */
  readonly workspaceAvailable: boolean;
  /** 侧栏激活时自动聚焦搜索输入（Ctrl+Shift+F 打开后可直接输入）。 */
  readonly active: boolean;
  /** 本次打开搜索侧栏希望聚焦的区域，避免当前文档查找被工作区输入抢焦点。 */
  readonly focusTarget?: 'workspace' | 'current-document';
  /** 鼠标切换侧栏内部标签时同步 App 中的快捷键目标。 */
  readonly onFocusTargetChange?: (target: 'workspace' | 'current-document') => void;
  /** CodeMirror 当前文档查找/替换面板的外部挂载点。 */
  readonly currentDocumentPanelHostRef?: RefObject<HTMLDivElement | null>;
  /** 活动文档类型：`txt` / `docx` / 无活动文档为 null（TASK-008 第 4.10 节）。 */
  readonly currentDocumentKind?: 'txt' | 'docx' | null;
  readonly currentDocumentAvailable?: boolean;
  /** 活动 DOCX 标签的 current-search controls（null = 无可用 DOCX 会话）。 */
  readonly docxSearchControls?: DocxCurrentSearchControls | null;
  /** DOCX 替换可用性与不可用原因（WP3 恒不可用；read-only/degraded 原因明确）。 */
  readonly docxReplaceAvailability?: DocxReplaceAvailability | null;
  /** 打开面板时希望聚焦的输入框（Ctrl+F / Ctrl+H / 侧栏入口）。 */
  readonly currentDocumentFocusMode?: 'find' | 'replace' | null;
  readonly onOpenCurrentDocumentSearch?: (mode: EditorSearchMode) => void;
  /** 点击匹配结果后的打开 / 定位入口（WP5 接入）。 */
  readonly onMatchActivate?: (
    file: WorkspaceTextSearchFileResult,
    match: WorkspaceTextSearchMatch,
  ) => void;
}

const TRUNCATED_REASON_LABEL: Readonly<Record<string, string>> = {
  'file-limit': '候选文件数已达上限',
  'docx-file-limit': 'DOCX 候选文件数已达上限',
  'matches-per-file-limit': '单文件匹配数已达上限',
  'total-matches-limit': '总匹配数已达上限',
};

export function SearchSidebar({
  search,
  workspaceAvailable,
  active,
  focusTarget = 'workspace',
  onFocusTargetChange,
  currentDocumentPanelHostRef,
  currentDocumentKind = null,
  currentDocumentAvailable = false,
  docxSearchControls = null,
  docxReplaceAvailability = null,
  currentDocumentFocusMode = null,
  onOpenCurrentDocumentSearch,
  onMatchActivate,
}: SearchSidebarProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 输入为草稿：搜索期间仍可编辑，新提交会取消旧搜索（controller 负责竞态）
  const searching = search.state.status === 'searching';

  useEffect(() => {
    if (active && focusTarget === 'workspace') {
      inputRef.current?.focus();
    }
  }, [active, focusTarget]);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (draft.length === 0) {
      return;
    }
    search.submitSearch(draft, caseSensitive);
  };

  const handleViewChange = (target: 'workspace' | 'current-document'): void => {
    onFocusTargetChange?.(target);
    if (target === 'workspace') {
      queueMicrotask(() => inputRef.current?.focus());
    } else if (
      currentDocumentKind === 'docx' ? docxSearchControls !== null : currentDocumentAvailable
    ) {
      // “查找与替换”标签本身就是功能入口，进入后直接展示完整面板。
      onOpenCurrentDocumentSearch?.('find');
    }
  };

  return (
    <div className="search-sidebar">
      <div className="search-view-tabs" role="tablist" aria-label="搜索范围">
        <button
          type="button"
          role="tab"
          id="workspace-search-tab"
          aria-controls="workspace-search-panel"
          aria-selected={focusTarget === 'workspace'}
          className={`search-view-tab${focusTarget === 'workspace' ? ' active' : ''}`}
          onClick={() => handleViewChange('workspace')}
        >
          全局搜索
        </button>
        <button
          type="button"
          role="tab"
          id="document-search-tab"
          aria-controls="document-search-panel"
          aria-selected={focusTarget === 'current-document'}
          className={`search-view-tab${focusTarget === 'current-document' ? ' active' : ''}`}
          onClick={() => handleViewChange('current-document')}
        >
          查找与替换
        </button>
      </div>

      <section
        id="document-search-panel"
        role="tabpanel"
        aria-labelledby="document-search-tab"
        className="search-view-panel current-document-view"
        hidden={focusTarget !== 'current-document'}
      >
        {currentDocumentKind === 'docx' ? (
          docxSearchControls !== null && docxReplaceAvailability !== null ? (
            <DocxCurrentSearchPanel
              controls={docxSearchControls}
              replaceAvailability={docxReplaceAvailability}
              focusMode={currentDocumentFocusMode}
            />
          ) : (
            <div className="current-document-search-empty">打开 DOCX 文件后可查找或替换。</div>
          )
        ) : (
          <>
            <div
              ref={currentDocumentPanelHostRef}
              className="current-document-search-panel"
              aria-label="当前文档查找与替换"
            />
            {!currentDocumentAvailable && (
              <div className="current-document-search-empty">打开一个 TXT 文件后可查找或替换。</div>
            )}
          </>
        )}
      </section>

      <section
        id="workspace-search-panel"
        role="tabpanel"
        aria-labelledby="workspace-search-tab"
        className="search-view-panel workspace-search-view"
        hidden={focusTarget !== 'workspace'}
      >
        <div className="section-label">工作区搜索</div>

        {!workspaceAvailable ? (
          <div className="ws-idle">
            <Icon name="folder" size={42} aria-hidden="true" />
            <p>尚未打开工作区</p>
            <span>打开文件夹后可搜索已保存的 TXT 和 DOCX 正文</span>
          </div>
        ) : (
          <>
            <form className="search-form" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                className="search-input"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="搜索已保存的 TXT 和 DOCX 正文…"
                aria-label="搜索内容"
              />
              <label className="search-case-label">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) => setCaseSensitive(event.target.checked)}
                />
                区分大小写
              </label>
              <div className="search-actions">
                {searching ? (
                  <button type="button" className="ws-btn" onClick={search.cancelSearch}>
                    取消
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="ws-btn ws-btn-primary"
                    disabled={draft.length === 0}
                  >
                    搜索
                  </button>
                )}
              </div>
            </form>

            <details className="search-help">
              <summary>搜索范围说明</summary>
              <div className="search-note">
                结果来自磁盘上已保存的文件，不包含未保存的编辑；DOCX 仅覆盖已进入结构化模型的正文。
              </div>
            </details>

            <div className="search-status-region">
              <SearchStatus search={search} onMatchActivate={onMatchActivate} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SearchStatus({
  search,
  onMatchActivate,
}: {
  readonly search: WorkspaceSearchController;
  readonly onMatchActivate?: SearchSidebarProps['onMatchActivate'];
}): React.JSX.Element {
  const { state } = search;
  switch (state.status) {
    case 'idle':
      return <div className="search-status">输入查询后按 Enter 或点击搜索。</div>;
    case 'searching':
      return <div className="search-status">正在搜索…</div>;
    case 'cancelled':
      return <div className="search-status">已取消</div>;
    case 'error':
      return <div className="search-error-banner">搜索失败：{state.error?.message ?? ''}</div>;
    case 'completed': {
      const result = state.result;
      if (result === null || result.status !== 'completed') {
        return <div className="search-status" />;
      }
      return (
        <CompletedView
          result={result}
          submittedQuery={state.submittedQuery}
          onMatchActivate={onMatchActivate}
        />
      );
    }
  }
}

function CompletedView({
  result,
  submittedQuery,
  onMatchActivate,
}: {
  readonly result: Extract<WorkspaceTextSearchResult, { status: 'completed' }>;
  readonly submittedQuery: string;
  readonly onMatchActivate?: SearchSidebarProps['onMatchActivate'];
}): React.JSX.Element {
  const { statistics } = result;
  const statsParts = [
    `扫描 ${statistics.scannedFiles} 个文件`,
    `命中 ${statistics.matchedFiles} 个文件`,
    `共 ${statistics.totalMatches} 处匹配`,
  ];
  if (statistics.skippedFiles > 0) {
    statsParts.push(`跳过 ${statistics.skippedFiles} 个`);
  }

  return (
    <>
      <div className="search-statistics">{statsParts.join(' · ')}</div>
      {result.truncated && result.truncatedReason !== null && (
        <div className="search-truncated">
          结果已截断：{TRUNCATED_REASON_LABEL[result.truncatedReason] ?? result.truncatedReason}
        </div>
      )}
      {result.files.length === 0 ? (
        <div className="search-empty">没有匹配</div>
      ) : (
        <SearchResults
          files={result.files}
          submittedQuery={submittedQuery}
          {...(onMatchActivate !== undefined ? { onMatchActivate } : {})}
        />
      )}
    </>
  );
}
