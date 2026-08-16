/**
 * TASK-009 WP3：reveal（资源管理器显示）服务测试。
 * 覆盖：文件/目录/工作区根显示一次且路径正确；缺失/链接/非法路径/internal name
 * 拒绝且不调用 shell；showItemInFolder 抛错 → REVEAL_FAILED；无工作区。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import {
  revealWorkspaceEntry,
  type RevealWorkspaceEntryAdapters,
} from '../../src/main/workspace/reveal-workspace-entry';
import type { FileStatLike } from '../../src/main/document/path-validation';

const ROOT = 'C:\\ws';
function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}
function dirStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0 };
}
function linkStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true, size: 0 };
}

function adaptersOf(
  lstatImpl: (path: string) => Promise<FileStatLike>,
  show: (path: string) => void,
): RevealWorkspaceEntryAdapters {
  return { lstat: lstatImpl, realpath: async (path: string) => path, showItemInFolder: show };
}

describe('revealWorkspaceEntry', () => {
  it('文件/目录/工作区根：各调用一次固定 showItemInFolder 且路径正确', async () => {
    const shown: string[] = [];
    const file = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'a.txt' },
      adaptersOf(
        async (path) =>
          path.endsWith('a.txt') ? fileStat() : Promise.reject(new Error('unexpected')),
        (path) => shown.push(path),
      ),
    );
    expect(file).toEqual({ status: 'revealed' });
    expect(shown).toEqual([join(ROOT, 'a.txt')]);

    shown.length = 0;
    const dir = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'sub' },
      adaptersOf(
        async (path) =>
          path.endsWith('sub') ? dirStat() : Promise.reject(new Error('unexpected')),
        (path) => shown.push(path),
      ),
    );
    expect(dir).toEqual({ status: 'revealed' });
    expect(shown).toEqual([join(ROOT, 'sub')]);

    shown.length = 0;
    const rootReveal = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: true },
      adaptersOf(
        async () => Promise.reject(new Error('root must not lstat')),
        (path) => shown.push(path),
      ),
    );
    expect(rootReveal).toEqual({ status: 'revealed' });
    expect(shown).toEqual([ROOT]);
  });

  it('缺失/链接/非法路径/internal name → 稳定错误且不调用 shell', async () => {
    const shown: string[] = [];
    const missing = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'nope.txt' },
      adaptersOf(
        async () => {
          const err = new Error('missing') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        },
        (path) => shown.push(path),
      ),
    );
    expect(missing.status === 'error' && missing.error.code).toBe('NOT_FOUND');

    const linked = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'link.txt' },
      adaptersOf(
        async () => linkStat(),
        (path) => shown.push(path),
      ),
    );
    expect(linked.status === 'error' && linked.error.code).toBe('LINK_NOT_ALLOWED');

    const invalid = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: '../x' },
      adaptersOf(
        async () => fileStat(),
        (path) => shown.push(path),
      ),
    );
    expect(invalid.status === 'error' && invalid.error.code).toBe('INVALID_PATH');

    const internal = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: '.wenshu-x.tmp' },
      adaptersOf(
        async () => fileStat(),
        (path) => shown.push(path),
      ),
    );
    expect(internal.status === 'error' && internal.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
    expect(shown).toEqual([]);
  });

  it('showItemInFolder 抛错 → REVEAL_FAILED；无工作区 → NO_WORKSPACE；多余字段 → INVALID_REQUEST', async () => {
    const failed = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'a.txt' },
      adaptersOf(
        async () => fileStat(),
        () => {
          throw new Error('shell boom');
        },
      ),
    );
    expect(failed.status === 'error' && failed.error.code).toBe('REVEAL_FAILED');

    const noRoot = await revealWorkspaceEntry(
      '',
      { revealRoot: true },
      adaptersOf(
        async () => fileStat(),
        () => undefined,
      ),
    );
    expect(noRoot.status === 'error' && noRoot.error.code).toBe('NO_WORKSPACE');

    const extra = await revealWorkspaceEntry(
      ROOT,
      { revealRoot: false, relativePath: 'a.txt', shell: 'openPath' },
      adaptersOf(
        async () => fileStat(),
        () => undefined,
      ),
    );
    expect(extra.status === 'error' && extra.error.code).toBe('INVALID_REQUEST');
  });
});

describe('revealWorkspaceEntry：真实文件系统（默认适配器，注入 shell spy）', () => {
  let root = '';
  let realJunctionSupported = false;
  let cleanup = async (): Promise<void> => {};
  const shown: string[] = [];
  const spyAdapters = (): RevealWorkspaceEntryAdapters => ({
    lstat: (path: string) => import('node:fs/promises').then((m) => m.lstat(path)),
    realpath: (path: string) => import('node:fs/promises').then((m) => m.realpath(path)),
    showItemInFolder: (path: string) => shown.push(path),
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp3-reveal-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'a.txt'), 'a');
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

  it('真实文件：显示候选绝对路径一次', async () => {
    const result = await revealWorkspaceEntry(
      root,
      { revealRoot: false, relativePath: 'a.txt' },
      spyAdapters(),
    );
    expect(result).toEqual({ status: 'revealed' });
    expect(shown).toEqual([join(root, 'a.txt')]);
  });

  it.runIf(realJunctionSupported)('真实 junction：LINK_NOT_ALLOWED 且不调用 shell', async () => {
    shown.length = 0;
    const result = await revealWorkspaceEntry(
      root,
      { revealRoot: false, relativePath: 'jlink' },
      spyAdapters(),
    );
    expect(result.status === 'error' && result.error.code).toBe('LINK_NOT_ALLOWED');
    expect(shown).toEqual([]);
  });
});
