/**
 * TASK-007 WP4：DOCX 固定 IPC 处理器测试（任务第 8.5 节）。
 * 覆盖：只注册固定通道、参数数量、字段白名单、字段类型、模型运行时校验（结构+预算）、
 * 拒绝根路径/绝对路径/临时路径/备份路径/原始 HTML/XML/危险策略字段、
 * 主进程结果不泄漏内部对象或原始异常。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReadDocxDocumentResult, SaveDocxDocumentResult } from '../../src/shared/docx';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../src/shared/docx';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ getCurrentWorkspaceRoot: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));
vi.mock('../../src/main/workspace/workspace-session', () => sessionMock);
vi.mock('../../src/main/docx/read-docx-document', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/main/docx/read-docx-document')>();
  return { ...original, readDocxDocument: vi.fn(original.readDocxDocument) };
});
vi.mock('../../src/main/docx/save-docx-document', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/main/docx/save-docx-document')>();
  return { ...original, saveDocxDocument: vi.fn(original.saveDocxDocument) };
});

import { registerDocxIpc } from '../../src/main/docx/docx-ipc';
import { readDocxDocument } from '../../src/main/docx/read-docx-document';
import { saveDocxDocument } from '../../src/main/docx/save-docx-document';

type IpcListener = (...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, IpcListener>();
ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
  handlers.set(channel, listener);
});

function validModel() {
  return { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: [] };
}

function expectSaveError(result: SaveDocxDocumentResult): { code: string } {
  expect(result.status).toBe('error');
  if (result.status !== 'error') {
    throw new Error('unreachable');
  }
  return result.error;
}

describe('registerDocxIpc', () => {
  it('注册保持幂等：重复调用不会重复注册处理器', () => {
    expect(ipcMainMock.handle).not.toHaveBeenCalled();
    registerDocxIpc();
    registerDocxIpc();
    expect(ipcMainMock.handle).toHaveBeenCalledTimes(2);
  });

  it('只注册 document:read-docx 与 document:save-docx 两个固定通道', () => {
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(['document:read-docx', 'document:save-docx']);
    expect(channels.some((c) => c.startsWith('file:') || c.startsWith('fs:'))).toBe(false);
  });
});

describe('document:read-docx 处理器', () => {
  let workspaceRoot: string;
  const invoke = async (...args: unknown[]): Promise<ReadDocxDocumentResult> =>
    (await handlers.get('document:read-docx')!({}, ...args)) as ReadDocxDocumentResult;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-docx-ipc-'));
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
  });

  afterEach(async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    vi.mocked(readDocxDocument).mockClear();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('参数数量错误 → INVALID_PATH，不调用读取器', async () => {
    for (const args of [[], ['a.docx', 'b.docx']]) {
      const result = await invoke(...args);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('INVALID_PATH');
      }
    }
    expect(vi.mocked(readDocxDocument)).not.toHaveBeenCalled();
  });

  it('非字符串路径 → INVALID_PATH', async () => {
    const result = await invoke(42);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_PATH');
    }
  });

  it('未打开工作区 → NO_WORKSPACE', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const result = await invoke('a.docx');
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('NO_WORKSPACE');
    }
    expect(vi.mocked(readDocxDocument)).not.toHaveBeenCalled();
  });

  it('只接受相对路径并交给读取器（根路径来自会话快照）', async () => {
    const loaded: ReadDocxDocumentResult = {
      status: 'error',
      error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
    };
    vi.mocked(readDocxDocument).mockResolvedValue(loaded);
    const result = await invoke('sub/a.docx');
    expect(result).toBe(loaded);
    expect(vi.mocked(readDocxDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readDocxDocument)).toHaveBeenCalledWith(workspaceRoot, 'sub/a.docx');
  });
});

describe('document:save-docx 处理器', () => {
  let workspaceRoot: string;
  const invoke = async (...args: unknown[]): Promise<SaveDocxDocumentResult> =>
    (await handlers.get('document:save-docx')!({}, ...args)) as SaveDocxDocumentResult;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-docx-ipc-save-'));
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
  });

  afterEach(async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    vi.mocked(saveDocxDocument).mockClear();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it.each([
    ['0 个参数', () => handlers.get('document:save-docx')!({})],
    ['2 个参数', () => handlers.get('document:save-docx')!({}, {}, {})],
  ])('拒绝错误参数数量：%s', async (_label, invokeWrong) => {
    const result = (await invokeWrong()) as SaveDocxDocumentResult;
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['字符串', 'a.docx'],
    ['数字', 42],
    ['数组', ['a.docx']],
  ])('拒绝非对象请求：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['workspaceRoot', 'C:/fake'],
    ['absolutePath', 'C:/fake/a.docx'],
    ['tempPath', 'C:/fake/.wenshu-x.tmp'],
    ['backupPath', 'C:/fake/a.docx.wenshu.bak'],
    ['html', '<p>uncleaned</p>'],
    ['xml', '<w:document/>'],
    ['strategy', 'overwrite'],
    ['force', true],
    ['skipBackup', true],
    ['channel', 'fs:write'],
    ['flags', 'w'],
  ])('拒绝多余危险字段：%s', async (_label, extraKey) => {
    const request = {
      relativePath: 'a.docx',
      expectedRevision: 'a'.repeat(64),
      model: validModel(),
      [extraKey as string]: 'dangerous',
    };
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['relativePath 缺失', { expectedRevision: 'a'.repeat(64), model: validModel() }],
    ['expectedRevision 缺失', { relativePath: 'a.docx', model: validModel() }],
    ['model 缺失', { relativePath: 'a.docx', expectedRevision: 'a'.repeat(64) }],
    [
      'expectedRevision 空串',
      { relativePath: 'a.docx', expectedRevision: '', model: validModel() },
    ],
  ])('拒绝缺失或非法必需字段：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it.each([
    [
      'relativePath 非字符串',
      { relativePath: 42, expectedRevision: 'a'.repeat(64), model: validModel() },
    ],
    [
      'expectedRevision 非字符串',
      { relativePath: 'a.docx', expectedRevision: 42, model: validModel() },
    ],
    ['model 非对象', { relativePath: 'a.docx', expectedRevision: 'a'.repeat(64), model: 'x' }],
    ['model 数组', { relativePath: 'a.docx', expectedRevision: 'a'.repeat(64), model: [] }],
    [
      'compatibilityConfirmationRevision 空串',
      {
        relativePath: 'a.docx',
        expectedRevision: 'a'.repeat(64),
        model: validModel(),
        compatibilityConfirmationRevision: '',
      },
    ],
    [
      'compatibilityConfirmationRevision 非字符串',
      {
        relativePath: 'a.docx',
        expectedRevision: 'a'.repeat(64),
        model: validModel(),
        compatibilityConfirmationRevision: 7,
      },
    ],
  ])('拒绝类型错误字段：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['未知 schemaVersion', { schemaVersion: 2, blocks: [] }],
    ['非法块类型', { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: [{ kind: 'image' }] }],
    [
      '空列表块',
      {
        schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
        blocks: [{ kind: 'bullet-list', level: 0, blocks: [] }],
      },
    ],
    [
      '非法颜色',
      {
        schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
        blocks: [
          {
            kind: 'paragraph',
            alignment: null,
            runs: [{ text: 'x', marks: [{ type: 'color', value: '#gggggg' }] }],
          },
        ],
      },
    ],
  ])('模型运行时校验拒绝：%s', async (_label, model) => {
    const request = { relativePath: 'a.docx', expectedRevision: 'a'.repeat(64), model };
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveDocxDocument)).not.toHaveBeenCalled();
  });

  it('合法请求交给保存器（根路径来自会话快照），结果透明透传', async () => {
    const saved: SaveDocxDocumentResult = {
      status: 'saved',
      document: {
        kind: 'docx',
        name: 'a.docx',
        relativePath: 'a.docx',
        revision: 'b'.repeat(64),
        size: 10,
        model: validModel(),
        compatibility: { level: 'supported', warnings: [] },
      },
      backupRelativePath: 'a.docx.wenshu.bak',
    };
    vi.mocked(saveDocxDocument).mockResolvedValue(saved);
    const request = {
      relativePath: 'a.docx',
      expectedRevision: 'a'.repeat(64),
      model: validModel(),
      compatibilityConfirmationRevision: 'a'.repeat(64),
    };
    const result = await invoke(request);
    expect(result).toBe(saved);
    expect(vi.mocked(saveDocxDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveDocxDocument)).toHaveBeenCalledWith(workspaceRoot, request);
  });

  it('意外异常转换为稳定 WRITE_FAILED，不泄漏内部错误', async () => {
    vi.mocked(saveDocxDocument).mockRejectedValue(new Error('秘密内部信息 C:\\secrets'));
    const result = await invoke({
      relativePath: 'a.docx',
      expectedRevision: 'a'.repeat(64),
      model: validModel(),
    });
    expect(expectSaveError(result).code).toBe('WRITE_FAILED');
    expect(JSON.stringify(result)).not.toContain('秘密');
    expect(JSON.stringify(result)).not.toContain('secrets');
  });
});
