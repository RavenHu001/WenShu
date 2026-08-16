/**
 * TASK-009 WP3：文件管理固定 IPC 测试。
 * 覆盖：只注册 workspace:create-entry / workspace:reveal 两个固定通道；形状/多余
 * 字段/危险开关 → INVALID_REQUEST；名称语义错误 → INVALID_NAME；无工作区 →
 * NO_WORKSPACE；根来自主进程 session；成功路径真实创建文件/调用 reveal；
 * mutationId 原样回传；发送窗口绑定。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDirWithRetry } from '../test-utils/temp-dir-cleanup';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ getCurrentWorkspaceRoot: vi.fn() }));
const browserWindowMock = vi.hoisted(() => ({ fromWebContents: vi.fn() }));
const shellMock = vi.hoisted(() => ({ showItemInFolder: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  BrowserWindow: browserWindowMock,
  shell: shellMock,
}));
vi.mock('../../src/main/workspace/workspace-session', () => sessionMock);

import { registerFileManagementIpc } from '../../src/main/workspace/file-management-ipc';
import type { RevealResult, WorkspaceMutationResult } from '../../src/shared/file-management';

type IpcListener = (...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, IpcListener>();
ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
  handlers.set(channel, listener);
});

const sender = { id: 42 };
const event = { sender };

function expectError(result: WorkspaceMutationResult | RevealResult): string {
  if ('mutationId' in result && result.status === 'error') {
    return result.error.code;
  }
  if (!('mutationId' in result) && result.status === 'error') {
    return result.error.code;
  }
  throw new Error('expected error result');
}

describe('registerFileManagementIpc', () => {
  let root = '';
  let cleanup = async (): Promise<void> => {};

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenshu-wp3-ipc-'));
    cleanup = () => removeDirWithRetry(root);
    registerFileManagementIpc();
    registerFileManagementIpc(); // 幂等
  });
  afterAll(async () => {
    await cleanup();
  });

  it('只注册 workspace:create-entry 与 workspace:reveal 两个固定通道', () => {
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(['workspace:create-entry', 'workspace:reveal']);
    expect(channels.some((c) => c.startsWith('fs:') || c.startsWith('shell:'))).toBe(false);
  });

  it('无工作区：两个通道都返回 NO_WORKSPACE', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const create = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 1,
      kind: 'text',
      parentRelativePath: '',
      name: 'a.txt',
    })) as WorkspaceMutationResult;
    expect(create.status === 'error' && create.error.code).toBe('NO_WORKSPACE');
    if (create.status === 'error') {
      expect(create.mutationId).toBe(1); // mutationId 原样回传
    }
    const reveal = (await handlers.get('workspace:reveal')!(event, {
      revealRoot: true,
    })) as RevealResult;
    expect(reveal.status === 'error' && reveal.error.code).toBe('NO_WORKSPACE');
  });

  it('create：多余字段/危险开关/错误类型 → INVALID_REQUEST（不写文件）', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const cases = [
      { mutationId: 1, kind: 'text', parentRelativePath: '', name: 'x.txt', force: true },
      { mutationId: 1, kind: 'text', parentRelativePath: '', name: 'x.txt', rootPath: 'C:/x' },
      { mutationId: 1, kind: 'text', parentRelativePath: '', name: 'x.txt', skipValidation: true },
      { mutationId: 0, kind: 'text', parentRelativePath: '', name: 'x.txt' },
      { mutationId: 1, kind: 'file', parentRelativePath: '', name: 'x.txt' },
      { mutationId: 1, kind: 'text', parentRelativePath: '', name: 'x.txt', encoding: 'utf-16' },
    ];
    for (const request of cases) {
      const result = (await handlers.get('workspace:create-entry')!(
        event,
        request,
      )) as WorkspaceMutationResult;
      expect(expectError(result)).toBe('INVALID_REQUEST');
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('create：非法叶名称 → INVALID_NAME（服务层细分，IPC 只校验形状）', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const result = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 2,
      kind: 'text',
      parentRelativePath: '',
      name: 'CON',
    })) as WorkspaceMutationResult;
    expect(expectError(result)).toBe('INVALID_NAME');
    expect(await readdir(root)).toEqual([]);
  });

  it('create：根/绝对路径被拒绝（parent 与 name 均不能携带）', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const absParent = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 3,
      kind: 'text',
      parentRelativePath: 'C:/x',
      name: 'a.txt',
    })) as WorkspaceMutationResult;
    expect(expectError(absParent)).toBe('INVALID_PATH');
    const absName = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 4,
      kind: 'text',
      parentRelativePath: '',
      name: 'C:/a.txt',
    })) as WorkspaceMutationResult;
    expect(expectError(absName)).toBe('INVALID_NAME');
  });

  it('create：TXT 成功（真实服务 + 默认适配器），结果只含规范相对路径', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    const result = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 5,
      kind: 'text',
      parentRelativePath: '',
      name: 'ipc.txt',
    })) as WorkspaceMutationResult;
    expect(result).toEqual({
      status: 'succeeded',
      mutationId: 5,
      relativePath: 'ipc.txt',
      kind: 'text',
    });
    expect(await readFile(join(root, 'ipc.txt'), 'utf8')).toBe('');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(root); // 不泄漏绝对路径
  });

  it('reveal：文件/根调用固定 showItemInFolder；缺失路径 → NOT_FOUND 不调用', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    shellMock.showItemInFolder.mockClear();
    const file = (await handlers.get('workspace:reveal')!(event, {
      revealRoot: false,
      relativePath: 'ipc.txt',
    })) as RevealResult;
    expect(file).toEqual({ status: 'revealed' });
    expect(shellMock.showItemInFolder).toHaveBeenCalledTimes(1);
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(join(root, 'ipc.txt'));

    shellMock.showItemInFolder.mockClear();
    const rootReveal = (await handlers.get('workspace:reveal')!(event, {
      revealRoot: true,
    })) as RevealResult;
    expect(rootReveal).toEqual({ status: 'revealed' });
    expect(shellMock.showItemInFolder).toHaveBeenCalledWith(root);

    shellMock.showItemInFolder.mockClear();
    const missing = (await handlers.get('workspace:reveal')!(event, {
      revealRoot: false,
      relativePath: 'missing.txt',
    })) as RevealResult;
    expect(expectError(missing)).toBe('NOT_FOUND');
    expect(shellMock.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveal：多余字段 → INVALID_REQUEST；发送窗口用于绑定（无窗口时退回 sender.id）', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(root);
    browserWindowMock.fromWebContents.mockReturnValue(undefined);
    const extra = (await handlers.get('workspace:reveal')!(event, {
      revealRoot: false,
      relativePath: 'ipc.txt',
      shell: 'openExternal',
    })) as RevealResult;
    expect(expectError(extra)).toBe('INVALID_REQUEST');
    // 无窗口回退 sender.id 的 create 仍成功（队列按 sender.id 绑定）
    const ok = (await handlers.get('workspace:create-entry')!(event, {
      mutationId: 6,
      kind: 'text',
      parentRelativePath: '',
      name: 'ipc2.txt',
    })) as WorkspaceMutationResult;
    expect(ok.status).toBe('succeeded');
  });
});
