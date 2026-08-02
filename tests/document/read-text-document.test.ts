import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_TXT_FILE_BYTES, type ReadTextDocumentResult } from '../../src/shared/document';
import {
  defaultReadTextAdapters,
  readBoundedTextBytes,
  readTextDocument,
  type ReadTextAdapters,
} from '../../src/main/document/read-text-document';

/** 返回 error 结果时抛出，测试断言更直接。 */
function expectError(
  result: ReadTextDocumentResult,
): NonNullable<Extract<ReadTextDocumentResult, { status: 'error' }>['error']> {
  expect(result.status).toBe('error');
  if (result.status !== 'error') {
    throw new Error('unreachable');
  }
  return result.error;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('readTextDocument', () => {
  let workspaceRoot: string;
  let outsideDir: string;
  let fileSymlinkSupported = false;
  let dirSymlinkSupported = false;
  beforeAll(async () => {
    outsideDir = await mkdtemp(join(tmpdir(), 'wenshu-reader-outside-'));
    const probeDir = await mkdtemp(join(tmpdir(), 'wenshu-reader-probe-'));

    const probeFile = join(probeDir, 'probe.txt');
    await writeFile(probeFile, 'x');
    try {
      await symlink(probeFile, join(probeDir, 'alias.txt'));
      fileSymlinkSupported = true;
    } catch {
      fileSymlinkSupported = false;
    }

    const probeDirTarget = join(probeDir, 'probe-dir');
    await mkdir(probeDirTarget);
    try {
      await symlink(
        probeDirTarget,
        join(probeDir, 'alias-dir'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      dirSymlinkSupported = true;
    } catch {
      dirSymlinkSupported = false;
    }

    await rm(probeDir, { recursive: true, force: true });
  }, 60_000);

  afterAll(async () => {
    await rm(outsideDir, { recursive: true, force: true });
  }, 60_000);

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-reader-ws-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('读取根目录中的 UTF-8 TXT', async () => {
    await writeFile(join(workspaceRoot, 'hello.txt'), 'hello world');
    const result = await readTextDocument(workspaceRoot, 'hello.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.name).toBe('hello.txt');
      expect(result.document.relativePath).toBe('hello.txt');
      expect(result.document.content).toBe('hello world');
      expect(result.document.byteLength).toBe(11);
    }
  });

  it('读取嵌套目录中的 TXT', async () => {
    await mkdir(join(workspaceRoot, 'sub', 'deep'), { recursive: true });
    await writeFile(join(workspaceRoot, 'sub', 'deep', 'inner.txt'), 'nested');
    const result = await readTextDocument(workspaceRoot, 'sub/deep/inner.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.name).toBe('inner.txt');
      expect(result.document.relativePath).toBe('sub/deep/inner.txt');
      expect(result.document.content).toBe('nested');
      expect(result.document.byteLength).toBe(6);
    }
  });

  it('中文、多行内容的正文与字节长度正确', async () => {
    const content = '中文\n第二行\r\nend';
    await writeFile(join(workspaceRoot, 'multi.txt'), content, 'utf8');
    const result = await readTextDocument(workspaceRoot, 'multi.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.content).toBe(content);
      expect(result.document.byteLength).toBe(Buffer.byteLength(content, 'utf8'));
    }
  });

  it('空文件正常返回空正文', async () => {
    await writeFile(join(workspaceRoot, 'empty.txt'), '');
    const result = await readTextDocument(workspaceRoot, 'empty.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.content).toBe('');
      expect(result.document.byteLength).toBe(0);
    }
  });

  it('UTF-8 BOM 不作为正文字符显示', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好')]);
    await writeFile(join(workspaceRoot, 'bom.txt'), bytes);
    const result = await readTextDocument(workspaceRoot, 'bom.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.content).toBe('你好');
      expect(result.document.byteLength).toBe(Buffer.byteLength('你好') + 3);
    }
  });

  it('扩展名大小写不敏感：.TXT 与 .Txt 均被接受', async () => {
    await writeFile(join(workspaceRoot, 'README.TXT'), 'upper');
    await writeFile(join(workspaceRoot, 'notes.Txt'), 'mixed');

    const upper = await readTextDocument(workspaceRoot, 'README.TXT');
    const mixed = await readTextDocument(workspaceRoot, 'notes.Txt');
    expect(upper.status).toBe('loaded');
    expect(mixed.status).toBe('loaded');
  });

  it('未打开工作区：空根路径或相对根路径返回 NO_WORKSPACE', async () => {
    expect((await readTextDocument('', 'a.txt')).status).toBe('error');
    const noRoot = await readTextDocument('', 'a.txt');
    expect(expectError(noRoot).code).toBe('NO_WORKSPACE');

    const relativeRoot = await readTextDocument('relative-root', 'a.txt');
    expect(expectError(relativeRoot).code).toBe('NO_WORKSPACE');
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
    const result = await readTextDocument(workspaceRoot, relativePath);
    expect(expectError(result).code).toBe('INVALID_PATH');
  });

  it('非字符串路径参数被拒绝', async () => {
    const result = await readTextDocument(workspaceRoot, null as unknown as string);
    expect(expectError(result).code).toBe('INVALID_PATH');
  });

  it('非 TXT 文件被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'notes.md'), '# title');
    const result = await readTextDocument(workspaceRoot, 'notes.md');
    expect(expectError(result).code).toBe('UNSUPPORTED_TYPE');
  });

  it('无扩展名的文件被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'LICENSE'), 'text');
    const result = await readTextDocument(workspaceRoot, 'LICENSE');
    expect(expectError(result).code).toBe('UNSUPPORTED_TYPE');
  });

  it('目录作为目标被拒绝（即使名为 .txt）', async () => {
    await mkdir(join(workspaceRoot, 'subdir.txt'));
    const result = await readTextDocument(workspaceRoot, 'subdir.txt');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it('路径中间段为普通文件时被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'conflict.txt'), 'x');
    const result = await readTextDocument(workspaceRoot, 'conflict.txt/b.txt');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it.runIf(fileSymlinkSupported)('最终段为符号链接的文件被拒绝（即使目标在工作区内）', async () => {
    await writeFile(join(workspaceRoot, 'real.txt'), 'content');
    await symlink(join(workspaceRoot, 'real.txt'), join(workspaceRoot, 'link.txt'));
    const result = await readTextDocument(workspaceRoot, 'link.txt');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it.runIf(dirSymlinkSupported)(
    '中间段为指向工作区外的 junction/目录符号链接时被拒绝',
    async () => {
      await writeFile(join(outsideDir, 'secret.txt'), 'outside');
      await symlink(
        outsideDir,
        join(workspaceRoot, 'alias'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const result = await readTextDocument(workspaceRoot, 'alias/secret.txt');
      expect(expectError(result).code).toBe('NOT_FILE');
    },
  );

  it('符号链接被拒绝（lstat 模拟：无权限环境下的确定性覆盖）', async () => {
    const symlinkStat = {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
      size: 0,
    };
    const adapters: ReadTextAdapters = {
      ...defaultReadTextAdapters,
      lstat: () => Promise.resolve(symlinkStat),
    };
    const finalLink = await readTextDocument(workspaceRoot, 'link.txt', adapters);
    expect(expectError(finalLink).code).toBe('NOT_FILE');

    const midLink = await readTextDocument(workspaceRoot, 'alias/file.txt', adapters);
    expect(expectError(midLink).code).toBe('NOT_FILE');
  });

  it('不存在的文件返回 NOT_FOUND', async () => {
    const result = await readTextDocument(workspaceRoot, 'missing.txt');
    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('无读取权限转换为 ACCESS_DENIED', async () => {
    await writeFile(join(workspaceRoot, 'denied.txt'), 'x');
    const adapters: ReadTextAdapters = {
      ...defaultReadTextAdapters,
      lstat: () => Promise.reject(errno('EACCES')),
    };
    const result = await readTextDocument(workspaceRoot, 'denied.txt', adapters);
    expect(expectError(result).code).toBe('ACCESS_DENIED');
  });

  it('文件在读取期间消失转换为 NOT_FOUND', async () => {
    await writeFile(join(workspaceRoot, 'gone.txt'), 'x');
    const adapters: ReadTextAdapters = {
      ...defaultReadTextAdapters,
      readTextBytes: () => Promise.reject(errno('ENOENT')),
    };
    const result = await readTextDocument(workspaceRoot, 'gone.txt', adapters);
    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('恰好 5 MiB 的文件可以读取', async () => {
    await writeFile(join(workspaceRoot, 'exact.txt'), Buffer.alloc(MAX_TXT_FILE_BYTES, 0x61));
    const result = await readTextDocument(workspaceRoot, 'exact.txt');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.byteLength).toBe(MAX_TXT_FILE_BYTES);
      expect(result.document.content.length).toBe(MAX_TXT_FILE_BYTES);
    }
  });

  it('超过 5 MiB 的文件在读取正文前被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'big.txt'), Buffer.alloc(MAX_TXT_FILE_BYTES + 1, 0x61));
    const result = await readTextDocument(workspaceRoot, 'big.txt');
    expect(expectError(result).code).toBe('TOO_LARGE');
  });

  it('文件在校验后增长：有界读取检测到超限并拒绝', async () => {
    await writeFile(join(workspaceRoot, 'growing.txt'), 'small');
    const adapters: ReadTextAdapters = {
      ...defaultReadTextAdapters,
      readTextBytes: () => Promise.resolve(new Uint8Array(MAX_TXT_FILE_BYTES + 1)),
    };
    const result = await readTextDocument(workspaceRoot, 'growing.txt', adapters);
    expect(expectError(result).code).toBe('TOO_LARGE');
  });

  it('有界读取会循环处理短读，不截断正文', async () => {
    const source = new TextEncoder().encode('short reads must be joined');
    const handle = {
      read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const bytesRead = Math.min(3, length, source.byteLength - position);
        if (bytesRead > 0) {
          buffer.set(source.subarray(position, position + bytesRead), offset);
        }
        return { bytesRead };
      },
    };

    const bytes = await readBoundedTextBytes(handle);

    expect(Array.from(bytes)).toEqual(Array.from(source));
  });

  it('非法 UTF-8 被拒绝', async () => {
    await writeFile(join(workspaceRoot, 'bad.txt'), Buffer.from([0x41, 0x42, 0xff, 0x43]));
    const result = await readTextDocument(workspaceRoot, 'bad.txt');
    expect(expectError(result).code).toBe('INVALID_UTF8');
  });

  it('意外异常转换为稳定 READ_FAILED，不泄漏原始 Error 或调用栈', async () => {
    await writeFile(join(workspaceRoot, 'ok.txt'), 'x');
    const adapters: ReadTextAdapters = {
      ...defaultReadTextAdapters,
      readTextBytes: () =>
        Promise.reject(new Error('秘密内部信息 C:\\secrets\\stack\n    at unknown (x.js:1:1)')),
    };
    const result = await readTextDocument(workspaceRoot, 'ok.txt', adapters);

    const error = expectError(result);
    expect(error.code).toBe('READ_FAILED');
    expect(error.message).toBe('读取文件失败');
    expect(JSON.stringify(result)).not.toContain('秘密');
    expect(JSON.stringify(result)).not.toContain('secrets');
  });
});
