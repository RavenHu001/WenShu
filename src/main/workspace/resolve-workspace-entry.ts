/**
 * 文件管理源/目标路径安全解析（TASK-009 §6.2 / WP2）。
 *
 * ## 与 path-validation.ts 的边界
 *
 * - `path-validation.ts`（resolveWorkspaceTarget）保持"最终段必须存在的普通文件"语义
 *   不变，继续服务 TXT/DOCX 读取与覆盖保存；本模块不修改、不调用它的可选化变体；
 * - 本模块为文件管理新增独立解析：现有文件、现有目录、目标父目录（根 `''`）、
 *   不存在目标、工作区根操作、internal name、case-only 与 same/descendant 判断；
 * - 全部解析按 §4.3 逐段 `lstat`（拒绝任一 symlink/junction，中间段必须普通目录）+
 *   realpath 边界；词法校验复用共享契约（`file-management.ts`）与
 *   `path-validation.validateRelativePath`（只读导入，不改动）。
 *
 * ## 可测试性
 *
 * 文件系统适配器（lstat/realpath）可注入：生产环境使用 `node:fs/promises` 默认实现，
 * 测试可注入 mock 确定性构造 ENOENT/EACCES/EPERM/链接/realpath 逃逸等分支。
 * 本模块不执行任何写入、rename、trash 或 shell 调用。
 */

import { isAbsolute, join, relative, sep } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import type { FileStatLike } from '../document/path-validation';
import { validateRelativePath } from '../document/path-validation';
import {
  fileManagementError,
  isInternalWorkspaceName,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  type FileManagementError,
  type WorkspaceTargetName,
} from '../../shared/file-management';

/** 文件系统适配器：与 path-validation 同构，测试可注入。 */
export interface WorkspaceEntryAdapters {
  /** 不跟随符号链接的条目状态查询。 */
  readonly lstat: (path: string) => Promise<FileStatLike>;
  /** 解析路径的最终真实路径（跟随全部符号链接 / junction）。 */
  readonly realpath: (path: string) => Promise<string>;
}

/** 生产环境默认适配器。 */
export const defaultWorkspaceEntryAdapters: WorkspaceEntryAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
});

/** 文件系统错误映射：ENOENT / EACCES / EPERM → 稳定错误；其余 → FS_FAILED。 */
function mapFsError(err: unknown): FileManagementError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return fileManagementError('NOT_FOUND');
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return fileManagementError('ACCESS_DENIED');
    }
  }
  return fileManagementError('FS_FAILED');
}

/** 解析成功结果：候选绝对路径 + 规范相对路径段（不含叶时为空）。 */
export type ResolvedWorkspaceEntry =
  | {
      readonly status: 'ok';
      /** 候选绝对路径（仅供主进程内部使用，绝不进入跨进程结果）。 */
      readonly candidate: string;
      /** 校验通过的规范相对路径段。 */
      readonly segments: readonly string[];
      /** 最终段 lstat 状态（仅现有文件/目录解析返回）。 */
      readonly stat: FileStatLike;
    }
  | { readonly status: 'error'; readonly error: FileManagementError };

export type ResolvedWorkspaceParent =
  | {
      readonly status: 'ok';
      readonly candidate: string;
      /** 父目录规范相对路径段（根父目录为 `[]`）。 */
      readonly segments: readonly string[];
    }
  | { readonly status: 'error'; readonly error: FileManagementError };

/**
 * 逐段 lstat 通用于三种解析：最终段必须为普通文件 / 普通目录 / 不限制（父目录用）。
 * 任一中间段不是普通目录、任一段是 symlink/junction 立即返回稳定错误。
 */
async function walkSegments(
  workspaceRoot: string,
  segments: readonly string[],
  finalKind: 'file' | 'directory' | 'any',
  adapters: WorkspaceEntryAdapters,
): Promise<
  | { readonly status: 'ok'; readonly candidate: string; readonly stat: FileStatLike }
  | { readonly status: 'error'; readonly error: FileManagementError }
> {
  let current = workspaceRoot;
  let finalStat: FileStatLike | null = null;
  for (let i = 0; i < segments.length; i += 1) {
    current = join(current, segments[i]!);
    let stat: FileStatLike;
    try {
      stat = await adapters.lstat(current);
    } catch (err) {
      return { status: 'error', error: mapFsError(err) };
    }
    if (stat.isSymbolicLink()) {
      return { status: 'error', error: fileManagementError('LINK_NOT_ALLOWED') };
    }
    const isLast = i === segments.length - 1;
    if (isLast) {
      if (finalKind === 'file' && !stat.isFile()) {
        return { status: 'error', error: fileManagementError('NOT_FILE') };
      }
      if (finalKind === 'directory' && !stat.isDirectory()) {
        return { status: 'error', error: fileManagementError('NOT_DIRECTORY') };
      }
      finalStat = stat;
    } else if (!stat.isDirectory()) {
      return { status: 'error', error: fileManagementError('NOT_DIRECTORY') };
    }
  }
  return { status: 'ok', candidate: current, stat: finalStat! };
}

/** 词法 + 边界检查的公共前置：工作区根、相对路径格式、internal name。 */
function preflight(workspaceRoot: string, segments: readonly string[]): FileManagementError | null {
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return fileManagementError('NO_WORKSPACE');
  }
  if (segments.some((segment) => isInternalWorkspaceName(segment))) {
    return fileManagementError('INTERNAL_NAME_NOT_ALLOWED');
  }
  return null;
}

/** realpath 边界检查：候选必须仍位于真实工作区根内（不跟随任何链接越界）。 */
async function realpathBoundaryCheck(
  workspaceRoot: string,
  candidate: string,
  adapters: WorkspaceEntryAdapters,
): Promise<FileManagementError | null> {
  try {
    const [realRoot, realCandidate] = await Promise.all([
      adapters.realpath(workspaceRoot),
      adapters.realpath(candidate),
    ]);
    const realRel = relative(realRoot, realCandidate);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      return fileManagementError('OUTSIDE_WORKSPACE');
    }
    return null;
  } catch (err) {
    return mapFsError(err);
  }
}

/**
 * 解析现有普通文件（最终段必须存在且为普通文件）。
 * 源文件/另存为覆盖目标等场景使用；不适用于不存在目标或目录目标。
 */
export async function resolveExistingWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  adapters: WorkspaceEntryAdapters = defaultWorkspaceEntryAdapters,
): Promise<ResolvedWorkspaceEntry> {
  const segments = validateRelativePath(relativePath);
  if (segments === null) {
    return { status: 'error', error: fileManagementError('INVALID_PATH') };
  }
  const preflightError = preflight(workspaceRoot, segments);
  if (preflightError !== null) {
    return { status: 'error', error: preflightError };
  }
  const walked = await walkSegments(workspaceRoot, segments, 'file', adapters);
  if (walked.status === 'error') {
    return { status: 'error', error: walked.error };
  }
  const boundaryError = await realpathBoundaryCheck(workspaceRoot, walked.candidate, adapters);
  if (boundaryError !== null) {
    return { status: 'error', error: boundaryError };
  }
  return { status: 'ok', candidate: walked.candidate, segments, stat: walked.stat };
}

/**
 * 解析现有普通目录（最终段必须存在且为普通目录）。
 * 工作区根（`''`）作为 relocate/trash 源一律返回 ROOT_OPERATION_NOT_ALLOWED；
 * 目录作为源（重命名/移动）或 reveal 目标使用。
 */
export async function resolveExistingWorkspaceDirectory(
  workspaceRoot: string,
  relativePath: string,
  adapters: WorkspaceEntryAdapters = defaultWorkspaceEntryAdapters,
): Promise<ResolvedWorkspaceEntry> {
  if (relativePath === '') {
    return { status: 'error', error: fileManagementError('ROOT_OPERATION_NOT_ALLOWED') };
  }
  const segments = validateRelativePath(relativePath);
  if (segments === null) {
    return { status: 'error', error: fileManagementError('INVALID_PATH') };
  }
  const preflightError = preflight(workspaceRoot, segments);
  if (preflightError !== null) {
    return { status: 'error', error: preflightError };
  }
  const walked = await walkSegments(workspaceRoot, segments, 'directory', adapters);
  if (walked.status === 'error') {
    return { status: 'error', error: walked.error };
  }
  const boundaryError = await realpathBoundaryCheck(workspaceRoot, walked.candidate, adapters);
  if (boundaryError !== null) {
    return { status: 'error', error: boundaryError };
  }
  return { status: 'ok', candidate: walked.candidate, segments, stat: walked.stat };
}

/**
 * 解析目标父目录：根父目录 `''` 显式支持（返回工作区根本身，零段校验）；
 * 非根父目录逐段校验（全部必须为普通目录、无链接）并做 realpath 边界检查。
 */
export async function resolveWorkspaceParentDirectory(
  workspaceRoot: string,
  parentRelativePath: string,
  adapters: WorkspaceEntryAdapters = defaultWorkspaceEntryAdapters,
): Promise<ResolvedWorkspaceParent> {
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return { status: 'error', error: fileManagementError('NO_WORKSPACE') };
  }
  if (parentRelativePath === '') {
    // 工作区根由 workspace-session 持有（打开时已扫描）；零段无需逐段校验，
    // 发布前复验仍会重新确认根未变化
    return { status: 'ok', candidate: workspaceRoot, segments: [] };
  }
  const segments = validateRelativePath(parentRelativePath);
  if (segments === null) {
    return { status: 'error', error: fileManagementError('INVALID_PATH') };
  }
  const preflightError = preflight(workspaceRoot, segments);
  if (preflightError !== null) {
    return { status: 'error', error: preflightError };
  }
  const walked = await walkSegments(workspaceRoot, segments, 'any', adapters);
  if (walked.status === 'error') {
    return { status: 'error', error: walked.error };
  }
  const boundaryError = await realpathBoundaryCheck(workspaceRoot, walked.candidate, adapters);
  if (boundaryError !== null) {
    return { status: 'error', error: boundaryError };
  }
  return { status: 'ok', candidate: walked.candidate, segments };
}

/**
 * 解析不存在目标（新建/另存为新目标）：父目录必须存在且为普通目录（逐段校验），
 * 叶名称通过 Windows 名称校验，且最终叶必须不存在（存在即 TARGET_EXISTS，不覆盖、
 * 不自动改名；文件系统大小写不敏感语义由 lstat 判定，即 `a.txt` vs `A.txt` 也算冲突）。
 */
export async function resolveNonExistingWorkspaceTarget(
  workspaceRoot: string,
  target: WorkspaceTargetName,
  adapters: WorkspaceEntryAdapters = defaultWorkspaceEntryAdapters,
): Promise<
  | {
      readonly status: 'ok';
      readonly candidate: string;
      readonly parentRelativePath: string;
      readonly name: string;
    }
  | { readonly status: 'error'; readonly error: FileManagementError }
> {
  if (
    target === null ||
    typeof target !== 'object' ||
    typeof target.name !== 'string' ||
    !validateWindowsLeafName(target.name)
  ) {
    return { status: 'error', error: fileManagementError('INVALID_NAME') };
  }
  if (
    typeof target.parentRelativePath !== 'string' ||
    (target.parentRelativePath !== '' && !validateWorkspaceRelativePath(target.parentRelativePath))
  ) {
    return { status: 'error', error: fileManagementError('INVALID_PATH') };
  }
  if (isInternalWorkspaceName(target.name)) {
    return { status: 'error', error: fileManagementError('INTERNAL_NAME_NOT_ALLOWED') };
  }
  const parent = await resolveWorkspaceParentDirectory(
    workspaceRoot,
    target.parentRelativePath,
    adapters,
  );
  if (parent.status === 'error') {
    return { status: 'error', error: parent.error };
  }
  const candidate = join(parent.candidate, target.name);
  try {
    await adapters.lstat(candidate);
    // 存在（含大小写别名）：不覆盖、不自动改名
    return { status: 'error', error: fileManagementError('TARGET_EXISTS') };
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        status: 'ok',
        candidate,
        parentRelativePath: parent.segments.join('/'),
        name: target.name,
      };
    }
    return { status: 'error', error: mapFsError(err) };
  }
}
