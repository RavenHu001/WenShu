import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultState,
  stateFailure,
  type SidebarState,
  type StateWriteResult,
} from '../../shared/app-state';
import { clampSidebarWidth } from './sidebar-size';

export function useSidebarLayout(saved: SidebarState | undefined) {
  const [sidebar, setSidebar] = useState(saved ?? defaultState().sidebar);
  const initialized = useRef(saved !== undefined);
  const current = useRef(sidebar);
  current.current = sidebar;
  const accepted = useRef(JSON.stringify(saved ?? defaultState().sidebar));
  const pending = useRef(0);
  const closing = useRef(false);
  const queue = useRef(Promise.resolve<StateWriteResult>({ status: 'unchanged', warnings: [] }));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!initialized.current && saved) {
      initialized.current = true;
      accepted.current = JSON.stringify(saved);
      setSidebar({ width: clampSidebarWidth(saved.width), collapsed: saved.collapsed });
    }
  }, [saved]);
  const write = useCallback(() => {
    const value = current.current;
    if (
      !initialized.current ||
      (JSON.stringify(value) === accepted.current && pending.current === 0)
    )
      return queue.current;
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const result = await window.desktop.appState.updateSidebar(value);
        if (result.status !== 'error') accepted.current = JSON.stringify(value);
        return result;
      } catch {
        return stateFailure('WRITE_FAILED');
      } finally {
        pending.current--;
      }
    });
    return queue.current;
  }, []);
  useEffect(() => {
    if (closing.current || !initialized.current || JSON.stringify(sidebar) === accepted.current)
      return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (closing.current) return;
      void write().then(async (result) => {
        if (cancelled || closing.current) return;
        const flushed =
          result.status === 'error'
            ? result
            : await window.desktop.appState.flush().catch(() => stateFailure('WRITE_FAILED'));
        if (!cancelled) setError(flushed.status === 'error' ? flushed.error.message : '');
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sidebar, write]);
  return {
    sidebar,
    error,
    retry: async () => {
      const result = await write();
      const flushed =
        result.status === 'error'
          ? result
          : await window.desktop.appState.flush().catch(() => stateFailure('WRITE_FAILED'));
      setError(flushed.status === 'error' ? flushed.error.message : '');
    },
    setWidth: (width: number) =>
      setSidebar((value) => ({ ...value, width: clampSidebarWidth(width) })),
    setCollapsed: (value: boolean | ((current: boolean) => boolean)) =>
      setSidebar((previous) => ({
        ...previous,
        collapsed: typeof value === 'function' ? value(previous.collapsed) : value,
      })),
    prepareClose: () => {
      closing.current = true;
      return write();
    },
  };
}
