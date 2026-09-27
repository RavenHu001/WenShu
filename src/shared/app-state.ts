/** Fixed Task 13 DTOs. No Node/Electron imports, document content, or arbitrary keys. */
export const SETTINGS_MAX_BYTES = 16 * 1024;
export const STATE_MAX_BYTES = 512 * 1024;
export const BOOTSTRAP_MAX_BYTES = 8 * 1024;
export const RESTORE_TAB_LIMIT = 100;
export const STATE_PATH_LIMIT = 4096;
export type StartupMode = 'blank' | 'workspace' | 'workspace-and-tabs';
export interface AppPreferences {
  readonly theme: 'system' | 'light' | 'dark';
  readonly txtFontPreset: 'system' | 'monospace' | 'serif';
  readonly txtFontSizePx: number;
  readonly startupMode: StartupMode;
}
export interface AppSettings extends AppPreferences {
  readonly version: 1;
}
export interface SidebarState {
  readonly width: number;
  readonly collapsed: boolean;
}
export interface WindowState {
  readonly normalBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly maximized: boolean;
}
export interface LastWorkspace {
  readonly rootPath: string;
  readonly tabRelativePaths: readonly string[];
  readonly activeRelativePath: string | null;
}
export interface AppState {
  readonly version: 1;
  readonly window: WindowState;
  readonly sidebar: SidebarState;
  readonly lastWorkspace: LastWorkspace | null;
}
export interface SessionCheckpoint {
  readonly workspaceSessionId: string | null;
  readonly tabRelativePaths: readonly string[];
  readonly activeRelativePath: string | null;
  readonly sidebar: SidebarState;
}
export interface WorkspaceIdentity {
  readonly id: string;
  readonly rootPath: string;
}
export interface BootstrapRecord {
  readonly version: 1;
  readonly dataRoot: string;
  readonly reselectOnNextStart?: boolean;
}
export type StateFileName = 'settings' | 'state';
export type StateErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_DATA'
  | 'UNSUPPORTED_VERSION'
  | 'TOO_LARGE'
  | 'STALE_SESSION'
  | 'DATA_DIRECTORY_UNAVAILABLE'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'FILE_CHANGED'
  | 'NOT_SUPPORTED';
export interface StateError {
  readonly code: StateErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}
export type StateFailure = { readonly status: 'error'; readonly error: StateError };
export type StateWriteResult =
  | { readonly status: 'saved' | 'queued' | 'unchanged'; readonly warnings: readonly 'TAB_LIMIT'[] }
  | StateFailure;
export type StateActionResult = { readonly status: 'ok' } | StateFailure;
export type StateFileStatus =
  'missing' | 'valid' | 'invalid' | 'unsupported' | 'too-large' | 'read-error';
export interface StateFileHealth {
  readonly status: StateFileStatus;
  readonly pending: boolean;
  readonly error: StateError | null;
}
export type DataDirectoryMode = 'development' | 'portable' | 'installed' | 'test';
export interface AppStateSnapshot {
  readonly settings: AppSettings;
  readonly state: AppState;
  /** Failed preference writes can retain their preview, but restore uses this durable mode. */
  readonly effectiveStartupMode: StartupMode;
  readonly workspaceSessionId: string | null;
  readonly files: Readonly<Record<StateFileName, StateFileHealth>>;
  readonly dataDirectory: {
    readonly path: string;
    readonly mode: DataDirectoryMode;
    readonly canReselect: boolean;
  };
}
export interface AppStateApi {
  readonly get: () => Promise<
    { readonly status: 'ok'; readonly snapshot: AppStateSnapshot } | StateFailure
  >;
  readonly updatePreferences: (preferences: AppPreferences) => Promise<StateWriteResult>;
  readonly checkpoint: (snapshot: SessionCheckpoint) => Promise<StateWriteResult>;
  readonly flush: () => Promise<StateWriteResult>;
  readonly openDataDirectory: () => Promise<StateActionResult>;
  readonly chooseDataDirectoryOnNextStart: () => Promise<StateActionResult>;
  readonly resetInvalidFile: (file: StateFileName) => Promise<StateWriteResult>;
}
export const defaultSettings = (): AppSettings => ({
  version: 1,
  theme: 'system',
  txtFontPreset: 'monospace',
  txtFontSizePx: 13,
  startupMode: 'workspace-and-tabs',
});
export const defaultState = (): AppState => ({
  version: 1,
  window: { normalBounds: null, maximized: false },
  sidebar: { width: 258, collapsed: false },
  lastWorkspace: null,
});
export function stateFailure(code: StateErrorCode): StateFailure {
  const messages: Record<StateErrorCode, string> = {
    INVALID_REQUEST: '设置请求无效',
    INVALID_DATA: '记录损坏或包含非法字段，请保留原件后重置',
    UNSUPPORTED_VERSION: '记录版本不受支持，已保留原件，请使用兼容版本',
    TOO_LARGE: '记录超过大小限制，已保留原件',
    STALE_SESSION: '工作区会话已变化，请重新提交当前快照',
    DATA_DIRECTORY_UNAVAILABLE: '数据目录缺失、不可写或不安全',
    READ_FAILED: '无法读取记录，已保留原件',
    WRITE_FAILED: '本次设置或恢复记录未保存，可重试',
    FILE_CHANGED: '记录已被外部修改，已停止覆盖，请重新启动检查',
    NOT_SUPPORTED: '此运行方式不支持该操作',
  };
  return {
    status: 'error',
    error: {
      code,
      message: messages[code],
      retryable: [
        'WRITE_FAILED',
        'READ_FAILED',
        'DATA_DIRECTORY_UNAVAILABLE',
        'STALE_SESSION',
      ].includes(code),
    },
  };
}
export function exactObject(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === null) &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key) || optional.includes(key))
  );
}
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
export function validLocalRoot(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > STATE_PATH_LIMIT ||
    hasControlCharacters(value) ||
    /[<>"|?*]/.test(value)
  )
    return false;
  // Windows drive roots; POSIX form keeps the pure/filesystem tests portable. No UNC/device paths.
  const path = /^[a-z]:[\\/]/i.test(value)
    ? value.slice(3)
    : value.startsWith('/') && !value.startsWith('//')
      ? value.slice(1)
      : null;
  if (path === null || path.includes(':')) return false;
  return (
    path === '' ||
    path
      .split(/[\\/]/)
      .every(
        (segment) =>
          segment !== '' && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment),
      )
  );
}
export function validTabPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= STATE_PATH_LIMIT &&
    /\.(txt|docx)$/i.test(value) &&
    !hasControlCharacters(value) &&
    !/[\\:<>"|?*]/.test(value) &&
    value
      .split('/')
      .every(
        (segment) =>
          !!segment &&
          segment !== '.' &&
          segment !== '..' &&
          !/[. ]$/.test(segment) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      )
  );
}
export function validPreferences(value: unknown): value is AppPreferences {
  return (
    exactObject(value, ['theme', 'txtFontPreset', 'txtFontSizePx', 'startupMode']) &&
    ['system', 'light', 'dark'].some((v) => v === value.theme) &&
    ['system', 'monospace', 'serif'].some((v) => v === value.txtFontPreset) &&
    Number.isInteger(value.txtFontSizePx) &&
    Number(value.txtFontSizePx) >= 12 &&
    Number(value.txtFontSizePx) <= 24 &&
    ['blank', 'workspace', 'workspace-and-tabs'].some((v) => v === value.startupMode)
  );
}
export function validSettings(value: unknown): value is AppSettings {
  if (
    !exactObject(value, ['version', 'theme', 'txtFontPreset', 'txtFontSizePx', 'startupMode']) ||
    value.version !== 1
  )
    return false;
  return validPreferences({
    theme: value.theme,
    txtFontPreset: value.txtFontPreset,
    txtFontSizePx: value.txtFontSizePx,
    startupMode: value.startupMode,
  });
}
export function validSidebar(value: unknown): value is SidebarState {
  return (
    exactObject(value, ['width', 'collapsed']) &&
    Number.isInteger(value.width) &&
    Number(value.width) >= 180 &&
    Number(value.width) <= 420 &&
    typeof value.collapsed === 'boolean'
  );
}
export function validWindow(value: unknown): value is WindowState {
  if (!exactObject(value, ['normalBounds', 'maximized']) || typeof value.maximized !== 'boolean')
    return false;
  const b = value.normalBounds;
  return (
    b === null ||
    (exactObject(b, ['x', 'y', 'width', 'height']) &&
      Object.values(b).every(Number.isSafeInteger) &&
      Number(b.width) > 0 &&
      Number(b.height) > 0)
  );
}
function validTabs(paths: unknown, active: unknown, limit: number): paths is string[] {
  return (
    Array.isArray(paths) &&
    paths.length <= limit &&
    paths.every(validTabPath) &&
    (active === null || (typeof active === 'string' && paths.includes(active)))
  );
}
function validStateRecord(value: unknown, stored: boolean): value is AppState {
  if (
    !exactObject(value, ['version', 'window', 'sidebar', 'lastWorkspace']) ||
    value.version !== 1 ||
    !validSidebar(value.sidebar) ||
    !validWindow(value.window)
  )
    return false;
  const w = value.lastWorkspace;
  return (
    w === null ||
    (exactObject(w, ['rootPath', 'tabRelativePaths', 'activeRelativePath']) &&
      validLocalRoot(w.rootPath) &&
      (stored
        ? Array.isArray(w.tabRelativePaths) &&
          w.tabRelativePaths.length <= STATE_MAX_BYTES / 5 &&
          w.tabRelativePaths.every(validTabPath) &&
          (w.activeRelativePath === null || validTabPath(w.activeRelativePath))
        : validTabs(w.tabRelativePaths, w.activeRelativePath, RESTORE_TAB_LIMIT) &&
          new Set(w.tabRelativePaths.map((p) => p.toLowerCase())).size ===
            w.tabRelativePaths.length))
  );
}
/** Published state stays canonical and capped. Bounded disk input may need selection/deduplication. */
export const validState = (value: unknown): value is AppState => validStateRecord(value, false);
export const validStoredState = (value: unknown): value is AppState =>
  validStateRecord(value, true);
export function validCheckpoint(value: unknown): value is SessionCheckpoint {
  return (
    exactObject(value, [
      'workspaceSessionId',
      'tabRelativePaths',
      'activeRelativePath',
      'sidebar',
    ]) &&
    (value.workspaceSessionId === null ||
      (typeof value.workspaceSessionId === 'string' &&
        /^[0-9a-f-]{36}$/.test(value.workspaceSessionId))) &&
    validSidebar(value.sidebar) &&
    validTabs(value.tabRelativePaths, value.activeRelativePath, STATE_MAX_BYTES / 5) &&
    (value.workspaceSessionId !== null ||
      (value.tabRelativePaths.length === 0 && value.activeRelativePath === null))
  );
}
export function validBootstrap(value: unknown): value is BootstrapRecord {
  return (
    exactObject(value, ['version', 'dataRoot'], ['reselectOnNextStart']) &&
    value.version === 1 &&
    validLocalRoot(value.dataRoot) &&
    (!Object.hasOwn(value, 'reselectOnNextStart') || typeof value.reselectOnNextStart === 'boolean')
  );
}
export function selectRestoreTabs(
  paths: readonly string[],
  active: string | null,
): { paths: string[]; active: string | null; truncated: boolean } {
  const seen = new Set<string>();
  const unique = paths.filter((path) => {
    const key = path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const canonicalActive =
    unique.find((path) => path.toLowerCase() === active?.toLowerCase()) ?? null;
  const selected = unique.slice(0, RESTORE_TAB_LIMIT);
  if (canonicalActive && !selected.includes(canonicalActive)) {
    selected.pop();
    selected.push(canonicalActive);
  }
  const selectedSet = new Set(selected);
  return {
    paths: unique.filter((path) => selectedSet.has(path)),
    active: canonicalActive,
    truncated: unique.length > RESTORE_TAB_LIMIT,
  };
}
/** Sole mode policy, reused by load, preference writes, and checkpoints. */
export function projectStartupState(state: AppState, mode: StartupMode): AppState {
  if (!state.lastWorkspace) return state;
  const selected = selectRestoreTabs(
    state.lastWorkspace.tabRelativePaths,
    state.lastWorkspace.activeRelativePath,
  );
  return mode === 'blank'
    ? { ...state, lastWorkspace: null }
    : mode === 'workspace'
      ? {
          ...state,
          lastWorkspace: { ...state.lastWorkspace, tabRelativePaths: [], activeRelativePath: null },
        }
      : {
          ...state,
          lastWorkspace: {
            ...state.lastWorkspace,
            tabRelativePaths: selected.paths,
            activeRelativePath: selected.active,
          },
        };
}
