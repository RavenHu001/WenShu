/**
 * TASK-007 WP2：DOCX 受控读取器测试（任务第 8.3 节）。
 * 覆盖：根/嵌套读取与快照字段、扩展名大小写、非法路径、目录/符号链接/junction/
 * 路径中间链接/工作区逃逸、不存在/无权限/读取中变化/非普通文件、恰好与超过 20 MiB、
 * 非 ZIP/缺失关键部件/加密模拟、SHA-256 revision、预期与意外失败转稳定错误。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import {
  DOCX_MAX_FILE_BYTES,
  type DocxDocumentError,
  type ReadDocxDocumentResult,
} from '../../src/shared/docx';
import {
  defaultReadDocxAdapters,
  readDocxDocument,
  type ReadDocxAdapters,
} from '../../src/main/docx/read-docx-document';
import { buildDocxFixtures } from './docx-fixture-builder';

/** 原始字节的 SHA-256 十六进制，用于断言 revision 与磁盘字节严格一致。 */
function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 返回 error 结果时抛出，测试断言更直接。 */
function expectError(
  result: ReadDocxDocumentResult,
): NonNullable<Extract<ReadDocxDocumentResult, { status: 'error' }>['error']> {
  expect(result.status).toBe('error');
  if (result.status !== 'error') {
    throw new Error('unreachable');
  }
  return result.error;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** 有界符号链接探测（与 TXT 读取器测试相同的环境探测策略）。 */
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

describe('readDocxDocument', () => {
  let workspaceRoot: string;
  let outsideDir: string;
  let fileSymlinkSupported = false;
  let dirSymlinkSupported = false;
  let fixtures: Awaited<ReturnType<typeof buildDocxFixtures>>;

  beforeAll(async () => {
    fixtures = await buildDocxFixtures();
    outsideDir = await mkdtemp(join(tmpdir(), 'wenshu-docx-outside-'));
    const probeDir = await mkdtemp(join(tmpdir(), 'wenshu-docx-probe-'));

    const probeFile = join(probeDir, 'probe.bin');
    await writeFile(probeFile, 'x');
    try {
      await boundedSymlinkProbe(probeFile, join(probeDir, 'alias.bin'));
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

    await rm(probeDir, { recursive: true, force: true });
  }, 60_000);

  afterAll(async () => {
    await rm(outsideDir, { recursive: true, force: true });
  }, 60_000);

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-docx-ws-'));
    await writeFile(join(workspaceRoot, 'plain.docx'), fixtures.files['ok-plain']!);
    await mkdir(join(workspaceRoot, 'sub', 'deep'), { recursive: true });
    await writeFile(
      join(workspaceRoot, 'sub', 'deep', 'inner.docx'),
      fixtures.files['ok-headings']!,
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('读取根目录 DOCX：快照字段完整，revision 基于原始字节', async () => {
    const result = await readDocxDocument(workspaceRoot, 'plain.docx');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      const doc = result.document;
      expect(doc.kind).toBe('docx');
      expect(doc.name).toBe('plain.docx');
      expect(doc.relativePath).toBe('plain.docx');
      expect(doc.size).toBe(fixtures.files['ok-plain']!.byteLength);
      expect(doc.revision).toBe(sha256Of(fixtures.files['ok-plain']!));
      expect(doc.model.blocks.length).toBeGreaterThan(0);
      expect(doc.compatibility.level).toBe('supported');
    }
  });

  it('读取嵌套目录 DOCX', async () => {
    const result = await readDocxDocument(workspaceRoot, 'sub/deep/inner.docx');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.relativePath).toBe('sub/deep/inner.docx');
      expect(result.document.name).toBe('inner.docx');
      expect(result.document.revision).toBe(sha256Of(fixtures.files['ok-headings']!));
    }
  });

  it('扩展名大小写不敏感：.DOCX 与 .Docx 均被接受', async () => {
    await writeFile(join(workspaceRoot, 'UPPER.DOCX'), fixtures.files['ok-plain']!);
    await writeFile(join(workspaceRoot, 'Mixed.Docx'), fixtures.files['ok-plain']!);
    expect((await readDocxDocument(workspaceRoot, 'UPPER.DOCX')).status).toBe('loaded');
    expect((await readDocxDocument(workspaceRoot, 'Mixed.Docx')).status).toBe('loaded');
  });

  it('复杂样本：兼容性报告随快照返回', async () => {
    await writeFile(join(workspaceRoot, 'complex.docx'), fixtures.files['complex-image']!);
    const result = await readDocxDocument(workspaceRoot, 'complex.docx');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.compatibility.level).toBe('degraded');
      expect(result.document.compatibility.warnings.map((w) => w.code)).toContain('image');
    }
  });

  it('未打开工作区：空根路径或相对根路径返回 NO_WORKSPACE', async () => {
    const empty = await readDocxDocument('', 'a.docx');
    expect(expectError(empty).code).toBe('NO_WORKSPACE');
    const relative = await readDocxDocument('relative-root', 'a.docx');
    expect(expectError(relative).code).toBe('NO_WORKSPACE');
  });

  it.each([
    ['空路径', ''],
    ['绝对路径', '/etc/passwd'],
    ['反斜杠', 'a\\b.docx'],
    ['.. 段', 'a/../b.docx'],
    ['. 段', 'a/./b.docx'],
    ['空段', 'a//b.docx'],
    ['尾部空段', 'a/'],
    ['盘符路径', 'C:/a.docx'],
    ['盘符相对路径', 'C:a.docx'],
    ['空字符', 'a\0b.docx'],
  ])('非法路径格式被拒绝：%s', async (_label, relativePath) => {
    const result = await readDocxDocument(workspaceRoot, relativePath);
    expect(expectError(result).code).toBe('INVALID_PATH');
  });

  it('非字符串路径参数被拒绝', async () => {
    const result = await readDocxDocument(workspaceRoot, null as unknown as string);
    expect(expectError(result).code).toBe('INVALID_PATH');
  });

  it('非 DOCX 扩展名被拒绝（.docm/.dotm/.txt/无扩展名/伪装扩展名）', async () => {
    await writeFile(join(workspaceRoot, 'fake.docx.bin'), fixtures.files['ok-plain']!);
    await writeFile(join(workspaceRoot, 'notes.txt'), 'text');
    for (const name of ['fake.docx.bin', 'notes.txt', 'notes.docm', 'notes.dotm', 'LICENSE']) {
      const result = await readDocxDocument(workspaceRoot, name);
      expect(expectError(result).code, name).toBe('UNSUPPORTED_TYPE');
    }
  });

  it('目录作为目标被拒绝（即使名为 .docx）', async () => {
    await mkdir(join(workspaceRoot, 'subdir.docx'));
    const result = await readDocxDocument(workspaceRoot, 'subdir.docx');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it('路径中间段为普通文件时被拒绝', async () => {
    const result = await readDocxDocument(workspaceRoot, 'plain.docx/inner.docx');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it.runIf(fileSymlinkSupported)('最终段为符号链接的文件被拒绝（即使目标在工作区内）', async () => {
    await symlink(join(workspaceRoot, 'plain.docx'), join(workspaceRoot, 'link.docx'));
    const result = await readDocxDocument(workspaceRoot, 'link.docx');
    expect(expectError(result).code).toBe('NOT_FILE');
  });

  it.runIf(dirSymlinkSupported)(
    '中间段为指向工作区外的 junction/目录符号链接时被拒绝',
    async () => {
      await symlink(
        outsideDir,
        join(workspaceRoot, 'alias'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const result = await readDocxDocument(workspaceRoot, 'alias/secret.docx');
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
    const adapters: ReadDocxAdapters = {
      ...defaultReadDocxAdapters,
      lstat: () => Promise.resolve(symlinkStat),
    };
    const finalLink = await readDocxDocument(workspaceRoot, 'plain.docx', adapters);
    expect(expectError(finalLink).code).toBe('NOT_FILE');
  });

  it('不存在的文件返回 NOT_FOUND', async () => {
    const result = await readDocxDocument(workspaceRoot, 'missing.docx');
    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('无读取权限转换为 ACCESS_DENIED', async () => {
    const adapters: ReadDocxAdapters = {
      ...defaultReadDocxAdapters,
      lstat: () => Promise.reject(errno('EACCES')),
    };
    const result = await readDocxDocument(workspaceRoot, 'plain.docx', adapters);
    expect(expectError(result).code).toBe('ACCESS_DENIED');
  });

  it('文件在读取期间消失转换为 NOT_FOUND', async () => {
    const adapters: ReadDocxAdapters = {
      ...defaultReadDocxAdapters,
      readDocxBytes: () => Promise.reject(errno('ENOENT')),
    };
    const result = await readDocxDocument(workspaceRoot, 'plain.docx', adapters);
    expect(expectError(result).code).toBe('NOT_FOUND');
  });

  it('恰好 20 MiB 的文件可以读取（ZIP 读取器忽略尾部填充）', async () => {
    const padded = Buffer.concat([
      fixtures.files['ok-plain']!,
      Buffer.alloc(DOCX_MAX_FILE_BYTES - fixtures.files['ok-plain']!.byteLength, 0x61),
    ]);
    expect(padded.byteLength).toBe(DOCX_MAX_FILE_BYTES);
    await writeFile(join(workspaceRoot, 'exact.docx'), padded);
    const result = await readDocxDocument(workspaceRoot, 'exact.docx');
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.size).toBe(DOCX_MAX_FILE_BYTES);
      expect(result.document.revision).toBe(sha256Of(padded));
    }
  });

  it('超过 20 MiB 的文件在读取正文前被拒绝', async () => {
    await writeFile(
      join(workspaceRoot, 'big.docx'),
      Buffer.concat([fixtures.files['ok-plain']!, Buffer.alloc(21 * 1024 * 1024, 0x61)]),
    );
    const result = await readDocxDocument(workspaceRoot, 'big.docx');
    expect(expectError(result).code).toBe('TOO_LARGE');
  });

  it('文件在校验后增长：有界读取检测到超限并拒绝', async () => {
    const adapters: ReadDocxAdapters = {
      ...defaultReadDocxAdapters,
      readDocxBytes: () => Promise.resolve(new Uint8Array(DOCX_MAX_FILE_BYTES + 1)),
    };
    const result = await readDocxDocument(workspaceRoot, 'plain.docx', adapters);
    expect(expectError(result).code).toBe('TOO_LARGE');
  });

  it('非 ZIP / 缺失关键部件 / 加密模拟 / 伪装内容 → INVALID_DOCX', async () => {
    for (const id of [
      'fail-corrupt',
      'fail-fake-docx',
      'fail-missing-parts',
      'fail-encrypted-sim',
    ]) {
      await writeFile(join(workspaceRoot, `${id}.docx`), fixtures.files[id]!);
      const result = await readDocxDocument(workspaceRoot, `${id}.docx`);
      expect(expectError(result).code, id).toBe('INVALID_DOCX');
    }
  });

  it('空白文档变体：无 w:body / 空 body / 仅 sectPr / 空段落均按空白文档加载（不拒绝）', async () => {
    const ns =
      ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const variants: [string, string][] = [
      ['no-body', `<w:document${ns}/>`],
      ['empty-body', `<w:document${ns}><w:body/></w:document>`],
      ['sectpr-only', `<w:document${ns}><w:body><w:sectPr/></w:body></w:document>`],
      ['empty-paragraph', `<w:document${ns}><w:body><w:p/></w:body></w:document>`],
      [
        'whitespace-text',
        `<w:document${ns}><w:body><w:p><w:r><w:t xml:space="preserve">  </w:t></w:r></w:p></w:body></w:document>`,
      ],
    ];
    for (const [label, docXml] of variants) {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      );
      zip.file('word/document.xml', docXml);
      zip.file(
        'word/styles.xml',
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      );
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      await writeFile(join(workspaceRoot, `${label}.docx`), bytes);
      const result = await readDocxDocument(workspaceRoot, `${label}.docx`);
      expect(result.status, label).toBe('loaded');
      if (result.status === 'loaded') {
        expect(result.document.compatibility.level, label).toBe('supported');
        const text = result.document.model.blocks
          .map((block) =>
            block.kind === 'paragraph' || block.kind === 'heading'
              ? block.runs.map((run) => run.text).join('')
              : '',
          )
          .join('');
        expect(text.replace(/\s+/g, ''), label).toBe('');
      }
    }
  });

  it('意外异常转换为稳定 READ_FAILED，不泄漏原始 Error 或调用栈', async () => {
    const adapters: ReadDocxAdapters = {
      ...defaultReadDocxAdapters,
      readDocxBytes: () =>
        Promise.reject(new Error('秘密内部信息 C:\\secrets\\stack\n    at unknown (x.js:1:1)')),
    };
    const result = await readDocxDocument(workspaceRoot, 'plain.docx', adapters);
    const error = expectError(result);
    expect(error.code).toBe('READ_FAILED');
    expect(JSON.stringify(result)).not.toContain('秘密');
    expect(JSON.stringify(result)).not.toContain('secrets');
  });

  it('资源预算超限（关键 XML 超 1 MiB）→ RESOURCE_LIMIT_EXCEEDED', async () => {
    const zip = await import('jszip').then(({ default: JSZip }) => {
      const instance = new JSZip();
      instance.file(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      );
      instance.file(
        'word/document.xml',
        `<w:document>${'<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(40_000)}</w:document>`,
      );
      return instance.generateAsync({ type: 'nodebuffer' });
    });
    await writeFile(join(workspaceRoot, 'bigxml.docx'), zip);
    const result = await readDocxDocument(workspaceRoot, 'bigxml.docx');
    expect(expectError(result).code).toBe('RESOURCE_LIMIT_EXCEEDED');
  });

  it('错误消息稳定且不含路径或内部信息', async () => {
    const result = await readDocxDocument(workspaceRoot, 'missing.docx');
    const error: DocxDocumentError = expectError(result);
    expect(error.message).toBe('文件不存在或已被移除');
    expect(JSON.stringify(result)).not.toContain(workspaceRoot);
  });
});
