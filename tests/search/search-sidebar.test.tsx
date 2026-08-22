// @vitest-environment jsdom
/**
 * TASK-006 WP4 活动栏与搜索侧栏组件测试（任务第 8.5 节）。
 * 通过真实 <App /> 组合验证：活动栏按钮语义与切换、Ctrl+Shift+F、
 * 无工作区空状态不发起 IPC、输入与已提交查询分离、loading/completed/cancelled/error/
 * empty/truncated 展示、结果分组与安全高亮、新请求取消旧请求、侧栏切换不丢
 * 工作区/标签/文件树状态、工作区打开取消/失败保留与成功切换清空旧结果。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';
import type { ReadDocxDocumentResult, SaveDocxDocumentResult } from '../../src/shared/docx';
import type {
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '../../src/shared/search';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
  if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
  }
  if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }) as DOMRect;
  }
});

function d(
  name: string,
  relativePath: string,
  children?: readonly WorkspaceEntry[],
): WorkspaceEntry {
  return {
    name,
    relativePath,
    kind: 'directory',
    ...(children !== undefined ? { children } : {}),
  };
}

function f(name: string, relativePath: string): WorkspaceEntry {
  return { name, relativePath, kind: 'file' };
}

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [], ...overrides };
}

function match(
  from: number,
  to: number,
  line: number,
  column: number,
  text: string,
): WorkspaceTextSearchMatch {
  return {
    from,
    to,
    line,
    column,
    matchedText: text,
    preview: `前 ${text} 后`,
    previewMatchFrom: 2,
    previewMatchTo: 2 + text.length,
  };
}

function completedResult(
  requestId: number,
  files: readonly WorkspaceTextSearchFileResult[],
  options: {
    truncated?: boolean;
    truncatedReason?: Extract<
      WorkspaceTextSearchResult,
      { status: 'completed' }
    >['truncatedReason'];
  } = {},
): WorkspaceTextSearchResult {
  return {
    status: 'completed',
    requestId,
    files,
    statistics: {
      scannedFiles: 2,
      matchedFiles: files.length,
      totalMatches: files.reduce((sum, file) => sum + file.matches.length, 0),
      skippedFiles: 1,
    },
    truncated: options.truncated ?? false,
    truncatedReason: options.truncatedReason ?? null,
  };
}

function makeDesktopMock(): {
  open: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  textWorkspace: ReturnType<typeof vi.fn>;
  cancelTextWorkspace: ReturnType<typeof vi.fn>;
  resolveSearch: (requestId: number, result: WorkspaceTextSearchResult) => void;
} {
  const pending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        pending.set(request.requestId, { resolve });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
  const open = vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' }));
  const refresh = vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' }));
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: { open, refresh },
    document: {
      readText: vi.fn(async (): Promise<ReadTextDocumentResult> => ({
        status: 'error',
        error: { code: 'NOT_FOUND', message: '文件不存在' },
      })),
      saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      })),
      readDocx: vi.fn(async (): Promise<ReadDocxDocumentResult> => ({
        status: 'loaded',
        document: {
          kind: 'docx',
          name: 'b.docx',
          relativePath: 'b.docx',
          revision: 'rev-b.docx',
          size: 10,
          model: { schemaVersion: 1, blocks: [] },
          compatibility: { level: 'supported', warnings: [] },
        },
      })),
      saveDocx: vi.fn(async (): Promise<SaveDocxDocumentResult> => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      })),
    },
    search: { textWorkspace, cancelTextWorkspace },
    window: {
      setDirtyState: vi.fn(async () => undefined),
      requestClose: vi.fn(async () => undefined),
      cancelClose: vi.fn(async () => undefined),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  };
  return {
    open,
    refresh,
    textWorkspace,
    cancelTextWorkspace,
    resolveSearch: (requestId, result) => pending.get(requestId)?.resolve(result),
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

/** 打开一个工作区（mock 返回 selected）；包在 act 中确保异步切换与被动 effect 全部冲刷。 */
async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

/** 打开搜索侧栏并提交查询。 */
async function submitSearch(query: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '搜索面板' }));
  await user.type(screen.getByLabelText('搜索内容'), query);
  await user.keyboard('{Enter}');
}

describe('活动栏（第 4.10 节）', () => {
  it('文件/搜索使用明确名称与 SVG，并且不展示伪可用设置入口', () => {
    makeDesktopMock();
    render(<App />);

    const filesBtn = screen.getByRole('button', { name: '文件面板' });
    const searchBtn = screen.getByRole('button', { name: '搜索面板' });

    expect(filesBtn.tagName).toBe('BUTTON');
    expect(filesBtn.getAttribute('aria-pressed')).toBe('true');
    expect(searchBtn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /设置/ })).toBeNull();
    expect(filesBtn.querySelector('svg')).not.toBeNull();
    expect(searchBtn.querySelector('svg')).not.toBeNull();

    act(() => {
      searchBtn.click();
    });
    expect(filesBtn.getAttribute('aria-pressed')).toBe('false');
    expect(searchBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('Ctrl+Shift+F 打开搜索侧栏并聚焦搜索输入', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'f' }),
      );
    });

    const input = screen.getByLabelText('搜索内容') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  it('侧栏可折叠，并可通过活动栏恢复且不伪造设置入口', async () => {
    makeDesktopMock();
    render(<App />);
    const sidebar = document.querySelector<HTMLElement>('aside.sidebar');
    expect(sidebar?.hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
    expect(sidebar?.hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    expect(sidebar?.hidden).toBe(false);
    expect(screen.queryByRole('button', { name: /设置/ })).toBeNull();
  });
});

describe('搜索侧栏状态与结果展示（第 8.5 节）', () => {
  it('无工作区：显示空状态且不发起搜索 IPC', () => {
    const api = makeDesktopMock();
    render(<App />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'f' }),
      );
    });

    expect(screen.getByText('尚未打开工作区')).toBeDefined();
    expect(api.textWorkspace).not.toHaveBeenCalled();
    expect(api.cancelTextWorkspace).not.toHaveBeenCalled();
  });

  it('输入草稿与已提交查询分离：结果标题使用已提交查询', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    const input = screen.getByLabelText('搜索内容') as HTMLInputElement;
    await user.type(input, 'hello');
    await user.keyboard('{Enter}');
    expect(screen.getByText('正在搜索…')).toBeDefined();

    // 结果标题只在有匹配分组时渲染（空结果只显示"没有匹配"）
    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [
          {
            kind: 'txt',
            relativePath: 'a.txt',
            revision: 'r1',
            truncated: false,
            matches: [match(6, 11, 1, 7, 'hello')],
          },
        ]),
      );
    });
    expect(screen.getByText('查询：“hello”')).toBeDefined();

    // 修改草稿不改变已提交查询标题
    await user.clear(input);
    await user.type(input, 'world');
    expect(screen.getByText('查询：“hello”')).toBeDefined();
  });

  it('completed：按文件分组展示路径、行列、高亮片段与统计', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');

    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [
          {
            kind: 'txt',
            relativePath: 'a.txt',
            revision: 'r1',
            truncated: false,
            matches: [match(6, 11, 1, 7, 'hello')],
          },
          {
            kind: 'txt',
            relativePath: 'sub/b.txt',
            revision: 'r2',
            truncated: false,
            matches: [match(0, 5, 2, 1, 'hello')],
          },
        ]),
      );
    });

    expect(screen.getByText('a.txt')).toBeDefined();
    expect(screen.getByTitle('sub/b.txt')).toBeDefined();
    expect(screen.getByText('b.txt')).toBeDefined();
    expect(screen.getByText('sub')).toBeDefined();
    expect(screen.getByText('1:7')).toBeDefined();
    expect(screen.getByText('2:1')).toBeDefined();
    // 安全高亮：mark 元素由文本节点渲染，无 innerHTML 注入
    const mark = document.querySelector('.search-match-preview mark');
    expect(mark?.textContent).toBe('hello');
    expect(screen.getByText(/扫描 2 个文件/)).toBeDefined();
    expect(screen.getByText(/共 2 处匹配/)).toBeDefined();
    expect(screen.getByText(/跳过 1 个/)).toBeDefined();
  });

  it('empty：无匹配时显示明确空结果', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('zzz');

    await act(async () => {
      api.resolveSearch(1, completedResult(1, []));
    });
    expect(screen.getByText('没有匹配')).toBeDefined();
  });

  it('truncated：展示截断原因', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');

    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [], { truncated: true, truncatedReason: 'total-matches-limit' }),
      );
    });
    expect(screen.getByText('结果已截断：总匹配数已达上限')).toBeDefined();
  });

  it('truncated docx-file-limit：展示 DOCX 候选上限文案', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');

    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [], { truncated: true, truncatedReason: 'docx-file-limit' }),
      );
    });
    expect(screen.getByText('结果已截断：DOCX 候选文件数已达上限')).toBeDefined();
  });

  it('一次查询展示 TXT 与 DOCX 分组：类型标识、路径与 DOCX 提取正文说明', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');

    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [
          {
            kind: 'txt',
            relativePath: 'a.txt',
            revision: 'r1',
            truncated: false,
            matches: [match(6, 11, 1, 7, 'hello')],
          },
          {
            kind: 'docx',
            relativePath: 'b.docx',
            revision: 'r2',
            truncated: false,
            matches: [match(0, 5, 2, 1, 'hello')],
          },
        ]),
      );
    });

    expect(screen.getByText('a.txt')).toBeDefined();
    expect(screen.getByText('b.docx')).toBeDefined();
    // 类型标识为可访问文本节点（TXT / DOCX 各一个）
    expect(screen.getAllByText('TXT')).toHaveLength(1);
    expect(screen.getAllByText('DOCX')).toHaveLength(1);
    expect(screen.getByLabelText('文件类型：DOCX')).toBeDefined();
    // DOCX 行列明确属于提取正文
    expect(screen.getByText('行列基于 DOCX 提取正文，不是 Word 页面坐标。')).toBeDefined();
    expect(screen.getByText('1:7')).toBeDefined();
    expect(screen.getByText('2:1')).toBeDefined();
    expect(screen.getByText(/扫描 2 个文件/)).toBeDefined();
  });

  it('未保存正文提示明确：侧栏说明结果不包含未保存编辑', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    expect(screen.getByText(/结果来自磁盘上已保存的文件，不包含未保存的编辑/)).toBeDefined();
    expect(screen.getByText(/DOCX 仅覆盖已进入结构化模型的正文/)).toBeDefined();
  });

  it('活动 DOCX 时当前文档查找显示 DOCX 面板（TASK-010 WP3 取代 TXT-only 说明）', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot({ entries: [f('b.docx', 'b.docx')] }),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    // 打开 DOCX 标签（mock readDocx 返回 loaded 空文档）
    await act(async () => {
      fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'b.docx' }));
    });
    await act(async () => {});
    await act(async () => {});

    // 打开搜索侧栏并切到"查找与替换"：DOCX 面板直接可用
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(screen.getByLabelText('查找内容')).toBeDefined();
    expect(screen.queryByText('当前文件查找替换仅支持 TXT 文档。')).toBeNull();
    // TXT 的 CodeMirror 挂载点不再用于 DOCX（无假可用输入框）
    expect(document.querySelector('.current-document-search-panel')).toBeNull();
  });

  it('cancelled：主动取消后展示已取消且结果不恢复', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    await user.type(screen.getByLabelText('搜索内容'), 'hello');
    await user.keyboard('{Enter}');
    expect(screen.getByText('正在搜索…')).toBeDefined();

    await user.click(screen.getByText('取消'));
    expect(screen.getByText('已取消')).toBeDefined();

    // 迟到结果不得恢复或覆盖已取消状态
    await act(async () => {
      api.resolveSearch(1, completedResult(1, []));
    });
    expect(screen.getByText('已取消')).toBeDefined();
    expect(screen.queryByText('没有匹配')).toBeNull();
  });

  it('error：展示稳定错误信息', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');

    await act(async () => {
      api.resolveSearch(1, {
        status: 'error',
        requestId: 1,
        error: { code: 'SEARCH_FAILED', message: '无法读取工作区根目录' },
      });
    });
    expect(screen.getByText(/搜索失败：无法读取工作区根目录/)).toBeDefined();
  });
});

describe('搜索竞态与侧栏状态保持（第 8.5 节）', () => {
  it('新搜索取消旧搜索：旧结果迟到不覆盖最新搜索', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    const input = screen.getByLabelText('搜索内容') as HTMLInputElement;
    await user.type(input, 'alpha');
    await user.keyboard('{Enter}');
    expect(screen.getByText('正在搜索…')).toBeDefined();

    // 搜索进行中提交第二个查询：jsdom 不实现无提交按钮表单的隐式提交，
    // 因此这里直接对表单触发 submit（真实浏览器中 Enter 即可提交，语义相同）
    await user.clear(input);
    await user.type(input, 'beta');
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });
    expect(screen.getByText('正在搜索…')).toBeDefined();

    // 旧结果迟到：不得覆盖 searching 状态
    await act(async () => {
      api.resolveSearch(1, completedResult(1, []));
    });
    expect(screen.getByText('正在搜索…')).toBeDefined();

    await act(async () => {
      api.resolveSearch(
        2,
        completedResult(2, [
          {
            kind: 'txt',
            relativePath: 'b.txt',
            revision: 'r2',
            truncated: false,
            matches: [match(0, 4, 1, 1, 'beta')],
          },
        ]),
      );
    });
    expect(screen.getByText('查询：“beta”')).toBeDefined();
  });

  it('切换文件/搜索侧栏不丢失工作区与文件树展开状态', async () => {
    const api = makeDesktopMock();
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot({ entries: [d('src', 'src', [f('deep.txt', 'src/deep.txt')])] }),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const user = userEvent.setup();
    // 展开目录
    const directoryButton = screen.getByRole('button', { name: 'src' });
    directoryButton.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('deep.txt')).toBeDefined();

    // 切到搜索再切回文件：展开状态保留
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    expect(screen.getByLabelText('搜索内容')).toBeDefined();
    await user.click(screen.getByRole('button', { name: '文件面板' }));
    expect(screen.getByText('deep.txt')).toBeDefined();
    expect(screen.getByText('test-root')).toBeDefined();
  });

  it('工作区打开取消或失败：保留原工作区与有效搜索状态', async () => {
    const api = makeDesktopMock();
    api.open
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({ status: 'cancelled' } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, []));
    });
    expect(screen.getByText('没有匹配')).toBeDefined();

    // 取消切换工作区：旧搜索结果保留
    await openWorkspace();
    expect(screen.getByText('没有匹配')).toBeDefined();
    expect(screen.getByText('test-root')).toBeDefined();
  });

  it('工作区成功切换：清空旧搜索结果', async () => {
    const api = makeDesktopMock();
    api.open
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot({ rootName: 'other-root', entries: [] }),
      } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, []));
    });
    expect(screen.getByText('没有匹配')).toBeDefined();

    // 成功切换到新工作区：旧结果清空，回到初始搜索状态
    await openWorkspace();
    expect(screen.getByText('other-root')).toBeDefined();
    expect(screen.queryByText('没有匹配')).toBeNull();
    expect(screen.getByText(/输入查询后按 Enter 或点击搜索/)).toBeDefined();
  });
});
