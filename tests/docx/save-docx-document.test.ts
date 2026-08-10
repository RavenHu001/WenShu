/**
 * TASK-007 WP3：DOCX 安全保存器测试（任务第 8.4 节）。
 * 覆盖：revision 冲突零写入、滚动备份等于保存前原文件、备份/导出/验证/临时写入/
 * sync/close/替换/保存期间变化等全部失败点注入、失败不删除不截断原文件、
 * 临时文件清理与清理错误隔离、degraded 确认/确认过期/read-only/非法模型拒绝、
 * 成功产物可重新导入、备份相对路径。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import {
  DOCX_MODEL_SCHEMA_VERSION,
  type DocxDocumentModel,
  type SaveDocxDocumentRequest,
} from '../../src/shared/docx';
import {
  defaultSaveDocxAdapters,
  saveDocxDocument,
  type SaveDocxAdapters,
} from '../../src/main/docx/save-docx-document';
import type { TempWriteHandle } from '../../src/main/document/write-safety';
import { readDocxDocument } from '../../src/main/docx/read-docx-document';
import { buildDocxFixtures } from './docx-fixture-builder';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sampleModel(text = '保存后的新内容'): DocxDocumentModel {
  return {
    schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
    blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text, marks: [] }] }],
  };
}

function makeRequest(overrides: Partial<SaveDocxDocumentRequest> = {}): SaveDocxDocumentRequest {
  return { relativePath: 'a.docx', expectedRevision: 'rev', model: sampleModel(), ...overrides };
}

/** 从默认适配器派生的可注入 mock 集合。 */
function mockAdapters(overrides: Partial<SaveDocxAdapters> = {}): SaveDocxAdapters {
  return { ...defaultSaveDocxAdapters, ...overrides };
}

async function noWenshuTemps(dir: string): Promise<void> {
  const names = await readdir(dir);
  expect(names.filter((n) => n.startsWith('.wenshu-'))).toEqual([]);
}

/** 把夹具写入临时工作区并读取其 revision。 */
async function setupFixtureIn(workspaceRoot: string, id: string): Promise<string> {
  const fixtures = await buildDocxFixtures();
  await writeFile(join(workspaceRoot, 'a.docx'), fixtures.files[id]!);
  const result = await readDocxDocument(workspaceRoot, 'a.docx');
  expect(result.status).toBe('loaded');
  if (result.status !== 'loaded') {
    throw new Error('unreachable');
  }
  return result.document.revision;
}

describe('saveDocxDocument：成功路径与滚动备份（第 8.4 节）', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-save-ws-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('expectedRevision 匹配时成功保存：目标替换、备份等于保存前原文件、返回新 revision', async () => {
    const fixtures = await buildDocxFixtures();
    const original = fixtures.files['ok-plain']!;
    await writeFile(join(workspaceRoot, 'a.docx'), original);
    const read = await readDocxDocument(workspaceRoot, 'a.docx');
    expect(read.status).toBe('loaded');
    if (read.status !== 'loaded') {
      return;
    }
    const model = sampleModel();
    const result = await saveDocxDocument(workspaceRoot, {
      relativePath: 'a.docx',
      expectedRevision: read.document.revision,
      model,
    });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') {
      return;
    }
    // 备份相对路径与内容
    expect(result.backupRelativePath).toBe('a.docx.wenshu.bak');
    const backupBytes = await readFile(join(workspaceRoot, 'a.docx.wenshu.bak'));
    expect(Buffer.from(backupBytes).equals(original)).toBe(true);
    // 目标被新产物替换且可重新读取
    const diskBytes = await readFile(join(workspaceRoot, 'a.docx'));
    expect(Buffer.from(diskBytes).equals(original)).toBe(false);
    const reload = await readDocxDocument(workspaceRoot, 'a.docx');
    expect(reload.status).toBe('loaded');
    if (reload.status === 'loaded') {
      expect(reload.document.revision).toBe(result.document.revision);
      expect(reload.document.size).toBe(result.document.size);
      expect(reload.document.compatibility.level).toBe('supported');
      const text = reload.document.model.blocks[0];
      expect(text).toBeDefined();
      if (text?.kind === 'paragraph') {
        expect(text.runs[0]?.text).toBe('保存后的新内容');
      }
    }
    // 无临时文件残留
    await noWenshuTemps(workspaceRoot);
  });

  it('revision 不一致返回 CONFLICT 且零写入（无备份、无临时文件）', async () => {
    const fixtures = await buildDocxFixtures();
    const original = fixtures.files['ok-plain']!;
    await writeFile(join(workspaceRoot, 'a.docx'), original);
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: 'wrong-rev' }),
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('CONFLICT');
    }
    const diskBytes = await readFile(join(workspaceRoot, 'a.docx'));
    expect(Buffer.from(diskBytes).equals(original)).toBe(true);
    await expect(readFile(join(workspaceRoot, 'a.docx.wenshu.bak'))).rejects.toThrow();
    await noWenshuTemps(workspaceRoot);
  });

  it('degraded 未确认 → COMPATIBILITY_CONFIRMATION_REQUIRED；确认后保存成功', async () => {
    const revision = await setupFixtureIn(workspaceRoot, 'complex-image');
    const unconfirmed = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: revision }),
    );
    expect(unconfirmed.status).toBe('error');
    if (unconfirmed.status === 'error') {
      expect(unconfirmed.error.code).toBe('COMPATIBILITY_CONFIRMATION_REQUIRED');
    }
    const confirmed = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: revision, compatibilityConfirmationRevision: revision }),
    );
    expect(confirmed.status).toBe('saved');
  });

  it('确认 revision 过期（≠ 当前磁盘 revision）→ COMPATIBILITY_CONFIRMATION_REQUIRED', async () => {
    // 确认绑定的是"打开时"的 revision；磁盘仍是 degraded 文档但确认已过期 → 拒绝
    const revision = await setupFixtureIn(workspaceRoot, 'complex-image');
    const stale = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: revision, compatibilityConfirmationRevision: 'stale-rev' }),
    );
    expect(stale.status).toBe('error');
    if (stale.status === 'error') {
      expect(stale.error.code).toBe('COMPATIBILITY_CONFIRMATION_REQUIRED');
    }
  });

  it('read-only 文档 → READ_ONLY_DOCUMENT', async () => {
    // 手写：合法 docx + word/embeddings/ 部件（检测为嵌入对象 → read-only）
    const fixtures = await buildDocxFixtures();
    const zip = await JSZip.loadAsync(fixtures.files['ok-plain']!);
    zip.file('word/embeddings/oleObject1.bin', Buffer.from([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await writeFile(join(workspaceRoot, 'a.docx'), bytes);
    const read = await readDocxDocument(workspaceRoot, 'a.docx');
    expect(read.status).toBe('loaded');
    if (read.status !== 'loaded') {
      return;
    }
    expect(read.document.compatibility.level).toBe('read-only');
    const result = await saveDocxDocument(workspaceRoot, {
      relativePath: 'a.docx',
      expectedRevision: read.document.revision,
      model: sampleModel(),
      compatibilityConfirmationRevision: read.document.revision,
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('READ_ONLY_DOCUMENT');
    }
  });

  it('非法模型 → INVALID_REQUEST（未知 schemaVersion）', async () => {
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ model: { schemaVersion: 2, blocks: [] } as never }),
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('路径与扩展名错误', async () => {
    expect((await saveDocxDocument('', makeRequest())).status).toBe('error');
    const noWs = await saveDocxDocument('', makeRequest());
    if (noWs.status === 'error') {
      expect(noWs.error.code).toBe('NO_WORKSPACE');
    }
    const badPath = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ relativePath: 'a\\b.docx' }),
    );
    if (badPath.status === 'error') {
      expect(badPath.error.code).toBe('INVALID_PATH');
    }
    const badExt = await saveDocxDocument(workspaceRoot, makeRequest({ relativePath: 'a.txt' }));
    if (badExt.status === 'error') {
      expect(badExt.error.code).toBe('UNSUPPORTED_TYPE');
    }
    const missing = await saveDocxDocument(workspaceRoot, makeRequest());
    if (missing.status === 'error') {
      expect(missing.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('saveDocxDocument：失败点注入（第 8.4 节）', () => {
  let workspaceRoot: string;
  let original: Buffer;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-save-mock-'));
    const fixtures = await buildDocxFixtures();
    original = fixtures.files['ok-plain']!;
    await writeFile(join(workspaceRoot, 'a.docx'), original);
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const goodAdapters = (): SaveDocxAdapters => ({
    ...defaultSaveDocxAdapters,
    readDiskBytes: vi.fn(async () => original),
  });

  /** mock 环境下的合法 expectedRevision：磁盘字节的真实 SHA-256（beforeEach 后取值）。 */
  const currentRevision = (): string => sha256Of(original);

  it('备份阶段失败 → BACKUP_FAILED，目标不变、无临时残留', async () => {
    const adapters = mockAdapters({
      ...goodAdapters(),
      createTempFile: vi.fn(() => Promise.reject(errno('EACCES'))),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('BACKUP_FAILED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
    await noWenshuTemps(workspaceRoot);
  });

  it('导出失败 → EXPORT_FAILED', async () => {
    const adapters = mockAdapters({
      ...goodAdapters(),
      generateDocx: vi.fn(() => Promise.reject(new Error('export boom'))),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('EXPORT_FAILED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
  });

  it('产物验证失败 → VERIFICATION_FAILED', async () => {
    const adapters = mockAdapters({
      ...goodAdapters(),
      verifyGenerated: vi.fn(async (): Promise<{ ok: false }> => ({ ok: false })),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('VERIFICATION_FAILED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
  });

  it('生成产物超过 20 MiB → 默认验证拒绝 → VERIFICATION_FAILED', async () => {
    const adapters = mockAdapters({
      ...goodAdapters(),
      generateDocx: vi.fn(async () => new Uint8Array(20 * 1024 * 1024 + 1)),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('VERIFICATION_FAILED');
    }
  });

  it('目标临时文件创建失败（第 2 次）→ ACCESS_DENIED，备份已生成但目标不变', async () => {
    let calls = 0;
    const adapters = mockAdapters({
      ...goodAdapters(),
      createTempFile: vi.fn((targetPath: string) => {
        calls += 1;
        return calls === 1
          ? defaultSaveDocxAdapters.createTempFile(targetPath)
          : Promise.reject(errno('EACCES'));
      }),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('ACCESS_DENIED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
    await noWenshuTemps(workspaceRoot);
  });

  it.each([
    [
      '写入失败',
      (handle: TempWriteHandle) => {
        handle.write = () => Promise.reject(errno('ENOSPC'));
      },
    ],
    [
      'sync 失败',
      (handle: TempWriteHandle) => {
        handle.sync = () => Promise.reject(errno('EIO'));
      },
    ],
    [
      'close 失败',
      (handle: TempWriteHandle) => {
        handle.close = () => Promise.reject(errno('EIO'));
      },
    ],
  ])('目标临时文件%s → WRITE_FAILED，临时文件被清理', async (_label, breakHandle) => {
    let calls = 0;
    const createTempFile = vi.fn((targetPath: string) => {
      calls += 1;
      if (calls === 1) {
        return defaultSaveDocxAdapters.createTempFile(targetPath);
      }
      return defaultSaveDocxAdapters.createTempFile(targetPath).then((handle) => {
        breakHandle(handle);
        return handle;
      });
    });
    const removeTemp = vi.fn((path: string) => defaultSaveDocxAdapters.removeTemp(path));
    const adapters = mockAdapters({ ...goodAdapters(), createTempFile, removeTemp });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('WRITE_FAILED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
    await noWenshuTemps(workspaceRoot);
    expect(removeTemp).toHaveBeenCalled();
  });

  it('目标替换失败（第 2 次 replace）→ ACCESS_DENIED，原文件保留、临时清理', async () => {
    let replaceCalls = 0;
    const removeTemp = vi.fn((path: string) => defaultSaveDocxAdapters.removeTemp(path));
    const adapters = mockAdapters({
      ...goodAdapters(),
      replace: vi.fn((tempPath: string, targetPath: string) => {
        replaceCalls += 1;
        return replaceCalls === 1
          ? defaultSaveDocxAdapters.replace(tempPath, targetPath)
          : Promise.reject(errno('EACCES'));
      }),
      removeTemp,
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('ACCESS_DENIED');
    }
    expect(Buffer.from(await readFile(join(workspaceRoot, 'a.docx'))).equals(original)).toBe(true);
    expect(removeTemp).toHaveBeenCalled();
    await noWenshuTemps(workspaceRoot);
  });

  it('保存期间目标变化（替换前 revision 复检不一致）→ CONFLICT，临时清理', async () => {
    const changed = Buffer.concat([original, Buffer.from([0x00])]);
    const readDiskBytes = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(changed);
    const removeTemp = vi.fn((path: string) => defaultSaveDocxAdapters.removeTemp(path));
    const adapters = mockAdapters({ ...goodAdapters(), readDiskBytes, removeTemp });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('CONFLICT');
    }
    expect(removeTemp).toHaveBeenCalled();
    await noWenshuTemps(workspaceRoot);
  });

  it('清理失败不覆盖主要错误（替换失败仍返回 ACCESS_DENIED）', async () => {
    let replaceCalls = 0;
    const adapters = mockAdapters({
      ...goodAdapters(),
      replace: vi.fn((tempPath: string, targetPath: string) => {
        replaceCalls += 1;
        return replaceCalls === 1
          ? defaultSaveDocxAdapters.replace(tempPath, targetPath)
          : Promise.reject(errno('EACCES'));
      }),
      removeTemp: vi.fn(() => Promise.reject(errno('EPERM'))),
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('ACCESS_DENIED');
    }
  });

  it('备份失败时清理备份临时文件（备份 replace 失败）', async () => {
    const removeTemp = vi.fn((path: string) => defaultSaveDocxAdapters.removeTemp(path));
    const adapters = mockAdapters({
      ...goodAdapters(),
      replace: vi.fn(() => Promise.reject(errno('EACCES'))),
      removeTemp,
    });
    const result = await saveDocxDocument(
      workspaceRoot,
      makeRequest({ expectedRevision: currentRevision() }),
      adapters,
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('BACKUP_FAILED');
    }
    expect(removeTemp).toHaveBeenCalled();
    await noWenshuTemps(workspaceRoot);
  });

  it('无工作区 / 非法请求形状', async () => {
    const noWs = await saveDocxDocument('', makeRequest());
    if (noWs.status === 'error') {
      expect(noWs.error.code).toBe('NO_WORKSPACE');
    }
    const invalid = await saveDocxDocument(workspaceRoot, null as never);
    if (invalid.status === 'error') {
      expect(invalid.error.code).toBe('INVALID_REQUEST');
    }
    const invalidModel = await saveDocxDocument(
      workspaceRoot,
      makeRequest({
        model: { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: [{ kind: 'image' }] } as never,
      }),
    );
    if (invalidModel.status === 'error') {
      expect(invalidModel.error.code).toBe('INVALID_REQUEST');
    }
  });
});
