/**
 * DOCX 文档安全保存器 —— revision 冲突、兼容性确认、滚动备份、临时写入、产物验证
 * 与安全替换（TASK-007 WP3，第 4.7 节）。
 *
 * ## 保存协议（第 4.7 节固定顺序）
 *
 * 1. 请求形状与模型校验（非法模型 → INVALID_REQUEST）；
 * 2. 重新校验工作区、相对路径、扩展名、符号链接、真实路径与普通文件；
 * 3. 有界读取磁盘文件并计算 SHA-256，与 `expectedRevision` 不一致返回 `CONFLICT`
 *    （此时不创建任何文件）；
 * 4. 重新导入磁盘文件判断兼容性（0 字节占位文件按 supported 空白文档处理；
 *    其余输入遵循第 4.2 / 5.3 节不变量 10-11）：
 *    `read-only` → READ_ONLY_DOCUMENT；`degraded` 且没有
 *    `compatibilityConfirmationRevision === expectedRevision`（绑定当前磁盘 revision
 *    的用户确认）→ COMPATIBILITY_CONFIRMATION_REQUIRED；
 * 5. 创建或刷新同目录滚动备份 `<文件名>.wenshu.bak`：写入自身排他临时文件、
 *    完整写入、刷盘、关闭后再安全替换备份；备份阶段任一失败 → BACKUP_FAILED，
 *    目标不变化，不允许"无备份模式"继续；
 * 6. 按模型生成新 DOCX 字节；生成失败 → EXPORT_FAILED；
 * 7. 生成字节大小、ZIP/OOXML 结构与重新导入验证；失败 → VERIFICATION_FAILED；
 * 8. 目标同目录排他临时文件：完整写入 → sync → 关闭；
 * 9. 替换目标前再次有界读取并核对 revision（保存期间外部变化 → CONFLICT，清理临时文件）；
 * 10. 同文件系统安全替换（不先删除、不先截断）；
 * 11. 返回新 revision、文件大小、兼容性与备份相对路径；
 * 12. 任一步失败都保留原目标，并尽力清理本次临时文件（清理错误不覆盖主要错误）。
 *
 * 滚动备份只保留最近一次保存前版本；备份文件不作为可编辑 `.docx` 出现在筛选结果中
 * （扩展名为 `.wenshu.bak`，由 WP5 文件树筛选处理）。
 *
 * ## 可测试性：函数参数注入
 *
 * `SaveDocxAdapters` 提供 lstat / realpath / readDiskBytes / createTempFile / replace /
 * removeTemp / generateDocx / verifyGenerated，生产环境使用默认实现，测试环境可注入
 * mock 确定性构造全部失败点。
 */

import { basename, extname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import {
  DOCX_MAX_FILE_BYTES,
  docxDocumentError,
  validateDocxDocumentModel,
  type DocxCompatibilityReport,
  type DocxDocumentError,
  type DocxDocumentSnapshot,
  type SaveDocxDocumentRequest,
  type SaveDocxDocumentResult,
} from '../../shared/docx';
import {
  readBoundedBytes,
  resolveWorkspaceTarget,
  validateRelativePath,
  type FileStatLike,
} from '../document/path-validation';
import {
  defaultTempWriteFactory,
  removeTempFile,
  replaceFile,
  type TempWriteHandle,
} from '../document/write-safety';
import { exportDocxDocument, verifyGeneratedDocxDocument } from './export-docx';
import { inspectDocxPackage } from './inspect-docx-package';
import { importDocxDocument, isEmptyDocxPlaceholder } from './import-docx';

/** 保存器文件系统与产物适配器；生产环境为默认实现，测试环境可注入 mock。 */
export interface SaveDocxAdapters {
  readonly lstat: (path: string) => Promise<FileStatLike>;
  readonly realpath: (path: string) => Promise<string>;
  /** 有界读取当前磁盘文件（最多 `DOCX_MAX_FILE_BYTES + 1` 字节），用于版本校验。 */
  readonly readDiskBytes: (path: string) => Promise<Uint8Array>;
  /** 在目标文件同一目录排他创建不可预测名称的临时文件。 */
  readonly createTempFile: (targetPath: string) => Promise<TempWriteHandle>;
  /** 同文件系统替换：临时文件替换为目标文件。 */
  readonly replace: (tempPath: string, targetPath: string) => Promise<void>;
  /** 尽力清理临时文件；`ENOENT` 视为成功。 */
  readonly removeTemp: (tempPath: string) => Promise<void>;
  /** 中间模型 → 基础 DOCX 字节；失败抛出异常。 */
  readonly generateDocx: (model: SaveDocxDocumentRequest['model']) => Promise<Uint8Array>;
  /** 生成产物的大小/结构/重新导入验证。 */
  readonly verifyGenerated: (
    bytes: Uint8Array,
  ) => Promise<
    { readonly ok: true; readonly compatibility: DocxCompatibilityReport } | { readonly ok: false }
  >;
}

/** 生产环境默认适配器：直接使用 `node:fs/promises` 与 DOCX 导出/验证管线。 */
export const defaultSaveDocxAdapters: SaveDocxAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  readDiskBytes: async (path: string) => {
    const handle = await open(path, 'r');
    try {
      return await readBoundedBytes(handle, DOCX_MAX_FILE_BYTES + 1);
    } finally {
      await handle.close();
    }
  },
  createTempFile: (targetPath: string) => defaultTempWriteFactory.create(targetPath),
  replace: (tempPath: string, targetPath: string) => replaceFile(tempPath, targetPath),
  removeTemp: (tempPath: string) => removeTempFile(tempPath),
  generateDocx: (model: SaveDocxDocumentRequest['model']) => exportDocxDocument(model),
  verifyGenerated: (bytes: Uint8Array) => verifyGeneratedDocxDocument(bytes),
});

/** 读取阶段的文件系统错误映射：ENOENT / EACCES / EPERM → 稳定错误。 */
function mapCheckFsError(err: unknown): DocxDocumentError | null {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return docxDocumentError('NOT_FOUND');
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return docxDocumentError('ACCESS_DENIED');
    }
  }
  return null;
}

/** 写入 / 替换阶段的文件系统错误映射：EACCES 视为权限类。 */
function mapWriteFsError(err: unknown): DocxDocumentError | null {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return docxDocumentError('NOT_FOUND');
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return docxDocumentError('ACCESS_DENIED');
    }
  }
  return null;
}

/** 请求形状校验：必需字段类型、模型合法性与可选确认字段；非法 → INVALID_REQUEST。 */
function validateRequestShape(value: unknown): value is SaveDocxDocumentRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.relativePath !== 'string' ||
    typeof record.expectedRevision !== 'string' ||
    record.expectedRevision.length === 0
  ) {
    return false;
  }
  if (validateDocxDocumentModel(record.model).length > 0) {
    return false;
  }
  if (
    record.compatibilityConfirmationRevision !== undefined &&
    (typeof record.compatibilityConfirmationRevision !== 'string' ||
      record.compatibilityConfirmationRevision.length === 0)
  ) {
    return false;
  }
  return true;
}

/** 备份相对路径：`<文件名>.wenshu.bak`（与目标同目录，`/` 分隔）。 */
function backupRelativePathOf(segments: readonly string[]): string {
  const name = segments[segments.length - 1]!;
  return [...segments.slice(0, -1), `${name}.wenshu.bak`].join('/');
}

/**
 * 在工作区边界内按安全协议保存一个 DOCX 文件。
 * 任何情况下都不先删除、不先截断目标；失败保留原文件与未保存内容语义。
 */
export async function saveDocxDocument(
  workspaceRoot: string,
  request: SaveDocxDocumentRequest,
  adapters: SaveDocxAdapters = defaultSaveDocxAdapters,
): Promise<SaveDocxDocumentResult> {
  // 0. 请求形状校验（渲染进程数据不可信）
  if (!validateRequestShape(request)) {
    return { status: 'error', error: docxDocumentError('INVALID_REQUEST') };
  }

  // 1. 已打开工作区：根路径必须存在且为绝对路径
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return { status: 'error', error: docxDocumentError('NO_WORKSPACE') };
  }

  // 2. 相对路径格式与扩展名
  const segments = validateRelativePath(request.relativePath);
  if (segments === null) {
    return { status: 'error', error: docxDocumentError('INVALID_PATH') };
  }
  if (extname(request.relativePath).toLowerCase() !== '.docx') {
    return { status: 'error', error: docxDocumentError('UNSUPPORTED_TYPE') };
  }

  // 3. 工作区边界解析与校验（词法/逐段 lstat/普通文件/真实路径）
  const resolved = await resolveWorkspaceTarget(workspaceRoot, request.relativePath, adapters);
  if (resolved.status === 'error') {
    return {
      status: 'error',
      error: { code: resolved.error.code, message: resolved.error.message },
    };
  }
  const candidate = resolved.candidate;
  if (resolved.finalStat.size > DOCX_MAX_FILE_BYTES) {
    return { status: 'error', error: docxDocumentError('TOO_LARGE') };
  }

  // 4. 有界读取磁盘文件并检查 revision；冲突时不创建任何文件
  let diskBytes: Uint8Array;
  try {
    diskBytes = await adapters.readDiskBytes(candidate);
  } catch (err) {
    const mapped = mapCheckFsError(err);
    return { status: 'error', error: mapped ?? docxDocumentError('WRITE_FAILED') };
  }
  if (diskBytes.byteLength > DOCX_MAX_FILE_BYTES) {
    return { status: 'error', error: docxDocumentError('TOO_LARGE') };
  }
  const diskRevision = createHash('sha256').update(diskBytes).digest('hex');
  if (diskRevision !== request.expectedRevision) {
    return { status: 'error', error: docxDocumentError('CONFLICT') };
  }

  // 5. 重新导入磁盘文件判断兼容性（revision 一致 ⇒ 磁盘内容 = 用户打开并确认过的文档）。
  // 0 字节占位文件在读取阶段已被定义为 supported 空白文档；首次保存时跳过 OOXML 复检，
  // 但仍执行 revision、备份、生成产物验证与替换协议。非零输入继续严格复检。
  if (!isEmptyDocxPlaceholder(diskBytes)) {
    const diskInspection = await inspectDocxPackage(diskBytes);
    if (diskInspection.status === 'error') {
      return { status: 'error', error: diskInspection.error };
    }
    const diskImported = await importDocxDocument(diskBytes, diskInspection.inspection);
    if (diskImported.status === 'error') {
      return { status: 'error', error: docxDocumentError('READ_FAILED') };
    }
    if (diskImported.compatibility.level === 'read-only') {
      return { status: 'error', error: docxDocumentError('READ_ONLY_DOCUMENT') };
    }
    if (
      diskImported.compatibility.level === 'degraded' &&
      request.compatibilityConfirmationRevision !== request.expectedRevision
    ) {
      return { status: 'error', error: docxDocumentError('COMPATIBILITY_CONFIRMATION_REQUIRED') };
    }
  }

  // 6. 滚动备份：写入自身排他临时文件 → 刷盘 → 关闭 → 安全替换备份
  const backupRelativePath = backupRelativePathOf(segments);
  const backupTarget = `${candidate}.wenshu.bak`;
  let backupHandle: TempWriteHandle | null = null;
  let backupTempPath: string | null = null;
  try {
    const handle = await adapters.createTempFile(backupTarget);
    backupHandle = handle;
    backupTempPath = handle.tempPath;
    await handle.write(diskBytes);
    await handle.sync();
    await handle.close();
    backupHandle = null;
    await adapters.replace(backupTempPath, backupTarget);
    backupTempPath = null;
  } catch {
    if (backupHandle !== null) {
      try {
        await backupHandle.close();
      } catch {
        // 忽略次要错误
      }
    }
    if (backupTempPath !== null) {
      try {
        await adapters.removeTemp(backupTempPath);
      } catch (cleanupErr) {
        const code =
          cleanupErr instanceof Error ? (cleanupErr as NodeJS.ErrnoException).code : null;
        console.error(`wenshu: 清理备份临时文件失败${code === undefined ? '' : ` (${code})`}`);
      }
    }
    // 备份阶段失败即保存中止（第 4.7 节：不允许"无备份模式"继续）
    return { status: 'error', error: docxDocumentError('BACKUP_FAILED') };
  }

  // 7. 生成新 DOCX 字节
  let generated: Uint8Array;
  try {
    generated = await adapters.generateDocx(request.model);
  } catch {
    return { status: 'error', error: docxDocumentError('EXPORT_FAILED') };
  }

  // 8. 产物验证：大小 / 结构 / 重新导入（第 4.7 节步骤 5）
  const verified = await adapters.verifyGenerated(generated);
  if (!verified.ok) {
    return { status: 'error', error: docxDocumentError('VERIFICATION_FAILED') };
  }

  // 9-11. 目标同目录排他临时文件：完整写入 → 刷盘 → 关闭
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  const cleanupTemp = async (): Promise<void> => {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // 忽略次要错误
      }
      handle = null;
    }
    if (tempPath !== null) {
      try {
        await adapters.removeTemp(tempPath);
      } catch (cleanupErr) {
        const code =
          cleanupErr instanceof Error ? (cleanupErr as NodeJS.ErrnoException).code : null;
        console.error(`wenshu: 清理临时文件失败${code === undefined ? '' : ` (${code})`}`);
      }
      tempPath = null;
    }
  };

  try {
    handle = await adapters.createTempFile(candidate);
    tempPath = handle.tempPath;
    await handle.write(generated);
    await handle.sync();
    await handle.close();
    handle = null;

    // 12. 替换前再次确认目标仍是同一 revision（保存期间外部变化 → CONFLICT）
    let currentBytes: Uint8Array;
    try {
      currentBytes = await adapters.readDiskBytes(candidate);
    } catch (readErr) {
      await cleanupTemp();
      const mapped = mapCheckFsError(readErr);
      return { status: 'error', error: mapped ?? docxDocumentError('WRITE_FAILED') };
    }
    const currentRevision = createHash('sha256').update(currentBytes).digest('hex');
    if (currentRevision !== request.expectedRevision) {
      await cleanupTemp();
      return { status: 'error', error: docxDocumentError('CONFLICT') };
    }

    // 13. 同文件系统安全替换（不先删除、不先截断目标）
    await adapters.replace(tempPath, candidate);
    tempPath = null;
  } catch (err) {
    await cleanupTemp();
    return { status: 'error', error: mapWriteFsError(err) ?? docxDocumentError('WRITE_FAILED') };
  }

  // 14. 返回新快照与备份相对路径
  const newRevision = createHash('sha256').update(generated).digest('hex');
  const savedDocument: DocxDocumentSnapshot = {
    kind: 'docx',
    name: basename(candidate),
    relativePath: segments.join('/'),
    revision: newRevision,
    size: generated.byteLength,
    model: request.model,
    compatibility: verified.compatibility,
  };
  return { status: 'saved', document: savedDocument, backupRelativePath };
}
