/**
 * 删除到回收站服务（TASK-009 WP5，§4.9）。
 *
 * ## 固定语义
 *
 * - 删除统一调用可注入的 `shell.trashItem`（生产为 Electron shell.trashItem）；
 *   严禁 unlink/rm/rmdir 永久删除降级；
 * - 源：普通文件或普通目录；工作区根、symlink/junction、other、内部恢复/临时名拒绝；
 * - 单 DOCX 文件删除时，伴随 `<文件名>.wenshu.bak` 一并送入回收站；主文件与备份
 *   非事务：主文件成功而备份失败 → PARTIAL_FAILURE（已入回收站的主文件不得写回原位置
 *   冒充回滚）；目录删除自然携带目录内备份（只 trash 目录一次）；
 * - 任一 trash 失败 → TRASH_FAILED（主文件未动时原状态保留）；
 * - 结果只含规范相对路径与条目类型，不泄漏绝对路径。
 */

import { isAbsolute } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { shell } from 'electron';
import {
  fileManagementError,
  type FileManagementError,
  type ManagedEntryKind,
  type TrashWorkspaceEntryRequest,
  type WorkspaceMutationResult,
} from '../../shared/file-management';
import { validateRelativePath } from '../document/path-validation';
import {
  preflight,
  realpathBoundaryCheck,
  walkSegments,
  type WorkspaceEntryAdapters,
} from './resolve-workspace-entry';

/** trash 文件系统适配器。 */
export interface TrashWorkspaceEntryAdapters extends WorkspaceEntryAdapters {
  /** 删除到回收站（生产为 Electron shell.trashItem；测试注入 spy）。 */
  readonly trashItem: (path: string) => Promise<void>;
}

/** 生产默认适配器。 */
export const defaultTrashWorkspaceEntryAdapters: TrashWorkspaceEntryAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  trashItem: (path: string) => shell.trashItem(path),
});

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 请求细分校验。 */
function validateRequest(
  value: unknown,
): { ok: true; request: TrashWorkspaceEntryRequest } | { ok: false; error: FileManagementError } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = value as Record<string, unknown>;
  const allowed = ['mutationId', 'relativePath'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (!isPositiveInteger(record.mutationId)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (record.relativePath === '') {
    return { ok: false, error: fileManagementError('ROOT_OPERATION_NOT_ALLOWED') };
  }
  if (
    typeof record.relativePath !== 'string' ||
    validateRelativePath(record.relativePath) === null
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
  }
  return { ok: true, request: value as TrashWorkspaceEntryRequest };
}

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
 * 在工作区边界内把普通文件/目录删除到回收站（含 DOCX 伴随备份）。
 */
export async function trashWorkspaceEntry(
  workspaceRoot: string,
  request: unknown,
  adapters: TrashWorkspaceEntryAdapters = defaultTrashWorkspaceEntryAdapters,
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

  const segments = validateRelativePath(req.relativePath);
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
  const walked = await walkSegments(workspaceRoot, segments, 'any', adapters);
  if (walked.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: walked.error };
  }
  const boundaryError = await realpathBoundaryCheck(workspaceRoot, walked.candidate, adapters);
  if (boundaryError !== null) {
    return { status: 'error', mutationId: req.mutationId, error: boundaryError };
  }
  const stat = walked.stat;
  const isDirectory = stat.isDirectory();
  const isFile = stat.isFile();
  if (!isFile && !isDirectory) {
    return { status: 'error', mutationId: req.mutationId, error: fileManagementError('NOT_FILE') };
  }

  // 单 DOCX 文件：伴随备份一并进入回收站（目录自然携带，不单独枚举）
  const backupPath =
    isFile && req.relativePath.toLowerCase().endsWith('.docx')
      ? `${walked.candidate}.wenshu.bak`
      : null;
  let hasBackup = false;
  if (backupPath !== null) {
    try {
      const backupStat = await adapters.lstat(backupPath);
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
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('TRASH_FAILED'),
        };
      }
    }
  }

  // 主文件进入回收站；失败 → TRASH_FAILED（原状态保留，不触碰备份）
  try {
    await adapters.trashItem(walked.candidate);
  } catch {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('TRASH_FAILED'),
    };
  }

  // 伴随备份：主文件已入回收站；备份失败 → PARTIAL_FAILURE（不把主文件写回）
  if (hasBackup) {
    try {
      await adapters.trashItem(backupPath!);
    } catch {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('PARTIAL_FAILURE'),
      };
    }
  }

  return {
    status: 'succeeded',
    mutationId: req.mutationId,
    relativePath: req.relativePath,
    kind: kindOfPath(req.relativePath, isDirectory),
  };
}
