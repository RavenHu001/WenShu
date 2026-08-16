/**
 * TASK-009 WP4：另存为固定 IPC 测试。
 * 覆盖：只注册 document:save-text-as / document:save-docx-as 两个通道；形状/多余
 * 字段/危险开关 → INVALID_REQUEST；无工作区 → NO_WORKSPACE（mutationId 回传）；
 * 成功路径真实写盘（TXT 新建目标）；两阶段 target-exists 经 IPC 原样返回。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';
import type { SaveAsResult } from '../../src/shared/file-management';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ getCurrentWorkspaceRoot: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));
vi.mock('../../src/main/workspace/workspace-session', () => sessionMock);

import { registerSaveAsIpc } from '../../src/main/document/save-as-ipc';

type IpcListener = (...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, IpcListener>();
ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
  handlers.set(channel, listener);
});

const event = { sender: { id: 77 } };

function errorCode(result: SaveAsResult): string {
  if (result.status === 'error') {
    return result.error.code;
  }
  throw new Error('expected error');
}

describe('registerSaveAsIpc', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp4-saveas-ipc-'));
    cleanup = () => removeDirWithRetry(root);
    registerSaveAsIpc();
    registerSaveAsIpc(); // 幂等
  });
  afterAll(async () => {
    await cleanup();
  });

  it('只注册 document:save-text-as 与 document:save-docx-as 两个固定通道', () => {
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(['document:save-docx-as', 'document:save-text-as']);
  });

  it('无工作区 → NO_WORKSPACE，mutationId 原样回传', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const result = (await handlers.get('document:save-text-as')!(event, {
      mutationId: 3,
      tabId: 't',
      sourceRelativePath: 'a.txt',
      target: { parentRelativePath: '', name: 'b.txt' },
      content: 'x',
      expectedSourceRevision: 'r',
    })) as SaveAsResult;
    expect(result.status === 'error' && result.error.code).toBe('NO_WORKSPACE');
    if (result.status === 'error') {
      expect(result.mutationId).toBe(3);
    }
  });

  it('多余字段/危险开关/错误类型 → INVALID_REQUEST（不写盘）', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const cases = [
      {
        mutationId: 1,
        tabId: 't',
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 'x',
        expectedSourceRevision: 'r',
        force: true,
      },
      {
        mutationId: 1,
        tabId: 't',
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 'x',
        expectedSourceRevision: 'r',
        overwrite: true,
      },
      {
        mutationId: 0,
        tabId: 't',
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 'x',
        expectedSourceRevision: 'r',
      },
      {
        mutationId: 1,
        tabId: 't',
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 42,
        expectedSourceRevision: 'r',
      },
      {
        mutationId: 1,
        tabId: '',
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 'x',
        expectedSourceRevision: 'r',
      },
    ];
    for (const request of cases) {
      const result = (await handlers.get('document:save-text-as')!(event, request)) as SaveAsResult;
      expect(errorCode(result)).toBe('INVALID_REQUEST');
    }
    // 源路径语义错误由服务层细分（绝对/盘符 → INVALID_PATH）
    const absSource = (await handlers.get('document:save-text-as')!(event, {
      mutationId: 1,
      tabId: 't',
      sourceRelativePath: 'C:/abs.txt',
      target: { parentRelativePath: '', name: 'b.txt' },
      content: 'x',
      expectedSourceRevision: 'r',
    })) as SaveAsResult;
    expect(errorCode(absSource)).toBe('INVALID_PATH');

    const docxBad = (await handlers.get('document:save-docx-as')!(event, {
      mutationId: 1,
      tabId: 't',
      sourceRelativePath: 'a.docx',
      target: { parentRelativePath: '', name: 'b.docx' },
      model: 'not-a-model',
      expectedSourceRevision: 'r',
    })) as SaveAsResult;
    expect(errorCode(docxBad)).toBe('INVALID_REQUEST');
  });

  it('TXT 另存为新目标：真实写盘成功，源不变', async () => {
    await writeFile(join(root, 'a.txt'), 'hello');
    const srcBytes = await readFile(join(root, 'a.txt'));
    const srcRevision = createHash('sha256').update(srcBytes).digest('hex');
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const result = (await handlers.get('document:save-text-as')!(event, {
      mutationId: 5,
      tabId: 'tab-1',
      sourceRelativePath: 'a.txt',
      target: { parentRelativePath: '', name: 'b.txt' },
      content: 'hello',
      expectedSourceRevision: srcRevision,
    })) as SaveAsResult;
    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.relativePath).toBe('b.txt');
      expect(result.kind).toBe('text');
    }
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('hello');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hello');
  });

  it('TXT 覆盖确认两阶段：第一阶段 target-exists 原样返回', async () => {
    await writeFile(join(root, 'c.txt'), 'new');
    await writeFile(join(root, 'd.txt'), 'old');
    const srcRevision = createHash('sha256')
      .update(await readFile(join(root, 'c.txt')))
      .digest('hex');
    const dstRevision = createHash('sha256')
      .update(await readFile(join(root, 'd.txt')))
      .digest('hex');
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const first = (await handlers.get('document:save-text-as')!(event, {
      mutationId: 6,
      tabId: 'tab-2',
      sourceRelativePath: 'c.txt',
      target: { parentRelativePath: '', name: 'd.txt' },
      content: 'new',
      expectedSourceRevision: srcRevision,
    })) as SaveAsResult;
    expect(first).toEqual({ status: 'target-exists', mutationId: 6, targetRevision: dstRevision });
    expect(await readFile(join(root, 'd.txt'), 'utf8')).toBe('old');
  });
});
