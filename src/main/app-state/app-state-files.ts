/** Bounded JSON and same-directory publication for Task 13 only. Never exposed over IPC. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  stateFailure,
  type StateErrorCode,
  type StateFailure,
  type StateFileStatus,
} from '../../shared/app-state';
import { defaultTempWriteFactory, type TempWriteFactory } from '../document/write-safety';

export class StateFileError extends Error {
  constructor(readonly code: StateErrorCode) {
    super(code);
  }
}
export function failureFrom(error: unknown, fallback: StateErrorCode): StateFailure {
  return stateFailure(error instanceof StateFileError ? error.code : fallback);
}
export function pathContains(root: string, path: string): boolean {
  const part = relative(root, path);
  return !part || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}
/** Validate every ancestor before creating a child. Reject links and unexpected real paths. */
export function ordinaryDirectory(path: string, create = false): string {
  if (!isAbsolute(path)) throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
  const absolute = resolve(path);
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep).filter(Boolean);
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(current);
      stat = lstatSync(current);
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      relative(current, realpathSync(current)) !== ''
    )
      throw new StateFileError('DATA_DIRECTORY_UNAVAILABLE');
  }
  return realpathSync(absolute);
}
function ordinaryFile(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    relative(path, realpathSync(path)) !== ''
  )
    throw new StateFileError('INVALID_DATA');
}
export function readBounded(path: string, budget: number): Buffer | null {
  ordinaryDirectory(dirname(path));
  try {
    ordinaryFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const handle = openSync(path, 'r');
  try {
    const stat = fstatSync(handle, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n) throw new StateFileError('INVALID_DATA');
    if (stat.size > BigInt(budget)) throw new StateFileError('TOO_LARGE');
    const bytes = Buffer.alloc(budget + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(handle, bytes, count, bytes.length - count, count);
      if (!read) break;
      count += read;
    }
    if (count > budget) throw new StateFileError('TOO_LARGE');
    ordinaryFile(path);
    const current = lstatSync(path, { bigint: true });
    // Windows Node 22 lstat reports dev=0 while fstat reports the volume serial.
    // The validated same-volume pathname plus bigint file ID and timestamps bind the handle.
    if (
      current.ino !== stat.ino ||
      current.birthtimeNs !== stat.birthtimeNs ||
      current.mtimeNs !== stat.mtimeNs ||
      current.size !== stat.size ||
      (process.platform !== 'win32' && current.dev !== stat.dev)
    )
      throw new StateFileError('FILE_CHANGED');
    return bytes.subarray(0, count);
  } finally {
    closeSync(handle);
  }
}
export const fingerprint = (bytes: Buffer | null): string | null =>
  bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
export interface LoadedJson<T> {
  readonly value: T;
  readonly status: StateFileStatus;
  readonly fingerprint: string | null;
  readonly error: StateFailure | null;
}
export function loadJson<T>(
  path: string,
  budget: number,
  validate: (value: unknown) => value is T,
  defaults: () => T,
): LoadedJson<T> {
  let hash: string | null = null;
  try {
    const bytes = readBounded(path, budget);
    if (bytes === null)
      return { value: defaults(), status: 'missing', fingerprint: null, error: null };
    hash = fingerprint(bytes);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new StateFileError('INVALID_DATA');
    }
    if (value && typeof value === 'object' && 'version' in value && value.version !== 1)
      throw new StateFileError('UNSUPPORTED_VERSION');
    if (!validate(value)) throw new StateFileError('INVALID_DATA');
    return { value, status: 'valid', fingerprint: hash, error: null };
  } catch (error) {
    const failure = failureFrom(error, 'READ_FAILED');
    const code = failure.error.code;
    return {
      value: defaults(),
      status:
        code === 'UNSUPPORTED_VERSION'
          ? 'unsupported'
          : code === 'TOO_LARGE'
            ? 'too-large'
            : code === 'INVALID_DATA'
              ? 'invalid'
              : 'read-error',
      fingerprint: hash,
      error: failure,
    };
  }
}
export async function publishJson(
  path: string,
  bytes: Buffer,
  budget: number,
  expected: string | null,
  guard: () => boolean = () => true,
  factory: TempWriteFactory = defaultTempWriteFactory,
): Promise<string> {
  if (bytes.length > budget) throw new StateFileError('TOO_LARGE');
  ordinaryDirectory(dirname(path));
  let temporary: Awaited<ReturnType<TempWriteFactory['create']>> | undefined;
  try {
    temporary = await factory.create(path);
    if (dirname(temporary.tempPath) !== dirname(path)) throw new StateFileError('INVALID_DATA');
    await temporary.write(bytes);
    await temporary.sync();
    await temporary.close();
    ordinaryDirectory(dirname(path));
    ordinaryFile(temporary.tempPath);
    if (fingerprint(readBounded(path, budget)) !== expected)
      throw new StateFileError('FILE_CHANGED');
    // No await between the session guard and rename: a workspace commit cannot interleave.
    if (!guard()) throw new StateFileError('STALE_SESSION');
    renameSync(temporary.tempPath, path);
    return fingerprint(bytes)!;
  } finally {
    if (temporary) {
      try {
        await temporary.close();
      } catch {
        /* already closed or failed */
      }
      // Only remove our generated temporary file, after checking its parent still resolves safely.
      try {
        ordinaryDirectory(dirname(path));
        if (dirname(temporary.tempPath) === dirname(path)) unlinkSync(temporary.tempPath);
      } catch {
        /* no broad cleanup or replacement fallback */
      }
    }
  }
}
/** Explicit reset preserves the bounded invalid original; unknown versions are handled by caller. */
export function preserveInvalid(path: string, budget: number, expected: string | null): void {
  if (fingerprint(readBounded(path, budget)) !== expected) throw new StateFileError('FILE_CHANGED');
  ordinaryDirectory(dirname(path));
  ordinaryFile(path);
  copyInvalidBackup(path);
}

function copyInvalidBackup(path: string): void {
  const backup = join(dirname(path), `.wenshu-invalid-${randomUUID()}.json`);
  copyFileSync(path, backup, constants.COPYFILE_EXCL);
  const handle = openSync(backup, 'r+');
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

/** Metadata identity allows explicit oversized-file reset without reading it into memory. */
export function fileIdentity(path: string): string | null {
  try {
    ordinaryDirectory(dirname(path));
    ordinaryFile(path);
    const stat = lstatSync(path, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  } catch {
    return null;
  }
}
export async function resetOversized(
  path: string,
  bytes: Buffer,
  expectedIdentity: string | null,
  factory: TempWriteFactory = defaultTempWriteFactory,
): Promise<void> {
  if (!expectedIdentity || fileIdentity(path) !== expectedIdentity)
    throw new StateFileError('FILE_CHANGED');
  const temporary = await factory.create(path);
  try {
    if (dirname(temporary.tempPath) !== dirname(path)) throw new StateFileError('INVALID_DATA');
    await temporary.write(bytes);
    await temporary.sync();
    await temporary.close();
    ordinaryDirectory(dirname(path));
    ordinaryFile(temporary.tempPath);
    if (fileIdentity(path) !== expectedIdentity) throw new StateFileError('FILE_CHANGED');
    copyInvalidBackup(path);
    if (fileIdentity(path) !== expectedIdentity) throw new StateFileError('FILE_CHANGED');
    renameSync(temporary.tempPath, path);
  } finally {
    try {
      await temporary.close();
    } catch {
      /* Already closed. */
    }
    try {
      ordinaryDirectory(dirname(path));
      if (dirname(temporary.tempPath) === dirname(path)) unlinkSync(temporary.tempPath);
    } catch {
      /* Never remove outside the original parent. */
    }
  }
}
