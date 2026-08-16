/**
 * TXT 另存为服务（TASK-009 WP4，§4.7）—— 两阶段覆盖确认 + 安全发布。
 *
 * ## 流程
 *
 * 1. 请求精确形状校验（共享契约；sourceRelativePath/target 细分错误）；
 * 2. 源文件重新解析并读取字节：revision 与 expectedSourceRevision 不一致 → CONFLICT
 *    （零写入，源文件保持不变）；BOM 策略取自源字节；
 * 3. 目标分支（以 lstat 判定存在性与类型，不读取链接）：
 *    - 无 expectedTargetRevision（第一阶段）：目标不存在 → 排他创建；目标存在 →
 *      只返回 target-exists + 受控目标 revision（目录/链接 revision 为空，不可覆盖）；
 *    - 有 expectedTargetRevision（覆盖确认后）：目标必须为普通非链接文件并读取 revision
 *      比较；不一致 → CONFLICT（重新确认）；
 * 4. 编码：复用 TXT 保存器的 BOM/换行规则；混合换行需 confirmMixedLineEndingNormalization；
 * 5. 写入：同目录排他临时文件 → 完整写入 → sync → close → 发布前复验（新目标必须仍
 *    不存在；覆盖目标必须仍是同一 revision）→ 同文件系统 rename 发布；
 * 6. 失败尽力清理临时文件（清理错误不覆盖主错误）；成功后源文件不变。
 */

import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MAX_TXT_FILE_BYTES,
  type LineEnding,
  type TextDocumentSnapshot,
} from '../../shared/document';
import {
  fileManagementError,
  validateWindowsLeafName,
  validateWorkspaceRelativePath,
  type FileManagementError,
  type SaveAsResult,
  type SaveTextDocumentAsRequest,
} from '../../shared/file-management';
import { validateRelativePath } from './path-validation';
import type { TempWriteHandle } from './write-safety';
import {
  defaultSaveTextAdapters,
  dominantLineEnding,
  encodeUtf8,
  normalizeLineEndings,
  type SaveTextAdapters,
} from './save-text-document';
import { detectLineEnding, hasUtf8Bom } from './read-text-document';
import {
  resolveExistingWorkspaceFile,
  resolveWorkspaceParentDirectory,
} from '../workspace/resolve-workspace-entry';

/** 另存为文件系统适配器：复用 TXT 保存器适配器（lstat/realpath/readDiskBytes/临时文件）。 */
export type SaveTextDocumentAsAdapters = SaveTextAdapters;

/** 生产默认适配器。 */
export const defaultSaveTextDocumentAsAdapters: SaveTextDocumentAsAdapters =
  defaultSaveTextAdapters;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 请求细分校验：形状 → INVALID_REQUEST；源路径 → INVALID_PATH；目标名称/父路径细分。 */
function validateRequest(
  value: unknown,
): { ok: true; request: SaveTextDocumentAsRequest } | { ok: false; error: FileManagementError } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = value as Record<string, unknown>;
  const allowed = [
    'confirmMixedLineEndingNormalization',
    'content',
    'expectedSourceRevision',
    'expectedTargetRevision',
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
  if (typeof record.content !== 'string' || typeof record.expectedSourceRevision !== 'string') {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    typeof record.sourceRelativePath !== 'string' ||
    validateRelativePath(record.sourceRelativePath) === null
  ) {
    return { ok: false, error: fileManagementError('INVALID_PATH') };
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
    record.confirmMixedLineEndingNormalization !== undefined &&
    record.confirmMixedLineEndingNormalization !== true
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  return { ok: true, request: value as SaveTextDocumentAsRequest };
}

/** 读取普通文件字节并计算 SHA-256（有界，超限 → TOO_LARGE）。 */
async function readFileBytes(
  path: string,
  adapters: SaveTextDocumentAsAdapters,
): Promise<{ bytes: Uint8Array; revision: string } | { error: FileManagementError }> {
  try {
    const bytes = await adapters.readDiskBytes(path);
    if (bytes.byteLength > MAX_TXT_FILE_BYTES) {
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

/**
 * 发布前复验 + 发布：
 * - create：目标必须仍不存在（竞态 → TARGET_EXISTS），再 rename；
 * - overwrite：目标必须仍是 expectedTargetRevision（覆盖前外部变化 → CONFLICT），再 rename。
 */
async function publishTextAs(
  tempPath: string,
  targetPath: string,
  mode: { kind: 'create' } | { kind: 'overwrite'; expectedTargetRevision: string },
  adapters: SaveTextDocumentAsAdapters,
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

/** 尽力清理临时文件（清理错误不覆盖主错误）。 */
async function cleanupTemp(
  handle: TempWriteHandle | null,
  tempPath: string | null,
  adapters: SaveTextDocumentAsAdapters,
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
      console.error(`wenshu: 清理另存为临时文件失败${code === undefined ? '' : ` (${code})`}`);
    }
  }
}

/**
 * 在工作区边界内执行 TXT 另存为（两阶段覆盖确认）。
 * 成功后返回新目标快照（源文件不变）；目标存在且未确认覆盖时只返回 target-exists。
 */
export async function saveTextDocumentAs(
  workspaceRoot: string,
  request: unknown,
  adapters: SaveTextDocumentAsAdapters = defaultSaveTextDocumentAsAdapters,
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

  // 1. 源文件解析 + revision 冲突检测（零写入；BOM 策略取自源字节）
  const source = await resolveExistingWorkspaceFile(
    workspaceRoot,
    req.sourceRelativePath,
    adapters,
  );
  if (source.status === 'error') {
    return { status: 'error', mutationId: req.mutationId, error: source.error };
  }
  const sourceBytes = await readFileBytes(source.candidate, adapters);
  if ('error' in sourceBytes) {
    return { status: 'error', mutationId: req.mutationId, error: sourceBytes.error };
  }
  if (sourceBytes.revision !== req.expectedSourceRevision) {
    return { status: 'error', mutationId: req.mutationId, error: fileManagementError('CONFLICT') };
  }
  const diskHasBom = hasUtf8Bom(sourceBytes.bytes);

  // 2. 目标父目录逐段解析
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

  // 3. 目标存在性与类型判定（lstat 优先，不读取/跟随链接）
  let targetStat: Awaited<ReturnType<SaveTextDocumentAsAdapters['lstat']>> | null = null;
  try {
    targetStat = await adapters.lstat(targetPath);
  } catch (err) {
    if (!(err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
      const mapped = mapWriteError(err);
      return { status: 'error', mutationId: req.mutationId, error: mapped };
    }
  }
  const targetExists = targetStat !== null;

  if (req.expectedTargetRevision === undefined) {
    // 第一阶段：目标不存在 → 创建；存在 → 只返回 target-exists + 受控目标 revision
    if (targetExists) {
      let targetRevision = '';
      if (targetStat !== null && targetStat.isFile() && !targetStat.isSymbolicLink()) {
        const read = await readFileBytes(targetPath, adapters);
        if ('error' in read) {
          targetRevision = '';
        } else {
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
    // 第二阶段：目标必须存在且为普通非链接文件、revision 匹配
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
  }

  // 4. 编码：BOM/换行/混合换行确认（复用 TXT 保存器语义）
  const lineEnding = detectLineEnding(req.content);
  let normalized: string;
  let savedLineEnding: LineEnding;
  if (lineEnding === 'mixed') {
    if (req.confirmMixedLineEndingNormalization !== true) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED'),
      };
    }
    const style = dominantLineEnding(req.content);
    normalized = normalizeLineEndings(req.content, style);
    savedLineEnding = style;
  } else {
    normalized = req.content;
    savedLineEnding = lineEnding;
  }
  const bytesToWrite = encodeUtf8(normalized, diskHasBom);
  if (bytesToWrite.byteLength > MAX_TXT_FILE_BYTES) {
    return { status: 'error', mutationId: req.mutationId, error: fileManagementError('TOO_LARGE') };
  }

  // 5. 临时文件写入 → sync → close → 发布前复验 → rename
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  try {
    handle = await adapters.createTempFile(targetPath);
    tempPath = handle.tempPath;
    await handle.write(bytesToWrite);
    await handle.sync();
    await handle.close();
    handle = null;
    const publishError = await publishTextAs(
      tempPath,
      targetPath,
      req.expectedTargetRevision === undefined
        ? { kind: 'create' }
        : { kind: 'overwrite', expectedTargetRevision: req.expectedTargetRevision },
      adapters,
    );
    if (publishError !== null) {
      await cleanupTemp(null, tempPath, adapters);
      return { status: 'error', mutationId: req.mutationId, error: publishError };
    }
    tempPath = null;
  } catch (err) {
    await cleanupTemp(handle, tempPath, adapters);
    return { status: 'error', mutationId: req.mutationId, error: mapWriteError(err) };
  }

  const savedDocument: TextDocumentSnapshot = {
    name: basename(targetPath),
    relativePath: targetRelativePath,
    content: normalized,
    byteLength: bytesToWrite.byteLength,
    revision: createHash('sha256').update(bytesToWrite).digest('hex'),
    hasUtf8Bom: diskHasBom,
    lineEnding: savedLineEnding,
  };
  return {
    status: 'saved',
    mutationId: req.mutationId,
    relativePath: targetRelativePath,
    kind: 'text',
    document: savedDocument,
  };
}
