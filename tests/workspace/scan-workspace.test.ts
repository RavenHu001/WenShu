/**
 * scanWorkspace 扫描器单元测试
 *
 * ## 测试策略
 *
 * 所有测试通过注入 mock `ReadDirFn` 完全隔离真实文件系统：
 * - `d(name)` / `f(name)` / `s(name)` / `o(name)` 创建轻量级 `DirEntry` 对象
 * - `createReadDir(map)` 根据路径→条目映射生成 mock 函数
 * - `p(relative)` 使用 `node:path.join` 拼接路径，保证跨平台兼容
 *
 * 不需要管理员权限、不创建真实文件、不依赖 `tmp` 目录。
 *
 * ## 覆盖范围（对应 TASK-002 第 8.1 节）
 *
 * - 空目录 → 空条目列表
 * - 嵌套目录 → 正确树结构与相对路径
 * - 目录在文件之前
 * - 同类名称自然排序稳定
 * - 文件不被当作目录递归
 * - 符号链接是叶节点，不跟随
 * - 未知类型是叶节点
 * - 子目录读取失败转为节点错误，保留兄弟条目
 * - 根目录读取失败抛出可识别异常
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  scanWorkspace,
  type DirEntry,
  type ReadDirFn,
} from '../../src/main/workspace/scan-workspace';

// ---- Mock 工厂函数 -----------------------------------------------------------

/** 创建模拟目录条目 */
function d(name: string): DirEntry {
  return { name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
}

/** 创建模拟普通文件条目 */
function f(name: string): DirEntry {
  return { name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
}

/** 创建模拟符号链接条目 */
function s(name: string): DirEntry {
  return { name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true };
}

/** 创建模拟"其他"类型条目（socket、设备等） */
function o(name: string): DirEntry {
  return { name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false };
}

/**
 * 基于路径映射创建 mock ReadDirFn。
 * - 路径存在于映射中 → 返回对应条目列表
 * - 路径不存在 → 抛出 ENOENT 错误（模拟真实 `fs.readdir` 行为）
 */
function createReadDir(map: Record<string, readonly DirEntry[]>): ReadDirFn {
  return async (absolutePath: string) => {
    const entries = map[absolutePath];
    if (entries === undefined) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${absolutePath}'`);
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    }
    return entries;
  };
}

// ---- 路径辅助 ----------------------------------------------------------------

/** 统一的工作区根路径，使用 `node:path.join` 保证跨平台 */
const root = join('/workspace');

/**
 * 拼接根路径和相对路径，与 `scan-workspace.ts` 内部 `join(rootPath, relativeDir)` 行为一致。
 */
function p(relative: string): string {
  return relative ? join(root, relative) : root;
}

// ---- 测试用例 ----------------------------------------------------------------

describe('scanWorkspace', () => {
  it('returns root name and path', async () => {
    const readDir = createReadDir({ [root]: [] });
    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.rootName).toBe('workspace');
    expect(snapshot.rootPath).toBe(root);
  });

  it('empty directory returns empty entries', async () => {
    const readDir = createReadDir({ [root]: [] });
    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toEqual([]);
  });

  it('nested directories generate correct tree structure and relative paths', async () => {
    const readDir = createReadDir({
      [root]: [d('a'), d('b')],
      [p('a')]: [f('a1.txt'), d('inner')],
      [p('a/inner')]: [f('x.txt')],
      [p('b')]: [],
    });

    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toHaveLength(2);

    const a = snapshot.entries[0]!;
    expect(a.name).toBe('a');
    expect(a.kind).toBe('directory');
    expect(a.relativePath).toBe('a');
    expect(a.children).toHaveLength(2);

    // 嵌套目录 'a/inner' 应在 a 的 children 中排在文件之前
    const inner = a.children![0]!;
    expect(inner.name).toBe('inner');
    expect(inner.kind).toBe('directory');
    expect(inner.relativePath).toBe('a/inner');
    expect(inner.children).toHaveLength(1);
    expect(inner.children![0]!.relativePath).toBe('a/inner/x.txt');

    const b = snapshot.entries[1]!;
    expect(b.name).toBe('b');
    expect(b.kind).toBe('directory');
    expect(b.relativePath).toBe('b');
    expect(b.children).toEqual([]);
  });

  it('sorts directories before files', async () => {
    const readDir = createReadDir({
      [root]: [f('z.txt'), d('a'), f('b.txt'), d('n')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toHaveLength(4);
    expect(snapshot.entries[0]!.kind).toBe('directory');
    expect(snapshot.entries[1]!.kind).toBe('directory');
    expect(snapshot.entries[2]!.kind).toBe('file');
    expect(snapshot.entries[3]!.kind).toBe('file');
  });

  it('sorts directory names naturally', async () => {
    // Intl.Collator numeric 排序：1 < 2 < 10，而非字典序的 '1' < '10' < '2'
    const readDir = createReadDir({
      [root]: [d('a10'), d('a2'), d('a1'), d('b')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    const names = snapshot.entries.map((e) => e.name);
    expect(names).toEqual(['a1', 'a2', 'a10', 'b']);
  });

  it('sorts file names naturally', async () => {
    const readDir = createReadDir({
      [root]: [f('z.txt'), f('a10.txt'), f('a2.txt'), f('a1.txt')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    const names = snapshot.entries.map((e) => e.name);
    expect(names).toEqual(['a1.txt', 'a2.txt', 'a10.txt', 'z.txt']);
  });

  it('files are leaf nodes without children', async () => {
    const readDir = createReadDir({
      [root]: [f('readme.txt')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toHaveLength(1);
    const entry = snapshot.entries[0]!;
    expect(entry.kind).toBe('file');
    // 文件节点不应具有 children 属性
    expect(entry.children).toBeUndefined();
  });

  it('symlinks are leaf nodes and not recursively followed', async () => {
    // 即使符号链接指向目录，扫描器也不应跟随
    const readDir = createReadDir({
      [root]: [s('link-to-dir')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toHaveLength(1);
    const entry = snapshot.entries[0]!;
    expect(entry.kind).toBe('symbolic-link');
    expect(entry.children).toBeUndefined();
  });

  it('unknown types are leaf nodes', async () => {
    // 非 file / directory / symlink 的条目（socket、FIFO 等）应作为 'other' 展示
    const readDir = createReadDir({
      [root]: [o('socket')],
    });

    const snapshot = await scanWorkspace(root, readDir);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]!.kind).toBe('other');
    expect(snapshot.entries[0]!.children).toBeUndefined();
  });

  it('subdirectory read failure converts to node error and preserves sibling entries', async () => {
    // 自定义 mock：对 'bad-dir' 抛出 EACCES，对其他路径正常返回
    function errorReadDir(absolutePath: string): Promise<readonly DirEntry[]> {
      if (absolutePath === p('bad-dir')) {
        const err = new Error('EACCES: permission denied, scandir');
        (err as NodeJS.ErrnoException).code = 'EACCES';
        throw err;
      }
      const map: Record<string, readonly DirEntry[]> = {
        [root]: [d('bad-dir'), f('ok.txt')],
      };
      const entries = map[absolutePath];
      if (!entries) {
        const err = new Error(`ENOENT: ${absolutePath}`);
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      return Promise.resolve(entries);
    }

    const snapshot = await scanWorkspace(root, errorReadDir);
    expect(snapshot.entries).toHaveLength(2);

    // bad-dir 是目录但读取失败 → 有 error 和空 children
    const badDir = snapshot.entries[0]!;
    expect(badDir.kind).toBe('directory');
    expect(badDir.error).toBeDefined();
    expect(badDir.error!.code).toBe('EACCES');
    expect(badDir.children).toEqual([]);

    // ok.txt 正常，不受 bad-dir 失败影响
    const okFile = snapshot.entries[1]!;
    expect(okFile.kind).toBe('file');
    expect(okFile.error).toBeUndefined();
  });

  it('root directory read failure throws a recognisable error', async () => {
    // 根目录不可读 → scanWorkspace 应抛出异常，由调用方（WP2 IPC 处理器）捕获
    const readDir: ReadDirFn = () => {
      const err = new Error('EACCES: permission denied, scandir');
      (err as NodeJS.ErrnoException).code = 'EACCES';
      throw err;
    };

    await expect(scanWorkspace(root, readDir)).rejects.toThrow('EACCES');
  });
});
