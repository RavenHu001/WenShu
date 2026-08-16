/**
 * DOCX 另存为服务（TASK-009 WP4，§4.7）—— 两阶段覆盖确认 + 目标备份 + 安全发布。
 *
 * ## 流程
 *
 * 1. 请求精确形状校验（含模型运行时校验）；sourceRelativePath 细分错误；
 * 2. 源文件重新解析并读取字节：revision 与 expectedSourceRevision 不一致 → CONFLICT
 *    （零写入，源文件保持不变）；
 * 3. 源兼容性：read-only → READ_ONLY_DOCUMENT（不允许另存为）；degraded 必须携带绑定
 *    源 revision 的 compatibilityConfirmationRevision，否则拒绝（不绕过确认）；
 *    0 字节占位按 supported 空文档处理；
 * 4. 目标分支：
 *    - 无 expectedTargetRevision：目标不存在 → 排他创建（无备份）；目标存在 → 只返回
 *      target-exists + 受控目标 revision，不写盘；
 *    - 有 expectedTargetRevision：目标必须为普通非链接文件且 revision 一致（否则
 *      CONFLICT/NOT_FOUND/LINK_NOT_ALLOWED/NOT_FILE）；覆盖前为目标创建/刷新滚动备份
 *      `<目标文件名>.wenshu.bak`（内容 = 目标替换前原字节；备份失败 → BACKUP_FAILED，
 *      目标不变）；
 * 5. 生成：模型 → 字节 → 大小/ZIP/OOXML/重导入验证（失败 → EXPORT_FAILED/VERIFICATION_FAILED）；
 * 6. 写入：同目录排他临时文件 → 完整写入 → sync → close → 发布前复验（新目标仍不存在；
 *    覆盖目标仍是同一 revision）→ 同文件系统 rename 发布；
 * 7. 失败尽力清理临时文件；成功后源文件不变。
 */

import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  DOCX_MAX_FILE_BYTES,
  validateDocxDocumentModel,
  type DocxDocumentSnapshot,
} from '../../shared/docx';
import {
  fileManagementError,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  type FileManagementError,
  type SaveAsResult,
  type SaveDocxDocumentAsRequest,
} from '../../shared/file-management';
import { validateRelativePath } from '../document/path-validation';
import { defaultSaveDocxAdapters, type SaveDocxAdapters } from './save-docx-document';
import { inspectDocxPackage } from './inspect-docx-package';
import { importDocxDocument, isEmptyDocxPlaceholder } from './import-docx';
import {
  resolveExistingWorkspaceFile,
  resolveWorkspaceParentDirectory,
} from '../workspace/resolve-workspace-entry';
import type { TempWriteHandle } from '../document/write-safety';

/** 另存为文件系统/产物适配器：复用 DOCX 保存器适配器。 */
export type SaveDocxDocumentAsAdapters = SaveDocxAdapters;

/** 生产默认适配器。 */
export const defaultSaveDocxDocumentAsAdapters: SaveDocxDocumentAsAdapters =
  defaultSaveDocxAdapters;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 请求细分校验：形状 → INVALID_REQUEST；源路径 → INVALID_PATH；目标/模型细分。 */
function validateRequest(
  value: unknown,
): { ok: true; request: SaveDocxDocumentAsRequest } | { ok: false; error: FileManagementError } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = value as Record<string, unknown>;
  const allowed = [
    'compatibilityConfirmationRevision',
    'expectedSourceRevision',
    'expectedTargetRevision',
    'model',
    'mutationId',
    'sourceRelativePath',
    'tabId',
    'target',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    !isPositiveInteger(record.mutationId) ||
    typeof record.tabId !== 'string' ||
    record.tabId.length === 0
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (typeof record.expectedSourceRevision !== 'string') {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    typeof record.sourceRelativePath !== 'string' ||
    validateRelativePath(record.sourceRelativePath) === null
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
  }
  if (validateDocxDocumentModel(record.model).length > 0) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const target = record.target as Record<string, unknown> | null | undefined;
  if (target === null || typeof target !== 'object') {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (typeof target.name !== 'string' || !validateWindowsLeafName(target.name)) {
    return { ok: false, error: fileManagementError('INVALID_NAME') };
  }
  if (
    typeof target.parentRelativePath !== 'string' ||
    (target.parentRelativePath !== '' && !validateWorkspaceRelativePath(target.parentRelativePath))
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
  }
  if (
    record.expectedTargetRevision !== undefined &&
    (typeof record.expectedTargetRevision !== 'string' ||
      record.expectedTargetRevision.length === 0)
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    record.compatibilityConfirmationRevision !== undefined &&
    (typeof record.compatibilityConfirmationRevision !== 'string' ||
      record.compatibilityConfirmationRevision.length === 0)
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  return { ok: true, request: value as SaveDocxDocumentAsRequest };
}

/** 读取字节并计算 SHA-256（有界 DOCX_MAX_FILE_BYTES + 1）。 */
async function readFileBytes(
  path: string,
  adapters: SaveDocxDocumentAsAdapters,
): Promise<{ bytes: Uint8Array; revision: string } | { error: FileManagementError }> {
  try {
    const bytes = await adapters.readDiskBytes(path);
    if (bytes.byteLength > DOCX_MAX_FILE_BYTES) {
      return { error: fileManagementError('TOO_LARGE') };
    }
    return { bytes, revision: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) {
    if (err instanceof Error) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return { error: fileManagementError('NOT_FOUND') };
      }
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        return { error: fileManagementError('ACCESS_DENIED') };
      }
      if (nodeErr.code === 'EISDIR') {
        return { error: fileManagementError('NOT_FILE') };
      }
    }
    return { error: fileManagementError('WRITE_FAILED') };
  }
}

/** 写阶段错误映射。 */
function mapWriteError(err: unknown): FileManagementError {
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

/** 目标已存在（发布竞态）的内部标记。 */
class TargetExistsError extends Error {
  constructor() {
    super('target exists');
    this.name = 'TargetExistsError';
  }
}

/** 尽力清理临时文件（清理错误不覆盖主错误）。 */
async function cleanupTemp(
  handle: TempWriteHandle | null,
  tempPath: string | null,
  adapters: SaveDocxDocumentAsAdapters,
  label: string,
): Promise<void> {
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
      const code = cleanupErr instanceof Error ? (cleanupErr as NodeJS.ErrnoException).code : null;
      console.error(`wenshu: 清理${label}临时文件失败${code === undefined ? '' : ` (${code})`}`);
    }
  }
}

/**
 * 覆盖前为目标创建/刷新滚动备份（内容 = 目标替换前原字节）。
 * 备份自身走排他临时文件 → sync → close → 替换；任一失败 → BACKUP_FAILED，目标不变。
 */
async function createTargetBackup(
  targetPath: string,
  targetBytes: Uint8Array,
  adapters: SaveDocxDocumentAsAdapters,
): Promise<FileManagementError | null> {
  const backupTarget = `${targetPath}.wenshu.bak`;
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  try {
    handle = await adapters.createTempFile(backupTarget);
    tempPath = handle.tempPath;
    await handle.write(targetBytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await adapters.replace(tempPath, backupTarget);
    tempPath = null;
    return null;
  } catch {
    await cleanupTemp(handle, tempPath, adapters, '备份');
    return fileManagementError('BACKUP_FAILED');
  }
}

/** 发布前复验 + 发布（create / overwrite）。 */
async function publishDocxAs(
  tempPath: string,
  targetPath: string,
  mode: { kind: 'create' } | { kind: 'overwrite'; expectedTargetRevision: string },
  adapters: SaveDocxDocumentAsAdapters,
): Promise<FileManagementError | null> {
  try {
    if (mode.kind === 'create') {
      try {
        await adapters.lstat(targetPath);
        throw new TargetExistsError();
      } catch (err) {
        if (err instanceof TargetExistsError) {
          throw err;
        }
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          await adapters.replace(tempPath, targetPath);
          return null;
        }
        throw err;
      }
    } else {
      const current = await readFileBytes(targetPath, adapters);
      if ('error' in current) {
        return current.error;
      }
      if (current.revision !== mode.expectedTargetRevision) {
        return fileManagementError('CONFLICT');
      }
      await adapters.replace(tempPath, targetPath);
      return null;
    }
  } catch (err) {
    if (err instanceof TargetExistsError) {
      return fileManagementError('TARGET_EXISTS');
    }
    return mapWriteError(err);
  }
  return null;
}

/**
 * 在工作区边界内执行 DOCX 另存为（两阶段覆盖确认；read-only 拒绝；degraded 需确认；
 * 覆盖前为目标创建滚动备份）。成功后源文件不变，返回目标快照与备份相对路径。
 */
export async function saveDocxDocumentAs(
  workspaceRoot: string,
  request: unknown,
  adapters: SaveDocxDocumentAsAdapters = defaultSaveDocxDocumentAsAdapters,
): Promise<SaveAsResult> {
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

  // 1. 源文件解析 + revision 冲突检测（零写入）
  const source = await resolveExistingWorkspaceFile(
    workspaceRoot,
    req.sourceRelativePath,
    adapters,
  );
  if (source.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: source.error };
  }
  const sourceRead = await readFileBytes(source.candidate, adapters);
  if ('error' in sourceRead) {
    return { status: 'error', mutationId: req.mutationId, error: sourceRead.error };
  }
  if (sourceRead.revision !== req.expectedSourceRevision) {
    return { status: 'error', mutationId: req.mutationId, error: fileManagementError('CONFLICT') };
  }

  // 2. 源兼容性（0 字节占位按 supported 空文档处理）
  if (!isEmptyDocxPlaceholder(sourceRead.bytes)) {
    const inspection = await inspectDocxPackage(sourceRead.bytes);
    if (inspection.status === 'error') {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('FS_FAILED'),
      };
    }
    const imported = await importDocxDocument(sourceRead.bytes, inspection.inspection);
    if (imported.status === 'error') {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('READ_ONLY_DOCUMENT'),
      };
    }
    if (imported.compatibility.level === 'read-only') {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('READ_ONLY_DOCUMENT'),
      };
    }
    if (
      imported.compatibility.level === 'degraded' &&
      req.compatibilityConfirmationRevision !== req.expectedSourceRevision
    ) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('COMPATIBILITY_CONFIRMATION_REQUIRED'),
      };
    }
  }

  // 3. 目标父目录逐段解析
  const parent = await resolveWorkspaceParentDirectory(
    workspaceRoot,
    req.target.parentRelativePath,
    adapters,
  );
  if (parent.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: parent.error };
  }
  const targetPath = join(parent.candidate, req.target.name);
  const targetRelativePath =
    parent.segments.length === 0
      ? req.target.name
      : `${parent.segments.join('/')}/${req.target.name}`;

  // 4. 目标存在性与类型判定（lstat 优先，不读取/跟随链接）
  let targetStat: Awaited<ReturnType<SaveDocxDocumentAsAdapters['lstat']>> | null = null;
  try {
    targetStat = await adapters.lstat(targetPath);
  } catch (err) {
    if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
      return { status: 'error', mutationId: req.mutationId, error: mapWriteError(err) };
    }
  }
  const targetExists = targetStat !== null;

  let backupRelativePath: string | null = null;
  if (req.expectedTargetRevision === undefined) {
    if (targetExists) {
      let targetRevision = '';
      if (targetStat !== null && targetStat.isFile() && !targetStat.isSymbolicLink()) {
        const read = await readFileBytes(targetPath, adapters);
        if (!('error' in read)) {
          targetRevision = read.revision;
        }
      }
      return {
        status: 'target-exists',
        mutationId: req.mutationId,
        targetRevision,
      };
    }
  } else {
    if (!targetExists || targetStat === null) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NOT_FOUND'),
      };
    }
    if (targetStat.isSymbolicLink()) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('LINK_NOT_ALLOWED'),
      };
    }
    if (!targetStat.isFile()) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NOT_FILE'),
      };
    }
    const targetRead = await readFileBytes(targetPath, adapters);
    if ('error' in targetRead) {
      return { status: 'error', mutationId: req.mutationId, error: targetRead.error };
    }
    if (targetRead.revision !== req.expectedTargetRevision) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('CONFLICT'),
      };
    }
    // 覆盖前：目标滚动备份（备份失败 → BACKUP_FAILED，目标不变）
    const backupError = await createTargetBackup(targetPath, targetRead.bytes, adapters);
    if (backupError !== null) {
      return { status: 'error', mutationId: req.mutationId, error: backupError };
    }
    backupRelativePath = `${targetRelativePath}.wenshu.bak`;
  }

  // 5. 生成 + 产物验证
  let generated: Uint8Array;
  try {
    generated = await adapters.generateDocx(req.model);
  } catch {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('EXPORT_FAILED'),
    };
  }
  const verified = await adapters.verifyGenerated(generated);
  if (!verified.ok) {
    return {
      status: 'error',
      mutationId: req.mutationId,
      error: fileManagementError('VERIFICATION_FAILED'),
    };
  }

  // 6. 临时文件写入 → sync → close → 发布前复验 → rename
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  try {
    handle = await adapters.createTempFile(targetPath);
    tempPath = handle.tempPath;
    await handle.write(generated);
    await handle.sync();
    await handle.close();
    handle = null;
    const publishError = await publishDocxAs(
      tempPath,
      targetPath,
      req.expectedTargetRevision === undefined
        ? { kind: 'create' }
        : { kind: 'overwrite', expectedTargetRevision: req.expectedTargetRevision },
      adapters,
    );
    if (publishError !== null) {
      await cleanupTemp(null, tempPath, adapters, '另存为');
      return { status: 'error', mutationId: req.mutationId, error: publishError };
    }
    tempPath = null;
  } catch (err) {
    await cleanupTemp(handle, tempPath, adapters, '另存为');
    return { status: 'error', mutationId: req.mutationId, error: mapWriteError(err) };
  }

  const savedDocument: DocxDocumentSnapshot = {
    kind: 'docx',
    name: basename(targetPath),
    relativePath: targetRelativePath,
    revision: createHash('sha256').update(generated).digest('hex'),
    size: generated.byteLength,
    model: req.model,
    compatibility: verified.compatibility,
  };
  return {
    status: 'saved',
    mutationId: req.mutationId,
    relativePath: targetRelativePath,
    kind: 'docx',
    document: savedDocument,
    ...(backupRelativePath !== null ? { backupRelativePath } : {}),
  };
}
