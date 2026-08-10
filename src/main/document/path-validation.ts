/**
 * 工作区文件路径安全校验内部 helper —— TXT 与 DOCX 读取/保存共用（TASK-007 WP2 提取）。
 *
 * 只被主进程 document / docx 模块导入，不暴露给 preload 或 renderer；
 * 不提供任何"按任意路径解析文件"的通用能力，全部校验都绑定工作区根。
 *
 * ## 语义（与 TASK-003 第 6.2 节逐段校验一致，行为与既有 TXT 读取器完全相同）
 *
 * 1. 相对路径格式校验（`/` 分隔、无空段 / `.` / `..` / 反斜杠 / 空字符 / `:`）；
 * 2. 词法逃逸检查（`path.relative` 语义，拒绝落在工作区根之外的候选路径）；
 * 3. 从工作区根逐段 lstat：拒绝任一层符号链接 / junction，中间段必须是目录、
 *    最终段必须是普通文件；
 * 4. 真实路径边界检查：工作区根与候选文件的 realpath 必须保持同一边界；
 * 5. 文件系统错误映射为稳定错误码（ENOENT / EACCES / EPERM / 其余）。
 *
 * 错误消息与既有 TXT 读取器逐字一致（测试按消息断言处保持兼容）。
 */

import { isAbsolute, join, relative, sep } from 'node:path';

/** 与 `fs.Stats` 语义一致的轻量接口，供测试 mock 使用。 */
export interface FileStatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
}

/** 路径校验阶段的稳定错误码（消息与 TXT 读取器一致）。 */
export type WorkspacePathErrorCode =
  'INVALID_PATH' | 'OUTSIDE_WORKSPACE' | 'NOT_FILE' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'READ_FAILED';

/** 可序列化的路径校验错误，已剥离原始异常与调用栈。 */
export interface WorkspacePathError {
  readonly code: WorkspacePathErrorCode;
  readonly message: string;
}

/** 路径校验所需的文件系统适配函数。 */
export interface WorkspacePathAdapters {
  /** 不跟随符号链接的条目状态查询。 */
  readonly lstat: (path: string) => Promise<FileStatLike>;
  /** 解析路径的最终真实路径（跟随全部符号链接 / junction）。 */
  readonly realpath: (path: string) => Promise<string>;
}

/** 常见 POSIX 错误码 → 稳定错误码的映射；其余错误由调用方降级为 READ_FAILED。 */
function mapPathFsError(err: unknown): WorkspacePathError | null {
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

/**
 * 校验相对路径格式：
 * - 非空字符串，使用 `/` 分隔；
 * - 不得为空段、`.`、`..`、反斜杠、空字符或 `:`（Windows 盘符 / 盘符相对路径）；
 * - 不得以 `/` 开头（绝对路径形式）；
 * - 返回拆分后的段列表，校验失败返回 null。
 */
export function validateRelativePath(relativePath: unknown): string[] | null {
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

/** 路径解析结果：成功返回候选绝对路径、段列表与最终段状态。 */
export type ResolveWorkspaceTargetResult =
  | {
      readonly status: 'ok';
      /** 候选绝对路径（段已通过全部校验）。 */
      readonly candidate: string;
      /** 校验后的规范相对路径段。 */
      readonly segments: readonly string[];
      /** 最终段 lstat 状态（已确认为普通文件）。 */
      readonly finalStat: FileStatLike;
    }
  | { readonly status: 'error'; readonly error: WorkspacePathError };

function pathError(code: WorkspacePathErrorCode, message: string): WorkspacePathError {
  return { code, message };
}

/**
 * 在工作区边界内解析并校验目标文件：
 * 相对路径格式 → 扩展名无关的边界校验（扩展名由调用方按文件类型检查）→
 * 逐段 lstat（拒绝符号链接 / junction）→ 真实路径边界。
 * 调用方必须先确认工作区根为绝对路径（`NO_WORKSPACE` 由调用方处理）。
 */
export async function resolveWorkspaceTarget(
  workspaceRoot: string,
  relativePath: string,
  adapters: WorkspacePathAdapters,
): Promise<ResolveWorkspaceTargetResult> {
  const segments = validateRelativePath(relativePath);
  if (segments === null) {
    return { status: 'error', error: pathError('INVALID_PATH', '无效的文件相对路径') };
  }

  const candidate = join(workspaceRoot, ...segments);
  const lexicalRel = relative(workspaceRoot, candidate);
  if (lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || isAbsolute(lexicalRel)) {
    return { status: 'error', error: pathError('OUTSIDE_WORKSPACE', '文件不在工作区内') };
  }

  let finalStat: FileStatLike | null = null;
  let current = workspaceRoot;
  try {
    for (let i = 0; i < segments.length; i += 1) {
      current = join(current, segments[i]!);
      const stat = await adapters.lstat(current);
      if (stat.isSymbolicLink()) {
        return {
          status: 'error',
          error: pathError('NOT_FILE', '路径包含符号链接或 junction'),
        };
      }
      const isLast = i === segments.length - 1;
      if (isLast) {
        if (!stat.isFile()) {
          return { status: 'error', error: pathError('NOT_FILE', '目标不是普通文件') };
        }
        finalStat = stat;
      } else if (!stat.isDirectory()) {
        return {
          status: 'error',
          error: pathError('NOT_FILE', '路径中间部分不是目录'),
        };
      }
    }
  } catch (err) {
    const mapped = mapPathFsError(err);
    return { status: 'error', error: mapped ?? pathError('READ_FAILED', '读取文件失败') };
  }

  try {
    const [realRoot, realCandidate] = await Promise.all([
      adapters.realpath(workspaceRoot),
      adapters.realpath(candidate),
    ]);
    const realRel = relative(realRoot, realCandidate);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      return { status: 'error', error: pathError('OUTSIDE_WORKSPACE', '文件不在工作区内') };
    }
  } catch (err) {
    const mapped = mapPathFsError(err);
    return { status: 'error', error: mapped ?? pathError('READ_FAILED', '读取文件失败') };
  }

  return { status: 'ok', candidate, segments, finalStat: finalStat! };
}

/** `FileHandle.read` 的最小只读契约，便于确定性测试短读。 */
export interface ReadableFileHandle {
  readonly read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ readonly bytesRead: number }>;
}

/**
 * 循环读取直至 EOF 或达到 `maxBytes` 的硬上限。
 * 单次 `FileHandle.read` 允许短读，因此不能把一次返回不足误判为 EOF。
 */
export async function readBoundedBytes(
  handle: ReadableFileHandle,
  maxBytes: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(maxBytes);
  let totalBytesRead = 0;

  while (totalBytesRead < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      totalBytesRead,
      buffer.byteLength - totalBytesRead,
      totalBytesRead,
    );
    if (bytesRead === 0) {
      break;
    }
    totalBytesRead += bytesRead;
  }

  return buffer.subarray(0, totalBytesRead);
}
