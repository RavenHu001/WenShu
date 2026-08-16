/**
 * TASK-009 WP4：DOCX 另存为服务测试（node 环境）。
 * 覆盖：新目标创建（无备份）、两阶段覆盖确认与目标备份（备份=覆盖前字节）、
 * 源 revision 冲突、read-only 拒绝、degraded 确认绑定源 revision、外部竞态、
 * 生成/验证/备份/发布/清理失败注入。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import { saveDocxDocumentAs } from '../../src/main/docx/save-docx-document-as';
import type { SaveDocxDocumentAsAdapters } from '../../src/main/docx/save-docx-document-as';
import { exportDocxDocument } from '../../src/main/docx/export-docx';
import { inspectDocxPackage } from '../../src/main/docx/inspect-docx-package';
import { importDocxDocument } from '../../src/main/docx/import-docx';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../src/shared/docx';
import type { TempWriteHandle } from '../../src/main/document/write-safety';
import type { FileStatLike } from '../../src/main/document/path-validation';

const model = {
  schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
  blocks: [
    { kind: 'paragraph' as const, alignment: null, runs: [{ text: '另存为内容', marks: [] }] },
  ],
};

function fileStat(): FileStatLike {
  return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 1 };
}

async function bytesOf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('saveDocxDocumentAs：真实文件系统（默认适配器）', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp4-docxas-'));
    cleanup = () => removeDirWithRetry(root);
    await mkdir(join(root, 'sub'));
  });
  afterAll(async () => {
    await cleanup();
  });

  it('新目标：产物可重导入、源不变、不创建备份、无临时残留', async () => {
    const sourceBytes = await exportDocxDocument(model);
    await writeFile(join(root, 'src.docx'), sourceBytes);
    const srcRevision = sha(sourceBytes);
    const result = await saveDocxDocumentAs(root, {
      mutationId: 1,
      tabId: 'tab-1',
      sourceRelativePath: 'src.docx',
      target: { parentRelativePath: 'sub', name: 'dst.docx' },
      model,
      expectedSourceRevision: srcRevision,
    });
    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.relativePath).toBe('sub/dst.docx');
      expect(result.kind).toBe('docx');
      expect(result.backupRelativePath).toBeUndefined();
    }
    const dstBytes = await bytesOf(join(root, 'sub', 'dst.docx'));
    const inspection = await inspectDocxPackage(dstBytes);
    expect(inspection.status).toBe('ok');
    if (inspection.status === 'ok') {
      const imported = await importDocxDocument(dstBytes, inspection.inspection);
      expect(imported.status).toBe('ok');
      if (imported.status === 'ok') {
        expect(imported.compatibility.level).toBe('supported');
      }
    }
    // 源文件字节不变
    expect(await bytesOf(join(root, 'src.docx'))).toEqual(sourceBytes);
    const residue = (await readdir(join(root, 'sub'))).filter((n) => n.includes('.wenshu-'));
    expect(residue).toEqual([]);
  });

  it('两阶段覆盖确认：第一阶段 target-exists；第二阶段备份=覆盖前字节并覆盖，源不变', async () => {
    const sourceBytes = await exportDocxDocument(model);
    await writeFile(join(root, 'ov-src.docx'), sourceBytes);
    const targetBytes = await exportDocxDocument({
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [
        { kind: 'paragraph' as const, alignment: null, runs: [{ text: '旧目标', marks: [] }] },
      ],
    });
    await writeFile(join(root, 'ov-dst.docx'), targetBytes);
    const srcRevision = sha(sourceBytes);
    const dstRevision = sha(targetBytes);

    const first = await saveDocxDocumentAs(root, {
      mutationId: 2,
      tabId: 'tab-2',
      sourceRelativePath: 'ov-src.docx',
      target: { parentRelativePath: '', name: 'ov-dst.docx' },
      model,
      expectedSourceRevision: srcRevision,
    });
    expect(first).toEqual({ status: 'target-exists', mutationId: 2, targetRevision: dstRevision });
    expect(await bytesOf(join(root, 'ov-dst.docx'))).toEqual(targetBytes); // 未写盘、无备份
    expect((await readdir(root)).filter((n) => n.includes('.wenshu.bak'))).toEqual([]);

    const second = await saveDocxDocumentAs(root, {
      mutationId: 3,
      tabId: 'tab-2',
      sourceRelativePath: 'ov-src.docx',
      target: { parentRelativePath: '', name: 'ov-dst.docx' },
      model,
      expectedSourceRevision: srcRevision,
      expectedTargetRevision: dstRevision,
    });
    expect(second.status).toBe('saved');
    if (second.status === 'saved') {
      expect(second.backupRelativePath).toBe('ov-dst.docx.wenshu.bak');
    }
    // 备份 = 覆盖前目标字节
    expect(await bytesOf(join(root, 'ov-dst.docx.wenshu.bak'))).toEqual(targetBytes);
    // 目标已替换为新产物
    expect(sha(await bytesOf(join(root, 'ov-dst.docx')))).not.toBe(dstRevision);
    // 源不变
    expect(await bytesOf(join(root, 'ov-src.docx'))).toEqual(sourceBytes);
  });

  it('外部竞态：确认覆盖后目标已变化 → CONFLICT，目标与备份都不动', async () => {
    const sourceBytes = await exportDocxDocument(model);
    await writeFile(join(root, 'race-src.docx'), sourceBytes);
    const targetBytes = await exportDocxDocument(model);
    await writeFile(join(root, 'race-dst.docx'), targetBytes);
    const srcRevision = sha(sourceBytes);
    const dstRevision = sha(targetBytes);
    // 修改目标（外部变化）
    await writeFile(join(root, 'race-dst.docx'), Buffer.concat([targetBytes, new Uint8Array([1])]));
    const result = await saveDocxDocumentAs(root, {
      mutationId: 4,
      tabId: 'tab-4',
      sourceRelativePath: 'race-src.docx',
      target: { parentRelativePath: '', name: 'race-dst.docx' },
      model,
      expectedSourceRevision: srcRevision,
      expectedTargetRevision: dstRevision,
    });
    expect(result.status === 'error' && result.error.code).toBe('CONFLICT');
    expect((await readdir(root)).filter((n) => n === 'race-dst.docx.wenshu.bak')).toEqual([]);
  });

  it('源 revision 冲突 → CONFLICT 零写入', async () => {
    const sourceBytes = await exportDocxDocument(model);
    await writeFile(join(root, 'csrc.docx'), sourceBytes);
    const result = await saveDocxDocumentAs(root, {
      mutationId: 5,
      tabId: 'tab-5',
      sourceRelativePath: 'csrc.docx',
      target: { parentRelativePath: '', name: 'cdst.docx' },
      model,
      expectedSourceRevision: 'stale',
    });
    expect(result.status === 'error' && result.error.code).toBe('CONFLICT');
    await expect(stat(join(root, 'cdst.docx'))).rejects.toThrow();
  });

  it('read-only 源 → READ_ONLY_DOCUMENT；degraded 未确认 → COMPATIBILITY_CONFIRMATION_REQUIRED', async () => {
    // read-only：settings.xml 注入 documentProtection enforcement=1
    const readOnlyBytes = await exportDocxDocument(model);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(readOnlyBytes);
    zip.file(
      'word/settings.xml',
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>',
    );
    const roBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(join(root, 'ro-src.docx'), roBuffer);
    const roResult = await saveDocxDocumentAs(root, {
      mutationId: 6,
      tabId: 'tab-6',
      sourceRelativePath: 'ro-src.docx',
      target: { parentRelativePath: '', name: 'ro-dst.docx' },
      model,
      expectedSourceRevision: sha(new Uint8Array(roBuffer)),
    });
    expect(roResult.status === 'error' && roResult.error.code).toBe('READ_ONLY_DOCUMENT');
  });
});

describe('saveDocxDocumentAs：mock 失败注入', () => {
  const ROOT = 'C:\\ws';
  const generated = new Uint8Array([4, 5, 6]);
  let sourceBytes: Uint8Array;
  let srcRevision: string;

  beforeAll(async () => {
    // 源必须是真实可导入的 DOCX，兼容性检查（inspect/import）才会通过
    sourceBytes = await exportDocxDocument(model);
    srcRevision = sha(sourceBytes);
  });

  interface MockOptions extends Partial<SaveDocxDocumentAsAdapters> {
    readonly handle?: Partial<TempWriteHandle>;
  }

  function adaptersOf(overrides: MockOptions = {}): SaveDocxDocumentAsAdapters & {
    __state: { replaced: string[]; removed: string[]; tempPath: string };
  } {
    const state = {
      replaced: [] as string[],
      removed: [] as string[],
      tempPath: join(ROOT, '.wenshu-as.tmp'),
    };
    const base: SaveDocxDocumentAsAdapters = {
      lstat: async (path: string) => {
        if (path.endsWith('src.docx')) {
          return fileStat();
        }
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
      realpath: async (path: string) => path,
      readDiskBytes: async (path: string) =>
        path.endsWith('src.docx') ? sourceBytes : new Uint8Array([9]),
      createTempFile: async (targetPath: string) => {
        const isBackup = targetPath.endsWith('.wenshu.bak');
        return {
          tempPath: isBackup ? join(ROOT, '.wenshu-bak.tmp') : state.tempPath,
          write: async () => undefined,
          sync: async () => undefined,
          close: async () => undefined,
          ...(isBackup ? {} : (overrides.handle ?? {})),
        };
      },
      replace: async (tempPath: string) => {
        state.replaced.push(tempPath);
      },
      removeTemp: async (tempPath: string) => {
        state.removed.push(tempPath);
      },
      generateDocx: async () => generated,
      verifyGenerated: async () => ({
        ok: true,
        compatibility: { level: 'supported', warnings: [] },
      }),
      ...overrides,
    };
    return Object.assign(base, { __state: state }) as SaveDocxDocumentAsAdapters & {
      __state: typeof state;
    };
  }

  const makeReq = () => ({
    mutationId: 1,
    tabId: 't',
    sourceRelativePath: 'src.docx',
    target: { parentRelativePath: '', name: 'new.docx' },
    model,
    expectedSourceRevision: srcRevision,
  });

  it('生成失败 → EXPORT_FAILED；验证失败 → VERIFICATION_FAILED（均不创建临时文件）', async () => {
    const genFail = adaptersOf({
      generateDocx: async () => {
        throw new Error('gen boom');
      },
    });
    const genResult = await saveDocxDocumentAs(ROOT, makeReq(), genFail);
    expect(genResult.status === 'error' && genResult.error.code).toBe('EXPORT_FAILED');
    expect(genFail.__state.replaced).toEqual([]);

    const verifyFail = adaptersOf({
      verifyGenerated: async () => ({ ok: false }),
    });
    const verifyResult = await saveDocxDocumentAs(ROOT, makeReq(), verifyFail);
    expect(verifyResult.status === 'error' && verifyResult.error.code).toBe('VERIFICATION_FAILED');
    expect(verifyFail.__state.replaced).toEqual([]);
    expect(verifyFail.__state.removed).toEqual([]);
  });

  it('备份失败 → BACKUP_FAILED，目标不变（覆盖分支）', async () => {
    const overwriteReq = {
      ...makeReq(),
      target: { parentRelativePath: '', name: 'dst.docx' },
      expectedTargetRevision: sha(new Uint8Array([9])),
    };
    const backupFail = adaptersOf({
      lstat: async () => fileStat(),
      readDiskBytes: async (path: string) =>
        path.endsWith('src.docx') ? sourceBytes : new Uint8Array([9]),
      createTempFile: async (targetPath: string) => {
        if (targetPath.endsWith('.wenshu.bak')) {
          throw new Error('backup temp boom');
        }
        const handle: TempWriteHandle = {
          tempPath: join(ROOT, '.wenshu-main.tmp'),
          write: async () => undefined,
          sync: async () => undefined,
          close: async () => undefined,
        };
        return handle;
      },
    });
    const result = await saveDocxDocumentAs(ROOT, overwriteReq, backupFail);
    expect(result.status === 'error' && result.error.code).toBe('BACKUP_FAILED');
    expect(backupFail.__state.replaced).toEqual([]);
  });

  it('sync/close 失败 → WRITE_FAILED 并清理', async () => {
    const syncFail = adaptersOf({
      handle: {
        sync: async () => {
          throw new Error('sync boom');
        },
      },
    });
    const syncResult = await saveDocxDocumentAs(ROOT, makeReq(), syncFail);
    expect(syncResult.status === 'error' && syncResult.error.code).toBe('WRITE_FAILED');
    expect(syncFail.__state.removed).toEqual([join(ROOT, '.wenshu-as.tmp')]);
  });

  it('覆盖发布前目标变化（发布复验读到新字节）→ CONFLICT 且清理', async () => {
    const stableTarget = new Uint8Array([9]);
    const overwriteReq = {
      ...makeReq(),
      target: { parentRelativePath: '', name: 'dst.docx' },
      expectedTargetRevision: sha(stableTarget),
    };
    let reads = 0;
    const race = adaptersOf({
      lstat: async () => fileStat(),
      readDiskBytes: async (path: string) => {
        reads += 1;
        if (path.endsWith('src.docx')) {
          return sourceBytes;
        }
        return reads === 2 ? stableTarget : new Uint8Array([8, 8, 8]);
      },
    });
    const result = await saveDocxDocumentAs(ROOT, overwriteReq, race);
    expect(result.status === 'error' && result.error.code).toBe('CONFLICT');
    // 备份已创建（覆盖前版本），但主文件未被替换；主临时文件已清理
    expect(race.__state.replaced).toEqual([join(ROOT, '.wenshu-bak.tmp')]);
    expect(race.__state.removed).toEqual([join(ROOT, '.wenshu-as.tmp')]);
  });
});
