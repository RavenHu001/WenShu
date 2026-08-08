/**
 * 工作区搜索侧栏 —— TASK-006 WP4（任务第 6.6 节）。
 *
 * 展示职责：搜索输入（草稿）、大小写选项、搜索 / 取消、状态、统计与分组结果；
 * 异步协调与迟到结果防护由 `useWorkspaceSearch` controller 负责。
 *
 * ## 边界（第 4.2 / 4.3 / 4.4 节）
 *
 * - 输入框内容只是草稿：输入变化不等于搜索完成结果，结果标题以已提交查询为准；
 * - 无工作区时显示明确空状态，不发起任何搜索 IPC；
 * - 结果来自磁盘已保存快照，侧栏明确提示不包含未保存编辑；
 * - 片段由 React 文本节点渲染，不使用 `dangerouslySetInnerHTML`；
 * - 本组件不调用 Node API，不从展示字符串解析路径、行列或匹配范围。
 */

import { useEffect, useRef, useState } from 'react';
import type { WorkspaceSearchController } from '../../lib/use-workspace-search';
import type { WorkspaceTextSearchResult } from '../../../shared/search';
import { SearchResults } from './SearchResults';

interface SearchSidebarProps {
  readonly search: WorkspaceSearchController;
  /** 是否已打开工作区；false 时显示空状态且不发起 IPC。 */
  readonly workspaceAvailable: boolean;
  /** 侧栏激活时自动聚焦搜索输入（Ctrl+Shift+F 打开后可直接输入）。 */
  readonly active: boolean;
}

const TRUNCATED_REASON_LABEL: Readonly<Record<string, string>> = {
  'file-limit': '候选文件数已达上限',
  'matches-per-file-limit': '单文件匹配数已达上限',
  'total-matches-limit': '总匹配数已达上限',
};

export function SearchSidebar({
  search,
  workspaceAvailable,
  active,
}: SearchSidebarProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 输入为草稿：搜索期间仍可编辑，新提交会取消旧搜索（controller 负责竞态）
  const searching = search.state.status === 'searching';

  useEffect(() => {
    if (active) {
      inputRef.current?.focus();
    }
  }, [active]);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (draft.length === 0) {
      return;
    }
    search.submitSearch(draft, caseSensitive);
  };

  return (
    <>
      <div className="section-label">工作区搜索</div>

      {!workspaceAvailable ? (
        <div className="ws-idle">
          <div className="folder-icon" aria-hidden="true" />
          <p>尚未打开工作区</p>
          <span>打开文件夹后可搜索已保存的 TXT 内容</span>
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
              placeholder="搜索已保存的 TXT 内容…"
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

          <div className="search-note">结果来自磁盘上已保存的文件，不包含未保存的编辑。</div>

          <SearchStatus search={search} />
        </>
      )}
    </>
  );
}

function SearchStatus({
  search,
}: {
  readonly search: WorkspaceSearchController;
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
      return <CompletedView result={result} submittedQuery={state.submittedQuery} />;
    }
  }
}

function CompletedView({
  result,
  submittedQuery,
}: {
  readonly result: Extract<WorkspaceTextSearchResult, { status: 'completed' }>;
  readonly submittedQuery: string;
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
        <SearchResults files={result.files} submittedQuery={submittedQuery} />
      )}
    </>
  );
}
