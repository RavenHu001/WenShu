import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_TXT_FILE_BYTES,
  type LineEnding,
  type ReadTextDocumentResult,
} from '../../src/shared/document';
import {
  defaultReadTextAdapters,
  readBoundedTextBytes,
  readTextDocument,
  type ReadTextAdapters,
} from '../../src/main/document/read-text-document';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';

/** 原始字节的 SHA-256 十六进制，用于断言 revision 与磁盘字节严格一致。 */
function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

/**
 * 有界符号链接探测（DEVELOPMENT_ENVIRONMENT.md"symlink/junction 探测卡住"处置）：
 * 受控环境可能因权限或安全软件使 `fs.symlink` 长时间阻塞后才失败；探测只在有限时间内等待，
 * 超时按"环境不支持符号链接"处理，只跳过真实链接用例，mock 拒绝分支继续确定性覆盖。
 */
function boundedSymlinkProbe(
  target: string,
  path: string,
  type?: 'junction' | 'dir',
): Promise<void> {
  const attempt = type === undefined ? symlink(target, path) : symlink(target, path, type);
  return Promise.race([
    attempt,
    new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error('symlink probe timed out')), 5_000);
    }),
  ]);
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
      await boundedSymlinkProbe(probeFile, join(probeDir, 'alias.txt'));
      fileSymlinkSupported = true;
    } catch {
      fileSymlinkSupported = false;
    }

    const probeDirTarget = join(probeDir, 'probe-dir');
    await mkdir(probeDirTarget);
    try {
      await boundedSymlinkProbe(
        probeDirTarget,
        join(probeDir, 'alias-dir'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      dirSymlinkSupported = true;
    } catch {
      dirSymlinkSupported = false;
    }

    await removeDirWithRetry(probeDir);
  }, 60_000);

  afterAll(async () => {
    await rm(outsideDir, { recursive: true, force: true });
  }, 60_000);

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-reader-ws-'));
  });

  afterEach(async () => {
    // junction 用例在 workspaceRoot 内创建 junction：清理使用有界重试（EBUSY 瞬时锁）
    await removeDirWithRetry(workspaceRoot);
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
      expect(result.document.revision).toBe(sha256Of(Buffer.from('hello world', 'utf8')));
      expect(result.document.hasUtf8Bom).toBe(false);
      expect(result.document.lineEnding).toBe('none');
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
      expect(result.document.revision).toBe(sha256Of(Buffer.from(content, 'utf8')));
      // 同时含 LF 与 CRLF，应识别为 mixed，不静默归一
      expect(result.document.lineEnding).toBe('mixed');
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
      // BOM 是原始字节的一部分，计入版本
      expect(result.document.revision).toBe(sha256Of(bytes));
      expect(result.document.hasUtf8Bom).toBe(true);
      expect(result.document.lineEnding).toBe('none');
    }
  });

  it('无 BOM 文件标记 hasUtf8Bom=false', async () => {
    await writeFile(join(workspaceRoot, 'plain.txt'), 'no bom');
    const result = await readTextDocument(workspaceRoot, 'plain.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.hasUtf8Bom).toBe(false);
    }
  });

  it('revision 为 64 位小写十六进制', async () => {
    await writeFile(join(workspaceRoot, 'hex.txt'), 'hex check');
    const result = await readTextDocument(workspaceRoot, 'hex.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.revision).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it.each([
    ['LF', 'a\nb\nc', 'lf'],
    ['CRLF', 'a\r\nb\r\n', 'crlf'],
    ['LF 与 CRLF 混合', 'a\nb\r\nc', 'mixed'],
    ['独立 CR（旧式 Mac）', 'a\rb\r', 'mixed'],
    ['LF 与独立 CR', 'a\rb\nc', 'mixed'],
    ['无换行', 'plain text', 'none'],
    ['空文件', '', 'none'],
    ['只有 LF 换行', '\n\n', 'lf'],
    ['只有 CRLF 换行', '\r\n\r\n', 'crlf'],
  ])('lineEnding 检测：%s', async (_label, content, expected) => {
    await writeFile(join(workspaceRoot, 'ending.txt'), content, 'utf8');
    const result = await readTextDocument(workspaceRoot, 'ending.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.lineEnding).toBe(expected as LineEnding);
      expect(result.document.revision).toBe(sha256Of(Buffer.from(content, 'utf8')));
      expect(result.document.byteLength).toBe(Buffer.byteLength(content, 'utf8'));
    }
  });

  it('空文件：无 BOM、无换行、版本为 SHA-256(空字节)', async () => {
    await writeFile(join(workspaceRoot, 'empty.txt'), '');
    const result = await readTextDocument(workspaceRoot, 'empty.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.content).toBe('');
      expect(result.document.hasUtf8Bom).toBe(false);
      expect(result.document.lineEnding).toBe('none');
      expect(result.document.revision).toBe(sha256Of(new Uint8Array(0)));
    }
  });

  it('中文等多字节字符的版本基于原始字节而非字符串长度', async () => {
    const content = '中文\n第二行';
    await writeFile(join(workspaceRoot, 'cjk.txt'), content, 'utf8');
    const result = await readTextDocument(workspaceRoot, 'cjk.txt');

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.revision).toBe(sha256Of(Buffer.from(content, 'utf8')));
      expect(result.document.byteLength).toBe(Buffer.byteLength(content, 'utf8'));
    }
  });

  it('相同字节内容产生相同版本，不同字节内容产生不同版本', async () => {
    await writeFile(join(workspaceRoot, 'one.txt'), 'same content');
    await writeFile(join(workspaceRoot, 'two.txt'), 'same content');
    await writeFile(join(workspaceRoot, 'three.txt'), 'other content');

    const one = await readTextDocument(workspaceRoot, 'one.txt');
    const two = await readTextDocument(workspaceRoot, 'two.txt');
    const three = await readTextDocument(workspaceRoot, 'three.txt');
    expect(one.status).toBe('loaded');
    expect(two.status).toBe('loaded');
    expect(three.status).toBe('loaded');
    if (one.status === 'loaded' && two.status === 'loaded' && three.status === 'loaded') {
      expect(one.document.revision).toBe(two.document.revision);
      expect(one.document.revision).not.toBe(three.document.revision);
    }
  });

  it('BOM 与换行风格计入版本：同正文不同字节得到不同版本', async () => {
    const plain = 'hello\nworld';
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(plain, 'utf8')]);
    const crlf = 'hello\r\nworld';
    await writeFile(join(workspaceRoot, 'plain.txt'), plain, 'utf8');
    await writeFile(join(workspaceRoot, 'bom.txt'), withBom);
    await writeFile(join(workspaceRoot, 'crlf.txt'), crlf, 'utf8');

    const plainRes = await readTextDocument(workspaceRoot, 'plain.txt');
    const bomRes = await readTextDocument(workspaceRoot, 'bom.txt');
    const crlfRes = await readTextDocument(workspaceRoot, 'crlf.txt');
    expect(plainRes.status).toBe('loaded');
    expect(bomRes.status).toBe('loaded');
    expect(crlfRes.status).toBe('loaded');
    if (plainRes.status === 'loaded' && bomRes.status === 'loaded' && crlfRes.status === 'loaded') {
      expect(bomRes.document.hasUtf8Bom).toBe(true);
      expect(crlfRes.document.lineEnding).toBe('crlf');
      expect(bomRes.document.revision).not.toBe(plainRes.document.revision);
      expect(crlfRes.document.revision).not.toBe(plainRes.document.revision);
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
