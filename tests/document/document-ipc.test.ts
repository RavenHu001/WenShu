import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SaveTextDocumentResult } from '../../src/shared/document';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ getCurrentWorkspaceRoot: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));
vi.mock('../../src/main/workspace/workspace-session', () => sessionMock);
vi.mock('../../src/main/document/save-text-document', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/main/document/save-text-document')>();
  return { ...original, saveTextDocument: vi.fn(original.saveTextDocument) };
});

import { registerDocumentIpc } from '../../src/main/document/document-ipc';
import { saveTextDocument } from '../../src/main/document/save-text-document';

type IpcListener = (...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, IpcListener>();
ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
  handlers.set(channel, listener);
});

function expectSaveError(result: SaveTextDocumentResult): { code: string } {
  expect(result.status).toBe('error');
  if (result.status !== 'error') {
    throw new Error('unreachable');
  }
  return result.error;
}

describe('registerDocumentIpc', () => {
  it('注册保持幂等：重复调用不会重复注册处理器', () => {
    expect(ipcMainMock.handle).not.toHaveBeenCalled();
    registerDocumentIpc();
    registerDocumentIpc();
    expect(ipcMainMock.handle).toHaveBeenCalledTimes(2);
  });

  it('只注册 document:read-text 与 document:save-text 两个固定通道', () => {
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(['document:read-text', 'document:save-text']);
    expect(channels.some((c) => c.startsWith('file:') || c.startsWith('fs:'))).toBe(false);
  });
});

describe('document:save-text 处理器', () => {
  let workspaceRoot: string;
  const invoke = async (request: unknown): Promise<SaveTextDocumentResult> =>
    (await handlers.get('document:save-text')!({}, request)) as SaveTextDocumentResult;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-ipc-save-'));
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
  });

  afterEach(async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    vi.mocked(saveTextDocument).mockClear();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it.each([
    ['0 个参数', () => handlers.get('document:save-text')!({})],
    ['2 个参数', () => handlers.get('document:save-text')!({}, {}, {})],
  ])('拒绝错误参数数量：%s', async (_label, invokeWrong) => {
    const result = (await invokeWrong()) as SaveTextDocumentResult;
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveTextDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['字符串', 'a.txt'],
    ['数字', 42],
    ['数组', ['a.txt']],
  ])('拒绝非对象请求：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveTextDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['workspaceRoot', 'C:/fake'],
    ['absolutePath', 'C:/fake/a.txt'],
    ['tempPath', 'C:/fake/.tmp'],
    ['encoding', 'utf-16le'],
    ['strategy', 'overwrite'],
    ['channel', 'fs:write'],
    ['filePath', 'C:/fake/a.txt'],
    ['flags', 'w'],
  ])('拒绝多余危险字段：%s', async (_label, extraKey) => {
    const request = {
      relativePath: 'a.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
      [extraKey]: 'dangerous',
    };
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
    expect(vi.mocked(saveTextDocument)).not.toHaveBeenCalled();
  });

  it.each([
    ['relativePath 缺失', { content: 'x', expectedRevision: 'a'.repeat(64) }],
    ['content 缺失', { relativePath: 'a.txt', expectedRevision: 'a'.repeat(64) }],
    ['expectedRevision 缺失', { relativePath: 'a.txt', content: 'x' }],
    ['expectedRevision 空串', { relativePath: 'a.txt', content: 'x', expectedRevision: '' }],
  ])('拒绝缺失或非法必需字段：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
  });

  it.each([
    ['relativePath 非字符串', { relativePath: 42, content: 'x', expectedRevision: 'a'.repeat(64) }],
    [
      'content 非字符串',
      { relativePath: 'a.txt', content: null, expectedRevision: 'a'.repeat(64) },
    ],
    ['expectedRevision 非字符串', { relativePath: 'a.txt', content: 'x', expectedRevision: 42 }],
  ])('拒绝错误字段类型：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
  });

  it.each([
    ['false', false],
    ['数字 1', 1],
    ['字符串 true', 'true'],
  ])('confirmMixedLineEndingNormalization 只接受 true：%s', async (_label, value) => {
    const result = await invoke({
      relativePath: 'a.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
      confirmMixedLineEndingNormalization: value,
    });
    expect(expectSaveError(result).code).toBe('INVALID_REQUEST');
  });

  it('未打开工作区返回 NO_WORKSPACE 且不调用保存器', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const result = await invoke({
      relativePath: 'a.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    expect(expectSaveError(result).code).toBe('NO_WORKSPACE');
    expect(vi.mocked(saveTextDocument)).not.toHaveBeenCalled();
  });

  it('合法请求真实保存：返回 saved，磁盘内容正确，保存器被调用一次', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'original');
    const { revision } = await readDiskRevision(workspaceRoot);

    const result = await invoke({
      relativePath: 'a.txt',
      content: 'updated via ipc',
      expectedRevision: revision,
    });

    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.document.relativePath).toBe('a.txt');
      expect(result.document.content).toBe('updated via ipc');
    }
    expect((await readFile(join(workspaceRoot, 'a.txt'))).toString()).toBe('updated via ipc');
    expect(vi.mocked(saveTextDocument)).toHaveBeenCalledTimes(1);
  });

  it('版本冲突透传 CONFLICT', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'original');
    const result = await invoke({
      relativePath: 'a.txt',
      content: 'x',
      expectedRevision: 'b'.repeat(64),
    });
    expect(expectSaveError(result).code).toBe('CONFLICT');
    expect((await readFile(join(workspaceRoot, 'a.txt'))).toString()).toBe('original');
  });

  it('保存器意外异常转换为稳定 WRITE_FAILED，不向调用方抛出', async () => {
    vi.mocked(saveTextDocument).mockRejectedValueOnce(new Error('意外内部错误'));
    const result = await invoke({
      relativePath: 'a.txt',
      content: 'x',
      expectedRevision: 'a'.repeat(64),
    });
    const error = expectSaveError(result);
    expect(error.code).toBe('WRITE_FAILED');
    expect(JSON.stringify(result)).not.toContain('意外');
  });
});

describe('document:read-text 处理器', () => {
  let workspaceRoot: string;
  const invoke = async (path: unknown): Promise<unknown> =>
    handlers.get('document:read-text')!({}, path);

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-ipc-read-'));
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
  });

  afterEach(async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('拒绝错误参数数量与类型', async () => {
    const noArg = (await handlers.get('document:read-text')!({})) as { status: string };
    expect(noArg.status).toBe('error');
    const twoArgs = (await handlers.get('document:read-text')!({}, 'a.txt', 'b.txt')) as {
      status: string;
    };
    expect(twoArgs.status).toBe('error');
    const notString = (await invoke(42)) as { status: string };
    expect(notString.status).toBe('error');
  });

  it('未打开工作区返回 NO_WORKSPACE', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const result = (await invoke('a.txt')) as { status: string; error: { code: string } };
    expect(result.status).toBe('error');
    expect(result.error.code).toBe('NO_WORKSPACE');
  });

  it('合法请求读取成功（回归）', async () => {
    await writeFile(join(workspaceRoot, 'a.txt'), 'hello');
    const result = (await invoke('a.txt')) as {
      status: string;
      document: { content: string; revision: string };
    };
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.document.content).toBe('hello');
      expect(result.document.revision).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

/** 读取磁盘文件的 revision（复用真实保存器内的版本语义：原始字节 SHA-256）。 */
async function readDiskRevision(workspaceRoot: string): Promise<{ revision: string }> {
  const { createHash } = await import('node:crypto');
  const bytes = await readFile(join(workspaceRoot, 'a.txt'));
  return { revision: createHash('sha256').update(bytes).digest('hex') };
}
