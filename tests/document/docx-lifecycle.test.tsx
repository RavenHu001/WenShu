// @vitest-environment jsdom
/**
 * TASK-007 WP6：DOCX 保存闭环、生命周期保护与混合场景测试（任务第 8.6 节跨组件）。
 * 覆盖：Ctrl+S、备份提示、保存中/成功/冲突、dirty 关闭/工作区切换/窗口关闭确认、
 * saving 标签保护、保存期间继续编辑、多个 DOCX 并行保存、TXT 搜索结果与 DOCX 标签共存。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceSnapshot,
  WorkspaceEntry,
} from '../../src/shared/workspace';
import type {
  ReadDocxDocumentResult,
  SaveDocxDocumentRequest,
  SaveDocxDocumentResult,
  DocxDocumentSnapshot,
  DocxDocumentModel,
} from '../../src/shared/docx';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../src/shared/docx';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';
import type {
  WorkspaceTextSearchFileResult,
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

function paragraphModel(text: string): DocxDocumentModel {
  return {
    schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
    blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text, marks: [] }] }],
  };
}

function docxSnapshot(
  relativePath: string,
  model: DocxDocumentModel,
  overrides: Partial<DocxDocumentSnapshot> = {},
): DocxDocumentSnapshot {
  return {
    kind: 'docx',
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    revision: `rev-${relativePath}`,
    size: 10,
    model,
    compatibility: { level: 'supported', warnings: [] },
    ...overrides,
  };
}

function entry(relativePath: string): WorkspaceEntry {
  return {
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    kind: 'file',
  };
}

function snapshot(entries: readonly WorkspaceEntry[]): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [...entries] };
}

function loadedText(relativePath: string, content: string): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision: `rev-${relativePath}`,
      hasUtf8Bom: false,
      lineEnding: content.includes('\r\n') ? 'crlf' : 'lf',
    },
  };
}

interface DesktopMock {
  readonly open: ReturnType<typeof vi.fn>;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly saveText: ReturnType<typeof vi.fn>;
  readonly readDocx: ReturnType<typeof vi.fn>;
  readonly saveDocx: ReturnType<typeof vi.fn>;
  /** 结算最近一次保存：默认回显请求模型（与主进程产物语义一致），可传覆盖结果。 */
  readonly resolveSaveDocx: (result?: SaveDocxDocumentResult) => void;
  readonly textWorkspace: ReturnType<typeof vi.fn>;
  readonly resolveSearch: (requestId: number, result: WorkspaceTextSearchResult) => void;
  readonly setDirtyState: ReturnType<typeof vi.fn>;
  readonly requestClose: ReturnType<typeof vi.fn>;
  readonly cancelClose: ReturnType<typeof vi.fn>;
  readonly onCloseRequested: ReturnType<typeof vi.fn>;
}

function mockDesktop(): DesktopMock {
  const saveDocxPending = new Map<number, { resolve: (r: SaveDocxDocumentResult) => void }>();
  let saveDocxSeq = 0;
  let lastSaveRequest: SaveDocxDocumentRequest | null = null;
  const saveDocx = vi.fn(
    (request: SaveDocxDocumentRequest) =>
      new Promise<SaveDocxDocumentResult>((resolve) => {
        lastSaveRequest = request;
        saveDocxSeq += 1;
        saveDocxPending.set(saveDocxSeq, { resolve });
      }),
  );
  const searchPending = new Map<number, { resolve: (r: WorkspaceTextSearchResult) => void }>();
  const textWorkspace = vi.fn(
    (request: { requestId: number }) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        searchPending.set(request.requestId, { resolve });
      }),
  );
  const onCloseRequested = vi.fn(() => () => undefined);
  const api = {
    open: vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' })),
    readText: vi.fn(async (): Promise<ReadTextDocumentResult> =>
      loadedText('a.txt', 'hello world'),
    ),
    saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: '写入文件失败' },
    })),
    readDocx: vi.fn(async (): Promise<ReadDocxDocumentResult> => ({
      status: 'loaded',
      document: docxSnapshot('b.docx', paragraphModel('DOCX 正文')),
    })),
    saveDocx,
    resolveSaveDocx: (result?: SaveDocxDocumentResult): void => {
      const key = [...saveDocxPending.keys()][0]!;
      const pending = saveDocxPending.get(key);
      saveDocxPending.delete(key);
      if (pending === undefined) {
        return;
      }
      if (result !== undefined) {
        pending.resolve(result);
        return;
      }
      const request = lastSaveRequest;
      if (request === null) {
        return;
      }
      pending.resolve({
        status: 'saved',
        document: docxSnapshot(request.relativePath, request.model, { revision: 'rev-saved' }),
        backupRelativePath: `${request.relativePath}.wenshu.bak`,
      });
    },
    textWorkspace,
    resolveSearch: (requestId: number, result: WorkspaceTextSearchResult): void => {
      searchPending.get(requestId)?.resolve(result);
    },
    setDirtyState: vi.fn(async () => undefined),
    requestClose: vi.fn(async () => undefined),
    cancelClose: vi.fn(async () => undefined),
    onCloseRequested,
  };
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: api.open,
      refresh: vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' })),
    },
    document: {
      readText: api.readText,
      saveText: api.saveText,
      readDocx: api.readDocx,
      saveDocx: api.saveDocx,
    },
    search: { textWorkspace: api.textWorkspace, cancelTextWorkspace: vi.fn(async () => undefined) },
    window: {
      setDirtyState: api.setDirtyState,
      requestClose: api.requestClose,
      cancelClose: api.cancelClose,
      onCloseRequested: api.onCloseRequested,
    },
  };
  return api;
}

async function openWorkspace(api: DesktopMock, entries: readonly WorkspaceEntry[]): Promise<void> {
  api.open.mockResolvedValue({
    status: 'selected',
    workspace: snapshot(entries),
  } as OpenWorkspaceResult);
  render(<App />);
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

async function openDocx(_api: DesktopMock, name = 'b.docx'): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
  });
  await act(async () => {});
  await act(async () => {});
}

function docxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

function makeDirty(): void {
  const editor = docxEditor();
  act(() => {
    editor?.view.dispatch(editor.view.state.tr.insertText(' 编辑'));
  });
}

function dirtyTabCount(): number {
  return document.querySelectorAll('.tab .tab-dirty').length;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

describe('DOCX 保存闭环（第 8.6 节）', () => {
  it('Ctrl+S 触发与保存按钮相同的保存流程', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    const proseMirror = document.querySelector('.ProseMirror') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(proseMirror, { key: 's', ctrlKey: true });
    });
    expect(api.saveDocx).toHaveBeenCalledTimes(1);
    const request = api.saveDocx.mock.calls[0]?.[0] as SaveDocxDocumentRequest;
    expect(request.relativePath).toBe('b.docx');
    expect(request.expectedRevision).toBe('rev-b.docx');
  });

  it('保存成功：dirty 清除、状态含备份提示（滚动备份相对路径）', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    expect(screen.getByText('未保存')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('正在保存…')).toBeDefined();
    expect(api.saveDocx).toHaveBeenCalledTimes(1);
    const request1 = api.saveDocx.mock.calls[0]?.[0] as SaveDocxDocumentRequest;
    expect(request1.expectedRevision).toBe('rev-b.docx');
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(0);
    expect(screen.getByText('已保存（备份 b.docx.wenshu.bak）')).toBeDefined();
  });

  it('保存期间继续编辑：旧保存成功不清除新 dirty（不变量 9）', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    // 保存在途时继续编辑
    makeDirty();
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('未保存')).toBeDefined();
  });

  it('保存冲突：外部冲突状态、重新读取确认后载入磁盘版本', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {
      api.resolveSaveDocx({
        status: 'error',
        error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
      });
    });
    await act(async () => {});
    expect(screen.getByText('外部冲突')).toBeDefined();
    expect(dirtyTabCount()).toBe(1);
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot('b.docx', paragraphModel('磁盘新正文'), { revision: 'rev-disk' }),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    await act(async () => {});
    await act(async () => {});
    expect(docxEditor()?.view.state.doc.textContent).toContain('磁盘新正文');
    expect(dirtyTabCount()).toBe(0);
  });

  it('多个 DOCX 标签并行保存：各自独立完成', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx'), entry('c.docx')]);
    await openDocx(api, 'b.docx');
    await openDocx(api, 'c.docx');
    makeDirty(); // c.docx（活动标签）
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    makeDirty(); // b.docx
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /c\.docx/ }));
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(api.saveDocx).toHaveBeenCalledTimes(2);
    // 依次完成两个保存
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(0);
  });
});

describe('生命周期保护（第 8.6 节）', () => {
  it('dirty DOCX 关闭：取消保留，确认后关闭', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    await userEvent.setup().click(screen.getByRole('button', { name: '关闭 b.docx' }));
    expect(screen.getByText(/放弃对 b\.docx 的未保存修改并关闭标签/)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: '取消' }));
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    expect(dirtyTabCount()).toBe(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '关闭 b.docx' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
  });

  it('dirty DOCX 切换工作区：聚合确认，取消不打开目录选择器', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    api.open.mockClear();
    await openDocx(api, 'b.docx');
    makeDirty();
    await userEvent.setup().click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    expect(screen.getByText(/放弃对 1 个未保存标签的修改，并切换工作区/)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: '取消' }));
    expect(api.open).toHaveBeenCalledTimes(0);
    await userEvent.setup().click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    expect(api.open).toHaveBeenCalledTimes(1);
  });

  it('dirty DOCX 关闭窗口：确认后 requestClose，取消后 cancelClose', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    await openDocx(api, 'b.docx');
    makeDirty();
    expect(api.setDirtyState).toHaveBeenLastCalledWith(true);
    const closeRequested = api.onCloseRequested.mock.calls[0]?.[0] as () => void;
    await act(async () => {
      closeRequested();
    });
    expect(screen.getByText(/放弃对 1 个未保存标签的修改，并关闭窗口/)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: '取消' }));
    expect(api.cancelClose).toHaveBeenCalled();
    await act(async () => {
      closeRequested();
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    expect(api.requestClose).toHaveBeenCalled();
  });

  it('saving DOCX 不能被关闭/切换/关窗丢弃：等待保存完成提示', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('b.docx')]);
    api.open.mockClear();
    await openDocx(api, 'b.docx');
    makeDirty();
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    // 保存在途：关闭被阻止
    await userEvent.setup().click(screen.getByRole('button', { name: '关闭 b.docx' }));
    expect(screen.getByText(/正在保存，请等待保存完成后再继续/)).toBeDefined();
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '知道了' }));
    // 工作区切换也被阻止
    await userEvent.setup().click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    expect(screen.getByText(/正在保存，请等待保存完成后再继续/)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: '知道了' }));
    expect(api.open).not.toHaveBeenCalled();
    // 保存完成后可正常关闭
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    await userEvent.setup().click(screen.getByRole('button', { name: '关闭 b.docx' }));
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
  });
});

describe('TXT 搜索结果与 DOCX 标签共存（第 8.6 节）', () => {
  it('搜索定位打开 TXT，DOCX 标签与编辑器保持完整', async () => {
    const api = mockDesktop();
    await openWorkspace(api, [entry('a.txt'), entry('b.docx')]);
    await openDocx(api, 'b.docx');
    // 打开搜索侧栏并提交查询
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: 'hello' } });
      fireEvent.submit(screen.getByLabelText('搜索内容').closest('form') as HTMLFormElement);
    });
    await act(async () => {
      api.resolveSearch(1, {
        status: 'completed',
        requestId: 1,
        files: [
          {
            kind: 'txt',
            relativePath: 'a.txt',
            revision: 'rev-a.txt',
            truncated: false,
            matches: [
              {
                from: 0,
                to: 5,
                line: 1,
                column: 1,
                matchedText: 'hello',
                preview: 'hello world',
                previewMatchFrom: 0,
                previewMatchTo: 5,
              },
            ],
          } as WorkspaceTextSearchFileResult,
        ],
        statistics: { scannedFiles: 1, matchedFiles: 1, totalMatches: 1, skippedFiles: 0 },
        truncated: false,
        truncatedReason: null,
      });
    });
    await act(async () => {
      fireEvent.click(document.querySelector('.search-match-btn') as HTMLButtonElement);
    });
    await act(async () => {});
    // TXT 标签打开并定位
    const tabs = document.querySelectorAll('.tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toContain('b.docx');
    expect(tabs[1]?.textContent).toContain('a.txt');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
    // DOCX 标签完好
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    expect(docxEditor()?.view.state.doc.textContent).toContain('DOCX 正文');
    // 保存 DOCX 后 dirty 状态按类型独立
    makeDirty();
    expect(dirtyTabCount()).toBe(1);
  });
});
