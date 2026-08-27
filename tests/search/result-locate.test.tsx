// @vitest-environment jsdom
/**
 * TASK-006 WP5 搜索结果打开/激活与安全定位测试（任务第 8.6 节与第 4.9 节规则）。
 * 覆盖：点击未打开结果创建唯一 loading 标签并在读取完成后定位；已打开标签只激活不重读；
 * loading 中重复点击去重；read-error 保留错误状态；关闭后迟到定位作废；
 * 连续点击只定位最后一次；revision 不一致 / 越界 / 正文不匹配只提示过期不错误选中；
 * CRLF 原文偏移到 CodeMirror 位置的转换；dirty 但范围一致允许定位且不清除 dirty；
 * 定位不修改正文、revision、dirty 或撤销历史。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';
import type {
  WorkspaceTextSearchFileResult,
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

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [], ...overrides };
}

function fileResult(
  relativePath: string,
  revision: string,
  from: number,
  to: number,
  matchedText: string,
): WorkspaceTextSearchFileResult {
  return {
    kind: 'txt',
    relativePath,
    revision,
    truncated: false,
    matches: [
      {
        from,
        to,
        line: 1,
        column: from + 1,
        matchedText,
        preview: matchedText,
        previewMatchFrom: 0,
        previewMatchTo: matchedText.length,
      },
    ],
  };
}

function completedResult(
  requestId: number,
  files: readonly WorkspaceTextSearchFileResult[],
): WorkspaceTextSearchResult {
  return {
    status: 'completed',
    requestId,
    files,
    statistics: {
      scannedFiles: files.length,
      matchedFiles: files.length,
      totalMatches: files.reduce((sum, file) => sum + file.matches.length, 0),
      skippedFiles: 0,
    },
    truncated: false,
    truncatedReason: null,
  };
}

interface DesktopMock {
  open: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
  textWorkspace: ReturnType<typeof vi.fn>;
  cancelTextWorkspace: ReturnType<typeof vi.fn>;
  resolveSearch: (requestId: number, result: WorkspaceTextSearchResult) => void;
}

function mockDesktop(readText: DesktopMock['readText']): DesktopMock {
  const pending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        pending.set(request.requestId, { resolve });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
  const open = vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' }));
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open,
      refresh: vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' })),
    },
    document: {
      readText,
      saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
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
    readText,
    textWorkspace,
    cancelTextWorkspace,
    resolveSearch: (requestId, result) => pending.get(requestId)?.resolve(result),
  };
}

function loaded(relativePath: string, content: string, revision: string): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision,
      hasUtf8Bom: false,
      lineEnding: content.includes('\r\n') ? 'crlf' : 'lf',
    },
  };
}

/** 标准 readText mock：按路径返回固定内容与 revision。 */
function makeReadText(
  files: Readonly<Record<string, { content: string; revision: string }>>,
): DesktopMock['readText'] {
  return vi.fn(async (relativePath: string): Promise<ReadTextDocumentResult> => {
    const info = files[relativePath];
    if (info === undefined) {
      return { status: 'error', error: { code: 'NOT_FOUND', message: '文件不存在' } };
    }
    return loaded(relativePath, info.content, info.revision);
  });
}

function editorView(): EditorView | null {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  return content === null ? null : EditorView.findFromDOM(content);
}

function selectionRange(): [number, number] | null {
  const view = editorView();
  if (view === null) {
    return null;
  }
  const main = view.state.selection.main;
  return [main.from, main.to];
}

function matchButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.search-match-btn')) as HTMLButtonElement[];
}

async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

/** 在同一个 act 作用域内让异步定位链（读取完成 → 校验 → 下发目标 → 宿主应用）完成。 */
async function clickMatch(index: number): Promise<void> {
  await act(async () => {
    fireEvent.click(matchButtons()[index]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 打开搜索侧栏并提交查询。
 * 注意：提交只用 fireEvent（change + Enter + form submit），不使用 user-event 键盘输入——
 * React 19.1 的 act 与 user-event 的 document 捕获级 dispatch 在编辑器聚焦夺走输入框焦点
 * 时存在 flush 碰撞，会产生"component suspended inside an act scope"一次性警告
 * （TASK-007 WP0 归因，见 docs/TASK_007_WP0_REPORT.md）。本文件的主题是结果定位，
 * 键入路径已在 tests/search/search-sidebar.test.tsx 用 user-event 覆盖。
 */
async function submitSearch(query: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: query } });
    fireEvent.keyDown(screen.getByLabelText('搜索内容'), { key: 'Enter' });
    fireEvent.submit(screen.getByLabelText('搜索内容').closest('form') as HTMLFormElement);
  });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

describe('搜索结果打开与定位（第 4.9 节）', () => {
  it('点击未打开文件结果：创建唯一标签，读取完成后选中范围、标签激活、无过期提示', async () => {
    const api = mockDesktop(
      makeReadText({ 'a.txt': { content: 'hello world', revision: 'rev-a' } }),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]));
    });

    await clickMatch(0);

    expect(selectionRange()).toEqual([0, 5]);
    expect(api.readText).toHaveBeenCalledTimes(1);
    expect(api.readText).toHaveBeenCalledWith('a.txt');
    // 唯一标签且活动
    const tabs = document.querySelectorAll('.tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.classList.contains('active')).toBe(true);
    // 定位成功：无过期提示
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('CRLF 文件把磁盘原文偏移转换为 CodeMirror 位置，不会错选相邻同文文本', async () => {
    const api = mockDesktop(
      makeReadText({ 'crlf.txt': { content: 'a\r\nbb', revision: 'rev-crlf' } }),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('b');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('crlf.txt', 'rev-crlf', 3, 4, 'b')]));
    });

    await clickMatch(0);

    // 磁盘原文中首个 b 是 3..4；CodeMirror 将 CRLF 作为一个位置，因此应选中 2..3。
    expect(selectionRange()).toEqual([2, 3]);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('点击已打开标签结果：只激活、不重复读取，再次定位成功', async () => {
    const api = mockDesktop(
      makeReadText({ 'a.txt': { content: 'hello world', revision: 'rev-a' } }),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]));
    });

    await clickMatch(0);
    expect(api.readText).toHaveBeenCalledTimes(1);

    // 手动移动光标后再点同一结果：只激活并重新定位，不发起第二次读取
    act(() => {
      editorView()?.dispatch({ selection: { anchor: 8, head: 8 } });
    });
    await clickMatch(0);
    expect(selectionRange()).toEqual([0, 5]);
    expect(api.readText).toHaveBeenCalledTimes(1);
  });

  it('loading 中重复点击同一结果：不创建第二标签、不重复读取', async () => {
    let resolveRead: ((result: ReadTextDocumentResult) => void) | null = null;
    const readText = vi.fn(
      () =>
        new Promise<ReadTextDocumentResult>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const api = mockDesktop(readText);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]));
    });

    await clickMatch(0);
    await clickMatch(0);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    await act(async () => {
      resolveRead?.(loaded('a.txt', 'hello world', 'rev-a'));
    });
    expect(selectionRange()).toEqual([0, 5]);
  });

  it('read-error 标签：保留错误状态，只提示过期、不定位', async () => {
    const readText = vi.fn(async (): Promise<ReadTextDocumentResult> => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
    }));
    const api = mockDesktop(readText);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]));
    });

    await clickMatch(0);

    expect(screen.getByText(/搜索结果已过期：a\.txt 读取失败/)).toBeDefined();
    // read-error 无正文快照：不挂载编辑器，不伪造定位成功
    expect(editorView()).toBeNull();
    expect(screen.getByText('无法读取文件 a.txt')).toBeDefined();
  });

  it('标签加载中关闭：定位请求作废，读取迟到结果不定位', async () => {
    let resolveRead: ((result: ReadTextDocumentResult) => void) | null = null;
    const readText = vi.fn(
      () =>
        new Promise<ReadTextDocumentResult>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const api = mockDesktop(readText);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]));
    });

    await clickMatch(0);
    // 加载中关闭标签
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭 a.txt' }));
    });
    // 读取迟到完成：标签已关闭，定位不生效、无过期提示
    await act(async () => {
      resolveRead?.(loaded('a.txt', 'hello world', 'rev-a'));
    });
    expect(editorView()).toBeNull();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('连续点击多个结果：只定位最后一次点击', async () => {
    let resolveA: ((result: ReadTextDocumentResult) => void) | null = null;
    let resolveB: ((result: ReadTextDocumentResult) => void) | null = null;
    const readText = vi.fn((relativePath: string) => {
      const promise = new Promise<ReadTextDocumentResult>((resolve) => {
        if (relativePath === 'a.txt') {
          resolveA = resolve;
        } else {
          resolveB = resolve;
        }
      });
      return promise;
    });
    const api = mockDesktop(readText);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('x');
    await act(async () => {
      api.resolveSearch(
        1,
        completedResult(1, [
          fileResult('a.txt', 'rev-a', 0, 1, 'x'),
          fileResult('b.txt', 'rev-b', 2, 3, 'x'),
        ]),
      );
    });

    await clickMatch(0); // a.txt
    await clickMatch(1); // b.txt（新定位请求作废 a 的定位）

    await act(async () => {
      resolveB?.(loaded('b.txt', 'x x x', 'rev-b'));
    });
    expect(selectionRange()).toEqual([2, 3]);

    // a 的读取迟到完成：定位已被作废，不得覆盖 b 的选区
    await act(async () => {
      resolveA?.(loaded('a.txt', 'x x x', 'rev-a'));
    });
    expect(selectionRange()).toEqual([2, 3]);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });
});

describe('定位过期校验（第 4.9.3 - 4.9.5 节）', () => {
  async function setupWithResult(
    files: Readonly<Record<string, { content: string; revision: string }>>,
    result: WorkspaceTextSearchResult,
  ): Promise<DesktopMock> {
    const api = mockDesktop(makeReadText(files));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(1, result);
    });
    return api;
  }

  it('revision 不一致（外部修改后）：只提示过期，不选中', async () => {
    const api = await setupWithResult(
      { 'a.txt': { content: 'hello world', revision: 'rev-a' } },
      completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]),
    );
    // 磁盘内容已在读取前被外部修改：readText 返回新 revision 与新正文
    api.readText.mockResolvedValueOnce(loaded('a.txt', 'HELLO WORLD', 'rev-a-changed'));

    await clickMatch(0);

    expect(screen.getByText(/搜索结果已过期：a\.txt 的内容已被外部修改/)).toBeDefined();
    expect(selectionRange()).toEqual([0, 0]);
  });

  it('越界范围：只提示过期，不错误选中', async () => {
    await setupWithResult(
      { 'a.txt': { content: 'hello', revision: 'rev-a' } },
      completedResult(1, [fileResult('a.txt', 'rev-a', 0, 100, 'hello')]),
    );

    await clickMatch(0);

    expect(screen.getByText(/搜索结果已过期：a\.txt 的匹配位置已失效/)).toBeDefined();
    expect(selectionRange()).toEqual([0, 0]);
  });

  it('dirty 但原范围仍一致：允许定位且不清除 dirty', async () => {
    await setupWithResult(
      { 'a.txt': { content: 'hello world', revision: 'rev-a' } },
      completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]),
    );

    await clickMatch(0);
    expect(selectionRange()).toEqual([0, 5]);

    // 在末尾追加内容：范围 0..5 不受影响，但标签变为 dirty
    await act(async () => {
      const view = editorView();
      if (view !== null) {
        const end = view.state.doc.length;
        view.dispatch({
          changes: { from: end, insert: '!' },
          selection: { anchor: end + 1 },
        });
      }
    });
    const saveButton = screen.getByText('保存').closest('button') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false); // dirty

    // 再次点击结果：dirty 但范围一致 → 定位成功且不清除 dirty
    await clickMatch(0);
    expect(selectionRange()).toEqual([0, 5]);
    expect((screen.getByText('保存').closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('dirty 导致范围变化：只提示过期，不错误定位', async () => {
    await setupWithResult(
      { 'a.txt': { content: 'hello world', revision: 'rev-a' } },
      completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]),
    );

    await clickMatch(0);

    // 在位置 0 插入字符：原范围 0..5 不再等于 "hello"
    await act(async () => {
      const view = editorView();
      if (view !== null) {
        view.dispatch({
          changes: { from: 0, insert: 'X' },
          selection: { anchor: 1 },
        });
      }
    });

    await clickMatch(0);

    expect(screen.getByText(/搜索结果已过期：a\.txt 的匹配位置已失效/)).toBeDefined();
    expect(selectionRange()).not.toEqual([0, 5]);
  });

  it('定位不修改正文、revision、dirty、saving 或撤销历史', async () => {
    const api = await setupWithResult(
      { 'a.txt': { content: 'hello world', revision: 'rev-a' } },
      completedResult(1, [fileResult('a.txt', 'rev-a', 0, 5, 'hello')]),
    );

    await clickMatch(0);

    const view = editorView();
    expect(view).not.toBeNull();
    expect(view?.state.doc.toString()).toBe('hello world');
    expect(selectionRange()).toEqual([0, 5]);
    // 定位只改变选区：不产生可撤销的历史步骤、不制造 dirty、不触发保存
    expect(undo(view as EditorView)).toBe(false);
    expect((screen.getByText('保存').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(api.readText).toHaveBeenCalledTimes(1);
  });
});
