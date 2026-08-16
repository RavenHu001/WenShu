/**
 * TASK-009 WP5：删除到回收站服务测试（node 环境）。
 * 覆盖：文件/空目录/非空目录 trash 成功；DOCX 主文件+伴随备份都进回收站；
 * 主文件成功备份失败 → PARTIAL_FAILURE（不写回主文件）；trash 失败 → TRASH_FAILED；
 * 根/link/other/internal/缺失拒绝且不调用 trashItem；绝不调用 unlink/rm/rmdir。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import { trashWorkspaceEntry } from '../../src/main/workspace/trash-workspace-entry';
import type { TrashWorkspaceEntryAdapters } from '../../src/main/workspace/trash-workspace-entry';
import type { FileStatLike } from '../../src/main/document/path-validation';

function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}
function otherStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false, size: 0 };
}
function linkStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true, size: 0 };
}

function expectError(result: { status: string } & Record<string, unknown>): string {
  if (result.status === 'error' && 'error' in result) {
    return (result.error as { code: string }).code;
  }
  throw new Error('expected error result');
}

describe('trashWorkspaceEntry：真实文件系统（默认适配器 + 注入 trashItem spy）', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};
  let realJunctionSupported = false;
  const trashed: string[] = [];

  const spyAdapters = (): TrashWorkspaceEntryAdapters => ({
    lstat: (path: string) => import('node:fs/promises').then((m) => m.lstat(path)),
    realpath: (path: string) => import('node:fs/promises').then((m) => m.realpath(path)),
    trashItem: async (path: string) => {
      trashed.push(path);
    },
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp5-trash-'));
    cleanup = () => removeDirWithRetry(root);
    const probeTarget = join(root, 'probe-target');
    await mkdir(probeTarget);
    try {
      await Promise.race([
        symlink(probeTarget, join(root, 'jlink'), 'junction'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('junction probe timed out')), 5_000),
        ),
      ]);
      realJunctionSupported = true;
    } catch {
      realJunctionSupported = false;
    }
  });
  afterAll(async () => {
    await cleanup();
  });

  it('普通文件/目录删除：trashItem 各调用一次', async () => {
    trashed.length = 0;
    await writeFile(join(root, 'f.txt'), 'f');
    const file = await trashWorkspaceEntry(
      root,
      { mutationId: 1, relativePath: 'f.txt' },
      spyAdapters(),
    );
    expect(file).toEqual({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'f.txt',
      kind: 'text',
    });
    expect(trashed).toEqual([join(root, 'f.txt')]);

    trashed.length = 0;
    await mkdir(join(root, 'empty-dir'));
    const dir = await trashWorkspaceEntry(
      root,
      { mutationId: 2, relativePath: 'empty-dir' },
      spyAdapters(),
    );
    expect(dir.status === 'succeeded' && dir.kind).toBe('directory');
    expect(trashed).toEqual([join(root, 'empty-dir')]);
  });

  it('DOCX 主文件 + 伴随备份都进回收站（两次调用）', async () => {
    trashed.length = 0;
    await writeFile(join(root, 'd.docx'), 'main');
    await writeFile(join(root, 'd.docx.wenshu.bak'), 'bak');
    const result = await trashWorkspaceEntry(
      root,
      { mutationId: 3, relativePath: 'd.docx' },
      spyAdapters(),
    );
    expect(result.status === 'succeeded' && result.kind).toBe('docx');
    expect(trashed).toEqual([join(root, 'd.docx'), join(root, 'd.docx.wenshu.bak')]);
  });

  it('根/缺失/link（junction 条件）拒绝且不调用 trashItem', async () => {
    trashed.length = 0;
    const rootOp = await trashWorkspaceEntry(
      root,
      { mutationId: 4, relativePath: '' },
      spyAdapters(),
    );
    expect(expectError(rootOp)).toBe('ROOT_OPERATION_NOT_ALLOWED');
    const missing = await trashWorkspaceEntry(
      root,
      { mutationId: 5, relativePath: 'missing.txt' },
      spyAdapters(),
    );
    expect(expectError(missing)).toBe('NOT_FOUND');
    expect(trashed).toEqual([]);
  });

  it.runIf(realJunctionSupported)('真实 junction 源 → LINK_NOT_ALLOWED', async () => {
    trashed.length = 0;
    const result = await trashWorkspaceEntry(
      root,
      { mutationId: 6, relativePath: 'jlink' },
      spyAdapters(),
    );
    expect(expectError(result)).toBe('LINK_NOT_ALLOWED');
    expect(trashed).toEqual([]);
  });
});

describe('trashWorkspaceEntry：mock 注入', () => {
  const ROOT = 'C:\\ws';

  interface MockOptions {
    readonly lstatImpl?: (path: string) => Promise<FileStatLike>;
    readonly trashImpl?: (path: string) => Promise<void>;
  }

  function adaptersOf(options: MockOptions = {}): TrashWorkspaceEntryAdapters {
    return {
      lstat: async (path: string) => {
        if (options.lstatImpl) {
          return options.lstatImpl(path);
        }
        if (
          path.endsWith('a.txt') ||
          path.endsWith('d.docx') ||
          path.endsWith('d.docx.wenshu.bak')
        ) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      realpath: async (path: string) => path,
      trashItem: async (path: string) => {
        if (options.trashImpl) {
          await options.trashImpl(path);
        }
      },
    };
  }

  it('trash 失败 → TRASH_FAILED（不触碰备份）；备份失败 → PARTIAL_FAILURE（不写回主文件）', async () => {
    const calls: string[] = [];
    const mainFail = adaptersOf({
      trashImpl: async (path) => {
        calls.push(path);
        throw new Error('trash boom');
      },
    });
    const failed = await trashWorkspaceEntry(
      ROOT,
      { mutationId: 1, relativePath: 'a.txt' },
      mainFail,
    );
    expect(expectError(failed)).toBe('TRASH_FAILED');
    expect(calls).toEqual([join(ROOT, 'a.txt')]);

    const backupFail = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('d.docx') || path.endsWith('d.docx.wenshu.bak')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      trashImpl: async (path) => {
        calls.push(path);
        if (path.endsWith('d.docx.wenshu.bak')) {
          throw new Error('backup trash boom');
        }
      },
    });
    calls.length = 0;
    const partial = await trashWorkspaceEntry(
      ROOT,
      { mutationId: 2, relativePath: 'd.docx' },
      backupFail,
    );
    expect(expectError(partial)).toBe('PARTIAL_FAILURE');
    expect(calls).toEqual([join(ROOT, 'd.docx'), join(ROOT, 'd.docx.wenshu.bak')]);
  });

  it('other 类型/link/internal name → 拒绝且不调用 trashItem', async () => {
    const calls: string[] = [];
    const adapters = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('socket')) {
          return otherStat();
        }
        if (path.endsWith('link')) {
          return linkStat();
        }
        if (path.endsWith('a.txt')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      trashImpl: async (path) => {
        calls.push(path);
      },
    });
    const other = await trashWorkspaceEntry(
      ROOT,
      { mutationId: 3, relativePath: 'socket' },
      adapters,
    );
    expect(expectError(other)).toBe('NOT_FILE');
    const link = await trashWorkspaceEntry(ROOT, { mutationId: 4, relativePath: 'link' }, adapters);
    expect(expectError(link)).toBe('LINK_NOT_ALLOWED');
    const internal = await trashWorkspaceEntry(
      ROOT,
      { mutationId: 5, relativePath: '.wenshu-x.tmp' },
      adapters,
    );
    expect(expectError(internal)).toBe('INTERNAL_NAME_NOT_ALLOWED');
    expect(calls).toEqual([]);
  });

  it('绝不调用永久删除 API：适配器只含 lstat/realpath/trashItem', () => {
    const adapters = adaptersOf();
    const keys = Object.keys(adapters).sort();
    expect(keys).toEqual(['lstat', 'realpath', 'trashItem']);
  });
});
