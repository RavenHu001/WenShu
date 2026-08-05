import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_TXT_FILE_BYTES,
  type SaveTextDocumentRequest,
  type SaveTextDocumentResult,
} from '../../src/shared/document';
import { readTextDocument } from '../../src/main/document/read-text-document';
import {
  defaultSaveTextAdapters,
  dominantLineEnding,
  normalizeLineEndings,
  saveTextDocument,
  writeAllBytes,
  type SaveTextAdapters,
  type TempWriteHandle,
} from '../../src/main/document/save-text-document';

/** 返回 error 结果时抛出，测试断言更直接。 */
function expectError(
  result: SaveTextDocumentResult,
): NonNullable<Extract<SaveTextDocumentResult, { status: 'error' }>['error']> {
  expect(result.status).toBe('error');
  if (result.status !== 'error') {
    throw new Error('unreachable');
  }
  return result.error;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** 通过真实读取器取得文件当前 revision。 */
async function revisionOf(workspaceRoot: string, relativePath: string): Promise<string> {
  const result = await readTextDocument(workspaceRoot, relativePath);
  expect(result.status).toBe('loaded');
  if (result.status !== 'loaded') {
    throw new Error('unreachable');
  }
  return result.document.revision;
}

/** 断言目录树中没有任何本任务临时文件残留。 */
async function expectNoTempLeftovers(workspaceRoot: string): Promise<void> {
  const entries = await readdir(workspaceRoot, { recursive: true });
  expect(entries.some((entry) => entry.includes('.wenshu-'))).toBe(false);
}

/** mock 临时句柄工厂：记录写入内容，可注入各步失败。 */
function makeMockHandle(
  overrides: Partial<TempWriteHandle> = {},
): TempWriteHandle & { readonly written: Uint8Array[] } {
  const written: Uint8Array[] = [];
  const handle: TempWriteHandle & { readonly written: Uint8Array[] } = {
    tempPath: join('mock', 'temp', 'wenshu-xxxx.tmp'),
    write: async (bytes: Uint8Array) => {
      written.push(bytes);
    },
    sync: async () => undefined,
    close: async () => undefined,
    written,
    ...overrides,
  };
  return handle;
}

function makeAdapters(overrides: Partial<SaveTextAdapters> = {}): SaveTextAdapters {
  return { ...defaultSaveTextAdapters, ...overrides };
}

describe('saveTextDocument 集成（真实文件系统）', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-saver-ws-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('根目录 TXT 正常保存：更新正文、快照字段与磁盘字节一致、无临时残留', async () => {
    await writeFile(join(workspaceRoot, 'hello.txt'), 'hello world');
    const revision = await revisionOf(workspaceRoot, 'hello.txt');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'hello.txt',
      content: 'hello wenshu\n第二行',
      expectedRevision: revision,
    });

    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.document.name).toBe('hello.txt');
      expect(result.document.relativePath).toBe('hello.txt');
      expect(result.document.content).toBe('hello wenshu\n第二行');
      expect(result.document.byteLength).toBe(Buffer.byteLength('hello wenshu\n第二行', 'utf8'));
      expect(result.document.lineEnding).toBe('lf');
      expect(result.document.hasUtf8Bom).toBe(false);
    }
    const disk = await readFile(join(workspaceRoot, 'hello.txt'));
    expect(Buffer.from(disk).equals(Buffer.from('hello wenshu\n第二行', 'utf8'))).toBe(true);
    await expectNoTempLeftovers(workspaceRoot);
  });

  it('嵌套目录 TXT 正常保存', async () => {
    await mkdir(join(workspaceRoot, 'sub', 'deep'), { recursive: true });
    await writeFile(join(workspaceRoot, 'sub', 'deep', 'inner.txt'), 'nested');
    const revision = await revisionOf(workspaceRoot, 'sub/deep/inner.txt');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'sub/deep/inner.txt',
      content: 'nested updated',
      expectedRevision: revision,
    });

    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.document.relativePath).toBe('sub/deep/inner.txt');
    }
    expect((await readFile(join(workspaceRoot, 'sub', 'deep', 'inner.txt'))).toString()).toBe(
      'nested updated',
    );
  });

  it('中文与空正文正确序列化', async () => {
    await writeFile(join(workspaceRoot, 'cjk.txt'), '中文原文');
    const revision = await revisionOf(workspaceRoot, 'cjk.txt');

    const saved = await saveTextDocument(workspaceRoot, {
      relativePath: 'cjk.txt',
      content: '中文\n新内容',
      expectedRevision: revision,
    });
    expect(saved.status).toBe('saved');
    if (saved.status === 'saved') {
      expect(saved.document.byteLength).toBe(Buffer.byteLength('中文\n新内容', 'utf8'));
    }

    const empty = await saveTextDocument(workspaceRoot, {
      relativePath: 'cjk.txt',
      content: '',
      expectedRevision: saved.status === 'saved' ? saved.document.revision : '',
    });
    expect(empty.status).toBe('saved');
    if (empty.status === 'saved') {
      expect(empty.document.byteLength).toBe(0);
      expect(empty.document.revision).toBe(await revisionOf(workspaceRoot, 'cjk.txt'));
    }
    expect((await readFile(join(workspaceRoot, 'cjk.txt'))).byteLength).toBe(0);
  });

  it('BOM 策略保留：原带 BOM 保存后仍带 BOM，原无 BOM 保存后仍无 BOM', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('原文')]);
    await writeFile(join(workspaceRoot, 'bom.txt'), bom);
    const bomRevision = await revisionOf(workspaceRoot, 'bom.txt');

    const withBom = await saveTextDocument(workspaceRoot, {
      relativePath: 'bom.txt',
      content: '新内容',
      expectedRevision: bomRevision,
    });
    expect(withBom.status).toBe('saved');
    if (withBom.status === 'saved') {
      expect(withBom.document.hasUtf8Bom).toBe(true);
    }
    const diskBom = await readFile(join(workspaceRoot, 'bom.txt'));
    expect([diskBom[0], diskBom[1], diskBom[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(diskBom.subarray(3).toString()).toBe('新内容');

    await writeFile(join(workspaceRoot, 'plain.txt'), '原文');
    const plainRevision = await revisionOf(workspaceRoot, 'plain.txt');
    const noBom = await saveTextDocument(workspaceRoot, {
      relativePath: 'plain.txt',
      content: '新内容',
      expectedRevision: plainRevision,
    });
    expect(noBom.status).toBe('saved');
    if (noBom.status === 'saved') {
      expect(noBom.document.hasUtf8Bom).toBe(false);
    }
    const diskPlain = await readFile(join(workspaceRoot, 'plain.txt'));
    expect(diskPlain[0]).not.toBe(0xef);
    expect(diskPlain.toString()).toBe('新内容');
  });

  it('一致的 LF 与 CRLF 文件保存后保持原换行风格', async () => {
    await writeFile(join(workspaceRoot, 'lf.txt'), 'a\nb\n');
    const lfRevision = await revisionOf(workspaceRoot, 'lf.txt');
    const lfSaved = await saveTextDocument(workspaceRoot, {
      relativePath: 'lf.txt',
      content: 'x\ny\n',
      expectedRevision: lfRevision,
    });
    expect(lfSaved.status).toBe('saved');
    if (lfSaved.status === 'saved') {
      expect(lfSaved.document.lineEnding).toBe('lf');
    }
    expect((await readFile(join(workspaceRoot, 'lf.txt'))).toString()).toBe('x\ny\n');

    await writeFile(join(workspaceRoot, 'crlf.txt'), 'a\r\nb\r\n');
    const crlfRevision = await revisionOf(workspaceRoot, 'crlf.txt');
    const crlfSaved = await saveTextDocument(workspaceRoot, {
      relativePath: 'crlf.txt',
      content: 'x\r\ny\r\n',
      expectedRevision: crlfRevision,
    });
    expect(crlfSaved.status).toBe('saved');
    if (crlfSaved.status === 'saved') {
      expect(crlfSaved.document.lineEnding).toBe('crlf');
    }
    const crlfDisk = await readFile(join(workspaceRoot, 'crlf.txt'));
    expect(crlfDisk.toString()).toBe('x\r\ny\r\n');
    expect(Buffer.from(crlfDisk).equals(Buffer.from('x\r\ny\r\n', 'utf8'))).toBe(true);
  });

  it('混合换行未经确认返回 MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED 且不写入', async () => {
    await writeFile(join(workspaceRoot, 'mixed.txt'), 'a\nb');
    const revision = await revisionOf(workspaceRoot, 'mixed.txt');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'mixed.txt',
      content: 'x\n y\r\nz',
      expectedRevision: revision,
    });

    expect(expectError(result).code).toBe('MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED');
    expect((await readFile(join(workspaceRoot, 'mixed.txt'))).toString()).toBe('a\nb');
    await expectNoTempLeftovers(workspaceRoot);
  });

  it.each([
    ['CRLF 为主', '1\r\n2\r\n3\n', 'crlf', '1\r\n2\r\n3\r\n'],
    ['LF 为主', '1\n2\n3\r\n', 'lf', '1\n2\n3\n'],
    ['平局取 CRLF', '1\r\n2\n', 'crlf', '1\r\n2\r\n'],
    ['含独立 CR 且 CRLF 为主', '1\r\n2\r3\r\n', 'crlf', '1\r\n2\r\n3\r\n'],
  ])(
    '混合换行确认后按 dominant 规则规范化：%s',
    async (_label, content, expectedEnding, expectedDisk) => {
      await writeFile(join(workspaceRoot, 'mixed.txt'), 'a\nb');
      const revision = await revisionOf(workspaceRoot, 'mixed.txt');

      const result = await saveTextDocument(workspaceRoot, {
        relativePath: 'mixed.txt',
        content,
        expectedRevision: revision,
        confirmMixedLineEndingNormalization: true,
      });

      expect(result.status).toBe('saved');
      if (result.status === 'saved') {
        expect(result.document.lineEnding).toBe(expectedEnding);
        expect(result.document.content).toBe(expectedDisk);
        expect(result.document.revision).toBe(await revisionOf(workspaceRoot, 'mixed.txt'));
      }
      expect((await readFile(join(workspaceRoot, 'mixed.txt'))).toString()).toBe(expectedDisk);
    },
  );

  it('保存成功后重新读取：revision 与磁盘字节严格一致', async () => {
    await writeFile(join(workspaceRoot, 'sync.txt'), 'original');
    const revision = await revisionOf(workspaceRoot, 'sync.txt');

    const saved = await saveTextDocument(workspaceRoot, {
      relativePath: 'sync.txt',
      content: '已保存内容',
      expectedRevision: revision,
    });
    expect(saved.status).toBe('saved');
    if (saved.status === 'saved') {
      const reread = await readTextDocument(workspaceRoot, 'sync.txt');
      expect(reread.status).toBe('loaded');
      if (reread.status === 'loaded') {
        expect(reread.document.revision).toBe(saved.document.revision);
        expect(reread.document.byteLength).toBe(saved.document.byteLength);
        expect(reread.document.content).toBe('已保存内容');
      }
    }
  });

  it('版本冲突返回 CONFLICT：磁盘不变、无临时文件创建与残留', async () => {
    await writeFile(join(workspaceRoot, 'conflict.txt'), 'original');
    const revision = await revisionOf(workspaceRoot, 'conflict.txt');
    await writeFile(join(workspaceRoot, 'conflict.txt'), 'externally modified');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'conflict.txt',
      content: 'local edit',
      expectedRevision: revision,
    });

    expect(expectError(result).code).toBe('CONFLICT');
    expect((await readFile(join(workspaceRoot, 'conflict.txt'))).toString()).toBe(
      'externally modified',
    );
    await expectNoTempLeftovers(workspaceRoot);
  });

  it('编码后恰好 5 MiB 可保存', async () => {
    await writeFile(join(workspaceRoot, 'big.txt'), 'init');
    const revision = await revisionOf(workspaceRoot, 'big.txt');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'big.txt',
      content: 'a'.repeat(MAX_TXT_FILE_BYTES),
      expectedRevision: revision,
    });

    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.document.byteLength).toBe(MAX_TXT_FILE_BYTES);
    }
  });

  it('编码后超过 5 MiB 在创建临时文件前被拒绝：磁盘不变、无残留', async () => {
    await writeFile(join(workspaceRoot, 'big.txt'), 'init');
    const revision = await revisionOf(workspaceRoot, 'big.txt');

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'big.txt',
      content: 'a'.repeat(MAX_TXT_FILE_BYTES + 1),
      expectedRevision: revision,
    });

    expect(expectError(result).code).toBe('TOO_LARGE');
    expect((await readFile(join(workspaceRoot, 'big.txt'))).toString()).toBe('init');
    await expectNoTempLeftovers(workspaceRoot);
  });

  it('磁盘文件本身超过 5 MiB 时被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'huge.txt'), Buffer.alloc(MAX_TXT_FILE_BYTES + 1, 0x61));

    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'huge.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });

    expect(expectError(result).code).toBe('TOO_LARGE');
  });

  it('文件不存在返回 NOT_FOUND', async () => {
    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'missing.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('目录作为目标、中间段为文件时返回 NOT_FILE', async () => {
    await mkdir(join(workspaceRoot, 'subdir.txt'));
    const dirResult = await saveTextDocument(workspaceRoot, {
      relativePath: 'subdir.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectError(dirResult).code).toBe('NOT_FILE');

    await writeFile(join(workspaceRoot, 'conflict.txt'), 'x');
    const midResult = await saveTextDocument(workspaceRoot, {
      relativePath: 'conflict.txt/b.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectError(midResult).code).toBe('NOT_FILE');
  });

  it('非 TXT 文件返回 UNSUPPORTED_TYPE', async () => {
    await writeFile(join(workspaceRoot, 'notes.md'), '# title');
    const result = await saveTextDocument(workspaceRoot, {
      relativePath: 'notes.md',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectError(result).code).toBe('UNSUPPORTED_TYPE');
  });

  it.each([
    ['空路径', ''],
    ['绝对路径', '/etc/passwd'],
    ['反斜杠', 'a\\b.txt'],
    ['.. 段', 'a/../b.txt'],
    ['. 段', 'a/./b.txt'],
    ['空段', 'a//b.txt'],
    ['尾部空段', 'a/'],
    ['盘符路径', 'C:/a.txt'],
    ['盘符相对路径', 'C:a.txt'],
    ['空字符', 'a\0b.txt'],
  ])('非法路径格式被拒绝：%s', async (_label, relativePath) => {
    const result = await saveTextDocument(workspaceRoot, {
      relativePath,
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectError(result).code).toBe('INVALID_PATH');
  });

  it('未打开工作区返回 NO_WORKSPACE', async () => {
    for (const root of ['', 'relative-root']) {
      const result = await saveTextDocument(root, {
        relativePath: 'a.txt',
        content: 'x',
        expectedRevision: 'a'.repeat(64),
      });
      expect(expectError(result).code).toBe('NO_WORKSPACE');
    }
  });

  it.each([
    ['null', null],
    ['数字', 42],
    ['relativePath 缺失', { content: 'x', expectedRevision: 'a'.repeat(64) }],
    ['content 缺失', { relativePath: 'a.txt', expectedRevision: 'a'.repeat(64) }],
    ['expectedRevision 缺失', { relativePath: 'a.txt', content: 'x' }],
    ['expectedRevision 空串', { relativePath: 'a.txt', content: 'x', expectedRevision: '' }],
    [
      'confirm 为 false',
      {
        relativePath: 'a.txt',
        content: 'x',
        expectedRevision: 'a'.repeat(64),
        confirmMixedLineEndingNormalization: false,
      },
    ],
    [
      'confirm 为数字',
      {
        relativePath: 'a.txt',
        content: 'x',
        expectedRevision: 'a'.repeat(64),
        confirmMixedLineEndingNormalization: 1,
      },
    ],
  ])('非法请求形状返回 INVALID_REQUEST：%s', async (_label, request) => {
    const result = await saveTextDocument(
      workspaceRoot,
      request as unknown as SaveTextDocumentRequest,
    );
    expect(expectError(result).code).toBe('INVALID_REQUEST');
  });

  it('临时文件排他创建、位于目标同目录且名称不可预测', async () => {
    const target = join(workspaceRoot, 'a.txt');
    const first = await defaultSaveTextAdapters.createTempFile(target);
    const second = await defaultSaveTextAdapters.createTempFile(target);
    try {
      expect(first.tempPath.startsWith(join(workspaceRoot, '.wenshu-'))).toBe(true);
      expect(second.tempPath.startsWith(join(workspaceRoot, '.wenshu-'))).toBe(true);
      expect(first.tempPath).not.toBe(second.tempPath);
      // 排他：同路径再次创建失败
      await expect(open(first.tempPath, 'wx')).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await first.close();
      await second.close();
      await rm(first.tempPath, { force: true });
      await rm(second.tempPath, { force: true });
    }
  });
});

describe('saveTextDocument 安全分支（适配器 mock）', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-saver-mock-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('真实路径逃逸返回 OUTSIDE_WORKSPACE', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'x');
    const adapters = makeAdapters({
      realpath: async (path: string) =>
        path === join(workspaceRoot, 'a.txt') ? join(workspaceRoot, '..', 'escape.txt') : path,
    });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'x', expectedRevision: 'a'.repeat(64) },
      adapters,
    );

    expect(expectError(result).code).toBe('OUTSIDE_WORKSPACE');
  });

  it('lstat 权限错误映射为 ACCESS_DENIED', async () => {
    const adapters = makeAdapters({ lstat: () => Promise.reject(errno('EACCES')) });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'x', expectedRevision: 'a'.repeat(64) },
      adapters,
    );

    expect(expectError(result).code).toBe('ACCESS_DENIED');
  });

  it('版本检查读取 ENOENT 映射为 NOT_FOUND', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'x');
    const adapters = makeAdapters({
      readDiskBytes: () => Promise.reject(errno('ENOENT')),
    });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'x', expectedRevision: 'a'.repeat(64) },
      adapters,
    );

    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('版本冲突时不会创建临时文件', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'x');
    const createTempFile = vi.fn<SaveTextAdapters['createTempFile']>();
    const adapters = makeAdapters({ createTempFile });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'x', expectedRevision: 'b'.repeat(64) },
      adapters,
    );

    expect(expectError(result).code).toBe('CONFLICT');
    expect(createTempFile).not.toHaveBeenCalled();
  });

  it('短写会循环完成，不产生截断文件', async () => {
    const filePath = join(workspaceRoot, 'short.txt');
    await writeFile(filePath, '');
    const realHandle = await open(filePath, 'r+');
    try {
      const chunked = {
        write: async (buffer: Uint8Array, offset: number, length: number) =>
          realHandle.write(buffer, offset, Math.min(3, length)),
      };
      const source = new TextEncoder().encode('短写必须循环完成，不得截断');
      await writeAllBytes(chunked, source);
      const disk = await readFile(filePath);
      expect(Buffer.from(disk).equals(Buffer.from(source))).toBe(true);
    } finally {
      await realHandle.close();
    }
  });

  it.each([
    ['write', async () => Promise.reject(errno('EIO'))],
    ['sync', async () => Promise.reject(errno('EIO'))],
    ['close', async () => Promise.reject(errno('EIO'))],
  ])('%s 失败：返回 WRITE_FAILED，原文件完整，临时文件被清理', async (_label, failStep) => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'original');
    const revision = await revisionOf(workspaceRoot, 'a.txt');
    const removeTemp = vi.fn(async () => undefined);
    const handle = makeMockHandle({ sync: failStep });
    const adapters = makeAdapters({
      createTempFile: async () => handle,
      removeTemp,
    });
    if (_label === 'write') {
      handle.write = failStep;
    }
    if (_label === 'close') {
      handle.close = failStep;
    }

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'new content', expectedRevision: revision },
      adapters,
    );

    expect(expectError(result).code).toBe('WRITE_FAILED');
    expect((await readFile(join(workspaceRoot, 'a.txt'))).toString()).toBe('original');
    expect(removeTemp).toHaveBeenCalledWith(handle.tempPath);
    await expectNoTempLeftovers(workspaceRoot);
  });

  it('替换失败：返回 WRITE_FAILED，原文件不删除不截断、不降级为覆盖写入，临时文件被清理', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'original');
    const revision = await revisionOf(workspaceRoot, 'a.txt');
    const removeTemp = vi.fn(async () => undefined);
    const handle = makeMockHandle();
    const replace = vi.fn(async () => Promise.reject(errno('EPERM')));
    const adapters = makeAdapters({ createTempFile: async () => handle, replace, removeTemp });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'new content', expectedRevision: revision },
      adapters,
    );

    expect(expectError(result).code).toBe('WRITE_FAILED');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(handle.tempPath, join(workspaceRoot, 'a.txt'));
    // 原文件保持原内容：没有发生覆盖或删除
    expect((await readFile(join(workspaceRoot, 'a.txt'))).toString()).toBe('original');
    expect(removeTemp).toHaveBeenCalledWith(handle.tempPath);
    await expectNoTempLeftovers(workspaceRoot);
  });

  it('清理失败不覆盖主要错误，也不抛出异常', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'original');
    const revision = await revisionOf(workspaceRoot, 'a.txt');
    const adapters = makeAdapters({
      createTempFile: async () => makeMockHandle(),
      replace: async () => Promise.reject(errno('EPERM')),
      removeTemp: async () => Promise.reject(errno('EACCES')),
    });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: 'new content', expectedRevision: revision },
      adapters,
    );

    expect(expectError(result).code).toBe('WRITE_FAILED');
    expect((await readFile(join(workspaceRoot, 'a.txt'))).toString()).toBe('original');
  });

  it('意外异常不泄漏路径、正文、临时文件名或调用栈', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'x');
    const adapters = makeAdapters({
      readDiskBytes: () =>
        Promise.reject(
          new Error('秘密内部信息 C:\\secrets\\wenshu-abc.tmp 正文泄漏\n    at unknown (x.js:1:1)'),
        ),
    });

    const result = await saveTextDocument(
      workspaceRoot,
      { relativePath: 'a.txt', content: '秘密正文', expectedRevision: 'a'.repeat(64) },
      adapters,
    );

    const error = expectError(result);
    expect(error.code).toBe('WRITE_FAILED');
    expect(error.message).toBe('写入文件失败');
    expect(JSON.stringify(result)).not.toContain('秘密');
    expect(JSON.stringify(result)).not.toContain('secrets');
    expect(JSON.stringify(result)).not.toContain('wenshu-abc');
    expect(JSON.stringify(result)).not.toContain('at unknown');
  });
});

describe('换行规范化纯函数', () => {
  it('normalizeLineEndings 把任意换行统一为指定风格', () => {
    const mixed = 'a\r\nb\rc\nd';
    expect(normalizeLineEndings(mixed, 'lf')).toBe('a\nb\nc\nd');
    expect(normalizeLineEndings(mixed, 'crlf')).toBe('a\r\nb\r\nc\r\nd');
    expect(normalizeLineEndings('已\n是\nLF', 'lf')).toBe('已\n是\nLF');
    expect(normalizeLineEndings('已\r\n是\r\nCRLF', 'crlf')).toBe('已\r\n是\r\nCRLF');
    expect(normalizeLineEndings('', 'lf')).toBe('');
  });

  it('dominantLineEnding 选择多数派，平局取 CRLF', () => {
    expect(dominantLineEnding('1\r\n2\r\n3\n')).toBe('crlf');
    expect(dominantLineEnding('1\n2\n3\r\n')).toBe('lf');
    expect(dominantLineEnding('1\r\n2\n')).toBe('crlf');
    expect(dominantLineEnding('1\r2\r3\n')).toBe('crlf');
    expect(dominantLineEnding('')).toBe('crlf');
  });
});
