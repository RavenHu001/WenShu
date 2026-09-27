import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultSettings,
  stateFailure,
  type AppPreferences,
  type AppStateApi,
  type StateError,
  type StateFileName,
} from '../../shared/app-state';

export type SettingsLoad = Awaited<ReturnType<AppStateApi['get']>>;
const fonts: Record<AppPreferences['txtFontPreset'], string> = {
  system: "'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif",
  monospace: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  serif: "'Noto Serif CJK SC', SimSun, 'Times New Roman', serif",
};

/** CSS only: no editor transactions, instances, history or document state. */
export function applyDisplayPreferences(preferences: AppPreferences): void {
  const root = document.documentElement;
  const dark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset['theme'] = dark ? 'dark' : 'light';
  root.style.setProperty('--txt-font-family', fonts[preferences.txtFontPreset]);
  root.style.setProperty('--txt-font-size', `${preferences.txtFontSizePx}px`);
}

export async function loadAppSettings(): Promise<SettingsLoad> {
  try {
    return await window.desktop.appState.get();
  } catch {
    return stateFailure('READ_FAILED');
  }
}

export function useAppSettings(initial?: SettingsLoad) {
  const [loaded, setLoaded] = useState<SettingsLoad | undefined>(initial);
  const [preferences, setPreferences] = useState<AppPreferences>(
    initial?.status === 'ok' ? initial.snapshot.settings : defaultSettings(),
  );
  const preferencesRef = useRef(preferences);
  const [error, setError] = useState<StateError | null>(
    initial?.status === 'error' ? initial.error : null,
  );
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState<StateError | null>(null);
  const [retryKind, setRetryKind] = useState<'open' | 'reselect' | StateFileName>('open');
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const adopt = useCallback((result: SettingsLoad, display: boolean) => {
    if (!mounted.current) return;
    setLoaded(result);
    if (result.status === 'error') setError(result.error);
    else if (display) {
      preferencesRef.current = result.snapshot.settings;
      setPreferences(result.snapshot.settings);
    }
  }, []);
  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    void loadAppSettings().then((result) => {
      if (!cancelled) adopt(result, true);
    });
    return () => {
      cancelled = true;
    };
  }, [initial, adopt]);

  useEffect(() => {
    applyDisplayPreferences(preferences);
    if (preferences.theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyDisplayPreferences(preferences);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preferences]);

  const update = useCallback(
    (patch: Partial<AppPreferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      // Send exactly the four preference fields, never the persisted version field.
      const request: AppPreferences = {
        theme: next.theme,
        txtFontPreset: next.txtFontPreset,
        txtFontSizePx: next.txtFontSizePx,
        startupMode: next.startupMode,
      };
      preferencesRef.current = request;
      setPreferences(request);
      setBusy(true);
      setError(null);
      setMessage('正在保存设置…');
      const id = ++revision.current;
      queue.current = queue.current.then(async () => {
        try {
          let result = await window.desktop.appState.updatePreferences(request);
          // Also retry an accepted state-policy write if settings are already durable.
          if (result.status !== 'error') result = await window.desktop.appState.flush();
          const refreshed = await loadAppSettings();
          if (!mounted.current || id !== revision.current) return;
          adopt(refreshed, false);
          setError(
            result.status === 'error'
              ? result.error
              : refreshed.status === 'error'
                ? refreshed.error
                : null,
          );
          setMessage(
            result.status === 'error' ? '本次设置或恢复记录未保存；显示预览已保留。' : '设置已保存',
          );
        } catch {
          if (mounted.current && id === revision.current) {
            setError(stateFailure('WRITE_FAILED').error);
            setMessage('本次设置未保存；显示预览已保留。');
          }
        } finally {
          if (mounted.current && id === revision.current) setBusy(false);
        }
      });
    },
    [adopt],
  );

  const action = useCallback(
    async (kind: 'open' | 'reselect' | StateFileName) => {
      if (busy) return;
      setBusy(true);
      setResetting(kind === 'settings' || kind === 'state');
      setActionError(null);
      setMessage('');
      setRetryKind(kind);
      try {
        const api = window.desktop.appState;
        const result = await (kind === 'open'
          ? api.openDataDirectory()
          : kind === 'reselect'
            ? api.chooseDataDirectoryOnNextStart()
            : api.resetInvalidFile(kind));
        if (!mounted.current) return;
        if (result.status === 'error') setActionError(result.error);
        else {
          if (kind === 'settings') setError(null);
          setMessage(
            kind === 'reselect'
              ? '已标记：下次启动重新选择。当前数据不搬迁。'
              : kind === 'open'
                ? '已打开数据目录'
                : '已保留原件并重置',
          );
          adopt(await loadAppSettings(), kind === 'settings');
        }
      } catch {
        if (mounted.current) setActionError(stateFailure('WRITE_FAILED').error);
      } finally {
        if (mounted.current) {
          setBusy(false);
          setResetting(false);
        }
      }
    },
    [adopt, busy],
  );

  const reload = useCallback(async () => {
    setError(null);
    adopt(await loadAppSettings(), true);
  }, [adopt]);
  return {
    preferences,
    loaded: loaded !== undefined,
    snapshot: loaded?.status === 'ok' ? loaded.snapshot : null,
    busy,
    resetting,
    error,
    actionError,
    message,
    update,
    action,
    reload,
    // WP4 must await renderer requests before asking the main-process queues to flush.
    waitForPendingPreferences: async () => {
      let pending: Promise<void>;
      do {
        pending = queue.current;
        await pending;
      } while (pending !== queue.current);
    },
    retry: () => (loaded?.status === 'ok' ? update({}) : void reload()),
    retryAction: () => void action(retryKind),
  };
}
export type AppSettingsController = ReturnType<typeof useAppSettings>;
