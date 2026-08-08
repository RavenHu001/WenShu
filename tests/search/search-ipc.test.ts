/**
 * TASK-006 WP3 搜索 IPC 契约测试（任务第 8.4 节）。
 * 覆盖：固定通道与幂等注册；非法请求（非对象、数组、额外字段、错误类型、参数数量）拒绝；
 * 无工作区；renderer 无法指定根路径；合法请求透传会话根；新搜索取消旧搜索；
 * 取消只能作用于同一发送窗口的已知 requestId；窗口销毁清理任务；
 * IPC 异常转换为稳定可序列化结果；结果不泄漏绝对路径或原始异常。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceTextSearchResult } from '../../src/shared/search';

const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ getCurrentWorkspaceRoot: vi.fn() }));
const searcherMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));
vi.mock('../../src/main/workspace/workspace-session', () => sessionMock);
vi.mock('../../src/main/search/search-text-workspace', () => ({
  searchTextWorkspace: searcherMock,
}));

import { registerSearchIpc } from '../../src/main/search/search-ipc';
import { searchTextWorkspace } from '../../src/main/search/search-text-workspace';
import type { WorkspaceTextSearchRequest } from '../../src/shared/search';

type IpcListener = (...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, IpcListener>();
ipcMainMock.handle.mockImplementation((channel: string, listener: IpcListener) => {
  handlers.set(channel, listener);
});

/** 模拟发送窗口 webContents：只提供 handler 使用的 id 与 once（销毁监听）。 */
interface FakeSender {
  readonly id: number;
  once(event: string, callback: () => void): void;
  fire(event: string): void;
}

function fakeSender(id: number): FakeSender {
  const listeners: Array<{ event: string; callback: () => void }> = [];
  return {
    id,
    once: (event, callback) => {
      listeners.push({ event, callback });
    },
    fire: (event) => {
      for (const listener of listeners) {
        if (listener.event === event) {
          listener.callback();
        }
      }
    },
  };
}

function completed(requestId: number): WorkspaceTextSearchResult {
  return {
    status: 'completed',
    requestId,
    files: [],
    statistics: { scannedFiles: 0, matchedFiles: 0, totalMatches: 0, skippedFiles: 0 },
    truncated: false,
    truncatedReason: null,
  };
}

describe('registerSearchIpc', () => {
  it('注册保持幂等：重复调用不会重复注册处理器', () => {
    expect(ipcMainMock.handle).not.toHaveBeenCalled();
    registerSearchIpc();
    registerSearchIpc();
    expect(ipcMainMock.handle).toHaveBeenCalledTimes(2);
  });

  it('只注册两个固定搜索通道，无通用文件系统或动态通道', () => {
    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(['search:cancel-text-workspace', 'search:text-workspace']);
    expect(
      channels.some(
        (channel) =>
          channel.startsWith('file:') ||
          channel.startsWith('fs:') ||
          channel.startsWith('search:') === false,
      ),
    ).toBe(false);
  });
});

describe('search:text-workspace 处理器', () => {
  let workspaceRoot: string;
  let sender: FakeSender;
  /** 每个用例使用唯一发送窗口 id：主进程的 cleanedWebContents 是模块级状态，复用 id 会跨用例干扰。 */
  let senderIdCounter = 0;
  const freshSender = (): FakeSender => fakeSender(++senderIdCounter);
  /** 当前生效的搜索器停止回调快照：按调用次序记录，供取消断言使用。 */
  const shouldStops: Array<() => boolean> = [];
  /** 搜索器门闩：非 null 时所有调用等待该 Promise，便于在搜索中途取消。 */
  let gate: Promise<void> | null = null;
  let resolveGate: (() => void) | null = null;

  const invoke = async (
    request: unknown,
    from: FakeSender = sender,
  ): Promise<WorkspaceTextSearchResult> =>
    (await handlers.get('search:text-workspace')!(
      { sender: from },
      request,
    )) as WorkspaceTextSearchResult;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-search-ipc-ws-'));
    sender = freshSender();
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
    shouldStops.length = 0;
    gate = null;
    resolveGate = null;
    searcherMock.mockReset();
    // 模拟真实搜索器：等待门闩（可选）后按 shouldStop 返回 cancelled 或 completed
    searcherMock.mockImplementation(
      async (
        _root: string,
        request: WorkspaceTextSearchRequest,
        options?: { shouldStop?: () => boolean },
      ) => {
        const shouldStop = options?.shouldStop ?? (() => false);
        shouldStops.push(shouldStop);
        if (gate !== null) {
          await gate;
        }
        return shouldStop()
          ? { status: 'cancelled', requestId: request.requestId }
          : completed(request.requestId);
      },
    );
  });

  afterEach(async () => {
    resolveGate?.();
    resolveGate = null;
    gate = null;
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    await rm(workspaceRoot, { recursive: true, force: true });
    await Promise.resolve();
  });

  it.each([
    ['0 个参数', () => handlers.get('search:text-workspace')!({ sender: sender })],
    ['2 个参数', () => handlers.get('search:text-workspace')!({ sender: sender }, {}, {})],
  ])('拒绝错误参数数量：%s', async (_label, invokeWrong) => {
    const result = (await invokeWrong()) as WorkspaceTextSearchResult;
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
    expect(vi.mocked(searchTextWorkspace)).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['字符串', 'hello'],
    ['数字', 42],
    ['数组', [{ requestId: 1, query: 'x', caseSensitive: true }]],
  ])('拒绝非对象请求：%s', async (_label, request) => {
    const result = await invoke(request);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
    expect(vi.mocked(searchTextWorkspace)).not.toHaveBeenCalled();
  });

  it.each([
    ['workspaceRoot', 'C:/fake'],
    ['rootPath', 'C:/fake'],
    ['absolutePath', 'C:/fake/a.txt'],
    ['maxFiles', 1000],
    ['concurrency', 4],
    ['encoding', 'utf-16le'],
    ['glob', '**/*.txt'],
    ['channel', 'fs:read'],
  ])('拒绝多余危险字段：%s', async (_label, extraKey) => {
    const result = await invoke({
      requestId: 1,
      query: 'x',
      caseSensitive: true,
      [extraKey]: 'dangerous',
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
    expect(vi.mocked(searchTextWorkspace)).not.toHaveBeenCalled();
  });

  it('未打开工作区返回 NO_WORKSPACE 且不调用搜索器', async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(null);
    const result = await invoke({ requestId: 1, query: 'x', caseSensitive: true });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('NO_WORKSPACE');
    }
    expect(vi.mocked(searchTextWorkspace)).not.toHaveBeenCalled();
  });

  it('合法请求：搜索器被调用并透传会话根与请求，结果原样返回', async () => {
    const result = await invoke({ requestId: 5, query: 'hello', caseSensitive: false });
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.requestId).toBe(5);
    }
    expect(vi.mocked(searchTextWorkspace)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchTextWorkspace).mock.calls[0]?.[0]).toBe(workspaceRoot);
    expect(vi.mocked(searchTextWorkspace).mock.calls[0]?.[1]).toEqual({
      requestId: 5,
      query: 'hello',
      caseSensitive: false,
    });
  });

  it('同一窗口新搜索取消旧搜索：旧任务停止回调生效且旧结果不标记 completed', async () => {
    gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const firstPromise = invoke({ requestId: 1, query: 'a', caseSensitive: true });
    expect(shouldStops).toHaveLength(1);

    gate = null;
    const secondResult = await invoke({ requestId: 2, query: 'b', caseSensitive: true });
    expect(secondResult.status).toBe('completed');

    // 新搜索已取消旧任务：旧任务 shouldStop 立即返回 true（搜索器据此返回 cancelled）
    expect(shouldStops).toHaveLength(2);
    expect(shouldStops[0]!()).toBe(true);
    expect(shouldStops[1]!()).toBe(false);

    resolveGate?.();
    const firstResult = await firstPromise;
    expect(firstResult.status).toBe('cancelled');
  });

  it('不同窗口的搜索互不影响：新窗口搜索不取消旧窗口任务', async () => {
    gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const firstPromise = invoke({ requestId: 1, query: 'a', caseSensitive: true }, freshSender());
    const secondPromise = invoke({ requestId: 1, query: 'a', caseSensitive: true }, freshSender());
    expect(shouldStops).toHaveLength(2);
    expect(shouldStops[0]!()).toBe(false); // 他窗新搜索不取消本窗任务

    resolveGate?.();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
  });

  it('搜索器意外异常转换为稳定 SEARCH_FAILED，不泄漏内部信息', async () => {
    searcherMock.mockRejectedValueOnce(new Error(`意外内部错误：${workspaceRoot}/secret.txt`));
    const result = await invoke({ requestId: 1, query: 'x', caseSensitive: true });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('SEARCH_FAILED');
      const json = JSON.stringify(result);
      expect(json).not.toContain(workspaceRoot);
      expect(json).not.toContain('secret');
      expect(json).not.toContain('意外');
    }
  });
});

describe('search:cancel-text-workspace 处理器', () => {
  let workspaceRoot: string;
  let sender: FakeSender;
  let senderIdCounter = 0;
  const freshSender = (): FakeSender => fakeSender(++senderIdCounter);
  const shouldStops: Array<() => boolean> = [];

  const invokeSearch = async (
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult> =>
    (await handlers.get('search:text-workspace')!(
      { sender: sender },
      request,
    )) as WorkspaceTextSearchResult;

  const invokeCancel = async (request: unknown): Promise<void> => {
    await handlers.get('search:cancel-text-workspace')!({ sender: sender }, request);
  };

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'wenshu-search-ipc-cancel-'));
    sender = freshSender();
    sessionMock.getCurrentWorkspaceRoot.mockReturnValue(workspaceRoot);
    shouldStops.length = 0;
    searcherMock.mockReset();
    searcherMock.mockImplementation(
      async (
        _root: string,
        request: WorkspaceTextSearchRequest,
        options?: { shouldStop?: () => boolean },
      ) => {
        const shouldStop = options?.shouldStop ?? (() => false);
        shouldStops.push(shouldStop);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        return shouldStop()
          ? { status: 'cancelled', requestId: request.requestId }
          : completed(request.requestId);
      },
    );
  });

  afterEach(async () => {
    sessionMock.getCurrentWorkspaceRoot.mockReset();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('非法取消请求安全无操作：搜索正常完成', async () => {
    const searchPromise = invokeSearch({ requestId: 1, query: 'x', caseSensitive: true });
    for (const bad of [null, [], '1', { requestId: 1, query: 'x' }, { requestId: '1' }]) {
      await invokeCancel(bad);
    }
    const result = await searchPromise;
    expect(result.status).toBe('completed');
  });

  it('取消未知 requestId 安全无操作：搜索正常完成', async () => {
    const searchPromise = invokeSearch({ requestId: 1, query: 'x', caseSensitive: true });
    await invokeCancel({ requestId: 999 });
    const result = await searchPromise;
    expect(result.status).toBe('completed');
    expect(shouldStops[0]!()).toBe(false);
  });

  it('取消当前窗口当前请求：搜索器停止回调生效并返回 cancelled', async () => {
    const searchPromise = invokeSearch({ requestId: 1, query: 'x', caseSensitive: true });
    await invokeCancel({ requestId: 1 });
    expect(shouldStops[0]!()).toBe(true);
    const result = await searchPromise;
    expect(result.status).toBe('cancelled');
  });

  it('取消只作用于同一发送窗口的已知 requestId', async () => {
    const otherSender = freshSender();
    const otherPromise = handlers.get('search:text-workspace')!(
      { sender: otherSender },
      { requestId: 1, query: 'x', caseSensitive: true },
    ) as Promise<WorkspaceTextSearchResult>;
    const ownPromise = invokeSearch({ requestId: 1, query: 'x', caseSensitive: true });
    // 他窗取消：对本窗任务无操作
    await handlers.get('search:cancel-text-workspace')!({ sender: otherSender }, { requestId: 1 });
    expect(shouldStops[1]!()).toBe(false);
    const [own, other] = await Promise.all([ownPromise, otherPromise]);
    expect(own.status).toBe('completed');
    expect(other.status).toBe('cancelled'); // 他窗自己的任务被自己取消
  });

  it('窗口销毁清理任务：销毁后取消安全无操作，搜索不受影响', async () => {
    const searchPromise = invokeSearch({ requestId: 1, query: 'x', caseSensitive: true });
    sender.fire('destroyed'); // 模拟窗口销毁：任务引用被清理
    await invokeCancel({ requestId: 1 });
    expect(shouldStops[0]!()).toBe(false); // 任务已清理，取消无操作
    const result = await searchPromise;
    expect(result.status).toBe('completed');
  });
});
