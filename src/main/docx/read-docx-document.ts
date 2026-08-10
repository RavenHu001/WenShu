/**
 * DOCX 文档读取器 —— 工作区授权边界内受控读取普通 .docx 文件（TASK-007 WP2）。
 *
 * ## 校验顺序（与 TASK-003 第 6.2 节语义一致，预算按 WP0 冻结值）
 *
 * 1. 确认已打开工作区（workspaceRoot 非空且为绝对路径）；
 * 2. 确认输入是符合格式要求的非空相对路径；
 * 3. 确认扩展名为大小写不敏感的 `.docx`（不接受 `.docm`、`.dotm`、`.rtf` 或伪装扩展名）；
 * 4. 复用 `resolveWorkspaceTarget` 完成词法边界、逐段 lstat（拒绝符号链接 / junction）、
 *    普通文件与真实路径边界校验；
 * 5. 读取前大小检查（≤ 20 MiB）；
 * 6. 有界读取（最多 20 MiB + 1 字节）并再次确认实际长度；
 * 7. 对原始完整字节计算 SHA-256 revision；
 * 8. 0 字节 `.docx` 占位文件直接映射为空白模型；其余输入执行 ZIP/OOXML 结构与资源预算检查
 *    （`inspectDocxPackage`）；
 * 9. 非占位输入执行语义导入（`importDocxDocument`）生成模型与兼容性报告；
 * 10. 返回文档快照，或把失败映射为稳定错误。
 *
 * ## 安全边界
 *
 * - 全部为只读操作；不请求网络、不执行文档内容；
 * - 不向调用方暴露 Error、Buffer、文件句柄、原始 OOXML 或调用栈；
 * - 任何预期与意外失败都转换为 `ReadDocxDocumentResult`。
 */

import { basename, extname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import {
  DOCX_MAX_FILE_BYTES,
  docxDocumentError,
  type DocxDocumentError,
  type DocxDocumentSnapshot,
  type ReadDocxDocumentResult,
} from '../../shared/docx';
import {
  readBoundedBytes,
  resolveWorkspaceTarget,
  validateRelativePath,
  type FileStatLike,
} from '../document/path-validation';
import { inspectDocxPackage } from './inspect-docx-package';
import {
  importDocxDocument,
  importEmptyDocxPlaceholder,
  isEmptyDocxPlaceholder,
  type ImportDocxResult,
} from './import-docx';

/** 文件系统适配函数集合；生产环境为 `node:fs/promises`，测试环境可注入 mock。 */
export interface ReadDocxAdapters {
  /** 不跟随符号链接的条目状态查询。 */
  readonly lstat: (path: string) => Promise<FileStatLike>;
  /** 解析路径的最终真实路径（跟随全部符号链接 / junction）。 */
  readonly realpath: (path: string) => Promise<string>;
  /** 有界读取：最多返回 `DOCX_MAX_FILE_BYTES + 1` 字节，调用方据此判定超限。 */
  readonly readDocxBytes: (path: string) => Promise<Uint8Array>;
}

/** 生产环境默认适配器：直接使用 `node:fs/promises`，全部为只读操作。 */
export const defaultReadDocxAdapters: ReadDocxAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  readDocxBytes: async (path: string) => {
    const handle = await open(path, 'r');
    try {
      return await readBoundedBytes(handle, DOCX_MAX_FILE_BYTES + 1);
    } finally {
      await handle.close();
    }
  },
});

/** 读取阶段的文件系统错误映射：ENOENT / EACCES / EPERM → 稳定错误。 */
function mapReadFsError(err: unknown): DocxDocumentError | null {
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

/**
 * 在工作区边界内异步读取一个普通 .docx 文件。
 *
 * @param workspaceRoot - 本次读取开始时捕获的工作区根路径（绝对路径）
 * @param relativePath - 渲染进程提交的规范相对路径，必须作为不可信输入重新验证
 * @param adapters - 文件系统适配器，默认使用 `node:fs/promises`
 * @returns `loaded` 文档快照或稳定 `error`，任何情况下都不会抛出异常
 */
export async function readDocxDocument(
  workspaceRoot: string,
  relativePath: string,
  adapters: ReadDocxAdapters = defaultReadDocxAdapters,
): Promise<ReadDocxDocumentResult> {
  // 1. 已打开工作区：根路径必须存在且为绝对路径
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return { status: 'error', error: docxDocumentError('NO_WORKSPACE') };
  }

  // 2. 相对路径格式校验
  const segments = validateRelativePath(relativePath);
  if (segments === null) {
    return { status: 'error', error: docxDocumentError('INVALID_PATH') };
  }

  // 3. 扩展名校验：大小写不敏感，只接受 `.docx`
  if (extname(relativePath).toLowerCase() !== '.docx') {
    return { status: 'error', error: docxDocumentError('UNSUPPORTED_TYPE') };
  }

  // 4. 工作区边界解析与校验（词法/逐段 lstat/普通文件/真实路径）
  const resolved = await resolveWorkspaceTarget(workspaceRoot, relativePath, adapters);
  if (resolved.status === 'error') {
    return {
      status: 'error',
      error: { code: resolved.error.code, message: resolved.error.message },
    };
  }
  const candidate = resolved.candidate;

  // 5. 读取前大小检查（基于逐段 lstat 得到的最终段状态）
  if (resolved.finalStat.size > DOCX_MAX_FILE_BYTES) {
    return { status: 'error', error: docxDocumentError('TOO_LARGE') };
  }

  // 6. 有界读取：最多读取 DOCX_MAX_FILE_BYTES + 1 字节，再确认实际长度
  let bytes: Uint8Array;
  try {
    bytes = await adapters.readDocxBytes(candidate);
  } catch (err) {
    const mapped = mapReadFsError(err);
    return { status: 'error', error: mapped ?? docxDocumentError('READ_FAILED') };
  }
  if (bytes.byteLength > DOCX_MAX_FILE_BYTES) {
    return { status: 'error', error: docxDocumentError('TOO_LARGE') };
  }

  // 7. revision 基于原始完整字节（含全部结构，不依赖解析结果）
  const revision = createHash('sha256').update(bytes).digest('hex');

  // 8-9. 0 字节 `.docx` 是 Windows/WPS 惰性占位文件：按空白文档加载；
  // 其余输入仍必须通过 ZIP/OOXML 结构预算检查与语义导入，不能把一般损坏文件当作空白文档。
  let imported: Extract<ImportDocxResult, { status: 'ok' }>;
  if (isEmptyDocxPlaceholder(bytes)) {
    imported = importEmptyDocxPlaceholder();
  } else {
    const inspection = await inspectDocxPackage(bytes);
    if (inspection.status === 'error') {
      return { status: 'error', error: inspection.error };
    }
    const result = await importDocxDocument(bytes, inspection.inspection);
    if (result.status === 'error') {
      return { status: 'error', error: result.error };
    }
    imported = result;
  }

  // 10. 返回只读快照
  const snapshot: DocxDocumentSnapshot = {
    kind: 'docx',
    name: basename(candidate),
    relativePath: segments.join('/'),
    revision,
    size: bytes.byteLength,
    model: imported.model,
    compatibility: imported.compatibility,
  };
  return { status: 'loaded', document: snapshot };
}
