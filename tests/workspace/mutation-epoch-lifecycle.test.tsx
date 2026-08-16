// @vitest-environment jsdom
/**
 * TASK-009 WP7：mutationEpoch 生命周期与搜索失效 App 级集成测试（§4.11 / WP0 冻结）。
 * 通过真实 <App /> 组合验证：
 * - 成功 create/save-as/relocate/trash 递增 mutationEpoch → 取消活动搜索、
 *   清空 completed 结果（搜索侧栏回到 idle）；
 * - 失败、用户取消与 reveal 不递增 → completed 结果保持有效；
 * - searching 中 mutation 成功 → 在途请求被取消（cancelTextWorkspace）；
 * - 手工刷新成功替换快照 → 作废搜索结果；刷新失败 → 保留。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function f(name: string, relativePath: string): WorkspaceEntry {
  return { name, relativePath, kind: 'file' };
}

function snapshot(entries: readonly WorkspaceEntry[] = []): WorkspaceSnapshot {
  return { rootName: 'ws', rootPath: '/ws', entries };
}

function match(from: number, to: number, text: string): WorkspaceTextSearchMatch {
  return {
    from,
    to,
    line: 0,
    column: from,
    matchedText: text,
    preview: `前 ${text} 后`,
    previewMatchFrom: 2,
    previewMatchTo: 2 + text.length,
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
      scannedFiles: 2,
      matchedFiles: files.length,
      totalMatches: files.reduce((sum, file) => sum + file.matches.length, 0),
      skippedFiles: 0,
    },
    truncated: false,
    truncatedReason: null,
  };
}

interface DesktopMock {
  textWorkspace: ReturnType<typeof vi.fn>;
  cancelTextWorkspace: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  createText: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
  resolveSearch: (requestId: number, result: WorkspaceTextSearchResult) => void;
}

function makeDesktopMock(): DesktopMock {
  const pending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        pending.set(request.requestId, { resolve });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
  const open = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
    status: 'selected',
    workspace: snapshot([f('a.txt', 'a.txt'), f('note.bin', 'note.bin'), f('b.docx', 'b.docx')]),
  }));
  const refresh = vi.fn(async (): Promise<RefreshWorkspaceResult> => ({
    status: 'refreshed',
    workspace: snapshot([f('a.txt', 'a.txt'), f('note.bin', 'note.bin'), f('b.docx', 'b.docx')]),
  }));
  const createText = vi.fn(async () => ({
    status: 'succeeded' as const,
    mutationId: 1,
    relativePath: 'new.txt',
    kind: 'text' as const,
  }));
  const reveal = vi.fn(async () => ({ status: 'revealed' as const }));
  const trash = vi.fn(async () => ({
    status: 'succeeded' as const,
    mutationId: 1,
    relativePath: 'a.txt',
    kind: 'text' as const,
  }));
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open,
      refresh,
      createText,
      createDocx: vi.fn(),
      createDirectory: vi.fn(),
      reveal,
      relocate: vi.fn(),
      trash,
    },
    document: {
      readText: vi.fn(async (): Promise<ReadTextDocumentResult> => ({
        status: 'loaded',
        document: {
          name: 'a.txt',
          relativePath: 'a.txt',
          content: 'hello world',
          byteLength: 11,
          revision: 'rev-a',
          hasUtf8Bom: false,
          lineEnding: 'lf',
        },
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
          revision: 'rev-b',
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
    textWorkspace,
    cancelTextWorkspace,
    trash,
    refresh,
    createText,
    reveal,
    resolveSearch: (requestId, result) => pending.get(requestId)?.resolve(result),
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

async function submitSearch(query: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '搜' }));
  await user.type(screen.getByLabelText('搜索内容'), query);
  await user.keyboard('{Enter}');
}

async function resolveCompleted(api: DesktopMock, requestId: number): Promise<void> {
  await act(async () => {
    api.resolveSearch(
      requestId,
      completedResult(requestId, [
        {
          relativePath: 'a.txt',
          kind: 'txt',
          revision: 'rev-a',
          matches: [match(6, 11, 'world')],
          truncated: false,
        },
      ]),
    );
  });
}

/** 切换到文件栏并确认删除 a.txt（trash 已由 mock 决定成功/失败）。 */
async function deleteSelectedFile(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '文' }));
  await userEvent.click(screen.getByTestId('ft-a.txt'));
  await userEvent.click(screen.getByTestId('fm-delete'));
  await userEvent.click(screen.getByTestId('fm-trash-confirm'));
}

describe('mutationEpoch 搜索失效（TASK-009 §4.11）', () => {
  it('completed 搜索 + 删除成功：清空结果回到 idle', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    await deleteSelectedFile();
    expect(api.trash).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText('输入查询后按 Enter 或点击搜索。')).toBeDefined();
    expect(screen.queryByText(/共 1 处匹配/)).toBeNull();
  });

  it('searching 中 + 删除成功：取消在途请求并清空', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    expect(screen.getByText('正在搜索…')).toBeDefined();

    await deleteSelectedFile();
    expect(api.cancelTextWorkspace).toHaveBeenCalledWith({ requestId: 1 });

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText('输入查询后按 Enter 或点击搜索。')).toBeDefined();
    expect(screen.queryByText('正在搜索…')).toBeNull();
  });

  it('completed 搜索 + 删除失败：结果保持有效（失败不递增）', async () => {
    const api = makeDesktopMock();
    api.trash.mockResolvedValue({
      status: 'error',
      mutationId: 1,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    });
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    await deleteSelectedFile();

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();
    expect(screen.queryByText('输入查询后按 Enter 或点击搜索。')).toBeNull();
  });

  it('completed 搜索 + 取消删除：结果保持有效（取消不递增）', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);

    await userEvent.click(screen.getByRole('button', { name: '文' }));
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await userEvent.click(screen.getByTestId('fm-delete'));
    await userEvent.click(screen.getByTestId('fm-trash-cancel'));
    expect(api.trash).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();
  });

  it('completed 搜索 + reveal 成功：结果保持有效（reveal 不递增）', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);

    await userEvent.click(screen.getByRole('button', { name: '文' }));
    await userEvent.click(screen.getByTestId('ft-a.txt'));
    await userEvent.click(screen.getByTestId('fm-reveal'));
    expect(api.reveal).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();
  });

  it('completed 搜索 + 新建 TXT 成功：清空结果', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '文' }));
    await userEvent.click(screen.getByTestId('fm-create-text'));
    await userEvent.type(screen.getByTestId('fm-name-input'), 'brand-new{Enter}');
    expect(api.createText).toHaveBeenCalledWith({
      mutationId: 1,
      parentRelativePath: '',
      name: 'brand-new.txt',
    });

    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText('输入查询后按 Enter 或点击搜索。')).toBeDefined();
  });

  it('手工刷新：成功替换快照 → 作废搜索结果；刷新失败 → 保留', async () => {
    const api = makeDesktopMock();
    render(<App />);
    await openWorkspace();
    await submitSearch('hello');
    await resolveCompleted(api, 1);
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    // 刷新失败：不递增，结果保留
    api.refresh.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'SCAN_FAILED', message: '扫描失败' },
    });
    await userEvent.click(screen.getByRole('button', { name: '文' }));
    await userEvent.click(screen.getByText('刷新'));
    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    // 刷新成功：替换快照 → 作废搜索结果
    await userEvent.click(screen.getByRole('button', { name: '文' }));
    await userEvent.click(screen.getByText('刷新'));
    await userEvent.click(screen.getByRole('button', { name: '搜' }));
    expect(screen.getByText('输入查询后按 Enter 或点击搜索。')).toBeDefined();
    expect(screen.queryByText(/共 1 处匹配/)).toBeNull();
  });
});
