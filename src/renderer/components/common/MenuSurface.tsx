import { useCallback, useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuCommand {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSurfaceProps {
  readonly label: string;
  readonly items: readonly MenuCommand[];
  readonly onClose: () => void;
  readonly restoreFocusTo?: HTMLElement | null;
  readonly position?: { readonly x: number; readonly y: number };
  readonly className?: string;
}

function enabledIndexes(items: readonly MenuCommand[]): readonly number[] {
  return items.flatMap((item, index) => (item.disabled === true ? [] : [index]));
}

export function MenuSurface({
  label,
  items,
  onClose,
  restoreFocusTo,
  position,
  className,
}: MenuSurfaceProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const restoreRef = useRef(restoreFocusTo);
  restoreRef.current = restoreFocusTo;

  const close = useCallback(
    (restoreFocus = true): void => {
      onClose();
      if (!restoreFocus) return;
      queueMicrotask(() => {
        const target = restoreRef.current;
        if (target?.isConnected) {
          target.focus();
        }
      });
    },
    [onClose],
  );

  const focusByDelta = useCallback(
    (delta: 1 | -1): void => {
      const indexes = enabledIndexes(items);
      if (indexes.length === 0) return;
      const current = indexes.findIndex(
        (index) => itemRefs.current.get(index) === document.activeElement,
      );
      const next =
        current === -1
          ? delta === 1
            ? 0
            : indexes.length - 1
          : (current + delta + indexes.length) % indexes.length;
      itemRefs.current.get(indexes[next]!)?.focus();
    },
    [items],
  );

  useEffect(() => {
    const first = enabledIndexes(items)[0];
    if (first !== undefined) {
      itemRefs.current.get(first)?.focus();
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!surfaceRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onBlur = (): void => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [close, items]);

  return (
    <div
      aria-label={label}
      className={['menu-surface', className].filter(Boolean).join(' ')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusByDelta(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusByDelta(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          const first = enabledIndexes(items)[0];
          if (first !== undefined) itemRefs.current.get(first)?.focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          const indexes = enabledIndexes(items);
          const last = indexes.at(-1);
          if (last !== undefined) itemRefs.current.get(last)?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          focusByDelta(event.shiftKey ? -1 : 1);
        }
      }}
      ref={surfaceRef}
      role="menu"
      style={position === undefined ? undefined : { left: position.x, top: position.y }}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separatorBefore === true && <div className="menu-separator" role="separator" />}
          <button
            aria-disabled={item.disabled === true ? true : undefined}
            className={['menu-item', item.danger === true ? 'menu-item--danger' : '']
              .filter(Boolean)
              .join(' ')}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled !== true) {
                close(false);
                item.onSelect();
              }
            }}
            ref={(element) => {
              if (element === null) itemRefs.current.delete(index);
              else itemRefs.current.set(index, element);
            }}
            role="menuitem"
            type="button"
          >
            <span className="menu-item__icon" aria-hidden="true">
              {item.icon === undefined ? null : <Icon name={item.icon} size={16} />}
            </span>
            <span className="menu-item__label">{item.label}</span>
            {item.shortcut !== undefined && (
              <span className="menu-item__shortcut" aria-hidden="true">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
