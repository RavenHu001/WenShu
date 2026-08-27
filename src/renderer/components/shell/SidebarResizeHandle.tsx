import { useEffect, useRef, useState } from 'react';
import { keyboardSidebarWidth, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../../lib/sidebar-size';

export function SidebarResizeHandle({
  width,
  onWidthChange,
}: {
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, width });

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent): void => {
      onWidthChange(startRef.current.width + event.clientX - startRef.current.x);
    };
    const stop = (): void => setDragging(false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragging, onWidthChange]);

  return (
    <div
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuenow={width}
      className={`sidebar-resize-handle${dragging ? ' is-dragging' : ''}`}
      onDoubleClick={() => onWidthChange(258)}
      onKeyDown={(event) => {
        const next = keyboardSidebarWidth(width, event.key);
        if (next !== width) {
          event.preventDefault();
          onWidthChange(next);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        startRef.current = { x: event.clientX, width };
        setDragging(true);
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
