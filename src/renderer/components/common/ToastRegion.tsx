import { useEffect } from 'react';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
  readonly persistent?: boolean;
}

const toneIcon: Record<ToastTone, IconName> = {
  success: 'check',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: ToastMessage;
  readonly onDismiss: (id: number) => void;
}): React.JSX.Element {
  useEffect(() => {
    if (toast.persistent === true) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), 4200);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={toneIcon[toast.tone]} size={17} />
      <span className="toast__message">{toast.message}</span>
      <button
        aria-label="关闭通知"
        className="toast__close"
        onClick={() => onDismiss(toast.id)}
        type="button"
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly ToastMessage[];
  readonly onDismiss: (id: number) => void;
}): React.JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div aria-label="通知" aria-live="polite" className="toast-region">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
