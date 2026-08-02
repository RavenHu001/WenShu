import { ReadonlyTextDocument } from './ReadonlyTextDocument';
import type { TextDocumentUiState } from '../../lib/use-text-document';

/**
 * 中央文档区 —— 表达 welcome / loading / loaded / error 四种状态。
 *
 * - welcome：尚未选择文档，显示欢迎内容；
 * - loading：显示正在读取的文件名和加载状态；
 * - loaded：显示一个活动标签及只读正文；
 * - error：已有成功文档时保留原正文并显示非阻塞错误提示；
 *   尚无成功文档时显示错误面板。
 */
export function DocumentPane({
  state,
}: {
  readonly state: TextDocumentUiState;
}): React.JSX.Element {
  const { status, tabName, lastDocument, error } = state;

  if (status === 'welcome') {
    return (
      <>
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
      </>
    );
  }

  // 读取失败但保留上一次成功文档：正文继续显示，错误以非阻塞横幅提示
  const showRetained = status === 'error' && lastDocument !== null;
  const bodyDocument = status === 'loaded' || showRetained ? lastDocument : null;

  return (
    <>
      <div className="editor-tabs">
        <div className="tab active">{showRetained ? lastDocument?.name : tabName}</div>
      </div>

      {status === 'loading' && <div className="doc-pane-body doc-loading">正在读取 {tabName}…</div>}

      {bodyDocument !== null && (
        <div className="doc-pane-body">
          {showRetained && error !== null && (
            <div className="doc-error-banner">
              读取 {tabName} 失败：{error.message}
            </div>
          )}
          <ReadonlyTextDocument name={bodyDocument.name} content={bodyDocument.content} />
        </div>
      )}

      {status === 'error' && lastDocument === null && (
        <div className="doc-pane-body doc-error-panel">
          <p>无法读取文件 {tabName}</p>
          <span>{error?.message}</span>
          <span>请在工作区文件树中选择其他 TXT 文件重试。</span>
        </div>
      )}
    </>
  );
}
