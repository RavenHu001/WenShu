import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  defaultSettings,
  defaultState,
  validBootstrap,
  validLocalRoot,
  validSettings,
  validState,
  BOOTSTRAP_MAX_BYTES,
  SETTINGS_MAX_BYTES,
  STATE_MAX_BYTES,
  type BootstrapRecord,
  type DataDirectoryMode,
  type StateActionResult,
} from '../../shared/app-state';
import {
  failureFrom,
  loadJson,
  ordinaryDirectory,
  pathContains,
  publishJson,
  StateFileError,
} from './app-state-files';

export interface DataDirectory {
  readonly root: string;
  readonly runtime: string;
  readonly mode: DataDirectoryMode;
}
export interface DirectoryEnvironment {
  readonly packaged: boolean;
  readonly projectRoot: string;
  readonly executable: string;
  readonly appData: string;
  readonly temp: string;
  readonly portableDirectory?: string;
  readonly userDataOverride?: string;
}
export type DirectoryPlan =
  | {
      readonly status: 'ready';
      readonly directory: DataDirectory;
      readonly environment: DirectoryEnvironment;
      readonly bootstrapHash: string | null;
    }
  | {
      readonly status: 'guide';
      readonly reason:
        'first' | 'reselect' | 'unavailable' | 'fixed-unavailable' | 'invalid-bootstrap';
      readonly environment: DirectoryEnvironment;
      readonly previous: BootstrapRecord | null;
      readonly bootstrapHash: string | null;
    };
export interface NativeDirectoryDialogs {
  select(options: {
    readonly title: string;
    readonly defaultPath: string;
    readonly properties: ['openDirectory', 'createDirectory'];
  }): Promise<string | null>;
  message(options: {
    readonly type: 'error' | 'info';
    readonly message: string;
    readonly detail?: string;
    readonly buttons: string[];
    readonly cancelId: number;
  }): Promise<number>;
}
export const bootstrapPath = (environment: DirectoryEnvironment): string =>
  join(environment.appData, 'WenShu', 'bootstrap.json');
function writableDirectory(path: string): void {
  ordinaryDirectory(path);
  const temporary = join(path, `.wenshu-probe-${randomUUID()}.tmp`);
  const handle = openSync(temporary, 'wx');
  try {
    writeSync(handle, Buffer.from('probe'));
  } finally {
    closeSync(handle);
    unlinkSync(temporary);
  }
}
export function validateDataRoot(
  root: string,
  environment: DirectoryEnvironment,
  create: boolean,
  selecting = false,
): string {
  if (!validLocalRoot(root) || !isAbsolute(root))
    throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
  if (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(root))
    throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
  const actual = ordinaryDirectory(root, create);
  if (environment.packaged && !environment.portableDirectory && !environment.userDataOverride) {
    const installation = ordinaryDirectory(dirname(environment.executable));
    if (pathContains(installation, actual) || pathContains(actual, installation))
      throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
  }
  writableDirectory(actual);
  if (selecting) {
    const settings = loadJson(
      join(actual, 'settings.json'),
      SETTINGS_MAX_BYTES,
      validSettings,
      defaultSettings,
    );
    const state = loadJson(join(actual, 'state.json'), STATE_MAX_BYTES, validState, defaultState);
    if (settings.error || state.error)
      throw new StateFileError((settings.error ?? state.error)!.error.code);
    if (
      readdirSync(actual).some(
        (name) =>
          !['settings.json', 'state.json', 'runtime'].includes(name) &&
          !/^\.wenshu-invalid-[0-9a-f-]+\.json$/.test(name),
      )
    )
      throw new StateFileError('INVALID_DATA');
  }
  return actual;
}
export function prepareRuntime(root: string, mode: DataDirectoryMode): DataDirectory {
  ordinaryDirectory(root);
  const runtime = mode === 'test' ? root : join(root, 'runtime');
  for (const path of [
    runtime,
    join(runtime, 'session'),
    join(runtime, 'logs'),
    join(runtime, 'crashDumps'),
  ]) {
    if (path !== root) {
      ordinaryDirectory(dirname(path));
      try {
        mkdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    // Single-level mkdir must never recreate a data root that disappeared after validation.
    ordinaryDirectory(path);
    writableDirectory(path);
  }
  return { root, runtime, mode };
}
/** Synchronous by design: called at the main entry before the first event-loop tick. */
export function planDataDirectory(environment: DirectoryEnvironment): DirectoryPlan {
  const fixedMode: DataDirectoryMode | null =
    environment.userDataOverride !== undefined
      ? 'test'
      : environment.portableDirectory
        ? 'portable'
        : !environment.packaged
          ? 'development'
          : null;
  if (fixedMode) {
    const root =
      environment.userDataOverride ??
      (environment.portableDirectory
        ? join(environment.portableDirectory, 'WenShuData')
        : resolve(environment.projectRoot, '.local-data/dev'));
    try {
      const actual = validateDataRoot(root, environment, true);
      return {
        status: 'ready',
        directory: prepareRuntime(actual, fixedMode),
        environment,
        bootstrapHash: null,
      };
    } catch {
      return {
        status: 'guide',
        reason: 'fixed-unavailable',
        previous: null,
        environment,
        bootstrapHash: null,
      };
    }
  }
  let previous: BootstrapRecord | null = null;
  let bootstrapHash: string | null = null;
  try {
    ordinaryDirectory(dirname(bootstrapPath(environment)), true);
    const locator = loadJson<BootstrapRecord>(
      bootstrapPath(environment),
      BOOTSTRAP_MAX_BYTES,
      validBootstrap,
      () => ({ version: 1, dataRoot: '' }),
    );
    bootstrapHash = locator.fingerprint;
    if (locator.error)
      return { status: 'guide', reason: 'invalid-bootstrap', previous, environment, bootstrapHash };
    if (locator.status === 'missing')
      return { status: 'guide', reason: 'first', previous, environment, bootstrapHash };
    previous = locator.value;
    const actual = validateDataRoot(previous.dataRoot, environment, false);
    if (previous.reselectOnNextStart)
      return { status: 'guide', reason: 'reselect', previous, environment, bootstrapHash };
    return {
      status: 'ready',
      directory: prepareRuntime(actual, 'installed'),
      environment,
      bootstrapHash,
    };
  } catch {
    return { status: 'guide', reason: 'unavailable', previous, environment, bootstrapHash };
  }
}
export async function markReselect(
  plan: Extract<DirectoryPlan, { status: 'ready' }>,
): Promise<StateActionResult> {
  if (plan.directory.mode !== 'installed')
    return failureFrom(new StateFileError('NOT_SUPPORTED'), 'WRITE_FAILED');
  try {
    const path = bootstrapPath(plan.environment);
    const current = loadJson(path, BOOTSTRAP_MAX_BYTES, validBootstrap, () => ({
      version: 1,
      dataRoot: '',
    }));
    if (current.error) return current.error;
    if (ordinaryDirectory(current.value.dataRoot) !== plan.directory.root)
      throw new StateFileError('FILE_CHANGED');
    await publishJson(
      path,
      Buffer.from(
        JSON.stringify({ version: 1, dataRoot: plan.directory.root, reselectOnNextStart: true }),
      ),
      BOOTSTRAP_MAX_BYTES,
      current.fingerprint,
    );
    return { status: 'ok' };
  } catch (error) {
    return failureFrom(error, 'WRITE_FAILED');
  }
}
function selectionStart(environment: DirectoryEnvironment): string {
  const installationVolume = parse(environment.executable).root;
  if (process.platform === 'win32' && /^c:/i.test(installationVolume)) {
    // A suggestion for the native picker only; it never becomes a data root without selection.
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      if (letter === 'C') continue;
      try {
        return ordinaryDirectory(`${letter}:\\`);
      } catch {
        /* Try another available local volume. */
      }
    }
  }
  return installationVolume;
}
export async function runDirectoryGuide(
  plan: Extract<DirectoryPlan, { status: 'guide' }>,
  dialogs: NativeDirectoryDialogs,
): Promise<'restart' | 'exit'> {
  if (plan.reason === 'fixed-unavailable' || plan.reason === 'invalid-bootstrap') {
    await dialogs.message({
      type: 'error',
      message:
        plan.reason === 'invalid-bootstrap'
          ? '数据定位文件损坏或版本不兼容，已保留原件。请修复定位文件后重启。'
          : plan.environment.portableDirectory
            ? '便携数据目录不可写或不安全。请移动整个便携目录到可写位置后重试。'
            : '数据目录不可用，请检查目录和权限后重启。',
      buttons: ['退出'],
      cancelId: 0,
    });
    return 'exit';
  }
  const saveLocator = async (root: string): Promise<void> => {
    ordinaryDirectory(dirname(bootstrapPath(plan.environment)), true);
    await publishJson(
      bootstrapPath(plan.environment),
      Buffer.from(JSON.stringify({ version: 1, dataRoot: root })),
      BOOTSTRAP_MAX_BYTES,
      plan.bootstrapHash,
    );
  };
  let unavailable = plan.reason === 'unavailable';
  let cancelledInvalidRoot = false;
  while (true) {
    if (unavailable) {
      const buttons = cancelledInvalidRoot ? ['重试', '退出'] : ['重试', '选择数据目录', '退出'];
      const choice = await dialogs.message({
        type: 'error',
        message: '数据目录缺失、不可写或不安全；不会自动建立空目录或改用其他磁盘。',
        buttons,
        cancelId: buttons.length - 1,
      });
      if (choice === buttons.length - 1) return 'exit';
      if (choice === 0) {
        try {
          if (!plan.previous) throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
          prepareRuntime(
            validateDataRoot(plan.previous.dataRoot, plan.environment, false),
            'installed',
          );
          // Clear a pending reselection only after its original root is usable again.
          if (plan.previous.reselectOnNextStart) await saveLocator(plan.previous.dataRoot);
          return 'restart';
        } catch {
          cancelledInvalidRoot = false;
          continue;
        }
      }
    }
    const chosen = await dialogs.select({
      title: '选择文枢独立数据目录（建议非系统盘、安装目录之外）',
      defaultPath: selectionStart(plan.environment),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (chosen === null) {
      if (plan.reason === 'first' && !unavailable) return 'exit';
      if (plan.reason === 'reselect' && !unavailable && plan.previous) {
        try {
          prepareRuntime(
            validateDataRoot(plan.previous.dataRoot, plan.environment, false),
            'installed',
          );
          await saveLocator(plan.previous.dataRoot);
          return 'restart';
        } catch {
          unavailable = true;
        }
      }
      cancelledInvalidRoot = true;
      unavailable = true;
      continue;
    }
    try {
      const root = validateDataRoot(chosen, plan.environment, false, true);
      prepareRuntime(root, 'installed');
      await saveLocator(root);
      return 'restart';
    } catch (error) {
      const choice = await dialogs.message({
        type: 'error',
        message: failureFrom(error, 'WRITE_FAILED').error.message,
        buttons: ['重新选择', '退出'],
        cancelId: 1,
      });
      if (choice === 1) return 'exit';
    }
  }
}
/** Bootstrap has no business root. Its unavoidable Chromium traces belong only to OS temp. */
export function prepareBootstrapRuntime(temp: string): {
  readonly runtime: string;
  readonly cleanup: () => void;
} {
  ordinaryDirectory(temp);
  const root = mkdtempSync(join(temp, 'wenshu-bootstrap-'));
  const runtime = prepareRuntime(root, 'test').runtime;
  const identity = lstatSync(root);
  return {
    runtime,
    cleanup: () => {
      try {
        const current = lstatSync(root);
        ordinaryDirectory(root);
        if (
          current.ino === identity.ino &&
          current.dev === identity.dev &&
          pathContains(temp, root) &&
          root !== temp
        )
          rmSync(root, { recursive: true, force: true });
      } catch {
        /* Own temporary traces may remain after forced exit or OS handle contention. */
      }
    },
  };
}
let activeDataRoot: string | null = null;
export function setActiveDataRoot(root: string | null): void {
  activeDataRoot = root === null ? null : ordinaryDirectory(root);
}
export function isDataPath(path: string): boolean {
  if (!activeDataRoot) return false;
  // Both lexical and real boundaries; aliases cannot expose the runtime subtree.
  if (pathContains(activeDataRoot, resolve(path))) return true;
  try {
    return pathContains(activeDataRoot, realpathSync(path));
  } catch {
    return false;
  }
}
