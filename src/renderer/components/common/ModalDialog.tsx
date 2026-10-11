import { useEffect, useRef, type ReactNode } from 'react';

const focusableSelector =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export function ModalDialog({
  title,
  children,
  onCancel,
  initialFocusRef,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onCancel?: () => void;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let lastFocused: HTMLElement | null = null;
    const focusInside = (): void => {
      const target =
        lastFocused !== null &&
        dialog.contains(lastFocused) &&
        lastFocused.matches(focusableSelector)
          ? lastFocused
          : (initialFocusRef?.current ?? dialog.querySelector<HTMLElement>(focusableSelector));
      (target ?? dialog).focus();
    };
    const containFocus = (event: FocusEvent): void => {
      // A late editor focus frame can run after this dialog opens. Only the frontmost
      // modal owns focus; trapping Tab alone does not prevent programmatic focus escape.
      const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (modals[modals.length - 1] !== dialog) return;
      if (event.target instanceof HTMLElement && dialog.contains(event.target)) {
        lastFocused = event.target;
      } else {
        focusInside();
      }
    };
    document.addEventListener('focusin', containFocus);
    focusInside();
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [initialFocusRef]);

  return (
    <div className="confirm-overlay">
      <div
        aria-label={title}
        aria-modal="true"
        className="confirm-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onCancel !== undefined) {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key !== 'Tab' || dialogRef.current === null) return;
          const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
          if (focusable.length === 0) {
            event.preventDefault();
            return;
          }
          const current = focusable.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey
            ? current <= 0
              ? focusable.length - 1
              : current - 1
            : current === focusable.length - 1
              ? 0
              : current + 1;
          event.preventDefault();
          focusable[next]?.focus();
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
