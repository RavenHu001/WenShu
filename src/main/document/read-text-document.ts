/**
 * UTF-8 TXT 文档读取器 —— 在工作区授权边界内受控读取普通文本文件。
 *
 * ## 校验顺序（与 TASK-003 第 6.2 节一致）
 *
 * 1. 确认已打开工作区（workspaceRoot 非空且为绝对路径）；
 * 2. 确认输入是符合格式要求的非空相对路径；
 * 3. 确认扩展名为大小写不敏感的 `.txt`；
 * 4. 以当前工作区根路径解析候选路径；
 * 5. 使用 `path.relative` 语义检查拒绝词法路径逃逸；
 * 6. 从工作区根目录开始逐段 lstat 检查，拒绝任一层符号链接 / junction，
 *    并确认中间段为目录、最终段为普通文件；
 * 7. 获取工作区根路径和候选文件的真实路径；
 * 8. 再次确认真实文件路径位于真实工作区根目录内；
 * 9. 在读取正文前检查文件大小不超过 5 MiB；
 * 10. 以最多 `5 MiB + 1 byte` 的有界方式读取，避免文件在预检查后增长导致无界内存分配；
 * 11. 再次确认实际读取长度不超过上限；
 * 12. 使用 fatal 模式严格解码 UTF-8；
 * 13. 返回文档快照，或把失败映射为稳定错误码。
 *
 * ## 安全边界
 *
 * - 使用 `node:fs/promises` 异步 API，全部为只读操作。
 * - 不调用任何写入、创建、重命名、删除或权限修改 API。
 * - 不记录正文，不把正文写入日志。
 * - 不向调用方暴露 `Error`、`Buffer`、`Stats`、文件句柄或调用栈。
 * - 所有预期与意外失败都转换为 `ReadTextDocumentResult`。
 *
 * ## 可测试性：函数参数注入
 *
 * 与 `scan-workspace.ts` 一致的轻量注入方式：`ReadTextAdapters` 提供
 * `lstat`、`realpath`、`readTextBytes` 三个文件系统适配函数，生产环境使用
 * `node:fs/promises` 默认实现，测试环境可注入 mock 以模拟权限错误、读取期间
 * 消失和文件增长等难以用真实文件系统稳定构造的场景。不引入 DI 容器或 IoC 框架。
 *
 * ## 已知限制
 *
 * 对本地进程恶意并发替换文件导致的操作系统级 TOCTOU 竞态，本任务只要求尽量
 * 缩小校验与读取窗口并保证只读，不实现平台原生句柄级防竞态方案。
 */

import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { lstat, open, realpath } from 'node:fs/promises';
import {
  MAX_TXT_FILE_BYTES,
  type ReadTextDocumentResult,
  type TextDocumentError,
  type TextDocumentSnapshot,
} from '../../shared/document';

/** 与 `fs.Stats` 语义一致的轻量接口，供测试 mock 使用。 */
export interface FileStatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
}

/** 文件系统适配函数集合；生产环境为 `node:fs/promises`，测试环境可注入 mock。 */
export interface ReadTextAdapters {
  /** 不跟随符号链接的条目状态查询。 */
  readonly lstat: (path: string) => Promise<FileStatLike>;
  /** 解析路径的最终真实路径（跟随全部符号链接 / junction）。 */
  readonly realpath: (path: string) => Promise<string>;
  /** 有界读取：最多返回 `MAX_TXT_FILE_BYTES + 1` 字节，调用方据此判定超限。 */
  readonly readTextBytes: (path: string) => Promise<Uint8Array>;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** 生产环境默认适配器：直接使用 `node:fs/promises`，全部为只读操作。 */
export const defaultReadTextAdapters: ReadTextAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  readTextBytes: async (path: string) => {
    const handle = await open(path, 'r');
    try {
      const buffer = new Uint8Array(MAX_TXT_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
});

/** 常见 POSIX 错误码 → 稳定错误码的映射；其余错误由调用方降级为 READ_FAILED。 */
function mapFsError(err: unknown): TextDocumentError | null {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return { code: 'NOT_FOUND', message: '文件不存在或已被移除' };
    }
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      return { code: 'ACCESS_DENIED', message: '没有读取权限' };
    }
  }
  return null;
}

function readFailed(): TextDocumentError {
  return { code: 'READ_FAILED', message: '读取文件失败' };
}

/**
 * 校验相对路径格式：
 * - 非空字符串，使用 `/` 分隔；
 * - 不得为空段、`.`、`..`、反斜杠、空字符或 `:`（Windows 盘符 / 盘符相对路径）；
 * - 不得以 `/` 开头（绝对路径形式）；
 * - 返回拆分后的段列表，校验失败返回 null。
 */
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
 * 在工作区边界内异步读取一个 UTF-8 TXT 文件。
 *
 * @param workspaceRoot - 本次读取开始时捕获的工作区根路径（绝对路径，不可信输入除外）
 * @param relativePath - 渲染进程提交的规范相对路径，必须作为不可信输入重新验证
 * @param adapters - 文件系统适配器，默认使用 `node:fs/promises`
 * @returns `loaded` 文档快照或稳定 `error`，任何情况下都不会抛出异常
 */
export async function readTextDocument(
  workspaceRoot: string,
  relativePath: string,
  adapters: ReadTextAdapters = defaultReadTextAdapters,
): Promise<ReadTextDocumentResult> {
  // 1. 已打开工作区：根路径必须存在且为绝对路径
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return { status: 'error', error: { code: 'NO_WORKSPACE', message: '尚未打开工作区' } };
  }

  // 2. 相对路径格式校验
  const segments = validateRelativePath(relativePath);
  if (segments === null) {
    return { status: 'error', error: { code: 'INVALID_PATH', message: '无效的文件相对路径' } };
  }

  // 3. 扩展名校验：大小写不敏感，只接受 `.txt`
  if (extname(relativePath).toLowerCase() !== '.txt') {
    return {
      status: 'error',
      error: { code: 'UNSUPPORTED_TYPE', message: '仅支持打开 .txt 文本文件' },
    };
  }

  // 4. 解析候选路径（相对路径已通过格式校验，join 结果即为规范绝对路径）
  const candidate = join(workspaceRoot, ...segments);

  // 5. 词法逃逸检查：拒绝任何落在工作区根目录之外的候选路径
  const lexicalRel = relative(workspaceRoot, candidate);
  if (lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || isAbsolute(lexicalRel)) {
    return {
      status: 'error',
      error: { code: 'OUTSIDE_WORKSPACE', message: '文件不在工作区内' },
    };
  }

  // 6. 从工作区根目录开始逐段 lstat：拒绝任一层符号链接 / junction，
  //    中间段必须是目录，最终段必须是普通文件
  let finalStat: FileStatLike | null = null;
  let current = workspaceRoot;
  try {
    for (let i = 0; i < segments.length; i += 1) {
      current = join(current, segments[i]!);
      const stat = await adapters.lstat(current);
      if (stat.isSymbolicLink()) {
        return {
          status: 'error',
          error: { code: 'NOT_FILE', message: '路径包含符号链接或 junction' },
        };
      }
      const isLast = i === segments.length - 1;
      if (isLast) {
        if (!stat.isFile()) {
          return {
            status: 'error',
            error: { code: 'NOT_FILE', message: '目标不是普通文件' },
          };
        }
        finalStat = stat;
      } else if (!stat.isDirectory()) {
        return {
          status: 'error',
          error: { code: 'NOT_FILE', message: '路径中间部分不是目录' },
        };
      }
    }
  } catch (err) {
    const mapped = mapFsError(err);
    return { status: 'error', error: mapped ?? readFailed() };
  }

  // 7-8. 真实路径检查：工作区根路径与候选文件的真实路径必须保持一致边界
  try {
    const [realRoot, realCandidate] = await Promise.all([
      adapters.realpath(workspaceRoot),
      adapters.realpath(candidate),
    ]);
    const realRel = relative(realRoot, realCandidate);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      return {
        status: 'error',
        error: { code: 'OUTSIDE_WORKSPACE', message: '文件不在工作区内' },
      };
    }
  } catch (err) {
    const mapped = mapFsError(err);
    return { status: 'error', error: mapped ?? readFailed() };
  }

  // 9. 读取前大小检查（基于逐段 lstat 得到的最终段状态）
  if (finalStat !== null && finalStat.size > MAX_TXT_FILE_BYTES) {
    return {
      status: 'error',
      error: { code: 'TOO_LARGE', message: '文件超过 5 MiB 上限' },
    };
  }

  // 10-11. 有界读取：最多读取 MAX_TXT_FILE_BYTES + 1 字节，再确认实际长度
  let bytes: Uint8Array;
  try {
    bytes = await adapters.readTextBytes(candidate);
  } catch (err) {
    const mapped = mapFsError(err);
    return { status: 'error', error: mapped ?? readFailed() };
  }
  if (bytes.byteLength > MAX_TXT_FILE_BYTES) {
    return {
      status: 'error',
      error: { code: 'TOO_LARGE', message: '文件超过 5 MiB 上限' },
    };
  }

  // 12. 严格 UTF-8 解码：fatal 模式，非法字节直接拒绝，不使用替换字符
  let content: string;
  try {
    content = utf8Decoder.decode(bytes);
  } catch {
    return {
      status: 'error',
      error: { code: 'INVALID_UTF8', message: '文件不是合法的 UTF-8 编码' },
    };
  }

  // UTF-8 BOM 不作为正文字符显示
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // 13. 返回只读快照
  const snapshot: TextDocumentSnapshot = {
    name: basename(candidate),
    relativePath: segments.join('/'),
    content,
    byteLength: bytes.byteLength,
  };
  return { status: 'loaded', document: snapshot };
}
