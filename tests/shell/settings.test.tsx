// @vitest-environment jsdom
import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings,
  defaultState,
  stateFailure,
  type AppStateApi,
  type AppStateSnapshot,
} from '../../src/shared/app-state';
import { loadAppSettings, useAppSettings } from '../../src/renderer/lib/use-app-settings';
import { SettingsDialog } from '../../src/renderer/components/shell/SettingsDialog';

function snapshot(): AppStateSnapshot {
  return {
    settings: defaultSettings(),
    state: defaultState(),
    effectiveStartupMode: 'workspace-and-tabs',
    workspaceSessionId: null,
    files: {
      settings: { status: 'missing', pending: false, error: null },
      state: { status: 'missing', pending: false, error: null },
    },
    dataDirectory: { path: '/synthetic/data', mode: 'installed', canReselect: true },
  };
}
let current: AppStateSnapshot;
let api: AppStateApi;
let dark: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  current = snapshot();
  dark = false;
  listeners = new Set();
  vi.stubGlobal('matchMedia', () => ({
    matches: dark,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  api = {
    get: vi.fn<AppStateApi['get']>(async () => ({ status: 'ok', snapshot: current })),
    updatePreferences: vi.fn<AppStateApi['updatePreferences']>(async (preferences) => {
      current = {
        ...current,
        settings: { version: 1, ...preferences },
        effectiveStartupMode: preferences.startupMode,
      };
      return { status: 'saved', warnings: [] };
    }),
    checkpoint: vi.fn<AppStateApi['checkpoint']>(),
    updateSidebar: vi.fn<AppStateApi['updateSidebar']>(async () => ({
      status: 'queued',
      warnings: [],
    })),
    flush: vi.fn<AppStateApi['flush']>(async () => ({ status: 'unchanged', warnings: [] })),
    openDataDirectory: vi.fn<AppStateApi['openDataDirectory']>(async () => ({ status: 'ok' })),
    chooseDataDirectoryOnNextStart: vi.fn<AppStateApi['chooseDataDirectoryOnNextStart']>(
      async () => ({ status: 'ok' }),
    ),
    resetInvalidFile: vi.fn<AppStateApi['resetInvalidFile']>(async () => ({
      status: 'saved',
      warnings: [],
    })),
  };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { appState: api } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});
function Harness() {
  const settings = useAppSettings({ status: 'ok', snapshot: current });
  return <SettingsDialog settings={settings} onClose={vi.fn()} />;
}

describe('WP2 settings service and dialog', () => {
  it('uses actual defaults and exact preference fields, never a checkpoint on display changes', async () => {
    render(<Harness />);
    expect((screen.getByLabelText('TXT 字体') as HTMLSelectElement).value).toBe('monospace');
    expect((screen.getByLabelText('TXT 字号') as HTMLSelectElement).value).toBe('13');
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'dark' } });
    expect(document.documentElement.dataset['theme']).toBe('dark');
    await screen.findByText('设置已保存');
    expect(api.updatePreferences).toHaveBeenCalledWith({
      theme: 'dark',
      txtFontPreset: 'monospace',
      txtFontSizePx: 13,
      startupMode: 'workspace-and-tabs',
    });
    expect(api.checkpoint).not.toHaveBeenCalled();
  });

  it('retains display preview after failure, shows durable mode, and retries the requested preferences', async () => {
    vi.mocked(api.updatePreferences).mockResolvedValueOnce(stateFailure('WRITE_FAILED'));
    const { result } = renderHook(() => useAppSettings({ status: 'ok', snapshot: current }));
    act(() => result.current.update({ theme: 'dark', startupMode: 'blank' }));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error?.code).toBe('WRITE_FAILED');
    expect(result.current.preferences.theme).toBe('dark');
    expect(result.current.snapshot?.effectiveStartupMode).toBe('workspace-and-tabs');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.snapshot?.effectiveStartupMode).toBe('blank'));
    expect(result.current.error).toBeNull();
  });

  it('serializes rapid preference changes and cannot let an older response replace the latest preview', async () => {
    let release!: () => void;
    vi.mocked(api.updatePreferences).mockImplementationOnce(async (preferences) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      current = { ...current, settings: { version: 1, ...preferences } };
      return { status: 'saved', warnings: [] };
    });
    const { result } = renderHook(() => useAppSettings({ status: 'ok', snapshot: current }));
    act(() => {
      result.current.update({ theme: 'dark' });
      result.current.update({ txtFontSizePx: 24 });
    });
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledTimes(1));
    expect(result.current.preferences.txtFontSizePx).toBe(24);
    await act(async () => release());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(api.updatePreferences).toHaveBeenCalledTimes(2);
    expect(current.settings).toMatchObject({ theme: 'dark', txtFontSizePx: 24 });
    expect(document.documentElement.style.getPropertyValue('--txt-font-size')).toBe('24px');
  });

  it('subscribes only in system mode and releases listeners under StrictMode and unmount', async () => {
    const { result, unmount } = renderHook(
      () => useAppSettings({ status: 'ok', snapshot: current }),
      { wrapper: StrictMode },
    );
    expect(listeners.size).toBe(1);
    act(() => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset['theme']).toBe('dark');
    act(() => result.current.update({ theme: 'light' }));
    expect(listeners.size).toBe(0);
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.update({ theme: 'system' }));
    expect(listeners.size).toBe(1);
    await waitFor(() => expect(result.current.busy).toBe(false));
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('shows health errors and requires explicit confirmation before resetting a bad file', async () => {
    current = {
      ...current,
      files: {
        ...current.files,
        settings: { status: 'invalid', pending: false, error: stateFailure('INVALID_DATA').error },
      },
    };
    render(<Harness />);
    expect(screen.getByRole('alert').textContent).toContain('settings.json');
    fireEvent.click(screen.getByText('重置 settings.json…'));
    expect(api.resetInvalidFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('保留原件并确认重置 settings.json'));
    await waitFor(() => expect(api.resetInvalidFile).toHaveBeenCalledWith('settings'));
  });

  it('never offers reset for newer versions, and only installed mode offers reselect', () => {
    current = {
      ...current,
      dataDirectory: { path: '/portable/WenShuData', mode: 'portable', canReselect: false },
      files: {
        ...current.files,
        settings: {
          status: 'unsupported',
          pending: false,
          error: stateFailure('UNSUPPORTED_VERSION').error,
        },
      },
    };
    render(<Harness />);
    expect(screen.queryByText(/重置 settings/)).toBeNull();
    expect(screen.queryByText('下次启动重新选择数据目录')).toBeNull();
    expect(screen.getByLabelText('当前数据目录').textContent).toBe('/portable/WenShuData');
  });

  it('opens a fixed directory and reselect only marks next startup without path parameters', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开数据目录'));
    await screen.findByText('已打开数据目录');
    expect(api.openDataDirectory).toHaveBeenCalledWith();
    fireEvent.click(screen.getByText('下次启动重新选择数据目录'));
    await screen.findByText('已标记：下次启动重新选择。当前数据不搬迁。');
    expect(api.chooseDataDirectoryOnNextStart).toHaveBeenCalledWith();
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('retries a failed directory action instead of writing preferences', async () => {
    vi.mocked(api.openDataDirectory).mockResolvedValueOnce(
      stateFailure('DATA_DIRECTORY_UNAVAILABLE'),
    );
    render(<Harness />);
    fireEvent.click(screen.getByText('打开数据目录'));
    fireEvent.click(await screen.findByText('重试操作'));
    await screen.findByText('已打开数据目录');
    expect(api.openDataDirectory).toHaveBeenCalledTimes(2);
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('does not erase a failed preference write when a directory action succeeds', async () => {
    vi.mocked(api.updatePreferences).mockResolvedValueOnce(stateFailure('WRITE_FAILED'));
    const { result } = renderHook(() => useAppSettings({ status: 'ok', snapshot: current }));
    act(() => result.current.update({ theme: 'dark' }));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () => result.current.action('open'));
    expect(result.current.error?.code).toBe('WRITE_FAILED');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(current.settings.theme).toBe('dark');
  });

  it('handles unavailable service explicitly and can reload without creating another store', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('disconnected'));
    expect(await loadAppSettings()).toEqual(stateFailure('READ_FAILED'));
    const { result } = renderHook(() => useAppSettings(stateFailure('READ_FAILED')));
    expect(result.current.snapshot).toBeNull();
    await act(async () => result.current.reload());
    expect(result.current.snapshot?.settings).toEqual(defaultSettings());
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('traps focus and restores it on Escape without passing document shortcuts through', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    function FocusHarness() {
      const settings = useAppSettings({ status: 'ok', snapshot: current });
      return <SettingsDialog settings={settings} onClose={onClose} />;
    }
    const outerKey = vi.fn();
    window.addEventListener('keydown', outerKey);
    const view = render(<FocusHarness />);
    expect(document.activeElement).toBe(screen.getByLabelText('主题'));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByText('关闭设置'));
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByLabelText('主题'));
    outerKey.mockClear();
    await user.keyboard('{Control>}s{/Control}');
    expect(outerKey).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    window.removeEventListener('keydown', outerKey);
    trigger.remove();
  });
});
