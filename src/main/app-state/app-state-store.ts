import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultSettings,
  defaultState,
  projectStartupState,
  selectRestoreTabs,
  stateFailure,
  validCheckpoint,
  validPreferences,
  validSettings,
  validStoredState,
  validWindow,
  SETTINGS_MAX_BYTES,
  STATE_MAX_BYTES,
  type AppSettings,
  type AppState,
  type AppPreferences,
  type AppStateSnapshot,
  type StateFileHealth,
  type StateFileName,
  type StateWriteResult,
  type StartupMode,
  type WindowState,
  type WorkspaceIdentity,
} from '../../shared/app-state';
import {
  failureFrom,
  fileIdentity,
  loadJson,
  ordinaryDirectory,
  preserveInvalid,
  publishJson,
  resetOversized,
  StateFileError,
} from './app-state-files';
import type { TempWriteFactory } from '../document/write-safety';

const saved = (): StateWriteResult => ({ status: 'saved', warnings: [] });
const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');
/** Internal queue used only by the two fixed JSON files; no configurable registry/backend. */
class FileQueue<T> {
  value: T;
  durable: T;
  health: StateFileHealth;
  private hash: string | null;
  private readonly blocked: boolean;
  private readonly initialIdentity: string | null;
  private revision = 0;
  private guard: () => boolean = () => true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<StateWriteResult> | null = null;
  constructor(
    readonly path: string,
    readonly budget: number,
    validate: (value: unknown) => value is T,
    defaults: () => T,
    private readonly factory: TempWriteFactory | undefined,
    private readonly delay: number,
    private readonly onSaved: (value: T) => void = () => {},
  ) {
    this.initialIdentity = fileIdentity(path);
    const loaded = loadJson(path, budget, validate, defaults);
    this.value = loaded.value;
    this.durable = structuredClone(loaded.value);
    this.hash = loaded.fingerprint;
    this.blocked = loaded.error !== null;
    this.health = { status: loaded.status, pending: false, error: loaded.error?.error ?? null };
  }
  request(value: T, guard: () => boolean = this.guard): StateWriteResult {
    if (this.blocked) return { status: 'error', error: this.health.error! };
    if (bytes(value).length > this.budget) return stateFailure('TOO_LARGE');
    if (JSON.stringify(value) === JSON.stringify(this.value) && !this.health.pending)
      return { status: 'unchanged', warnings: [] };
    this.value = structuredClone(value);
    this.guard = guard;
    this.revision++;
    this.health = { ...this.health, pending: true, error: null };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delay);
    this.timer.unref();
    return { status: 'queued', warnings: [] };
  }
  async flush(): Promise<StateWriteResult> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.blocked) return { status: 'error', error: this.health.error! };
    if (this.running) return this.running;
    // Start after assigning running, including for a no-op synchronous completion.
    this.running = Promise.resolve()
      .then(async () => {
        while (this.health.pending) {
          const revision = this.revision;
          const snapshot = structuredClone(this.value);
          const guard = this.guard;
          try {
            this.hash = await publishJson(
              this.path,
              bytes(snapshot),
              this.budget,
              this.hash,
              guard,
              this.factory,
            );
            this.durable = snapshot;
            this.health = { status: 'valid', pending: this.revision !== revision, error: null };
            this.onSaved(snapshot);
          } catch (error) {
            const failure = failureFrom(error, 'WRITE_FAILED');
            if (failure.error.code === 'STALE_SESSION') {
              if (revision !== this.revision) continue;
              this.health = { ...this.health, pending: false, error: failure.error };
            } else this.health = { ...this.health, error: failure.error };
            return failure;
          }
        }
        return saved();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  async reset(defaults: () => T): Promise<StateWriteResult> {
    if (!this.blocked || this.health.status === 'missing' || this.health.status === 'valid')
      return { status: 'unchanged', warnings: [] };
    if (this.health.status !== 'invalid' && this.health.status !== 'too-large')
      return { status: 'error', error: this.health.error! };
    try {
      if (this.health.status === 'too-large')
        await resetOversized(this.path, bytes(defaults()), this.initialIdentity, this.factory);
      else {
        preserveInvalid(this.path, this.budget, this.hash);
        await publishJson(
          this.path,
          bytes(defaults()),
          this.budget,
          this.hash,
          () => true,
          this.factory,
        );
      }
      return saved();
    } catch (error) {
      return failureFrom(error, 'WRITE_FAILED');
    }
  }
}

export interface StoreOptions {
  readonly root: string;
  readonly getWorkspace: () => WorkspaceIdentity | null;
  readonly mode: AppStateSnapshot['dataDirectory']['mode'];
  readonly writeFactory?: TempWriteFactory;
  readonly coalesceMs?: number;
}
export class AppStateStore {
  private settings: FileQueue<AppSettings>;
  private state: FileQueue<AppState>;
  private mode: StartupMode;
  private resetting = false;
  constructor(private readonly options: StoreOptions) {
    ordinaryDirectory(options.root);
    this.state = this.stateQueue();
    this.settings = this.settingsQueue();
    this.mode = this.settings.durable.startupMode;
  }
  private stateQueue(): FileQueue<AppState> {
    return new FileQueue(
      join(this.options.root, 'state.json'),
      STATE_MAX_BYTES,
      validStoredState,
      defaultState,
      this.options.writeFactory,
      this.options.coalesceMs ?? 500,
    );
  }
  private settingsQueue(): FileQueue<AppSettings> {
    return new FileQueue(
      join(this.options.root, 'settings.json'),
      SETTINGS_MAX_BYTES,
      validSettings,
      defaultSettings,
      this.options.writeFactory,
      this.options.coalesceMs ?? 500,
      (settings) => {
        this.mode = settings.startupMode;
        // Only a durable preference may clear/trim persisted workspace metadata.
        this.state.request(projectStartupState(this.state.value, this.mode));
      },
    );
  }
  get(): AppStateSnapshot {
    return structuredClone({
      settings: this.settings.value,
      state: projectStartupState(this.state.value, this.mode),
      effectiveStartupMode: this.mode,
      workspaceSessionId: this.options.getWorkspace()?.id ?? null,
      files: { settings: this.settings.health, state: this.state.health },
      dataDirectory: {
        path: this.options.root,
        mode: this.options.mode,
        canReselect: this.options.mode === 'installed',
      },
    });
  }
  /** Only restore needs the bounded original list to report truncation. No renderer path input. */
  getRestoreRecord() {
    return structuredClone(
      this.mode === 'workspace-and-tabs'
        ? this.state.value.lastWorkspace
        : projectStartupState(this.state.value, this.mode).lastWorkspace,
    );
  }
  async updatePreferences(value: unknown): Promise<StateWriteResult> {
    if (this.resetting || !validPreferences(value)) return stateFailure('INVALID_REQUEST');
    const request = this.settings.request({ version: 1, ...(value as AppPreferences) });
    if (request.status === 'error' || request.status === 'unchanged') return request;
    const result = await this.settings.flush();
    if (result.status === 'error') return result;
    // A blocked state file remains untouched and its error remains visible in get().
    if (this.state.health.pending) return this.state.flush();
    return result;
  }
  checkpoint(value: unknown): StateWriteResult {
    if (this.resetting || !validCheckpoint(value)) return stateFailure('INVALID_REQUEST');
    let pathBytes = 0;
    for (const path of value.tabRelativePaths) {
      pathBytes += Buffer.byteLength(path, 'utf8') + 3;
      if (pathBytes > STATE_MAX_BYTES) return stateFailure('TOO_LARGE');
    }
    if (bytes(value).length > STATE_MAX_BYTES) return stateFailure('TOO_LARGE');
    const identity = this.options.getWorkspace();
    if ((identity?.id ?? null) !== value.workspaceSessionId) return stateFailure('STALE_SESSION');
    const selected = selectRestoreTabs(value.tabRelativePaths, value.activeRelativePath);
    try {
      if (identity) {
        ordinaryDirectory(identity.rootPath);
        for (const path of selected.paths) {
          let current = identity.rootPath;
          const segments = path.split('/');
          for (let i = 0; i < segments.length; i++) {
            current = join(current, segments[i]!);
            let stat;
            try {
              stat = lstatSync(current);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
              throw error;
            }
            if (
              stat.isSymbolicLink() ||
              (i < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())
            )
              throw new StateFileError('INVALID_DATA');
          }
        }
      }
    } catch (error) {
      return failureFrom(error, 'READ_FAILED');
    }
    const next: AppState = {
      ...this.state.value,
      sidebar: value.sidebar,
      // An empty startup renderer cannot erase a saved workspace before WP3 restore.
      lastWorkspace: identity
        ? {
            rootPath: identity.rootPath,
            tabRelativePaths: selected.paths,
            activeRelativePath: selected.active,
          }
        : this.state.value.lastWorkspace,
    };
    const result = this.state.request(
      projectStartupState(next, this.mode),
      () => (this.options.getWorkspace()?.id ?? null) === value.workspaceSessionId,
    );
    return result.status === 'error'
      ? result
      : { ...result, warnings: selected.truncated ? ['TAB_LIMIT'] : [] };
  }
  /** Main-only WP4 seam. No renderer can submit window coordinates. Not wired in WP1. */
  updateWindow(window: WindowState): StateWriteResult {
    if (!validWindow(window) || this.resetting) return stateFailure('INVALID_REQUEST');
    return this.state.request(projectStartupState({ ...this.state.value, window }, this.mode));
  }
  async flush(): Promise<StateWriteResult> {
    const preferences = await this.settings.flush();
    const state = await this.state.flush();
    return preferences.status === 'error' ? preferences : state;
  }
  async resetInvalidFile(file: StateFileName): Promise<StateWriteResult> {
    if (this.resetting) return stateFailure('INVALID_REQUEST');
    this.resetting = true;
    try {
      const result =
        file === 'settings'
          ? await this.settings.reset(defaultSettings)
          : await this.state.reset(defaultState);
      if (result.status === 'saved') {
        if (file === 'settings') {
          this.settings = this.settingsQueue();
          this.mode = this.settings.durable.startupMode;
        } else this.state = this.stateQueue();
      }
      return result;
    } finally {
      this.resetting = false;
    }
  }
}
