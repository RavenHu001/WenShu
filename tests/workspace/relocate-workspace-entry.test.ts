/**
 * TASK-009 WP5：重命名/移动服务测试（node 环境）。
 * 覆盖：文件/跨父目录/非空目录移动、只改大小写两步中间名、目录移入自身/后代拒绝、
 * 目标存在不覆盖、同路径 no-op、根/link/other/internal 拒绝、发布前竞态、
 * DOCX 伴随备份迁移/目标备份冲突/备份失败回滚/回滚失败 PARTIAL_FAILURE、
 * EXDEV 跨卷拒绝与权限错误。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import { relocateWorkspaceEntry } from '../../src/main/workspace/relocate-workspace-entry';
import type { RelocateWorkspaceEntryAdapters } from '../../src/main/workspace/relocate-workspace-entry';
import type { FileStatLike } from '../../src/main/document/path-validation';

function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}
function req(sourceRelativePath: string, parentRelativePath: string, name: string, mutationId = 1) {
  return { mutationId, sourceRelativePath, parentRelativePath, name };
}

function expectError(result: { status: string } & Record<string, unknown>): string {
  if (result.status === 'error' && 'error' in result) {
    return (result.error as { code: string }).code;
  }
  throw new Error('expected error result');
}

describe('relocateWorkspaceEntry：真实文件系统（默认适配器）', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};
  let realJunctionSupported = false;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp5-relocate-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
    await mkdir(join(root, 'dir-a'));
    await writeFile(join(root, 'dir-a', 'inner.txt'), 'inner');
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

  it('文件重命名（根 → 子目录跨父移动）：内容跟随、源消失', async () => {
    await writeFile(join(root, 'a.txt'), 'hello');
    const result = await relocateWorkspaceEntry(root, req('a.txt', 'sub', 'b.txt', 1));
    expect(result).toEqual({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'sub/b.txt',
      kind: 'text',
    });
    expect(await readFile(join(root, 'sub', 'b.txt'), 'utf8')).toBe('hello');
    await expect(stat(join(root, 'a.txt'))).rejects.toThrow();
  });

  it('非空目录移动：内容随迁', async () => {
    const result = await relocateWorkspaceEntry(root, req('dir-a', 'sub', 'dir-moved', 2));
    expect(result.status === 'succeeded' && result.kind).toBe('directory');
    expect(await readFile(join(root, 'sub', 'dir-moved', 'inner.txt'), 'utf8')).toBe('inner');
  });

  it('目录移入自身/后代 → DIRECTORY_INTO_DESCENDANT（预校验，不依赖 OS）', async () => {
    await mkdir(join(root, 'self'));
    const intoSelf = await relocateWorkspaceEntry(root, req('self', 'self', 'child', 3));
    expect(expectError(intoSelf)).toBe('DIRECTORY_INTO_DESCENDANT');
    const intoDesc = await relocateWorkspaceEntry(root, req('self', 'self', 'child', 4));
    expect(expectError(intoDesc)).toBe('DIRECTORY_INTO_DESCENDANT');
  });

  it('目标存在 → TARGET_EXISTS 不覆盖；同路径 → 安全无操作', async () => {
    await writeFile(join(root, 's.txt'), 's');
    await writeFile(join(root, 't.txt'), 't');
    const conflict = await relocateWorkspaceEntry(root, req('s.txt', '', 't.txt', 5));
    expect(expectError(conflict)).toBe('TARGET_EXISTS');
    expect(await readFile(join(root, 't.txt'), 'utf8')).toBe('t');
    expect(await readFile(join(root, 's.txt'), 'utf8')).toBe('s');
    const noop = await relocateWorkspaceEntry(root, req('s.txt', '', 's.txt', 6));
    expect(noop.status).toBe('succeeded');
  });

  it('只改大小写：文件与目录两步中间名成功，无 .wenshu-case- 残留', async () => {
    await writeFile(join(root, 'case.txt'), 'case-content');
    const fileResult = await relocateWorkspaceEntry(root, req('case.txt', '', 'CASE.TXT', 7));
    expect(fileResult.status).toBe('succeeded');
    if (fileResult.status === 'succeeded') {
      expect(fileResult.relativePath).toBe('CASE.TXT');
    }
    expect(await readFile(join(root, 'CASE.TXT'), 'utf8')).toBe('case-content');

    await mkdir(join(root, 'dirx'));
    const dirResult = await relocateWorkspaceEntry(root, req('dirx', '', 'DIRX', 8));
    expect(dirResult.status).toBe('succeeded');
    const residue = (await import('node:fs/promises').then((m) => m.readdir(root))).filter((n) =>
      n.startsWith('.wenshu-case-'),
    );
    expect(residue).toEqual([]);
  });

  it('根/缺失/internal name 拒绝；真实 junction → LINK_NOT_ALLOWED', async () => {
    const rootOp = await relocateWorkspaceEntry(root, req('', '', 'x', 9));
    expect(expectError(rootOp)).toBe('ROOT_OPERATION_NOT_ALLOWED');
    const missing = await relocateWorkspaceEntry(root, req('nope.txt', '', 'x.txt', 10));
    expect(expectError(missing)).toBe('NOT_FOUND');
    const internal = await relocateWorkspaceEntry(root, req('sub/.wenshu-x.tmp', '', 'y', 11));
    expect(expectError(internal)).toBe('INTERNAL_NAME_NOT_ALLOWED');
  });

  it.runIf(realJunctionSupported)('真实 junction 源 → LINK_NOT_ALLOWED', async () => {
    const result = await relocateWorkspaceEntry(root, req('jlink', '', 'x', 12));
    expect(expectError(result)).toBe('LINK_NOT_ALLOWED');
  });

  it('DOCX 伴随备份：主文件与备份一起迁移，备份字节不变', async () => {
    await writeFile(join(root, 'doc.docx'), 'doc-bytes');
    await writeFile(join(root, 'doc.docx.wenshu.bak'), 'bak-bytes');
    const result = await relocateWorkspaceEntry(root, req('doc.docx', 'sub', 'renamed.docx', 13));
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.kind).toBe('docx');
    }
    expect(await readFile(join(root, 'sub', 'renamed.docx'), 'utf8')).toBe('doc-bytes');
    expect(await readFile(join(root, 'sub', 'renamed.docx.wenshu.bak'), 'utf8')).toBe('bak-bytes');
    await expect(stat(join(root, 'doc.docx'))).rejects.toThrow();
  });

  it('DOCX 伴随备份：目标备份已存在 → TARGET_EXISTS，主文件未动', async () => {
    await writeFile(join(root, 'src2.docx'), 'main');
    await writeFile(join(root, 'src2.docx.wenshu.bak'), 'bak');
    await writeFile(join(root, 'dst2.docx.wenshu.bak'), 'existing-bak');
    const result = await relocateWorkspaceEntry(root, req('src2.docx', '', 'dst2.docx', 14));
    expect(expectError(result)).toBe('TARGET_EXISTS');
    expect(await readFile(join(root, 'src2.docx'), 'utf8')).toBe('main');
    expect(await readFile(join(root, 'src2.docx.wenshu.bak'), 'utf8')).toBe('bak');
  });
});

describe('relocateWorkspaceEntry：mock 失败注入', () => {
  const ROOT = 'C:\\ws';

  interface MockOptions {
    readonly lstatImpl?: (path: string, calls: Map<string, number>) => Promise<FileStatLike>;
    readonly renameImpl?: (from: string, to: string) => Promise<void>;
  }

  function adaptersOf(options: MockOptions = {}): RelocateWorkspaceEntryAdapters {
    const calls = new Map<string, number>();
    const lstat = async (path: string): Promise<FileStatLike> => {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      return options.lstatImpl
        ? options.lstatImpl(path, calls)
        : (() => {
            if (path.endsWith('src.txt') || path.endsWith('src.docx')) {
              return fileStat();
            }
            const err = new Error('missing') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          })();
    };
    return {
      lstat,
      realpath: async (path: string) => path,
      rename: async (from: string, to: string) => {
        if (options.renameImpl) {
          await options.renameImpl(from, to);
        }
      },
    };
  }

  it('case-only 第二步失败 → 回滚成功：源恢复、返回原错误', async () => {
    const calls: string[] = [];
    const adapters = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async (from, to) => {
        calls.push(`${from} -> ${to}`);
        if (to === join(ROOT, 'SRC.TXT')) {
          const err = new Error('boom') as NodeJS.ErrnoException;
          err.code = 'WRITE_FAILED';
          throw err;
        }
      },
    });
    const result = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'SRC.TXT', 1), adapters);
    // 第一步 src→temp；第二步 temp→SRC.TXT 失败；回滚 temp→src
    expect(calls.length).toBe(3);
    expect(calls[0]!.includes('src.txt')).toBe(true);
    expect(calls[0]!.includes('.wenshu-case-')).toBe(true);
    expect(calls[2]!.endsWith('-> ' + join(ROOT, 'src.txt'))).toBe(true);
    expect(expectError(result)).toBe('WRITE_FAILED');
  });

  it('case-only 回滚失败 → PARTIAL_FAILURE（第一步成功，第二步与回滚都失败）', async () => {
    let calls = 0;
    const adapters = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async () => {
        calls += 1;
        if (calls >= 2) {
          const err = new Error('boom') as NodeJS.ErrnoException;
          err.code = 'WRITE_FAILED';
          throw err;
        }
      },
    });
    const result = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'SRC.TXT', 2), adapters);
    expect(calls).toBe(3); // 第一步 + 第二步失败 + 回滚失败
    expect(expectError(result)).toBe('PARTIAL_FAILURE');
  });

  it('DOCX 备份迁移失败 → 回滚主文件成功：BACKUP_FAILED 且源恢复', async () => {
    const calls: string[] = [];
    const adapters = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.docx') || path.endsWith('src.docx.wenshu.bak')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async (from, to) => {
        calls.push(`${from} -> ${to}`);
        if (to.endsWith('dst.docx.wenshu.bak')) {
          const err = new Error('boom') as NodeJS.ErrnoException;
          err.code = 'WRITE_FAILED';
          throw err;
        }
      },
    });
    const result = await relocateWorkspaceEntry(ROOT, req('src.docx', '', 'dst.docx', 3), adapters);
    expect(calls.length).toBe(3);
    expect(calls[0]!.endsWith('-> ' + join(ROOT, 'dst.docx'))).toBe(true);
    expect(calls[1]!.endsWith('.wenshu.bak')).toBe(true);
    expect(calls[2]!.endsWith('-> ' + join(ROOT, 'src.docx'))).toBe(true); // 回滚
    expect(expectError(result)).toBe('BACKUP_FAILED');
  });

  it('DOCX 备份失败且主文件回滚失败 → PARTIAL_FAILURE', async () => {
    const adapters = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.docx') || path.endsWith('src.docx.wenshu.bak')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async (_from, to) => {
        if (!to.endsWith('dst.docx')) {
          const err = new Error('boom') as NodeJS.ErrnoException;
          err.code = 'WRITE_FAILED';
          throw err;
        }
      },
    });
    const result = await relocateWorkspaceEntry(ROOT, req('src.docx', '', 'dst.docx', 4), adapters);
    expect(expectError(result)).toBe('PARTIAL_FAILURE');
  });

  it('发布前复验：源消失 → NOT_FOUND；目标出现 → TARGET_EXISTS', async () => {
    let sourceLstat = 0;
    const gone = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          sourceLstat += 1;
          if (sourceLstat >= 2) {
            const err = new Error('missing') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          }
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    });
    const notFound = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'dst.txt', 5), gone);
    expect(expectError(notFound)).toBe('NOT_FOUND');

    let targetLstat = 0;
    const appeared = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        if (path.endsWith('dst.txt')) {
          targetLstat += 1;
          if (targetLstat > 1) {
            return fileStat(); // 发布前复验时目标出现
          }
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    });
    const conflict = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'dst.txt', 6), appeared);
    expect(expectError(conflict)).toBe('TARGET_EXISTS');
  });

  it('跨卷/权限错误 → CROSS_DEVICE_NOT_ALLOWED / ACCESS_DENIED', async () => {
    const exdev = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async () => {
        const err = new Error('cross') as NodeJS.ErrnoException;
        err.code = 'EXDEV';
        throw err;
      },
    });
    const cross = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'dst.txt', 7), exdev);
    expect(expectError(cross)).toBe('CROSS_DEVICE_NOT_ALLOWED');

    const denied = adaptersOf({
      lstatImpl: async (path) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      renameImpl: async () => {
        const err = new Error('no') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    const access = await relocateWorkspaceEntry(ROOT, req('src.txt', '', 'dst.txt', 8), denied);
    expect(expectError(access)).toBe('ACCESS_DENIED');
  });
});
