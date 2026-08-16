/**
 * 文件管理操作栏（TASK-009 WP6）—— 作用于当前选中条目（与活动文档分离）。
 * running 状态禁用全部按钮阻止重复提交；错误/部分完成/成功消息展示为可关闭横幅。
 */

import type { FileManagementUiState } from '../../lib/use-file-management';

export function FileManagementToolbar({
  state,
  onBeginCreate,
  onBeginRename,
  onBeginMove,
  onBeginDelete,
  onReveal,
  onSaveAs,
  saveAsDisabled,
  onDismissMessage,
}: {
  readonly state: FileManagementUiState;
  readonly onBeginCreate: (kind: 'text' | 'docx' | 'directory') => void;
  readonly onBeginRename: () => void;
  readonly onBeginMove: () => void;
  readonly onBeginDelete: () => void;
  readonly onReveal: () => void;
  readonly onSaveAs: (() => void) | undefined;
  readonly saveAsDisabled: boolean;
  readonly onDismissMessage: () => void;
}): React.JSX.Element {
  const busy = state.status === 'running';
  const hasSelection = state.selectedPath !== null && state.selectedPath !== '';
  const hasError = state.status === 'error';
  const showMessage = state.message !== null;
  return (
    <div className="fm-toolbar" data-testid="fm-toolbar">
      <div className="fm-toolbar-row">
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-create-text"
          disabled={busy}
          onClick={() => onBeginCreate('text')}
        >
          新建 TXT
        </button>
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-create-docx"
          disabled={busy}
          onClick={() => onBeginCreate('docx')}
        >
          新建 DOCX
        </button>
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-create-dir"
          disabled={busy}
          onClick={() => onBeginCreate('directory')}
        >
          新建文件夹
        </button>
      </div>
      <div className="fm-toolbar-row">
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-rename"
          disabled={busy || !hasSelection}
          onClick={onBeginRename}
        >
          重命名
        </button>
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-move"
          disabled={busy || !hasSelection}
          onClick={onBeginMove}
        >
          移动
        </button>
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-delete"
          disabled={busy || !hasSelection}
          onClick={onBeginDelete}
        >
          删除
        </button>
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-reveal"
          disabled={busy || !hasSelection}
          onClick={onReveal}
        >
          在资源管理器中显示
        </button>
      </div>
      <div className="fm-toolbar-row">
        <button
          type="button"
          className="ws-btn"
          data-testid="fm-save-as"
          disabled={busy || saveAsDisabled || onSaveAs === undefined}
          onClick={() => onSaveAs?.()}
        >
          另存为当前文档…
        </button>
      </div>
      {hasError && state.error !== null && (
        <div className="fm-error-banner" role="alert">
          <span>{state.error.message}</span>
        </div>
      )}
      {showMessage && (
        <div className="fm-message-banner" role="status">
          <span>{state.message}</span>
          <button type="button" aria-label="关闭提示" onClick={onDismissMessage}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
