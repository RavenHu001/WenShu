/**
 * 搜索结果列表 —— TASK-006 WP4（任务第 6.6 节）。
 *
 * 按文件分组展示匹配：相对路径、1-based 行列、单行上下文片段与统计说明；
 * 片段由 React 文本节点渲染（纯文本拆分高亮），不使用 `dangerouslySetInnerHTML`；
 * 本组件不调用 Node API，不从展示字符串解析路径、行列或匹配范围。
 * WP5 将接入 `onMatchActivate` 完成打开 / 激活 / 定位。
 */

import type {
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchMatch,
} from '../../../shared/search';

interface SearchResultsProps {
  readonly files: readonly WorkspaceTextSearchFileResult[];
  /** 已提交查询文本（结果标题以此为准，与输入草稿分离）。 */
  readonly submittedQuery: string;
  /** 点击匹配后的打开 / 定位请求入口（WP5 接入；当前可省略）。 */
  readonly onMatchActivate?: (
    file: WorkspaceTextSearchFileResult,
    match: WorkspaceTextSearchMatch,
  ) => void;
}

export function SearchResults({
  files,
  submittedQuery,
  onMatchActivate,
}: SearchResultsProps): React.JSX.Element {
  return (
    <div className="search-results">
      <div className="search-results-note">查询：“{submittedQuery}”</div>
      {files.map((file) => (
        <FileResultGroup key={file.relativePath} file={file} onMatchActivate={onMatchActivate} />
      ))}
    </div>
  );
}

function FileResultGroup({
  file,
  onMatchActivate,
}: {
  readonly file: WorkspaceTextSearchFileResult;
  readonly onMatchActivate?: SearchResultsProps['onMatchActivate'];
}): React.JSX.Element {
  return (
    <div className="search-file-group">
      <div className="search-file-path" title={file.relativePath}>
        {file.relativePath}
        {file.truncated ? <span className="search-file-truncated">（已截断）</span> : null}
      </div>
      <ul className="search-match-list">
        {file.matches.map((match, index) => (
          <MatchRow
            key={`${match.from}-${index}`}
            file={file}
            match={match}
            onMatchActivate={onMatchActivate}
          />
        ))}
      </ul>
    </div>
  );
}

function MatchRow({
  file,
  match,
  onMatchActivate,
}: {
  readonly file: WorkspaceTextSearchFileResult;
  readonly match: WorkspaceTextSearchMatch;
  readonly onMatchActivate?: SearchResultsProps['onMatchActivate'];
}): React.JSX.Element {
  const content = (
    <>
      <span className="search-match-loc">
        {match.line}:{match.column}
      </span>
      <span className="search-match-preview">
        <PreviewText match={match} />
      </span>
    </>
  );
  if (onMatchActivate === undefined) {
    return <li className="search-match-row">{content}</li>;
  }
  return (
    <li className="search-match-row">
      <button
        type="button"
        className="search-match-btn"
        onClick={() => onMatchActivate(file, match)}
      >
        {content}
      </button>
    </li>
  );
}

/** 安全高亮匹配片段：纯文本节点拆分，不使用 dangerouslySetInnerHTML。 */
function PreviewText({ match }: { readonly match: WorkspaceTextSearchMatch }): React.JSX.Element {
  const { preview, previewMatchFrom, previewMatchTo } = match;
  const safeFrom = Math.max(0, Math.min(previewMatchFrom, preview.length));
  const safeTo = Math.max(safeFrom, Math.min(previewMatchTo, preview.length));
  return (
    <>
      {preview.slice(0, safeFrom)}
      <mark>{preview.slice(safeFrom, safeTo)}</mark>
      {preview.slice(safeTo)}
    </>
  );
}
