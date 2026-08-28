// @vitest-environment jsdom
/**
 * TASK-006 WP3 工作区搜索 controller 竞态测试（任务第 8.4 节与第 5.2 / 5.3 节不变量）。
 * 覆盖：状态机（idle/searching/completed/cancelled/error）；requestId 单调与唯一；
 * 无工作区与非法查询不发起 IPC；新搜索取消旧搜索；主动取消与迟到结果；
 * 工作区 epoch 变化作废；卸载后迟到结果不提交；结果只绑定发起时的 requestId 与 epoch。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useWorkspaceSearch } from '../../src/renderer/lib/use-workspace-search';
import type {
  WorkspaceTextSearchError,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '../../src/shared/search';

function completedResult(requestId: number, totalMatches = 0): WorkspaceTextSearchResult {
  return {
    status: 'completed',
    requestId,
    files: [],
    statistics: {
      scannedFiles: 0,
      matchedFiles: 0,
      totalMatches,
      skippedFiles: 0,
    },
    truncated: false,
    truncatedReason: null,
  };
}

function errorResult(
  requestId: number,
  code: WorkspaceTextSearchError['code'],
): WorkspaceTextSearchResult {
  return { status: 'error', requestId, error: { code, message: `err-${code}` } };
}

function mockSearchApi(): {
  textWorkspace: ReturnType<typeof vi.fn>;
  cancelTextWorkspace: ReturnType<typeof vi.fn>;
  resolve: (requestId: number, result: WorkspaceTextSearchResult) => void;
  reject: (requestId: number) => void;
} {
  const pending = new Map<
    number,
    { resolve: (result: WorkspaceTextSearchResult) => void; reject: (error: unknown) => void }
  >();
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9', appVersion: '0.1.0-alpha.1' },
    workspace: { open: vi.fn(), refresh: vi.fn() },
    document: { readText: vi.fn(), saveText: vi.fn() },
    search: { textWorkspace, cancelTextWorkspace },
    window: {
      setDirtyState: vi.fn(),
      requestClose: vi.fn(),
      cancelClose: vi.fn(),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  };
  return {
    textWorkspace,
    cancelTextWorkspace,
    resolve: (requestId, result) => pending.get(requestId)?.resolve(result),
    reject: (requestId) => pending.get(requestId)?.reject(new Error('ipc infrastructure failure')),
  };
}

function Harness({
  available,
  epoch,
  mutationEpoch,
}: {
  available: boolean;
  epoch: number;
  mutationEpoch: number;
}): React.JSX.Element {
  const { state, submitSearch, cancelSearch } = useWorkspaceSearch({
    workspaceAvailable: available,
    workspaceEpoch: epoch,
    mutationEpoch,
  });
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="query">{state.submittedQuery}</output>
      <output data-testid="case-sensitive">{String(state.caseSensitive)}</output>
      <output data-testid="request-id">
        {state.requestId === null ? 'null' : String(state.requestId)}
      </output>
      <output data-testid="result-status">
        {state.result === null ? 'none' : state.result.status}
      </output>
      <output data-testid="result-total">
        {state.result?.status === 'completed'
          ? String(state.result.statistics.totalMatches)
          : 'n/a'}
      </output>
      <output data-testid="error-code">{state.error === null ? 'none' : state.error.code}</output>
      <button onClick={() => submitSearch('hello', false)}>submit</button>
      <button onClick={() => submitSearch('World', true)}>submit-world</button>
      <button onClick={() => submitSearch('', false)}>submit-empty</button>
      <button onClick={() => cancelSearch()}>cancel</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('useWorkspaceSearch 状态机（第 5.1 节）', () => {
  it('初始 idle：无活动请求、无结果、无错误，不发起 IPC', () => {
    mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('request-id').textContent).toBe('null');
    expect(screen.getByTestId('result-status').textContent).toBe('none');
    expect(screen.getByTestId('error-code').textContent).toBe('none');
  });

  it('提交后进入 searching：唯一活动 requestId、记录已提交查询与大小写选项', () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    expect(screen.getByTestId('status').textContent).toBe('searching');
    expect(screen.getByTestId('request-id').textContent).toBe('1');
    expect(screen.getByTestId('query').textContent).toBe('hello');
    expect(screen.getByTestId('case-sensitive').textContent).toBe('false');
    expect(api.textWorkspace).toHaveBeenCalledTimes(1);
    expect(api.textWorkspace).toHaveBeenCalledWith({
      requestId: 1,
      query: 'hello',
      caseSensitive: false,
    });
  });

  it('完成：提交结果与统计，活动请求句柄释放（不变量 1）', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.resolve(1, completedResult(1, 42));
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('result-status').textContent).toBe('completed');
    expect(screen.getByTestId('result-total').textContent).toBe('42');
    expect(screen.getByTestId('request-id').textContent).toBe('null');
  });

  it('错误：进入 error 并展示稳定错误码', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.resolve(1, errorResult(1, 'SEARCH_FAILED'));
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('error-code').textContent).toBe('SEARCH_FAILED');
    expect(screen.getByTestId('request-id').textContent).toBe('null');
  });

  it('IPC 基础设施异常：防御性转换为稳定 SEARCH_FAILED', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.reject(1);
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('error-code').textContent).toBe('SEARCH_FAILED');
  });
});

describe('useWorkspaceSearch 输入与工作区门禁', () => {
  it('无工作区：提交不发起 IPC，状态保持 idle', () => {
    const api = mockSearchApi();
    render(<Harness available={false} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    expect(api.textWorkspace).not.toHaveBeenCalled();
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('非法查询（空串）：防御性拒绝，不发起 IPC', () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit-empty').click();
    });
    expect(api.textWorkspace).not.toHaveBeenCalled();
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('无活动搜索时主动取消：安全无操作', () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('cancel').click();
    });
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });
});

describe('useWorkspaceSearch 竞态与迟到结果（第 5.2 / 5.3 节）', () => {
  it('新搜索取消旧搜索：旧请求被取消且其迟到结果不覆盖新搜索', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click(); // requestId 1
    });
    act(() => {
      screen.getByText('submit-world').click(); // requestId 2
    });
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    expect(screen.getByTestId('request-id').textContent).toBe('2');
    expect(screen.getByTestId('query').textContent).toBe('World');
    // 旧结果迟到：不得覆盖 searching 状态（不变量 3）
    await act(async () => {
      api.resolve(1, completedResult(1, 999));
    });
    expect(screen.getByTestId('status').textContent).toBe('searching');
    expect(screen.getByTestId('request-id').textContent).toBe('2');
    // 新结果提交
    await act(async () => {
      api.resolve(2, completedResult(2, 7));
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('query').textContent).toBe('World');
    expect(screen.getByTestId('case-sensitive').textContent).toBe('true');
    expect(screen.getByTestId('result-total').textContent).toBe('7');
  });

  it('主动取消：立即进入 cancelled 并作废在途请求，迟到结果不恢复状态', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    act(() => {
      screen.getByText('cancel').click();
    });
    expect(screen.getByTestId('status').textContent).toBe('cancelled');
    expect(screen.getByTestId('request-id').textContent).toBe('null');
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    // 迟到结果：既不能恢复 searching，也不能覆盖 cancelled（不变量 3）
    await act(async () => {
      api.resolve(1, completedResult(1, 5));
    });
    expect(screen.getByTestId('status').textContent).toBe('cancelled');
    expect(screen.getByTestId('result-status').textContent).toBe('none');
  });

  it('工作区 epoch 变化：作废在途请求并清空旧结果', async () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    act(() => {
      rerender(<Harness available={true} epoch={1} mutationEpoch={0} />);
    });
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    // 旧工作区的迟到结果不提交（不变量 2：requestId 与 epoch 必须同时匹配）
    await act(async () => {
      api.resolve(1, completedResult(1, 100));
    });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('result-status').textContent).toBe('none');
  });

  it('epoch 未变化时重渲染不重置状态', () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={3} mutationEpoch={5} />);
    act(() => {
      screen.getByText('submit').click();
    });
    act(() => {
      rerender(<Harness available={true} epoch={3} mutationEpoch={5} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('searching');
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
  });

  it('卸载时取消活动请求，迟到结果不提交、不抛异常', async () => {
    const api = mockSearchApi();
    const { unmount } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    unmount();
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    await expect(async () => {
      await act(async () => {
        api.resolve(1, completedResult(1, 5));
      });
    }).not.toThrow();
  });

  it('结果只绑定发起时的 requestId：乱序完成只提交最新请求', async () => {
    const api = mockSearchApi();
    render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click(); // requestId 1
    });
    act(() => {
      screen.getByText('submit-world').click(); // requestId 2
    });
    // 2 先完成、1 后完成（乱序）
    await act(async () => {
      api.resolve(2, completedResult(2, 8));
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('query').textContent).toBe('World');
    await act(async () => {
      api.resolve(1, completedResult(1, 999));
    });
    // 旧结果被忽略：查询与统计保持最新请求的结果
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('query').textContent).toBe('World');
    expect(screen.getByTestId('result-total').textContent).toBe('8');
  });
});

describe('useWorkspaceSearch mutationEpoch 失效（TASK-009 §4.11）', () => {
  it('completed 状态 + mutationEpoch 变化：清空结果回到 idle，不保留旧路径', async () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.resolve(1, completedResult(1, 42));
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('result-total').textContent).toBe('42');
    // 磁盘文件管理操作确认成功（create/save-as/relocate/trash）→ mutationEpoch +1
    act(() => {
      rerender(<Harness available={true} epoch={0} mutationEpoch={1} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('result-status').textContent).toBe('none');
    expect(screen.getByTestId('query').textContent).toBe('');
  });

  it('searching 中 + mutationEpoch 变化：取消在途请求，迟到结果不提交', async () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    expect(screen.getByTestId('status').textContent).toBe('searching');
    act(() => {
      rerender(<Harness available={true} epoch={0} mutationEpoch={1} />);
    });
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    // 磁盘变更后的迟到结果：不得恢复 searching 或覆盖 idle（§4.11 迟到结果校验）
    await act(async () => {
      api.resolve(1, completedResult(1, 100));
    });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('result-status').textContent).toBe('none');
  });

  it('cancelled / error 状态 + mutationEpoch 变化：同样清空为 idle', async () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    // cancelled
    act(() => {
      screen.getByText('submit').click();
    });
    act(() => {
      screen.getByText('cancel').click();
    });
    expect(screen.getByTestId('status').textContent).toBe('cancelled');
    act(() => {
      rerender(<Harness available={true} epoch={0} mutationEpoch={1} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    // error
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.resolve(2, errorResult(2, 'SEARCH_FAILED'));
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
    act(() => {
      rerender(<Harness available={true} epoch={0} mutationEpoch={2} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('error-code').textContent).toBe('none');
  });

  it('mutationEpoch 未变化时重渲染不重置状态', () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={2} mutationEpoch={4} />);
    act(() => {
      screen.getByText('submit').click();
    });
    act(() => {
      rerender(<Harness available={true} epoch={2} mutationEpoch={4} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('searching');
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
  });

  it('失败、取消与 reveal 不递增时：结果保持有效（mutationEpoch 不变不清空）', async () => {
    const api = mockSearchApi();
    const { rerender } = render(<Harness available={true} epoch={0} mutationEpoch={0} />);
    act(() => {
      screen.getByText('submit').click();
    });
    await act(async () => {
      api.resolve(1, completedResult(1, 42));
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    // 同一 mutationEpoch 下任意重渲染（如 reveal 后刷新、失败提示）不清空有效结果
    act(() => {
      rerender(<Harness available={true} epoch={0} mutationEpoch={0} />);
    });
    expect(screen.getByTestId('status').textContent).toBe('completed');
    expect(screen.getByTestId('result-total').textContent).toBe('42');
  });
});
