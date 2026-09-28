import type { BrowserWindow, Rectangle } from 'electron';
import { validWindow, type WindowState } from '../../shared/app-state';
import type { AppStateStore } from '../app-state/app-state-store';

export const WINDOW_MIN_WIDTH = 900;
export const WINDOW_MIN_HEIGHT = 600;

/** Windows can adjust constructor dimensions for the native frame at fractional DPI.
 * Correct against observed bounds before show, with a bounded number of public API calls.
 * The OS minimum remains authoritative when a requested size cannot be represented. */
export function applyWindowBounds(window: BrowserWindow, target: Rectangle): void {
  let requested = { ...target };
  for (let attempt = 0; attempt < 3; attempt++) {
    window.setBounds(requested);
    const actual = window.getNormalBounds();
    if (
      Object.keys(target).every(
        (key) => actual[key as keyof Rectangle] === target[key as keyof Rectangle],
      )
    )
      break;
    const next = {
      x: requested.x + target.x - actual.x,
      y: requested.y + target.y - actual.y,
      width: Math.max(WINDOW_MIN_WIDTH, requested.width + target.width - actual.width),
      height: Math.max(WINDOW_MIN_HEIGHT, requested.height + target.height - actual.height),
    };
    if (JSON.stringify(next) === JSON.stringify(requested)) break;
    requested = next;
  }
}

/** Electron bounds and display work areas are DIPs, never multiply by scaleFactor. */
export function restoreWindowLayout(
  saved: WindowState,
  areas: readonly Rectangle[],
  primary: Rectangle,
): WindowState {
  const bounds = validWindow(saved) ? saved.normalBounds : null;
  const overlap = (area: Rectangle) =>
    bounds
      ? Math.max(
          0,
          Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x),
        ) *
        Math.max(
          0,
          Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y),
        )
      : 0;
  const target = [...areas].sort((a, b) => overlap(b) - overlap(a))[0];
  const area = target && overlap(target) > 0 ? target : primary;
  const width = Math.max(WINDOW_MIN_WIDTH, Math.min(bounds?.width ?? 1280, area.width));
  const height = Math.max(WINDOW_MIN_HEIGHT, Math.min(bounds?.height ?? 820, area.height));
  const x = bounds && target && overlap(target) > 0 ? bounds.x : area.x + (area.width - width) / 2;
  const y =
    bounds && target && overlap(target) > 0 ? bounds.y : area.y + (area.height - height) / 2;
  return {
    normalBounds: {
      x: Math.round(Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - width)))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - height)))),
      width: Math.round(width),
      height: Math.round(height),
    },
    maximized: validWindow(saved) && saved.maximized,
  };
}

/** Stop accepting layout events before final flush; never record minimized/fullscreen bounds. */
export function trackWindowLayout(window: BrowserWindow, store: AppStateStore) {
  let stopped = false;
  let maximized = window.isMaximized();
  const capture = () => {
    if (stopped || window.isDestroyed() || window.isFullScreen()) return;
    if (!window.isMinimized()) maximized = window.isMaximized();
    store.updateWindow({ normalBounds: window.getNormalBounds(), maximized });
  };
  window.on('move', capture);
  window.on('resize', capture);
  window.on('maximize', capture);
  window.on('unmaximize', capture);
  window.on('restore', capture);
  const stop = () => {
    capture();
    stopped = true;
    window.removeListener('move', capture);
    window.removeListener('resize', capture);
    window.removeListener('maximize', capture);
    window.removeListener('unmaximize', capture);
    window.removeListener('restore', capture);
  };
  window.once('closed', stop);
  return stop;
}
