export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 258;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function keyboardSidebarWidth(current: number, key: string): number {
  switch (key) {
    case 'ArrowLeft':
      return clampSidebarWidth(current - 16);
    case 'ArrowRight':
      return clampSidebarWidth(current + 16);
    case 'Home':
      return SIDEBAR_MIN_WIDTH;
    case 'End':
      return SIDEBAR_MAX_WIDTH;
    default:
      return current;
  }
}
