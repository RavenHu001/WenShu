import { TextEditor } from './TextEditor';
import type { TextDocumentUiState } from '../../lib/use-text-document';

/**
 * 中央文档区 —— 表达 welcome / loading / loaded-clean / loaded-dirty /
 * saving / save-error / conflict / read-error 状态。
 *
 * - welcome：尚未选择文档，显示欢迎内容；
 * - loading：显示正在读取的文件名和加载状态；
 * - loaded-*：显示标签（未保存带 ●）、保存工具条与可编辑正文；
 * - saving：标签与正文保持，工具条显示"正在保存…"；
 * - save-error / conflict：正文与未保存标记保留，显示错误横幅；
 * - read-error：已有成功文档时保留原正文并可继续编辑，显示非阻塞提示；
 *   尚无成功文档时显示错误面板。
 */
export function DocumentPane({
  state,
  onContentChange,
  onSave,
}: {
  readonly state: TextDocumentUiState;
  readonly onContentChange: (content: string) => void;
  readonly onSave: () => void;
}): React.JSX.Element {
  const { status, tabName, document, content, dirty, saving, error } = state;

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

  const editable =
    status === 'loaded-clean' ||
    status === 'loaded-dirty' ||
    status === 'saving' ||
    status === 'save-error' ||
    status === 'conflict' ||
    (status === 'read-error' && document !== null);
  const showErrorPanel = status === 'read-error' && document === null;

  const saveStatusLabel = ((): string => {
    switch (status) {
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
  })();

  const errorBannerText = ((): string | null => {
    if (error === null) {
      return null;
    }
    if (status === 'read-error') {
      return `读取 ${tabName} 失败：${error.message}`;
    }
    if (status === 'save-error' || status === 'conflict') {
      return `保存失败：${error.message}`;
    }
    return null;
  })();

  return (
    <>
      <div className="editor-tabs">
        <div className="tab active">
          <span className="tab-name">{tabName ?? ''}</span>
          {dirty && (
            <span className="tab-dirty" aria-label="未保存">
              ●
            </span>
          )}
        </div>
        {editable && (
          <div className="doc-toolbar">
            <button
              className="doc-save-btn"
              type="button"
              disabled={saving || !dirty}
              onClick={onSave}
            >
              保存
            </button>
            {saveStatusLabel !== '' && (
              <span className={`doc-save-status${saving ? ' is-saving' : ''}`}>
                {saveStatusLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && <div className="doc-pane-body doc-loading">正在读取 {tabName}…</div>}

      {editable && (
        <div className="doc-pane-body">
          {errorBannerText !== null && <div className="doc-error-banner">{errorBannerText}</div>}
          <TextEditor content={content} onContentChange={onContentChange} onSaveRequest={onSave} />
        </div>
      )}

      {showErrorPanel && (
        <div className="doc-pane-body doc-error-panel">
          <p>无法读取文件 {tabName}</p>
          <span>{error?.message}</span>
          <span>请在工作区文件树中选择其他 TXT 文件重试。</span>
        </div>
      )}
    </>
  );
}
