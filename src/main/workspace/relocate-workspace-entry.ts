/**
 * 重命名/移动服务（TASK-009 WP5，§4.8）—— 受控 relocate。
 *
 * ## 固定语义
 *
 * - 源：普通文件或普通目录；工作区根、symlink/junction、other、内部恢复/临时名一律拒绝；
 * - 目标：父目录逐段校验（根父目录 '' 支持）+ 叶名称校验；目标存在一律 TARGET_EXISTS
 *   （不覆盖、不合并）；目录不能移动到自身或任一后代（段边界）；
 * - 同路径（字符串完全相同）为安全无操作；
 * - Windows 只改大小写：不可预测、同目录、排他的中间名两步 rename，任一步失败尝试
 *   回滚；回滚失败 → PARTIAL_FAILURE；
 * - 普通同卷 rename 使用文件系统原子 rename；发布前复验（源类型未变、目标仍不存在）；
 * - DOCX 伴随备份：单 DOCX 重命名/移动时，`<源>.wenshu.bak` 跟随迁移到
 *   `<目标>.wenshu.bak`；目标备份已存在 → 操作前冲突；备份迁移失败 → 尝试回滚主文件，
 *   回滚成功返回 BACKUP_FAILED，回滚失败返回 PARTIAL_FAILURE；目录自然携带备份；
 * - 全部错误为稳定 FileManagementError，不泄漏绝对路径/临时名。
 */

import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, rename } from 'node:fs/promises';
import {
  fileManagementError,
  isCaseOnlyRename,
  isSameOrDescendantPath,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  type FileManagementError,
  type ManagedEntryKind,
  type RelocateWorkspaceEntryRequest,
  type WorkspaceMutationResult,
} from '../../shared/file-management';
import { validateRelativePath } from '../document/path-validation';
import {
  preflight,
  realpathBoundaryCheck,
  walkSegments,
  resolveWorkspaceParentDirectory,
  type WorkspaceEntryAdapters,
} from './resolve-workspace-entry';

/** relocate 文件系统适配器。 */
export interface RelocateWorkspaceEntryAdapters extends WorkspaceEntryAdapters {
  /** 同文件系统 rename（Windows MoveFileExW；EXDEV 表示跨卷）。 */
  readonly rename: (from: string, to: string) => Promise<void>;
}

/** 生产默认适配器。 */
export const defaultRelocateWorkspaceEntryAdapters: RelocateWorkspaceEntryAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  rename: (from: string, to: string) => rename(from, to),
});

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 请求细分校验。 */
function validateRequest(
  value: unknown,
):
  { ok: true; request: RelocateWorkspaceEntryRequest } | { ok: false; error: FileManagementError } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = value as Record<string, unknown>;
  const allowed = ['mutationId', 'name', 'parentRelativePath', 'sourceRelativePath'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (!isPositiveInteger(record.mutationId)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (record.sourceRelativePath === '') {
    return { ok: false, error: fileManagementError('ROOT_OPERATION_NOT_ALLOWED') };
  }
  if (
    typeof record.sourceRelativePath !== 'string' ||
    validateRelativePath(record.sourceRelativePath) === null
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
  }
  if (typeof record.name !== 'string' || !validateWindowsLeafName(record.name)) {
    return { ok: false, error: fileManagementError('INVALID_NAME') };
  }
  if (
    typeof record.parentRelativePath !== 'string' ||
    (record.parentRelativePath !== '' && !validateWorkspaceRelativePath(record.parentRelativePath))
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
  }
  return { ok: true, request: value as RelocateWorkspaceEntryRequest };
}

/** rename 错误映射。 */
function mapRenameError(err: unknown): FileManagementError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      return fileManagementError('TARGET_EXISTS');
    }
    if (nodeErr.code === 'EXDEV') {
      return fileManagementError('CROSS_DEVICE_NOT_ALLOWED');
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return fileManagementError('ACCESS_DENIED');
    }
    if (nodeErr.code === 'ENOENT') {
      return fileManagementError('NOT_FOUND');
    }
  }
  return fileManagementError('WRITE_FAILED');
}

/** 条目类型映射（供结果 kind）。 */
function kindOfPath(relativePath: string, isDirectory: boolean): ManagedEntryKind {
  if (isDirectory) {
    return 'directory';
  }
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.txt')) {
    return 'text';
  }
  if (lower.endsWith('.docx')) {
    return 'docx';
  }
  return 'file';
}

/**
 * 移动一个条目（普通或 case-only）：
 * - case-only：不可预测中间名两步；任一步失败尝试回滚（回滚失败 → PARTIAL_FAILURE）；
 * - 普通：直接 rename。
 * 返回 { ok } 或 { ok:false; error; rolledBack }（rolledBack=false 表示状态未知/部分完成）。
 */
async function moveEntry(
  from: string,
  to: string,
  caseOnly: boolean,
  adapters: RelocateWorkspaceEntryAdapters,
): Promise<{ ok: true } | { ok: false; error: FileManagementError; rolledBack: boolean }> {
  if (!caseOnly) {
    try {
      await adapters.rename(from, to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: mapRenameError(err), rolledBack: true };
    }
  }
  // case-only：同目录、不可预测、排他中间名
  const dir = join(from, '..');
  let tempPath = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = join(dir, `.wenshu-case-${randomUUID()}.tmp`);
    try {
      await adapters.lstat(candidate);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        tempPath = candidate;
        break;
      }
    }
  }
  if (tempPath === '') {
    return { ok: false, error: fileManagementError('WRITE_FAILED'), rolledBack: true };
  }
  try {
    await adapters.rename(from, tempPath);
  } catch (err) {
    return { ok: false, error: mapRenameError(err), rolledBack: true };
  }
  try {
    await adapters.rename(tempPath, to);
    return { ok: true };
  } catch (err) {
    // 第二步失败：尝试回滚到源
    try {
      await adapters.rename(tempPath, from);
      return { ok: false, error: mapRenameError(err), rolledBack: true };
    } catch {
      return { ok: false, error: fileManagementError('PARTIAL_FAILURE'), rolledBack: false };
    }
  }
}

/**
 * 在工作区边界内执行重命名/移动（含 case-only 两步与 DOCX 伴随备份迁移）。
 */
export async function relocateWorkspaceEntry(
  workspaceRoot: string,
  request: unknown,
  adapters: RelocateWorkspaceEntryAdapters = defaultRelocateWorkspaceEntryAdapters,
): Promise<WorkspaceMutationResult> {
  const validated = validateRequest(request);
  if (!validated.ok) {
    return { status: 'error', mutationId: 0, error: validated.error };
  }
  const req = validated.request;
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('NO_WORKSPACE'),
    };
  }

  // 1. 源解析（逐段 lstat/realpath；final 必须普通文件或普通目录）
  const segments = validateRelativePath(req.sourceRelativePath);
  if (segments === null) {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('INVALID_PATH'),
    };
  }
  const preflightError = preflight(workspaceRoot, segments);
  if (preflightError !== null) {
    return { status: 'error', mutationId: req.mutationId, error: preflightError };
  }
  const sourceWalk = await walkSegments(workspaceRoot, segments, 'any', adapters);
  if (sourceWalk.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: sourceWalk.error };
  }
  const sourceBoundary = await realpathBoundaryCheck(workspaceRoot, sourceWalk.candidate, adapters);
  if (sourceBoundary !== null) {
    return { status: 'error', mutationId: req.mutationId, error: sourceBoundary };
  }
  const sourceStat = sourceWalk.stat;
  const sourceIsDirectory = sourceStat.isDirectory();
  const sourceIsFile = sourceStat.isFile();
  if (!sourceIsFile && !sourceIsDirectory) {
    return { status: 'error', mutationId: req.mutationId, error: fileManagementError('NOT_FILE') };
  }

  // 2. 目标解析
  const parent = await resolveWorkspaceParentDirectory(
    workspaceRoot,
    req.parentRelativePath,
    adapters,
  );
  if (parent.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: parent.error };
  }
  const targetPath = join(parent.candidate, req.name);
  const targetRelativePath =
    parent.segments.length === 0 ? req.name : `${parent.segments.join('/')}/${req.name}`;

  // 3. 同路径安全无操作
  if (req.sourceRelativePath === targetRelativePath) {
    return {
      status: 'succeeded',
      mutationId: req.mutationId,
      relativePath: targetRelativePath,
      kind: kindOfPath(targetRelativePath, sourceIsDirectory),
    };
  }

  const caseOnly = isCaseOnlyRename(req.sourceRelativePath, targetRelativePath);

  // 4. 目录不能移动到自身或后代（case-only 不算）
  if (
    sourceIsDirectory &&
    !caseOnly &&
    isSameOrDescendantPath(req.sourceRelativePath, targetRelativePath)
  ) {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('DIRECTORY_INTO_DESCENDANT'),
    };
  }

  // 5. 目标存在性（case-only 时 lstat 命中源别名，跳过）
  if (!caseOnly) {
    try {
      await adapters.lstat(targetPath);
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('TARGET_EXISTS'),
      };
    } catch (err) {
      if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
        return { status: 'error', mutationId: req.mutationId, error: mapRenameError(err) };
      }
    }
  }

  // 6. DOCX 伴随备份预检（仅单 DOCX 文件；目录自然携带）
  const isDocxFile = sourceIsFile && req.sourceRelativePath.toLowerCase().endsWith('.docx');
  const backupSource = `${sourceWalk.candidate}.wenshu.bak`;
  const backupTarget = `${targetPath}.wenshu.bak`;
  let hasBackup = false;
  if (isDocxFile) {
    try {
      const backupStat = await adapters.lstat(backupSource);
      if (backupStat.isSymbolicLink()) {
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('LINK_NOT_ALLOWED'),
        };
      }
      hasBackup = true;
    } catch (err) {
      if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
        return { status: 'error', mutationId: req.mutationId, error: mapRenameError(err) };
      }
    }
    if (hasBackup && !caseOnly) {
      try {
        await adapters.lstat(backupTarget);
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('TARGET_EXISTS'),
        };
      } catch (err) {
        if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
          return { status: 'error', mutationId: req.mutationId, error: mapRenameError(err) };
        }
      }
    }
  }

  // 7. 发布前复验：源类型未变、仍非链接；目标仍不存在（case-only 目标即源别名，跳过）
  try {
    const recheck = await adapters.lstat(sourceWalk.candidate);
    if (recheck.isSymbolicLink()) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('LINK_NOT_ALLOWED'),
      };
    }
    if (sourceIsFile && !recheck.isFile()) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NOT_FILE'),
      };
    }
    if (sourceIsDirectory && !recheck.isDirectory()) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NOT_DIRECTORY'),
      };
    }
    if (!caseOnly) {
      try {
        await adapters.lstat(targetPath);
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('TARGET_EXISTS'),
        };
      } catch (targetErr) {
        if (!(
          targetErr instanceof Error && (targetErr as NodeJS.ErrnoException).code === 'ENOENT'
        )) {
          return { status: 'error', mutationId: req.mutationId, error: mapRenameError(targetErr) };
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NOT_FOUND'),
      };
    }
    return { status: 'error', mutationId: req.mutationId, error: mapRenameError(err) };
  }

  // 8. 移动主条目
  const moved = await moveEntry(sourceWalk.candidate, targetPath, caseOnly, adapters);
  if (!moved.ok) {
    return { status: 'error', mutationId: req.mutationId, error: moved.error };
  }

  // 9. 伴随备份迁移（失败 → 回滚主文件；回滚失败 → PARTIAL_FAILURE）
  if (hasBackup) {
    const backupMoved = await moveEntry(backupSource, backupTarget, caseOnly, adapters);
    if (!backupMoved.ok) {
      const rollback = await moveEntry(targetPath, sourceWalk.candidate, caseOnly, adapters);
      if (!rollback.ok) {
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('PARTIAL_FAILURE'),
        };
      }
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('BACKUP_FAILED'),
      };
    }
  }

  return {
    status: 'succeeded',
    mutationId: req.mutationId,
    relativePath: targetRelativePath,
    kind: kindOfPath(targetRelativePath, sourceIsDirectory),
  };
}
