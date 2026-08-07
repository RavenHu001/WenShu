/**
 * 应用内确认对话框 —— 用于所有可能丢弃未保存修改的过渡（TASK-004 第 7.4 节）。
 *
 * - "放弃修改"是显式确认动作，只影响用户明确确认的当前过渡；
 * - "取消"保持编辑内容、当前文件、工作区和选择状态；
 * - 窗口关闭确认复用同一组件，取消时由调用方负责复位主进程确认状态；
 * - `cancelLabel` 可选：不传时只显示单个确认按钮（如"saving 标签等待保存完成"
 *   的提示对话框，TASK-005 WP5）。
 */
export interface ConfirmDialogProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions">
          {cancelLabel !== undefined && (
            <button className="ws-btn" type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button className="ws-btn ws-btn-primary" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
