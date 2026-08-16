/**
 * 工作区新建服务（TASK-009 WP3，§4.6）—— TXT / 基础 DOCX / 文件夹排他新建。
 *
 * ## 安全发布协议
 *
 * - 目标先经 resolveNonExistingWorkspaceTarget 解析：父目录逐段 lstat/realpath（拒绝
 *   symlink/junction）、叶不存在（含大小写别名 → TARGET_EXISTS）；
 * - TXT：0 字节合法 UTF-8（无 BOM），经目标同目录排他临时文件写入 → sync → close →
 *   发布前复验（目标仍不存在）→ 同文件系统 rename 发布；任一步失败尽力清理临时文件；
 * - DOCX：固定空模型（schemaVersion 1，至少一个空段落）→ 导出 → 大小/ZIP/OOXML/重导入
 *   验证 → 同一临时文件管线发布；验证失败 → VERIFICATION_FAILED，目标不变；
 * - 文件夹：非递归单级 mkdir（EEXIST → TARGET_EXISTS），不隐式创建父目录；
 * - 全部错误为稳定 FileManagementError，不泄漏绝对路径、临时名或原始异常；
 * - 文件系统适配器可注入（lstat/realpath/mkdir/临时文件/发布/清理/DOCX 生成验证），
 *   测试可确定性构造短写、sync/close/验证/发布/清理失败与父目录竞态。
 */

import { isAbsolute } from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import {
  defaultTempWriteFactory,
  removeTempFile,
  replaceFile,
  type TempWriteHandle,
} from '../document/write-safety';
import {
  exportDocxDocument,
  verifyGeneratedDocxDocument,
  type VerifyGeneratedDocxResult,
} from '../docx/export-docx';
import {
  fileManagementError,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  type CreateWorkspaceEntryRequest,
  type FileManagementError,
  type WorkspaceMutationResult,
} from '../../shared/file-management';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../shared/docx';
import type { DocxDocumentModel } from '../../shared/docx';
import {
  resolveNonExistingWorkspaceTarget,
  type WorkspaceEntryAdapters,
} from './resolve-workspace-entry';

/** 新建 DOCX 使用的固定空模型：至少一个空段落（§4.6）。 */
export const EMPTY_DOCX_MODEL: DocxDocumentModel = {
  schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
  blocks: [{ kind: 'paragraph', alignment: null, runs: [] }],
};

/** 新建服务文件系统与产物适配器。 */
export interface CreateWorkspaceEntryAdapters extends WorkspaceEntryAdapters {
  /** 非递归单级创建目录（已存在 → EEXIST）。 */
  readonly mkdir: (path: string) => Promise<void>;
  /** 目标同目录排他临时文件。 */
  readonly createTempFile: (targetPath: string) => Promise<TempWriteHandle>;
  /** 同文件系统替换（发布）。 */
  readonly replace: (tempPath: string, targetPath: string) => Promise<void>;
  /** 尽力清理临时文件；ENOENT 视为成功。 */
  readonly removeTemp: (tempPath: string) => Promise<void>;
  /** 空模型 → 基础 DOCX 字节；失败抛出异常。 */
  readonly generateDocx: (model: DocxDocumentModel) => Promise<Uint8Array>;
  /** 生成产物的大小/结构/重导入验证。 */
  readonly verifyGenerated: (bytes: Uint8Array) => Promise<VerifyGeneratedDocxResult>;
}

/** 生产默认适配器。 */
export const defaultCreateWorkspaceEntryAdapters: CreateWorkspaceEntryAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  mkdir: (path: string) => mkdir(path),
  createTempFile: (targetPath: string) => defaultTempWriteFactory.create(targetPath),
  replace: (tempPath: string, targetPath: string) => replaceFile(tempPath, targetPath),
  removeTemp: (tempPath: string) => removeTempFile(tempPath),
  generateDocx: (model: DocxDocumentModel) => exportDocxDocument(model),
  verifyGenerated: (bytes: Uint8Array) => verifyGeneratedDocxDocument(bytes),
});

/** 发布阶段目标已存在（竞态）的模块内错误标记。 */
class TargetExistsError extends Error {
  constructor() {
    super('target exists');
    this.name = 'TargetExistsError';
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 请求细分校验：形状 → INVALID_REQUEST；名称 → INVALID_NAME；父路径 → INVALID_PATH。 */
function validateRequest(
  request: unknown,
): { ok: true; request: CreateWorkspaceEntryRequest } | { ok: false; error: FileManagementError } {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = request as Record<string, unknown>;
  const allowed = ['kind', 'mutationId', 'name', 'parentRelativePath'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    !isPositiveInteger(record.mutationId) ||
    (record.kind !== 'text' && record.kind !== 'docx' && record.kind !== 'directory')
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
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
  return { ok: true, request: request as CreateWorkspaceEntryRequest };
}

/** 写入/发布阶段错误映射。 */
function mapWriteError(err: unknown): FileManagementError {
  if (err instanceof TargetExistsError) {
    return fileManagementError('TARGET_EXISTS');
  }
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return fileManagementError('ACCESS_DENIED');
    }
    if (nodeErr.code === 'ENOENT') {
      return fileManagementError('NOT_FOUND');
    }
    if (nodeErr.code === 'EEXIST') {
      return fileManagementError('TARGET_EXISTS');
    }
  }
  return fileManagementError('WRITE_FAILED');
}

/** 目录创建错误映射。 */
function mapMkdirError(err: unknown): FileManagementError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      return fileManagementError('TARGET_EXISTS');
    }
    if (nodeErr.code === 'ENOENT') {
      return fileManagementError('NOT_FOUND');
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return fileManagementError('ACCESS_DENIED');
    }
  }
  return fileManagementError('WRITE_FAILED');
}

/**
 * 发布前复验 + 不覆盖发布：先确认目标仍不存在（TOCTOU 竞态 → TARGET_EXISTS，
 * 不覆盖、不自动改名），再同文件系统 rename 发布。
 */
async function publishIfAbsent(
  tempPath: string,
  candidate: string,
  adapters: CreateWorkspaceEntryAdapters,
): Promise<void> {
  try {
    await adapters.lstat(candidate);
    throw new TargetExistsError();
  } catch (err) {
    if (err instanceof TargetExistsError) {
      throw err;
    }
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      await adapters.replace(tempPath, candidate);
      return;
    }
    throw err;
  }
}

/** 临时文件管线：写入 → sync → close → 发布前复验 → 发布；失败返回稳定错误并尽力清理。 */
async function writeTempAndPublish(
  candidate: string,
  bytes: Uint8Array,
  adapters: CreateWorkspaceEntryAdapters,
): Promise<FileManagementError | null> {
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  try {
    handle = await adapters.createTempFile(candidate);
    tempPath = handle.tempPath;
    await handle.write(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await publishIfAbsent(tempPath, candidate, adapters);
    tempPath = null;
    return null;
  } catch (err) {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // 忽略次要错误
      }
    }
    if (tempPath !== null) {
      try {
        await adapters.removeTemp(tempPath);
      } catch (cleanupErr) {
        const code =
          cleanupErr instanceof Error ? (cleanupErr as NodeJS.ErrnoException).code : null;
        console.error(`wenshu: 清理新建临时文件失败${code === undefined ? '' : ` (${code})`}`);
      }
    }
    return mapWriteError(err);
  }
}

/**
 * 在工作区边界内排他新建 TXT / 基础 DOCX / 文件夹。
 * 成功后返回规范相对路径与条目类型；任何失败保留目标缺失并返回稳定错误。
 */
export async function createWorkspaceEntry(
  workspaceRoot: string,
  request: unknown,
  adapters: CreateWorkspaceEntryAdapters = defaultCreateWorkspaceEntryAdapters,
): Promise<WorkspaceMutationResult> {
  const validated = validateRequest(request);
  if (!validated.ok) {
    return {
      status: 'error',
      mutationId: 0,
      error: validated.error,
    };
  }
  const req = validated.request;
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('NO_WORKSPACE'),
    };
  }

  // 目标解析：父目录逐段校验 + 叶不存在（含大小写别名冲突）
  const resolved = await resolveNonExistingWorkspaceTarget(
    workspaceRoot,
    { parentRelativePath: req.parentRelativePath, name: req.name },
    adapters,
  );
  if (resolved.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: resolved.error };
  }
  const relativePath =
    resolved.parentRelativePath === '' ? req.name : `${resolved.parentRelativePath}/${req.name}`;

  if (req.kind === 'directory') {
    try {
      await adapters.mkdir(resolved.candidate);
    } catch (err) {
      return { status: 'error', mutationId: req.mutationId, error: mapMkdirError(err) };
    }
    return {
      status: 'succeeded',
      mutationId: req.mutationId,
      relativePath,
      kind: 'directory',
    };
  }

  let bytes: Uint8Array;
  if (req.kind === 'text') {
    // 合法空 UTF-8（无 BOM）TXT
    bytes = new Uint8Array(0);
  } else {
    try {
      bytes = await adapters.generateDocx(EMPTY_DOCX_MODEL);
    } catch {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('EXPORT_FAILED'),
      };
    }
    const verified = await adapters.verifyGenerated(bytes);
    if (!verified.ok) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('VERIFICATION_FAILED'),
      };
    }
  }

  const writeError = await writeTempAndPublish(resolved.candidate, bytes, adapters);
  if (writeError !== null) {
    return { status: 'error', mutationId: req.mutationId, error: writeError };
  }
  return {
    status: 'succeeded',
    mutationId: req.mutationId,
    relativePath,
    kind: req.kind,
  };
}
