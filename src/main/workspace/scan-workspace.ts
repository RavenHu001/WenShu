/**
 * 工作区目录扫描器 —— 异步递归读取目录树，生成可序列化的只读快照。
 *
 * ## 设计决策
 *
 * ### 可测试性：函数参数注入
 * `scanWorkspace()` 接受可选的 `ReadDirFn` 参数。生产环境默认调用 `node:fs/promises.readdir`；
 * 测试环境传入 mock 函数，完全隔离文件系统。这里的"依赖注入"只有一层函数参数，不引入
 * DI 容器、装饰器或 IoC 框架。
 *
 * ### 错误隔离
 * - 根目录读取失败：直接抛出异常，由调用方（IPC 处理器，WP2）捕获并转换为 `OpenWorkspaceResult.error`。
 * - 子目录读取失败：在对应节点上设置 `error` 字段并保留空 `children`，同层其他条目不受影响。
 *
 * ### 安全边界
 * - 不读取文件内容。
 * - 不跟随符号链接 / junction。
 * - 不调用写入类 API。
 * - 不向调用方暴露 `Dirent`、`Stats` 等 Node.js 对象。
 *
 * ### 排序规则
 * 目录优先于所有其他类型；同类条目使用 `Intl.Collator` 自然排序（`a1 < a2 < a10`）。
 *
 * ### 路径约定
 * 内部使用 `node:path.join()` 拼接文件系统路径；`relativePath` 使用 `/` 分隔符，仅作为
 * 界面标识，不用于文件系统操作。
 */

import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  WorkspaceEntry,
  WorkspaceEntryError,
  WorkspaceSnapshot,
} from '../../shared/workspace';

/**
 * 轻量级目录条目接口 —— 提取自 `fs.Dirent` 中扫描器实际使用的方法。
 * 生产环境由 `readdir(..., { withFileTypes: true })` 提供；
 * 测试环境由 mock 对象实现。
 */
export interface DirEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** 异步读取目录项的函数签名。作为函数参数传递可实现测试隔离。 */
export type ReadDirFn = (path: string) => Promise<readonly DirEntry[]>;

/**
 * 将 `DirEntry` 分类为 WorkspaceEntryKind。
 * 优先级：directory > symbolic-link > file > other。
 * 符号链接在 directory 判断之后检查，因为有些文件系统可能同时报告 `isDirectory()` 和
 * `isSymbolicLink()` 为 true —— 这种情况下我们按 directory 处理以保持一致性。
 */
function classifyKind(entry: DirEntry): WorkspaceEntry['kind'] {
  if (entry.isDirectory()) {
    return 'directory';
  }
  if (entry.isSymbolicLink()) {
    return 'symbolic-link';
  }
  if (entry.isFile()) {
    return 'file';
  }
  return 'other';
}

/**
 * 将原始异常转换为可序列化的 `WorkspaceEntryError`。
 * 剥离 Node.js `ErrnoException` 对象引用，只保留 `code` 和 `message`。
 * 非 Error 类型（极少见）降级为字符串描述。
 */
function toWorkspaceError(err: unknown): WorkspaceEntryError {
  if (err instanceof Error) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code) {
      return { code: nodeErr.code, message: nodeErr.message };
    }
    return { message: nodeErr.message };
  }
  return { message: String(err) };
}

/**
 * 全局排序器：启用数字自然排序（如 `file2 < file10`）和大小写不敏感比较。
 * `Intl.Collator` 性能优于逐个调用 `localeCompare()`。
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * 对条目列表进行稳定排序：目录在前，其他在后，同类按名称自然排序。
 * 返回新数组，不修改原数组。
 */
function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  const directories = entries.filter((e) => e.kind === 'directory');
  const others = entries.filter((e) => e.kind !== 'directory');
  const compare = (a: WorkspaceEntry, b: WorkspaceEntry) => collator.compare(a.name, b.name);
  directories.sort(compare);
  others.sort(compare);
  return [...directories, ...others];
}

/**
 * 递归扫描单个目录。
 *
 * @param rootPath - 工作区根绝对路径，递归过程中保持不变
 * @param relativeDir - 当前目录相对于根目录的路径（根目录为空字符串 `""`）
 * @param readDirFn - 目录读取函数，生产环境为 `fs.promises.readdir`
 * @returns 排序后的条目列表
 *
 * 错误处理：
 * - 当前目录读取失败 → 异常向上传播（根目录则到 `scanWorkspace`，子目录则由父级 `catch` 捕获）
 * - 子目录读取失败 → 在对应目录节点上设置 `error` 字段，`children` 置为 `[]`
 */
async function scanDir(
  rootPath: string,
  relativeDir: string,
  readDirFn: ReadDirFn,
): Promise<readonly WorkspaceEntry[]> {
  // 根目录时 relativeDir 为空，absolutePath 即为 rootPath；
  // 子目录时用 join 拼接得到绝对路径用于文件系统读取
  const absolutePath = relativeDir ? join(rootPath, relativeDir) : rootPath;
  const rawEntries = await readDirFn(absolutePath);
  const results: WorkspaceEntry[] = [];

  for (const raw of rawEntries) {
    const kind = classifyKind(raw);
    // relativePath 使用 `/` 拼接，跨平台一致，仅作为 UI 标识
    const relativePath = relativeDir ? `${relativeDir}/${raw.name}` : raw.name;

    // 子目录需要递归扫描；非目录节点保持为叶节点，不设置 children
    let children: readonly WorkspaceEntry[] | undefined;
    let error: WorkspaceEntryError | undefined;

    if (kind === 'directory') {
      try {
        children = await scanDir(rootPath, relativePath, readDirFn);
      } catch (err) {
        // 子目录读取失败：记录错误但不中断同级其他条目的扫描
        error = toWorkspaceError(err);
        children = [];
      }
    }

    // 使用条件展开：`exactOptionalPropertyTypes` 要求可选属性要么存在（非 undefined），
    // 要么完全缺失。将 undefined 值直接放入对象字面量会触发 TS2379 错误。
    results.push({
      name: raw.name,
      relativePath,
      kind,
      ...(children !== undefined ? { children } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }

  return sortEntries(results);
}

/**
 * 扫描整个工作区目录，生成可序列化的只读快照。
 *
 * @param rootPath - 工作区根目录的绝对路径，由原生目录选择器（WP2）提供
 * @param readDirFn - 可选的文件系统读取适配器，默认使用 `node:fs/promises.readdir`
 * @returns 包含根目录信息、绝对路径和排序后条目树的快照
 *
 * @throws 根目录无法读取时抛出异常（如权限不足、路径不存在），
 *         调用方应捕获并转换为 `OpenWorkspaceResult.error`。
 *
 * ## 使用示例
 *
 * ```ts
 * // 生产环境
 * const snapshot = await scanWorkspace('/home/user/my-workspace');
 *
 * // 测试环境
 * const mockReadDir = createReadDir({ '/root': [d('a'), f('b')] });
 * const snapshot = await scanWorkspace('/root', mockReadDir);
 * ```
 */
export async function scanWorkspace(
  rootPath: string,
  readDirFn: ReadDirFn = (path) =>
    readdir(path, { withFileTypes: true }) as Promise<readonly DirEntry[]>,
): Promise<WorkspaceSnapshot> {
  // 从根目录（relativeDir = ''）启动递归扫描
  const entries = await scanDir(rootPath, '', readDirFn);

  return {
    rootName: basename(rootPath),
    rootPath,
    entries,
  };
}
