/**
 * TASK-009 WP3：新建服务测试（node 环境）。
 * 覆盖：真实 FS 排他新建 TXT/DOCX/文件夹、DOCX 产物重导入验证、无临时残留；
 * 冲突（含大小写别名）、非法名称/父路径、internal name、无工作区；
 * mock 适配器注入：临时文件创建/写入/sync/close/发布/清理失败、发布前父目录竞态
 * （目标在发布时刻出现 → TARGET_EXISTS）、DOCX 生成/验证失败、mkdir 冲突/权限。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import {
  createWorkspaceEntry,
  type CreateWorkspaceEntryAdapters,
} from '../../src/main/workspace/create-workspace-entry';
import { inspectDocxPackage } from '../../src/main/docx/inspect-docx-package';
import { importDocxDocument } from '../../src/main/docx/import-docx';
import type { FileStatLike } from '../../src/main/document/path-validation';
import type { TempWriteHandle } from '../../src/main/document/write-safety';

const ROOT = 'C:\\ws';

function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}

function dirStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0 };
}

function enoent(): never {
  const err = new Error('missing') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  throw err;
}

interface MockState {
  written: number[];
  synced: boolean;
  closed: boolean;
  replaced: string[];
  removed: string[];
  tempPath: string;
}

function tempHandle(state: MockState, overrides: Partial<TempWriteHandle> = {}): TempWriteHandle {
  return {
    tempPath: state.tempPath,
    write: async (bytes) => {
      state.written.push(...bytes);
    },
    sync: async () => {
      state.synced = true;
    },
    close: async () => {
      state.closed = true;
    },
    ...overrides,
  };
}

/** mock 选项：适配器覆盖 + 测试专用（发布竞态、临时句柄覆盖）。 */
interface MockOptions extends Partial<CreateWorkspaceEntryAdapters> {
  readonly appearAtPublish?: boolean;
  readonly handle?: Partial<TempWriteHandle>;
}

/** 基础 mock 适配器：父目录存在、目标缺失；可覆盖任意失败点。 */
function mockAdapters(overrides: MockOptions = {}): {
  adapters: CreateWorkspaceEntryAdapters;
  state: MockState;
} {
  const state: MockState = {
    written: [],
    synced: false,
    closed: false,
    replaced: [],
    removed: [],
    tempPath: join(ROOT, '.wenshu-create.tmp'),
  };
  let candidateLstatCalls = 0;
  const base: CreateWorkspaceEntryAdapters = {
    lstat: async (path: string) => {
      if (path === join(ROOT, 'sub')) {
        return dirStat();
      }
      if (path === join(ROOT, 'sub', 'new.txt') || path === join(ROOT, 'new.txt')) {
        candidateLstatCalls += 1;
        if (candidateLstatCalls > 1) {
          // 发布前复验时目标出现（父目录竞态）
          if (overrides.appearAtPublish) {
            return fileStat();
          }
        }
        enoent();
      }
      enoent();
    },
    realpath: async (path: string) => path,
    mkdir: async () => undefined,
    createTempFile: async () => tempHandle(state, overrides.handle),
    replace: async (tempPath: string) => {
      state.replaced.push(tempPath);
    },
    removeTemp: async (tempPath: string) => {
      state.removed.push(tempPath);
    },
    generateDocx: async () => new Uint8Array([1, 2, 3]),
    verifyGenerated: async () => ({
      ok: true,
      compatibility: { level: 'supported', warnings: [] },
    }),
    ...overrides,
  };
  return { adapters: base, state };
}

describe('createWorkspaceEntry：真实文件系统（默认适配器）', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp3-create-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'Case.txt'), 'case');
  });
  afterAll(async () => {
    await cleanup();
  });

  it('根目录新建 TXT：0 字节空 UTF-8、无临时残留', async () => {
    const result = await createWorkspaceEntry(root, {
      mutationId: 1,
      kind: 'text',
      parentRelativePath: '',
      name: 'a.txt',
    });
    expect(result).toEqual({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'a.txt',
      kind: 'text',
    });
    const bytes = await readFile(join(root, 'a.txt'));
    expect(bytes.byteLength).toBe(0);
    const residue = (await readdir(root)).filter((name) => name.includes('.wenshu-'));
    expect(residue).toEqual([]);
  });

  it('子目录新建 TXT 与文件夹；多级父目录逐段校验', async () => {
    const text = await createWorkspaceEntry(root, {
      mutationId: 2,
      kind: 'text',
      parentRelativePath: 'sub',
      name: 'b.txt',
    });
    expect(text.status).toBe('succeeded');
    if (text.status === 'succeeded') {
      expect(text.relativePath).toBe('sub/b.txt');
    }
    const dir = await createWorkspaceEntry(root, {
      mutationId: 3,
      kind: 'directory',
      parentRelativePath: '',
      name: 'new-dir',
    });
    expect(dir.status).toBe('succeeded');
    const dirStatInfo = await stat(join(root, 'new-dir'));
    expect(dirStatInfo.isDirectory()).toBe(true);
  });

  it('新建 DOCX：导出 → 验证 → 重导入成功（supported，至少一个空段落）', async () => {
    const result = await createWorkspaceEntry(root, {
      mutationId: 4,
      kind: 'docx',
      parentRelativePath: '',
      name: 'blank.docx',
    });
    expect(result.status).toBe('succeeded');
    const bytes = new Uint8Array(await readFile(join(root, 'blank.docx')));
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const inspection = await inspectDocxPackage(bytes);
    expect(inspection.status).toBe('ok');
    if (inspection.status === 'ok') {
      const imported = await importDocxDocument(bytes, inspection.inspection);
      expect(imported.status).toBe('ok');
      if (imported.status === 'ok') {
        expect(imported.model.blocks.length).toBeGreaterThanOrEqual(1);
        expect(imported.compatibility.level).toBe('supported');
      }
    }
    expect((await readdir(root)).filter((name) => name.includes('.wenshu-'))).toEqual([]);
  });

  it('冲突：已存在文件/目录/大小写别名 → TARGET_EXISTS，不覆盖', async () => {
    const exists = await createWorkspaceEntry(root, {
      mutationId: 5,
      kind: 'text',
      parentRelativePath: '',
      name: 'a.txt',
    });
    expect(exists.status === 'error' && exists.error.code).toBe('TARGET_EXISTS');
    const dirExists = await createWorkspaceEntry(root, {
      mutationId: 6,
      kind: 'directory',
      parentRelativePath: '',
      name: 'sub',
    });
    expect(dirExists.status === 'error' && dirExists.error.code).toBe('TARGET_EXISTS');
    // 大小写别名（WP0 实测：写 A.txt 覆盖 a.txt → 必须以排他创建判定冲突）
    const caseAlias = await createWorkspaceEntry(root, {
      mutationId: 7,
      kind: 'text',
      parentRelativePath: '',
      name: 'case.txt',
    });
    expect(caseAlias.status === 'error' && caseAlias.error.code).toBe('TARGET_EXISTS');
    // 目标未被覆盖
    expect(await readFile(join(root, 'Case.txt'), 'utf8')).toBe('case');
  });

  it('非法名称/父路径/internal name/无工作区/多余字段', async () => {
    const badName = await createWorkspaceEntry(root, {
      mutationId: 8,
      kind: 'text',
      parentRelativePath: '',
      name: 'CON',
    });
    expect(badName.status === 'error' && badName.error.code).toBe('INVALID_NAME');
    const badParent = await createWorkspaceEntry(root, {
      mutationId: 9,
      kind: 'text',
      parentRelativePath: 'a//b',
      name: 'x.txt',
    });
    expect(badParent.status === 'error' && badParent.error.code).toBe('INVALID_PATH');
    const internal = await createWorkspaceEntry(root, {
      mutationId: 10,
      kind: 'text',
      parentRelativePath: '',
      name: '.wenshu-x.tmp',
    });
    expect(internal.status === 'error' && internal.error.code).toBe('INTERNAL_NAME_NOT_ALLOWED');
    const noRoot = await createWorkspaceEntry('', {
      mutationId: 11,
      kind: 'text',
      parentRelativePath: '',
      name: 'x.txt',
    });
    expect(noRoot.status === 'error' && noRoot.error.code).toBe('NO_WORKSPACE');
    const extra = await createWorkspaceEntry(root, {
      mutationId: 12,
      kind: 'text',
      parentRelativePath: '',
      name: 'x.txt',
      force: true,
    });
    expect(extra.status === 'error' && extra.error.code).toBe('INVALID_REQUEST');
  });

  it('父目录缺失 → NOT_FOUND（不隐式递归创建）', async () => {
    const missing = await createWorkspaceEntry(root, {
      mutationId: 13,
      kind: 'directory',
      parentRelativePath: 'no-such-dir',
      name: 'x',
    });
    expect(missing.status === 'error' && missing.error.code).toBe('NOT_FOUND');
  });
});

describe('createWorkspaceEntry：mock 适配器失败注入', () => {
  it('TXT：临时文件写入 → sync → close → 发布前复验 → replace 全链路成功', async () => {
    const { adapters, state } = mockAdapters();
    const result = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 1,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      adapters,
    );
    expect(result.status).toBe('succeeded');
    expect(state.synced).toBe(true);
    expect(state.closed).toBe(true);
    expect(state.replaced).toEqual([state.tempPath]);
    expect(state.removed).toEqual([]);
  });

  it('DOCX：生成字节完整写入并发布；验证失败 → VERIFICATION_FAILED 且无发布', async () => {
    const { adapters: okAdapters, state: okState } = mockAdapters();
    const docx = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 2,
        kind: 'docx',
        parentRelativePath: '',
        name: 'b.docx',
      },
      okAdapters,
    );
    expect(docx.status).toBe('succeeded');
    expect(okState.written).toEqual([1, 2, 3]);
    expect(okState.replaced).toEqual([okState.tempPath]);

    const { adapters: badAdapters, state: badState } = mockAdapters({
      verifyGenerated: async () => ({ ok: false }),
    });
    const failed = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 3,
        kind: 'docx',
        parentRelativePath: '',
        name: 'c.docx',
      },
      badAdapters,
    );
    expect(failed.status === 'error' && failed.error.code).toBe('VERIFICATION_FAILED');
    expect(badState.replaced).toEqual([]);
    expect(badState.removed).toEqual([]); // 验证失败发生在临时文件创建前
  });

  it('DOCX 生成失败 → EXPORT_FAILED，不创建临时文件', async () => {
    const { adapters, state } = mockAdapters({
      generateDocx: async () => {
        throw new Error('generate boom');
      },
    });
    const result = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 4,
        kind: 'docx',
        parentRelativePath: '',
        name: 'd.docx',
      },
      adapters,
    );
    expect(result.status === 'error' && result.error.code).toBe('EXPORT_FAILED');
    expect(state.replaced).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it('sync/close/临时创建/替换失败 → 稳定错误并尽力清理', async () => {
    const { adapters: syncAdapters, state: syncState } = mockAdapters({
      handle: {
        sync: async () => {
          throw new Error('sync boom');
        },
      },
    });
    const syncResult = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 5,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      syncAdapters,
    );

    expect(syncResult.status === 'error' && syncResult.error.code).toBe('WRITE_FAILED');
    expect(syncState.replaced).toEqual([]);
    expect(syncState.removed).toEqual([syncState.tempPath]);

    const { adapters: closeAdapters, state: closeState } = mockAdapters({
      handle: {
        close: async () => {
          throw new Error('close boom');
        },
      },
    });
    const closeResult = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 6,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      closeAdapters,
    );

    expect(closeResult.status === 'error' && closeResult.error.code).toBe('WRITE_FAILED');
    expect(closeState.removed).toEqual([closeState.tempPath]);

    const { adapters: createAdapters, state: createState } = mockAdapters({
      createTempFile: async () => {
        throw new Error('create boom');
      },
    });
    const createResult = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 7,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      createAdapters,
    );

    expect(createResult.status === 'error' && createResult.error.code).toBe('WRITE_FAILED');
    expect(createState.replaced).toEqual([]);

    const { adapters: replaceAdapters, state: replaceState } = mockAdapters({
      replace: async () => {
        const err = new Error('no') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    const replaceResult = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 8,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      replaceAdapters,
    );

    expect(replaceResult.status === 'error' && replaceResult.error.code).toBe('ACCESS_DENIED');
    expect(replaceState.removed).toEqual([replaceState.tempPath]);
  });

  it('发布前目标出现（父目录竞态）→ TARGET_EXISTS，临时文件清理、不覆盖', async () => {
    const { adapters, state } = mockAdapters({ appearAtPublish: true });
    const result = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 9,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      adapters,
    );
    expect(result.status === 'error' && result.error.code).toBe('TARGET_EXISTS');
    expect(state.replaced).toEqual([]);
    expect(state.removed).toEqual([state.tempPath]);
  });

  it('清理失败不覆盖主要错误（sync 失败仍返回 WRITE_FAILED）', async () => {
    const { adapters } = mockAdapters({
      handle: {
        sync: async () => {
          throw new Error('sync boom');
        },
      },
      removeTemp: async () => {
        const err = new Error('cleanup') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    const result = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 10,
        kind: 'text',
        parentRelativePath: '',
        name: 'new.txt',
      },
      adapters,
    );
    expect(result.status === 'error' && result.error.code).toBe('WRITE_FAILED');
  });

  it('mkdir：EEXIST → TARGET_EXISTS；EACCES → ACCESS_DENIED', async () => {
    const { adapters: existAdapters } = mockAdapters({
      mkdir: async () => {
        const err = new Error('exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      },
    });
    const exists = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 11,
        kind: 'directory',
        parentRelativePath: '',
        name: 'd',
      },
      existAdapters,
    );
    expect(exists.status === 'error' && exists.error.code).toBe('TARGET_EXISTS');

    const { adapters: deniedAdapters } = mockAdapters({
      mkdir: async () => {
        const err = new Error('no') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    const access = await createWorkspaceEntry(
      ROOT,
      {
        mutationId: 12,
        kind: 'directory',
        parentRelativePath: '',
        name: 'd',
      },
      deniedAdapters,
    );
    expect(access.status === 'error' && access.error.code).toBe('ACCESS_DENIED');
  });
});
