// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidebarLayout } from '../../src/renderer/lib/use-sidebar-layout';
import { stateFailure, type SidebarState } from '../../src/shared/app-state';
const updateSidebar = vi.fn(),
  flush = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  updateSidebar.mockReset().mockResolvedValue({ status: 'queued', warnings: [] });
  flush.mockReset().mockResolvedValue({ status: 'saved', warnings: [] });
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { appState: { updateSidebar, flush } },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('adopts loaded layout once, does not publish defaults, clamps edits and coalesces without a workspace', async () => {
  const { result, rerender } = renderHook(
    ({ saved }: { saved: SidebarState | undefined }) => useSidebarLayout(saved),
    { initialProps: { saved: undefined as SidebarState | undefined } },
  );
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(updateSidebar).not.toHaveBeenCalled();
  rerender({ saved: { width: 400, collapsed: true } });
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(result.current.sidebar).toEqual({ width: 400, collapsed: true });
  expect(updateSidebar).not.toHaveBeenCalled();
  act(() => {
    result.current.setWidth(999);
    result.current.setCollapsed(false);
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(updateSidebar).toHaveBeenLastCalledWith({ width: 420, collapsed: false });
  rerender({ saved: { width: 258, collapsed: true } });
  expect(result.current.sidebar.width).toBe(420);
  act(() => result.current.setWidth(0));
  await act(() => result.current.prepareClose());
  expect(updateSidebar).toHaveBeenLastCalledWith({ width: 180, collapsed: false });
  const calls = updateSidebar.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(updateSidebar).toHaveBeenCalledTimes(calls);
});
it('retains visible layout on failure and retries before close', async () => {
  const { result } = renderHook(() => useSidebarLayout({ width: 258, collapsed: false }));
  updateSidebar.mockResolvedValueOnce(stateFailure('WRITE_FAILED'));
  act(() => result.current.setWidth(320));
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.sidebar.width).toBe(320);
  expect(result.current.error).toContain('未保存');
  await act(() => result.current.retry());
  expect(result.current.error).toBe('');
  expect(updateSidebar).toHaveBeenCalledTimes(2);
});
