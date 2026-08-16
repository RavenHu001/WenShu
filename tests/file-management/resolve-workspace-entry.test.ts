/**
 * TASK-009 WP2：主进程源/目标路径安全解析测试（node 环境）。
 * 覆盖：现有文件/现有目录/目标父目录（根 ''）逐段校验、不存在目标、真实 junction
 * 拒绝、realpath 边界、类型错误、internal name、大小写冲突（真实 FS 大小写不敏感）、
 * mock 适配器注入（链接/权限/realpath 逃逸/未知错误）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import {
  resolveExistingWorkspaceDirectory,
  resolveExistingWorkspaceFile,
  resolveNonExistingWorkspaceTarget,
  resolveWorkspaceParentDirectory,
  type WorkspaceEntryAdapters,
} from '../../src/main/workspace/resolve-workspace-entry';
import type { FileStatLike } from '../../src/main/document/path-validation';

/* ======================= 测试工具 ======================= */

function fileStat(size = 1): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size };
}

function dirStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0 };
}

function linkStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true, size: 0 };
}

/** 有界 junction 探测（与既有测试一致）：超时/失败按"环境不支持"处理。 */
async function junctionSupported(): Promise<boolean> {
  const probeDir = await mkdtemp(join(tmpdir(), 'wenshu-wp2-junction-probe-'));
  try {
    const target = join(probeDir, 'target');
    await mkdir(target);
    await Promise.race([
      symlink(target, join(probeDir, 'alias'), 'junction'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('junction probe timed out')), 5_000),
      ),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    await removeDirWithRetry(probeDir);
  }
}

/* ======================= 真实文件系统（默认适配器） ======================= */

describe('真实文件系统解析（默认适配器）', () => {
  let root = '';
  let realJunctionSupported = false;
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    realJunctionSupported = await junctionSupported();
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp2-resolve-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
    await mkdir(join(root, 'empty-dir'));
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'Case.txt'), 'case');
    await writeFile(join(root, 'sub', 'b.txt'), 'b');
    await writeFile(join(root, 'sub', '.wenshu-temp.tmp'), 'temp');
    await writeFile(join(root, 'a.docx.wenshu.bak'), 'bak');
  });
  it('现有文件：根/嵌套/普通文件通过，缺失/目录/路径穿越/绝对路径拒绝', async () => {
    const ok = await resolveExistingWorkspaceFile(root, 'a.txt');
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.candidate.endsWith('a.txt')).toBe(true);
      expect(ok.segments).toEqual(['a.txt']);
    }
    const nested = await resolveExistingWorkspaceFile(root, 'sub/b.txt');
    expect(nested.status).toBe('ok');
    const missing = await resolveExistingWorkspaceFile(root, 'nope.txt');
    expect(missing.status === 'error' && missing.error.code).toBe('NOT_FOUND');
    const dirAsFile = await resolveExistingWorkspaceFile(root, 'sub');
    expect(dirAsFile.status === 'error' && dirAsFile.error.code).toBe('NOT_FILE');
    const fileAsMid = await resolveExistingWorkspaceFile(root, 'a.txt/x.txt');
    expect(fileAsMid.status === 'error' && fileAsMid.error.code).toBe('NOT_DIRECTORY');
    const traversal = await resolveExistingWorkspaceFile(root, '../x.txt');
    expect(traversal.status === 'error' && traversal.error.code).toBe('INVALID_PATH');
    const abs = await resolveExistingWorkspaceFile(root, 'C:/x.txt');
    expect(abs.status === 'error' && abs.error.code).toBe('INVALID_PATH');
    const empty = await resolveExistingWorkspaceFile(root, '');
    expect(empty.status === 'error' && empty.error.code).toBe('INVALID_PATH');
  });

  it('现有目录：普通目录通过；根空串与文件目标拒绝', async () => {
    const ok = await resolveExistingWorkspaceDirectory(root, 'sub');
    expect(ok.status).toBe('ok');
    const rootOp = await resolveExistingWorkspaceDirectory(root, '');
    expect(rootOp.status === 'error' && rootOp.error.code).toBe('ROOT_OPERATION_NOT_ALLOWED');
    const fileAsDir = await resolveExistingWorkspaceDirectory(root, 'a.txt');
    expect(fileAsDir.status === 'error' && fileAsDir.error.code).toBe('NOT_DIRECTORY');
    const missing = await resolveExistingWorkspaceDirectory(root, 'missing');
    expect(missing.status === 'error' && missing.error.code).toBe('NOT_FOUND');
  });

  it('目标父目录：根父目录空串显式支持；多级父目录逐段校验', async () => {
    const rootParent = await resolveWorkspaceParentDirectory(root, '');
    expect(rootParent.status).toBe('ok');
    if (rootParent.status === 'ok') {
      expect(rootParent.candidate).toBe(root);
      expect(rootParent.segments).toEqual([]);
    }
    const nested = await resolveWorkspaceParentDirectory(root, 'sub');
    expect(nested.status).toBe('ok');
    if (nested.status === 'ok') {
      expect(nested.candidate.endsWith('sub')).toBe(true);
    }
    const missing = await resolveWorkspaceParentDirectory(root, 'no-such/x');
    expect(missing.status === 'error' && missing.error.code).toBe('NOT_FOUND');
    const fileParent = await resolveWorkspaceParentDirectory(root, 'a.txt/x');
    expect(fileParent.status === 'error' && fileParent.error.code).toBe('NOT_DIRECTORY');
  });

  it('不存在目标：叶缺失 ok；存在（含大小写别名）→ TARGET_EXISTS', async () => {
    const fresh = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: '',
      name: 'new.txt',
    });
    expect(fresh.status).toBe('ok');
    if (fresh.status === 'ok') {
      expect(fresh.candidate.endsWith('new.txt')).toBe(true);
      expect(fresh.parentRelativePath).toBe('');
    }
    const nested = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: 'sub',
      name: 'new.txt',
    });
    expect(nested.status).toBe('ok');
    if (nested.status === 'ok') {
      expect(nested.parentRelativePath).toBe('sub');
    }
    const exists = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: '',
      name: 'a.txt',
    });
    expect(exists.status === 'error' && exists.error.code).toBe('TARGET_EXISTS');
    // 大小写冲突：真实 Windows FS 大小写不敏感（WP0 实测：写 A.txt 覆盖 a.txt）
    const caseAlias = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: '',
      name: 'case.txt',
    });
    expect(caseAlias.status === 'error' && caseAlias.error.code).toBe('TARGET_EXISTS');
    const parentMissing = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: 'no-such',
      name: 'x.txt',
    });
    expect(parentMissing.status === 'error' && parentMissing.error.code).toBe('NOT_FOUND');
  });

  it('internal name 一律拒绝（含父目录段）', async () => {
    const leaf = await resolveNonExistingWorkspaceTarget(root, {
      parentRelativePath: '',
      name: '.wenshu-abc.tmp',
    });
    expect(leaf.status === 'error' && leaf.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
    const leafBak = await resolveExistingWorkspaceFile(root, 'a.docx.wenshu.bak');
    expect(leafBak.status === 'error' && leafBak.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
    const mid = await resolveExistingWorkspaceFile(root, 'sub/.wenshu-temp.tmp');
    expect(mid.status === 'error' && mid.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
  });

  it.runIf(realJunctionSupported)(
    '真实 junction：现有文件/目录/父目录/不存在目标全部拒绝 LINK_NOT_ALLOWED',
    async () => {
      const junction = join(root, 'jlink');
      await symlink(join(root, 'sub'), junction, 'junction');
      try {
        const file = await resolveExistingWorkspaceFile(root, 'jlink/b.txt');
        expect(file.status === 'error' && file.error.code).toBe('LINK_NOT_ALLOWED');
        const dir = await resolveExistingWorkspaceDirectory(root, 'jlink');
        expect(dir.status === 'error' && dir.error.code).toBe('LINK_NOT_ALLOWED');
        const parent = await resolveWorkspaceParentDirectory(root, 'jlink');
        expect(parent.status === 'error' && parent.error.code).toBe('LINK_NOT_ALLOWED');
        const target = await resolveNonExistingWorkspaceTarget(root, {
          parentRelativePath: 'jlink',
          name: 'new.txt',
        });
        expect(target.status === 'error' && target.error.code).toBe('LINK_NOT_ALLOWED');
      } finally {
        await removeDirWithRetry(junction);
      }
    },
  );

  it('无工作区根/相对根：NO_WORKSPACE', async () => {
    const noRoot = await resolveExistingWorkspaceFile('', 'a.txt');
    expect(noRoot.status === 'error' && noRoot.error.code).toBe('NO_WORKSPACE');
    const relRoot = await resolveExistingWorkspaceFile('relative/root', 'a.txt');
    expect(relRoot.status === 'error' && relRoot.error.code).toBe('NO_WORKSPACE');
  });

  afterAll(async () => {
    await cleanup();
  });
});

/* ======================= mock 适配器（确定性失败注入） ======================= */

describe('mock 适配器解析', () => {
  const ROOT = 'C:\\ws';
  const adaptersOf = (
    lstatImpl: (path: string) => Promise<FileStatLike>,
    realpathImpl?: (path: string) => Promise<string>,
  ): WorkspaceEntryAdapters => ({
    lstat: lstatImpl,
    realpath: realpathImpl ?? (async (path: string) => path),
  });

  it('最终段/中间段 symlink → LINK_NOT_ALLOWED（不跟随）', async () => {
    const finalLink = await resolveExistingWorkspaceFile(
      ROOT,
      'link.txt',
      adaptersOf(async () => linkStat()),
    );
    expect(finalLink.status === 'error' && finalLink.error.code).toBe('LINK_NOT_ALLOWED');
    const midLink = await resolveExistingWorkspaceFile(
      ROOT,
      'linkdir/a.txt',
      adaptersOf(async (path) => (path.endsWith('linkdir') ? linkStat() : fileStat())),
    );
    expect(midLink.status === 'error' && midLink.error.code).toBe('LINK_NOT_ALLOWED');
    const dirLink = await resolveExistingWorkspaceDirectory(
      ROOT,
      'linkdir',
      adaptersOf(async () => linkStat()),
    );
    expect(dirLink.status === 'error' && dirLink.error.code).toBe('LINK_NOT_ALLOWED');
  });

  it('realpath 越界 → OUTSIDE_WORKSPACE', async () => {
    const escaped = await resolveExistingWorkspaceFile(
      ROOT,
      'a.txt',
      adaptersOf(
        async () => fileStat(),
        async (path) => (path === ROOT ? ROOT : 'C:\\outside\\evil.txt'),
      ),
    );
    expect(escaped.status === 'error' && escaped.error.code).toBe('OUTSIDE_WORKSPACE');
    const dirEscaped = await resolveExistingWorkspaceDirectory(
      ROOT,
      'sub',
      adaptersOf(
        async () => dirStat(),
        async (path) => (path === ROOT ? ROOT : 'C:\\outside\\evil-dir'),
      ),
    );
    expect(dirEscaped.status === 'error' && dirEscaped.error.code).toBe('OUTSIDE_WORKSPACE');
    const parentEscaped = await resolveWorkspaceParentDirectory(
      ROOT,
      'sub',
      adaptersOf(
        async () => dirStat(),
        async (path) => (path === ROOT ? ROOT : 'C:\\outside\\evil-dir'),
      ),
    );
    expect(parentEscaped.status === 'error' && parentEscaped.error.code).toBe('OUTSIDE_WORKSPACE');
  });

  it('权限/未知错误 → ACCESS_DENIED / FS_FAILED', async () => {
    const denied = await resolveExistingWorkspaceFile(
      ROOT,
      'a.txt',
      adaptersOf(async () => {
        const err = new Error('no') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }),
    );
    expect(denied.status === 'error' && denied.error.code).toBe('ACCESS_DENIED');
    const unknown = await resolveExistingWorkspaceFile(
      ROOT,
      'a.txt',
      adaptersOf(async () => {
        throw new Error('boom');
      }),
    );
    expect(unknown.status === 'error' && unknown.error.code).toBe('FS_FAILED');
  });

  it('不存在目标：lstat ENOENT → ok；存在 → TARGET_EXISTS', async () => {
    const adapters = adaptersOf(async () => {
      const err = new Error('missing') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    const ok = await resolveNonExistingWorkspaceTarget(
      ROOT,
      { parentRelativePath: '', name: 'new.txt' },
      adapters,
    );
    expect(ok.status).toBe('ok');
    const exists = await resolveNonExistingWorkspaceTarget(
      ROOT,
      { parentRelativePath: '', name: 'a.txt' },
      adaptersOf(async () => fileStat()),
    );
    expect(exists.status === 'error' && exists.error.code).toBe('TARGET_EXISTS');
  });

  it('非法名称/内部名称在触碰文件系统前拒绝（适配器不调用）', async () => {
    let lstatCalls = 0;
    const adapters = adaptersOf(async () => {
      lstatCalls += 1;
      return fileStat();
    });
    const badName = await resolveNonExistingWorkspaceTarget(
      ROOT,
      { parentRelativePath: '', name: 'CON' },
      adapters,
    );
    expect(badName.status === 'error' && badName.error.code).toBe('INVALID_NAME');
    const internal = await resolveNonExistingWorkspaceTarget(
      ROOT,
      { parentRelativePath: '', name: '.wenshu-x.tmp' },
      adapters,
    );
    expect(internal.status === 'error' && internal.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
    expect(lstatCalls).toBe(0);
  });

  it('根父目录空串不触碰文件系统（零段校验语义）', async () => {
    let calls = 0;
    const adapters: WorkspaceEntryAdapters = {
      lstat: async () => {
        calls += 1;
        return fileStat();
      },
      realpath: async () => {
        calls += 1;
        return '';
      },
    };
    const parent = await resolveWorkspaceParentDirectory(ROOT, '', adapters);
    expect(parent.status).toBe('ok');
    expect(calls).toBe(0);
  });
});
