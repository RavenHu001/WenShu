import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  applyWindowBounds,
  restoreWindowLayout,
  trackWindowLayout,
} from '../../src/main/window/window-layout';
import type { WindowState } from '../../src/shared/app-state';

const primary = { x: 0, y: 0, width: 1536, height: 824 };
const second = { x: -1920, y: 0, width: 1920, height: 1040 };
describe('window layout in display work-area DIPs', () => {
  it('corrects measured native-frame adjustment with a bounded public-API retry', () => {
    let bounds = { x: 30, y: 40, width: 1107, height: 700 };
    const setBounds = vi.fn((value: typeof bounds) => {
      bounds = { ...value, width: value.width + 2 };
    });
    applyWindowBounds({ setBounds, getNormalBounds: () => bounds } as never, {
      ...bounds,
      width: 1102,
    });
    expect(bounds.width).toBe(1102);
    expect(setBounds).toHaveBeenCalledTimes(2);
    applyWindowBounds({ setBounds, getNormalBounds: () => bounds } as never, {
      ...bounds,
      width: 900,
    });
    expect(bounds.width).toBe(902);
    expect(setBounds).toHaveBeenCalledTimes(3);
  });
  it.each([
    [
      { x: -1800, y: 80, width: 1100, height: 700 },
      [primary, second],
      { x: -1800, y: 80, width: 1100, height: 700 },
    ],
    [
      { x: -1800, y: 80, width: 1100, height: 700 },
      [primary],
      { x: 218, y: 62, width: 1100, height: 700 },
    ],
    [
      { x: 1400, y: 780, width: 1800, height: 1200 },
      [primary],
      { x: 0, y: 0, width: 1536, height: 824 },
    ],
    [{ x: 50, y: 10, width: 1, height: 1 }, [primary], { x: 50, y: 10, width: 900, height: 600 }],
  ])(
    'corrects bounds without restoring minimized/fullscreen or physical pixels',
    (normalBounds, areas, expected) => {
      expect(restoreWindowLayout({ normalBounds, maximized: true }, areas, primary)).toEqual({
        normalBounds: expected,
        maximized: true,
      });
    },
  );
  it.each([NaN, Infinity, Number.MAX_VALUE])(
    'rejects abnormal coordinate %s and uses centered defaults',
    (x) => {
      expect(
        restoreWindowLayout(
          { normalBounds: { x, y: 0, width: 900, height: 600 }, maximized: true },
          [primary],
          primary,
        ),
      ).toEqual({ normalBounds: { x: 128, y: 2, width: 1280, height: 820 }, maximized: false });
    },
  );
  it('keeps the title bar reachable when scaled work area is smaller than the UI minimum', () => {
    const area = { x: 100, y: 20, width: 768, height: 512 };
    expect(
      restoreWindowLayout({ normalBounds: null, maximized: false }, [area], area).normalBounds,
    ).toEqual({ x: 100, y: 20, width: 900, height: 600 });
  });
  it('records normal bounds and last maximized state, ignores fullscreen, and seals late events', () => {
    const emitter = new EventEmitter();
    let maximized = true,
      minimized = false,
      fullscreen = false;
    const normalBounds = { x: 10, y: 20, width: 1100, height: 700 };
    const window = Object.assign(emitter, {
      isDestroyed: () => false,
      isMaximized: () => maximized,
      isMinimized: () => minimized,
      isFullScreen: () => fullscreen,
      getNormalBounds: () => normalBounds,
    });
    const updateWindow = vi.fn<(state: WindowState) => void>();
    const stop = trackWindowLayout(window as never, { updateWindow } as never);
    emitter.emit('maximize');
    minimized = true;
    maximized = false;
    emitter.emit('resize');
    expect(updateWindow).toHaveBeenLastCalledWith({ normalBounds, maximized: true });
    fullscreen = true;
    emitter.emit('resize');
    expect(updateWindow).toHaveBeenCalledTimes(2);
    fullscreen = false;
    minimized = false;
    stop();
    emitter.emit('move');
    emitter.emit('restore');
    expect(updateWindow).toHaveBeenCalledTimes(3);
    expect(updateWindow).toHaveBeenLastCalledWith({ normalBounds, maximized: false });
  });
});
