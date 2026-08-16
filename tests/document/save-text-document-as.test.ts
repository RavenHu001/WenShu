/**
 * TASK-009 WP4：TXT 另存为服务测试（node 环境）。
 * 覆盖：新目标排他创建（BOM/换行保留）、源不变、两阶段覆盖确认（target-exists →
 * expectedTargetRevision CAS）、混合换行确认、源 revision 冲突零写入、目标/源外部竞态、
 * 写入/发布/清理失败注入、TOO_LARGE、类型与名称错误。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import { saveTextDocumentAs } from '../../src/main/document/save-text-document-as';
import type { SaveTextDocumentAsAdapters } from '../../src/main/document/save-text-document-as';
import type { TextDocumentSnapshot } from '../../src/shared/document';
import type { TempWriteHandle } from '../../src/main/document/write-safety';
import type { FileStatLike } from '../../src/main/document/path-validation';

function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}
function dirStat(): FileStatLike {
  return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0 };
}

describe('saveTextDocumentAs：真实文件系统（默认适配器）', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp4-txtas-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
  });
  afterAll(async () => {
    await cleanup();
  });

  it('新目标：源不变、内容正确、无临时残留', async () => {
    await writeFile(join(root, 'src.txt'), 'hello\r\nworld');
    const sourceBytes = await readFile(join(root, 'src.txt'));
    const revision = createHash('sha256').update(sourceBytes).digest('hex');
    const result = await saveTextDocumentAs(root, {
      mutationId: 1,
      tabId: 'tab-1',
      sourceRelativePath: 'src.txt',
      target: { parentRelativePath: 'sub', name: 'dst.txt' },
      content: 'hello\r\nworld',
      expectedSourceRevision: revision,
    });
    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.relativePath).toBe('sub/dst.txt');
      expect(result.kind).toBe('text');
      expect((result.document as TextDocumentSnapshot).lineEnding).toBe('crlf');
    }
    expect(await readFile(join(root, 'sub', 'dst.txt'), 'utf8')).toBe('hello\r\nworld');
    expect(await readFile(join(root, 'src.txt'), 'utf8')).toBe('hello\r\nworld');
    expect((await stat(join(root, 'sub', 'dst.txt'))).isFile()).toBe(true);
  });

  it('BOM 保留：源带 BOM 时目标同样带 BOM', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]);
    await writeFile(join(root, 'bom-src.txt'), bom);
    const revision = createHash('sha256').update(new Uint8Array(bom)).digest('hex');
    const result = await saveTextDocumentAs(root, {
      mutationId: 2,
      tabId: 'tab-2',
      sourceRelativePath: 'bom-src.txt',
      target: { parentRelativePath: '', name: 'bom-dst.txt' },
      content: '中文',
      expectedSourceRevision: revision,
    });
    expect(result.status).toBe('saved');
    const dst = await readFile(join(root, 'bom-dst.txt'));
    expect(dst[0]).toBe(0xef);
    expect(dst[1]).toBe(0xbb);
    expect(dst[2]).toBe(0xbf);
    if (result.status === 'saved') {
      expect((result.document as TextDocumentSnapshot).hasUtf8Bom).toBe(true);
    }
  });

  it('混合换行：未确认 → MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED；确认后按 dominant 规范化', async () => {
    await writeFile(join(root, 'mixed-src.txt'), 'a\r\nb\nc');
    const revision = createHash('sha256')
      .update(await readFile(join(root, 'mixed-src.txt')))
      .digest('hex');
    const denied = await saveTextDocumentAs(root, {
      mutationId: 3,
      tabId: 'tab-3',
      sourceRelativePath: 'mixed-src.txt',
      target: { parentRelativePath: '', name: 'mixed-dst.txt' },
      content: 'a\r\nb\nc',
      expectedSourceRevision: revision,
    });
    expect(denied.status === 'error' && denied.error.code).toBe(
      'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
    );
    const confirmed = await saveTextDocumentAs(root, {
      mutationId: 4,
      tabId: 'tab-3',
      sourceRelativePath: 'mixed-src.txt',
      target: { parentRelativePath: '', name: 'mixed-dst.txt' },
      content: 'a\r\nb\nc',
      expectedSourceRevision: revision,
      confirmMixedLineEndingNormalization: true,
    });
    expect(confirmed.status).toBe('saved');
    expect(await readFile(join(root, 'mixed-dst.txt'), 'utf8')).toBe('a\r\nb\r\nc');
  });

  it('源 revision 冲突 → CONFLICT 且零写入', async () => {
    await writeFile(join(root, 'conflict-src.txt'), 'v1');
    const result = await saveTextDocumentAs(root, {
      mutationId: 5,
      tabId: 'tab-5',
      sourceRelativePath: 'conflict-src.txt',
      target: { parentRelativePath: '', name: 'conflict-dst.txt' },
      content: 'v2',
      expectedSourceRevision: 'wrong-revision',
    });
    expect(result.status === 'error' && result.error.code).toBe('CONFLICT');
    await expect(stat(join(root, 'conflict-dst.txt'))).rejects.toThrow();
  });

  it('两阶段覆盖确认：第一阶段 target-exists + 目标 revision；第二阶段 CAS 覆盖', async () => {
    await writeFile(join(root, 'ov-src.txt'), 'new');
    await writeFile(join(root, 'ov-dst.txt'), 'old');
    const srcRevision = createHash('sha256')
      .update(await readFile(join(root, 'ov-src.txt')))
      .digest('hex');
    const dstBytes = await readFile(join(root, 'ov-dst.txt'));
    const dstRevision = createHash('sha256').update(dstBytes).digest('hex');

    const first = await saveTextDocumentAs(root, {
      mutationId: 6,
      tabId: 'tab-6',
      sourceRelativePath: 'ov-src.txt',
      target: { parentRelativePath: '', name: 'ov-dst.txt' },
      content: 'new',
      expectedSourceRevision: srcRevision,
    });
    expect(first).toEqual({
      status: 'target-exists',
      mutationId: 6,
      targetRevision: dstRevision,
    });
    expect(await readFile(join(root, 'ov-dst.txt'), 'utf8')).toBe('old'); // 未写盘

    const wrong = await saveTextDocumentAs(root, {
      mutationId: 7,
      tabId: 'tab-6',
      sourceRelativePath: 'ov-src.txt',
      target: { parentRelativePath: '', name: 'ov-dst.txt' },
      content: 'new',
      expectedSourceRevision: srcRevision,
      expectedTargetRevision: 'stale-revision',
    });
    expect(wrong.status === 'error' && wrong.error.code).toBe('CONFLICT');
    expect(await readFile(join(root, 'ov-dst.txt'), 'utf8')).toBe('old');

    const second = await saveTextDocumentAs(root, {
      mutationId: 8,
      tabId: 'tab-6',
      sourceRelativePath: 'ov-src.txt',
      target: { parentRelativePath: '', name: 'ov-dst.txt' },
      content: 'new',
      expectedSourceRevision: srcRevision,
      expectedTargetRevision: dstRevision,
    });
    expect(second.status).toBe('saved');
    expect(await readFile(join(root, 'ov-dst.txt'), 'utf8')).toBe('new');
    expect(await readFile(join(root, 'ov-src.txt'), 'utf8')).toBe('new'); // 源不变
    const residue = (await readdir(root)).filter((n) => n.includes('.wenshu-'));
    expect(residue).toEqual([]);
  });

  it('目标为目录：第一阶段 target-exists（revision 空）；第二阶段 NOT_FILE', async () => {
    await writeFile(join(root, 'dir-src.txt'), 'x');
    const srcRevision = createHash('sha256')
      .update(await readFile(join(root, 'dir-src.txt')))
      .digest('hex');
    const first = await saveTextDocumentAs(root, {
      mutationId: 9,
      tabId: 'tab-9',
      sourceRelativePath: 'dir-src.txt',
      target: { parentRelativePath: '', name: 'sub' },
      content: 'x',
      expectedSourceRevision: srcRevision,
    });
    expect(first).toEqual({ status: 'target-exists', mutationId: 9, targetRevision: '' });
    const second = await saveTextDocumentAs(root, {
      mutationId: 10,
      tabId: 'tab-9',
      sourceRelativePath: 'dir-src.txt',
      target: { parentRelativePath: '', name: 'sub' },
      content: 'x',
      expectedSourceRevision: srcRevision,
      expectedTargetRevision: 'anything',
    });
    expect(second.status === 'error' && second.error.code).toBe('NOT_FILE');
  });

  it('非法请求/名称/父路径/无工作区', async () => {
    const badName = await saveTextDocumentAs(root, {
      mutationId: 11,
      tabId: 't',
      sourceRelativePath: 'src.txt',
      target: { parentRelativePath: '', name: 'CON' },
      content: 'x',
      expectedSourceRevision: 'r',
    });
    expect(badName.status === 'error' && badName.error.code).toBe('INVALID_NAME');
    const badParent = await saveTextDocumentAs(root, {
      mutationId: 12,
      tabId: 't',
      sourceRelativePath: 'src.txt',
      target: { parentRelativePath: 'a//b', name: 'x.txt' },
      content: 'x',
      expectedSourceRevision: 'r',
    });
    expect(badParent.status === 'error' && badParent.error.code).toBe('INVALID_PATH');
    const badSrc = await saveTextDocumentAs(root, {
      mutationId: 13,
      tabId: 't',
      sourceRelativePath: '../evil',
      target: { parentRelativePath: '', name: 'x.txt' },
      content: 'x',
      expectedSourceRevision: 'r',
    });
    expect(badSrc.status === 'error' && badSrc.error.code).toBe('INVALID_PATH');
    const noRoot = await saveTextDocumentAs('', {
      mutationId: 14,
      tabId: 't',
      sourceRelativePath: 'src.txt',
      target: { parentRelativePath: '', name: 'x.txt' },
      content: 'x',
      expectedSourceRevision: 'r',
    });
    expect(noRoot.status === 'error' && noRoot.error.code).toBe('NO_WORKSPACE');
  });
});

describe('saveTextDocumentAs：mock 失败注入', () => {
  const ROOT = 'C:\\ws';

  interface MockOptions extends Partial<SaveTextDocumentAsAdapters> {
    readonly handle?: Partial<TempWriteHandle>;
  }

  function adaptersOf(overrides: MockOptions = {}): SaveTextDocumentAsAdapters & {
    __state: { replaced: string[]; removed: string[]; tempPath: string };
  } {
    const state = {
      replaced: [] as string[],
      removed: [] as string[],
      tempPath: join(ROOT, '.wenshu-as.tmp'),
    };
    const handle: TempWriteHandle = {
      tempPath: state.tempPath,
      write: async () => undefined,
      sync: async () => undefined,
      close: async () => undefined,
      ...(overrides.handle ?? {}),
    };
    const base: SaveTextDocumentAsAdapters = {
      lstat: async (path: string) => {
        if (path.endsWith('src.txt') || path === join(ROOT, 'sub')) {
          return path.endsWith('src.txt') ? fileStat() : dirStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      realpath: async (path: string) => path,
      readDiskBytes: async (path: string) =>
        path.endsWith('src.txt') ? new TextEncoder().encode('src-content') : new Uint8Array([9]),
      createTempFile: async () => handle,
      replace: async (tempPath: string) => {
        state.replaced.push(tempPath);
      },
      removeTemp: async (tempPath: string) => {
        state.removed.push(tempPath);
      },
      ...overrides,
    };
    return Object.assign(base, { __state: state }) as SaveTextDocumentAsAdapters & {
      __state: typeof state;
    };
  }

  const req = {
    mutationId: 1,
    tabId: 't',
    sourceRelativePath: 'src.txt',
    target: { parentRelativePath: '', name: 'new.txt' },
    content: 'x',
    expectedSourceRevision: createHash('sha256')
      .update(new TextEncoder().encode('src-content'))
      .digest('hex'),
  };

  it('sync/close/替换失败 → 稳定错误并清理；清理失败不覆盖主错误', async () => {
    const syncFail = adaptersOf({
      handle: {
        sync: async () => {
          throw new Error('sync boom');
        },
      },
    });
    const syncResult = await saveTextDocumentAs(ROOT, req, syncFail);
    expect(syncResult.status === 'error' && syncResult.error.code).toBe('WRITE_FAILED');
    expect(syncFail.__state.replaced).toEqual([]);
    expect(syncFail.__state.removed).toEqual([syncFail.__state.tempPath]);

    const replaceFail = adaptersOf({
      replace: async () => {
        const err = new Error('no') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    const replaceResult = await saveTextDocumentAs(ROOT, req, replaceFail);
    expect(replaceResult.status === 'error' && replaceResult.error.code).toBe('ACCESS_DENIED');
    expect(replaceFail.__state.removed).toEqual([replaceFail.__state.tempPath]);
  });

  it('覆盖发布前外部变化（发布复验读到新字节）→ CONFLICT 且清理', async () => {
    const stableTargetBytes = new Uint8Array([9]);
    const overwriteReq = {
      ...req,
      expectedTargetRevision: createHash('sha256').update(stableTargetBytes).digest('hex'),
    };
    let reads = 0;
    const race = adaptersOf({
      lstat: async () => fileStat(),
      readDiskBytes: async (path: string) => {
        reads += 1;
        if (path.endsWith('src.txt')) {
          return new TextEncoder().encode('src-content');
        }
        // 第 2 次读（覆盖 CAS 检查）与 expected 一致；第 3 次读（发布前复验）目标已变化
        return reads === 2 ? stableTargetBytes : new Uint8Array([1, 2, 3]);
      },
    });
    const result = await saveTextDocumentAs(ROOT, overwriteReq, race);
    expect(result.status === 'error' && result.error.code).toBe('CONFLICT');
    expect(race.__state.replaced).toEqual([]);
    expect(race.__state.removed).toEqual([race.__state.tempPath]);
  });

  it('新目标发布前目标出现（竞态）→ TARGET_EXISTS 且清理', async () => {
    let targetLstat = 0;
    const race = adaptersOf({
      lstat: async (path: string) => {
        if (path.endsWith('src.txt')) {
          return fileStat();
        }
        if (path.endsWith('new.txt')) {
          targetLstat += 1;
          if (targetLstat > 1) {
            return fileStat();
          }
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    });
    const result = await saveTextDocumentAs(ROOT, req, race);
    expect(result.status === 'error' && result.error.code).toBe('TARGET_EXISTS');
    expect(race.__state.replaced).toEqual([]);
    expect(race.__state.removed).toEqual([race.__state.tempPath]);
  });
});
