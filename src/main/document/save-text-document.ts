/**
 * UTF-8 TXT 文档安全保存器 —— 工作区边界内按固定安全协议保存普通文本文件。
 *
 * ## 安全写入协议（与 TASK-004 第 4.6 节一致）
 *
 * 1. 由调用方（IPC 处理器）传入本次操作开始时捕获的工作区根路径；
 * 2. 把保存请求视为不可信输入，重新校验规范相对路径、扩展名与工作区词法边界；
 * 3. 从工作区根开始逐段 `lstat`，拒绝符号链接 / junction，并确认中间段为目录、
 *    目标为普通文件；
 * 4. 使用真实路径再次确认目标仍位于真实工作区根内；
 * 5. 有界读取当前文件并对原始字节计算 SHA-256，与 `expectedRevision` 不一致
 *    返回 `CONFLICT`，此时不创建任何临时文件；
 * 6. 按原文件 BOM 策略与换行规则编码 UTF-8，编码后超过 5 MiB 在创建临时文件前拒绝；
 * 7. 在目标文件同一目录排他创建不可预测名称的临时文件；
 * 8. 完整写入全部字节（循环处理短写）并对临时文件执行 `sync` 刷盘；
 * 9. 关闭临时文件句柄；
 * 10. 使用同文件系统替换操作把临时文件替换为目标文件
 *     （Windows 上由 libuv 的 MoveFileExW(MOVEFILE_REPLACE_EXISTING) 提供替换语义）；
 * 11. 返回基于实际保存字节生成的新快照和内容版本；
 * 12. 任一步失败都转换为稳定错误，并尽力清理本次临时文件。
 *
 * 禁止：对目标文件直接截断写入；先删除目标文件再重命名；在系统临时目录写入后
 * 跨文件系统移动；使用渲染进程提供的绝对路径、临时文件名、编码或写入选项；
 * 替换失败后降级为不安全的覆盖写入；在错误结果或日志中泄漏正文、系统绝对路径、
 * 临时文件名或调用栈。
 *
 * ## 换行与 BOM 规则（与 TASK-004 第 4.5 节一致）
 *
 * - BOM：保留版本检查时从磁盘原始字节检测到的 BOM 策略，不因编辑器进入而静默移除；
 * - 一致的 LF / CRLF：正文换行即磁盘原风格，原样编码，不做任何隐式转换；
 * - 混合换行：未经 `confirmMixedLineEndingNormalization: true` 确认时返回
 *   `MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED` 且不写入；确认后按本任务选定规则
 *   规范化：dominant 风格（出现次数多的 `\r\n`+独立 `\r` 或 `\n`），平局取 CRLF。
 *
 * ## 可测试性：函数参数注入
 *
 * 与 `read-text-document.ts` 一致的轻量注入方式：`SaveTextAdapters` 提供
 * lstat / realpath / readDiskBytes / createTempFile / replace / removeTemp，
 * 生产环境使用 `node:fs/promises` 默认实现，测试环境可注入 mock 以确定性构造
 * 权限错误、短写、写入失败、刷盘失败、替换失败与清理失败等分支。
 *
 * ## 已知限制
 *
 * 版本校验是保存时刻的冲突检测，不等同于文件系统实时监听，也不承诺解决恶意本地
 * 进程制造的所有操作系统级 TOCTOU 竞态。
 */

import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, rm } from 'node:fs/promises';
import {
  MAX_TXT_FILE_BYTES,
  type LineEnding,
  type SaveTextDocumentError,
  type SaveTextDocumentErrorCode,
  type SaveTextDocumentRequest,
  type SaveTextDocumentResult,
  type TextDocumentSnapshot,
} from '../../shared/document';
import {
  detectLineEnding,
  hasUtf8Bom,
  readBoundedTextBytes,
  type FileStatLike,
} from './read-text-document';

/** 排他创建的临时写入句柄：完整写入、刷盘、关闭。 */
export interface TempWriteHandle {
  /** 临时文件绝对路径（与目标同目录），只供保存器内部使用，绝不进入跨进程结果。 */
  readonly tempPath: string;
  /** 完整写入全部字节；实现必须循环处理短写。 */
  write(bytes: Uint8Array): Promise<void>;
  /** 刷盘到持久存储。 */
  sync(): Promise<void>;
  /** 关闭句柄。 */
  close(): Promise<void>;
}

/** `FileHandle.write` 的最小写入契约，便于确定性测试短写。 */
export interface WritableFileHandle {
  readonly write: (
    buffer: Uint8Array,
    offset: number,
    length: number,
  ) => Promise<{ readonly bytesWritten: number }>;
}

/**
 * 循环写入直至全部字节写完或失败。
 * 单次 `FileHandle.write` 允许短写，不能把一次返回不足误判为结束。
 */
export async function writeAllBytes(handle: WritableFileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten <= 0) {
      throw new Error('wenshu: 临时文件写入无进展');
    }
    offset += bytesWritten;
  }
}

/** 保存器文件系统适配器；生产环境为 `node:fs/promises`，测试环境可注入 mock。 */
export interface SaveTextAdapters {
  /** 不跟随符号链接的条目状态查询。 */
  readonly lstat: (path: string) => Promise<FileStatLike>;
  /** 解析路径的最终真实路径（跟随全部符号链接 / junction）。 */
  readonly realpath: (path: string) => Promise<string>;
  /** 有界读取当前磁盘文件（最多 `MAX_TXT_FILE_BYTES + 1` 字节），用于版本校验。 */
  readonly readDiskBytes: (path: string) => Promise<Uint8Array>;
  /** 在目标文件同一目录排他创建不可预测名称的临时文件。 */
  readonly createTempFile: (targetPath: string) => Promise<TempWriteHandle>;
  /** 同文件系统替换：临时文件替换为目标文件。 */
  readonly replace: (tempPath: string, targetPath: string) => Promise<void>;
  /** 尽力清理临时文件；`ENOENT` 视为成功。 */
  readonly removeTemp: (tempPath: string) => Promise<void>;
}

const utf8Encoder = new TextEncoder();

/** 生产环境默认适配器：直接使用 `node:fs/promises`。 */
export const defaultSaveTextAdapters: SaveTextAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  readDiskBytes: async (path: string) => {
    const handle = await open(path, 'r');
    try {
      return await readBoundedTextBytes(handle);
    } finally {
      await handle.close();
    }
  },
  createTempFile: async (targetPath: string) => {
    const tempPath = join(dirname(targetPath), `.wenshu-${randomUUID()}.tmp`);
    const handle = await open(tempPath, 'wx');
    return {
      tempPath,
      write: (bytes: Uint8Array) => writeAllBytes(handle, bytes),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  replace: (tempPath: string, targetPath: string) => rename(tempPath, targetPath),
  removeTemp: async (tempPath: string) => {
    await rm(tempPath, { force: true });
  },
});

/** 稳定保存错误快捷构造。 */
function saveError(code: SaveTextDocumentErrorCode, message: string): SaveTextDocumentResult {
  return { status: 'error', error: { code, message } };
}

/** 校验 / 读取阶段的文件系统错误映射：EPERM 视为权限类。 */
function mapCheckFsError(err: unknown): SaveTextDocumentError | null {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return { code: 'NOT_FOUND', message: '文件不存在或已被移除' };
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return { code: 'ACCESS_DENIED', message: '没有写入权限' };
    }
  }
  return null;
}

/** 写入 / 替换阶段的文件系统错误映射：EPERM 多为 Windows 目标被占用等。 */
function mapWriteFsError(err: unknown): SaveTextDocumentError | null {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return { code: 'NOT_FOUND', message: '文件不存在或已被移除' };
    }
    if (nodeErr.code === 'EACCES') {
      return { code: 'ACCESS_DENIED', message: '没有写入权限' };
    }
  }
  return null;
}

function writeFailed(): SaveTextDocumentError {
  return { code: 'WRITE_FAILED', message: '写入文件失败' };
}

/** 校验相对路径格式：非空、`/` 分隔、无空段 / `.` / `..` / 反斜杠 / 空字符 / `:`。 */
function validateRelativePath(relativePath: unknown): string[] | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null;
  }
  if (
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.includes(':')
  ) {
    return null;
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  return segments;
}

/**
 * 把任意换行统一为指定风格。
 * 两遍替换是安全的：先把 `\r\n` 与独立 `\r` 统一为 `\n`，再按需把 `\n` 转为 `\r\n`，
 * 不会产生 `\r\r\n` 等畸形序列。
 */
export function normalizeLineEndings(content: string, style: 'lf' | 'crlf'): string {
  const lfNormalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return style === 'lf' ? lfNormalized : lfNormalized.replace(/\n/g, '\r\n');
}

/**
 * 混合换行确认后的规范化规则：dominant 风格（CR 系：`\r\n` + 独立 `\r`；LF 系：`\n`），
 * 出现次数多者胜出；平局取 CRLF（Windows 主平台约定）。
 */
export function dominantLineEnding(content: string): 'lf' | 'crlf' {
  let crStyle = 0;
  let lfStyle = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code === 0x0d) {
      crStyle += 1;
      if (i + 1 < content.length && content.charCodeAt(i + 1) === 0x0a) {
        i += 1;
      }
    } else if (code === 0x0a) {
      lfStyle += 1;
    }
  }
  return lfStyle > crStyle ? 'lf' : 'crlf';
}

/** 按 BOM 策略把正文编码为 UTF-8 字节。 */
function encodeUtf8(content: string, bom: boolean): Uint8Array {
  const textBytes = utf8Encoder.encode(content);
  if (!bom) {
    return textBytes;
  }
  const withBom = new Uint8Array(textBytes.byteLength + 3);
  withBom[0] = 0xef;
  withBom[1] = 0xbb;
  withBom[2] = 0xbf;
  withBom.set(textBytes, 3);
  return withBom;
}

/**
 * 在工作区边界内按安全写入协议保存一个 UTF-8 TXT 文件。
 *
 * @param workspaceRoot - 本次保存开始时捕获的工作区根路径（绝对路径）
 * @param request - 渲染进程提交的保存请求，必须作为不可信输入重新验证
 * @param adapters - 文件系统适配器，默认使用 `node:fs/promises`
 * @returns `saved` 新快照或稳定 `error`，任何情况下都不会抛出异常
 */
export async function saveTextDocument(
  workspaceRoot: string,
  request: SaveTextDocumentRequest,
  adapters: SaveTextAdapters = defaultSaveTextAdapters,
): Promise<SaveTextDocumentResult> {
  // 0. 请求形状校验：渲染进程数据不可信，入口必须执行运行时检查
  if (request === null || typeof request !== 'object') {
    return saveError('INVALID_REQUEST', '无效的保存请求');
  }
  if (
    typeof request.relativePath !== 'string' ||
    typeof request.content !== 'string' ||
    typeof request.expectedRevision !== 'string' ||
    request.expectedRevision.length === 0
  ) {
    return saveError('INVALID_REQUEST', '无效的保存请求');
  }
  if (
    request.confirmMixedLineEndingNormalization !== undefined &&
    request.confirmMixedLineEndingNormalization !== true
  ) {
    return saveError('INVALID_REQUEST', '无效的保存请求');
  }

  // 1. 已打开工作区：根路径必须存在且为绝对路径
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return saveError('NO_WORKSPACE', '尚未打开工作区');
  }

  // 2. 相对路径格式、扩展名与词法边界
  const segments = validateRelativePath(request.relativePath);
  if (segments === null) {
    return saveError('INVALID_PATH', '无效的文件相对路径');
  }
  if (extname(request.relativePath).toLowerCase() !== '.txt') {
    return saveError('UNSUPPORTED_TYPE', '仅支持保存 .txt 文本文件');
  }
  const candidate = join(workspaceRoot, ...segments);
  const lexicalRel = relative(workspaceRoot, candidate);
  if (lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || isAbsolute(lexicalRel)) {
    return saveError('OUTSIDE_WORKSPACE', '文件不在工作区内');
  }

  // 3. 从工作区根开始逐段 lstat：拒绝任一层符号链接 / junction，
  //    中间段必须是目录，最终段必须是普通文件
  let finalStat: FileStatLike | null = null;
  let current = workspaceRoot;
  try {
    for (let i = 0; i < segments.length; i += 1) {
      current = join(current, segments[i]!);
      const stat = await adapters.lstat(current);
      if (stat.isSymbolicLink()) {
        return saveError('NOT_FILE', '路径包含符号链接或 junction');
      }
      const isLast = i === segments.length - 1;
      if (isLast) {
        if (!stat.isFile()) {
          return saveError('NOT_FILE', '目标不是普通文件');
        }
        finalStat = stat;
      } else if (!stat.isDirectory()) {
        return saveError('NOT_FILE', '路径中间部分不是目录');
      }
    }
  } catch (err) {
    return { status: 'error', error: mapCheckFsError(err) ?? writeFailed() };
  }
  if (finalStat !== null && finalStat.size > MAX_TXT_FILE_BYTES) {
    return saveError('TOO_LARGE', '文件超过 5 MiB 上限');
  }

  // 4. 真实路径边界：工作区根与候选文件的真实路径必须保持一致边界
  try {
    const [realRoot, realCandidate] = await Promise.all([
      adapters.realpath(workspaceRoot),
      adapters.realpath(candidate),
    ]);
    const realRel = relative(realRoot, realCandidate);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      return saveError('OUTSIDE_WORKSPACE', '文件不在工作区内');
    }
  } catch (err) {
    return { status: 'error', error: mapCheckFsError(err) ?? writeFailed() };
  }

  // 5. 有界读取当前磁盘文件并检查预期内容版本；冲突时不创建任何临时文件
  let diskBytes: Uint8Array;
  try {
    diskBytes = await adapters.readDiskBytes(candidate);
  } catch (err) {
    return { status: 'error', error: mapCheckFsError(err) ?? writeFailed() };
  }
  if (diskBytes.byteLength > MAX_TXT_FILE_BYTES) {
    return saveError('TOO_LARGE', '文件超过 5 MiB 上限');
  }
  const diskRevision = createHash('sha256').update(diskBytes).digest('hex');
  if (diskRevision !== request.expectedRevision) {
    return saveError('CONFLICT', '文件已被外部修改，保存被拒绝');
  }

  // 6. 按原 BOM 策略与换行规则编码 UTF-8，大小检查必须在创建临时文件之前
  const diskHasBom = hasUtf8Bom(diskBytes);
  const lineEnding = detectLineEnding(request.content);
  let normalized: string;
  let savedLineEnding: LineEnding;
  if (lineEnding === 'mixed') {
    if (request.confirmMixedLineEndingNormalization !== true) {
      return saveError(
        'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
        '文件包含混合换行，需要确认规范化规则',
      );
    }
    const style = dominantLineEnding(request.content);
    normalized = normalizeLineEndings(request.content, style);
    savedLineEnding = style;
  } else {
    normalized = request.content;
    savedLineEnding = lineEnding;
  }
  const bytesToWrite = encodeUtf8(normalized, diskHasBom);
  if (bytesToWrite.byteLength > MAX_TXT_FILE_BYTES) {
    return saveError('TOO_LARGE', '文件超过 5 MiB 上限');
  }

  // 7-10. 同目录排他临时文件：完整写入 → 刷盘 → 关闭 → 替换
  let handle: TempWriteHandle | null = null;
  let tempPath: string | null = null;
  try {
    handle = await adapters.createTempFile(candidate);
    tempPath = handle.tempPath;
    await handle.write(bytesToWrite);
    await handle.sync();
    await handle.close();
    handle = null;
    await adapters.replace(tempPath, candidate);
  } catch (err) {
    // 尽力关闭句柄与清理临时文件；清理失败不覆盖主要错误
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
        // 只记录稳定错误码，不记录路径、正文、临时文件名或调用栈
        const code =
          cleanupErr instanceof Error ? (cleanupErr as NodeJS.ErrnoException).code : null;
        console.error(`wenshu: 清理临时文件失败${code === undefined ? '' : ` (${code})`}`);
      }
    }
    return { status: 'error', error: mapWriteFsError(err) ?? writeFailed() };
  }

  // 11. 基于实际保存字节生成新快照与内容版本
  const savedDocument: TextDocumentSnapshot = {
    name: basename(candidate),
    relativePath: segments.join('/'),
    content: normalized,
    byteLength: bytesToWrite.byteLength,
    revision: createHash('sha256').update(bytesToWrite).digest('hex'),
    hasUtf8Bom: diskHasBom,
    lineEnding: savedLineEnding,
  };
  return { status: 'saved', document: savedDocument };
}
