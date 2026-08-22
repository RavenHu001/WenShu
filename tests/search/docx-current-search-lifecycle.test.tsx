// @vitest-environment jsdom
/**
 * TASK-010 WP5：兼容性、保存中编辑、路径迁移与跨功能回归（任务第 8.6 节）。
 *
 * ## 覆盖矩阵
 *
 * 兼容性门禁：
 * - read-only 可查找/导航/装饰，替换入口禁用且命令层防御性拒绝；
 * - degraded 未确认可查不可替换；确认绑定当前 revision 后**不重建 editor** 即可替换；
 *   重新读取不同 revision 后旧确认失效、替换重新禁用；
 * - saving 期间替换产生更高 editRevision：旧保存完成后仍 dirty，磁盘保存的是替换前内容；
 * - save-error / conflict：查找与替换仍可用并进入 dirty；conflict 重读回到磁盘内容；
 * - read-error：带快照可查可替换；无快照不显示假可用面板。
 *
 * 生命周期与身份：
 * - 关闭后重开是新会话（新 tabId / 新 editor），查询与面板状态不残留；
 * - 工作区切换清空全部标签与 controls；
 * - 两个 DOCX 标签：旧标签迟到的编辑回报不污染活动面板（原子 controls 切换）。
 *
 * 路径迁移（stable tabId）：
 * - 重命名、移动、另存为均不重建 editor，面板/查询/装饰保持；
 *
 * 跨功能：
 * - 工作区结果定位不改写当前查找查询，定位与面板共存；
 * - mutationEpoch 变化只作废工作区搜索，不清空当前 DOCX 搜索状态。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type {
  DocxCompatibilityReport,
  DocxDocumentModel,
  DocxDocumentSnapshot,
  ReadDocxDocumentResult,
  SaveDocxDocumentRequest,
  SaveDocxDocumentResult,
} from '../../src/shared/docx';
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

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

/* ======================= 模型/快照/工作区夹具 ======================= */

function paragraphModel(text: string): DocxDocumentModel {
  return {
    schemaVersion: 1,
    blocks: [
      {
        kind: 'paragraph',
        alignment: null,
        runs: text.length === 0 ? [] : [{ text, marks: [] }],
      },
    ],
  };
}

function compatibilityOf(level: DocxCompatibilityReport['level']): DocxCompatibilityReport {
  return {
    level,
    warnings:
      level === 'supported' ? [] : [{ code: 'image', message: '文档包含图片，保存后可能丢失' }],
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
    revision: 'rev-' + relativePath,
    size: 10,
    model,
    compatibility: compatibilityOf('supported'),
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

function directory(relativePath: string, children: readonly WorkspaceEntry[] = []): WorkspaceEntry {
  return {
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    kind: 'directory',
    children: [...children],
  };
}

function snapshot(
  entries: readonly WorkspaceEntry[],
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [...entries], ...overrides };
}

function loadedText(relativePath: string, content: string): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: relativePath.split('/').pop() ?? relativePath,
      relativePath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      revision: 'rev-' + relativePath,
      hasUtf8Bom: false,
      lineEnding: content.includes('\r\n') ? 'crlf' : 'lf',
    },
  };
}

/* ======================= desktop mock ======================= */

interface DesktopMock {
  readonly open: ReturnType<typeof vi.fn>;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly readDocx: ReturnType<typeof vi.fn>;
  readonly saveDocx: ReturnType<typeof vi.fn>;
  readonly saveDocxAs: ReturnType<typeof vi.fn>;
  readonly createText: ReturnType<typeof vi.fn>;
  readonly relocate: ReturnType<typeof vi.fn>;
  readonly trash: ReturnType<typeof vi.fn>;
  readonly textWorkspace: ReturnType<typeof vi.fn>;
  readonly cancelTextWorkspace: ReturnType<typeof vi.fn>;
  /** 结算最近一次搜索（controller 每次提交递增 requestId，测试只需结算最新请求）。 */
  readonly resolveSearch: (result: WorkspaceTextSearchResult) => void;
  /** 结算最近一次 DOCX 保存（默认回显请求模型）。 */
  readonly resolveSaveDocx: (result?: SaveDocxDocumentResult) => void;
  readonly lastSaveRequest: () => SaveDocxDocumentRequest | null;
}

interface MockOptions {
  readonly entries?: readonly WorkspaceEntry[];
  readonly readDocx?: (relativePath: string) => Promise<ReadDocxDocumentResult>;
  readonly relocate?: ReturnType<typeof vi.fn>;
}

function mockDesktop(options: MockOptions = {}): DesktopMock {
  const entries = options.entries ?? [];
  const searchPending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  let lastRequestId = 0;
  const textWorkspace = vi.fn(
    (request: { requestId: number }) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        lastRequestId = request.requestId;
        searchPending.set(request.requestId, { resolve });
      }),
  );
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
  const open = vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' }));
  const refresh = vi.fn(async (): Promise<RefreshWorkspaceResult> => ({
    status: 'refreshed',
    workspace: snapshot(entries),
  }));
  const readText = vi.fn(async (relativePath: string): Promise<ReadTextDocumentResult> =>
    loadedText(relativePath, 'TXT 内容'),
  );
  const readDocx = vi.fn(
    options.readDocx ??
      (async (relativePath: string): Promise<ReadDocxDocumentResult> => ({
        status: 'loaded',
        document: docxSnapshot(relativePath, paragraphModel('abc abc')),
      })),
  );
  const saveDocxAs = vi.fn(
    async (request: {
      target: { parentRelativePath: string; name: string };
      model: DocxDocumentModel;
    }) => {
      const targetPath =
        request.target.parentRelativePath === ''
          ? request.target.name
          : request.target.parentRelativePath + '/' + request.target.name;
      return {
        status: 'saved' as const,
        mutationId: 1,
        relativePath: targetPath,
        kind: 'docx' as const,
        document: docxSnapshot(targetPath, request.model, { revision: 'rev-saved-as' }),
        backupRelativePath: targetPath + '.wenshu.bak',
      };
    },
  );
  const createText = vi.fn(async () => ({
    status: 'succeeded' as const,
    mutationId: 1,
    relativePath: 'new.txt',
    kind: 'text' as const,
  }));
  const relocate =
    options.relocate ??
    vi.fn(async () => ({
      status: 'succeeded' as const,
      mutationId: 1,
      relativePath: 'renamed.docx',
      kind: 'docx' as const,
    }));
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
      reveal: vi.fn(async () => ({ status: 'revealed' })),
      relocate,
      trash,
    },
    document: {
      readText,
      saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      })),
      readDocx,
      saveDocx,
      saveTextAs: vi.fn(),
      saveDocxAs,
    },
    search: { textWorkspace, cancelTextWorkspace: vi.fn(async () => undefined) },
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
    readText,
    readDocx,
    saveDocx,
    saveDocxAs,
    createText,
    relocate,
    trash,
    textWorkspace,
    cancelTextWorkspace: window.desktop.search.cancelTextWorkspace as ReturnType<typeof vi.fn>,
    resolveSearch: (result) => searchPending.get(lastRequestId)?.resolve(result),
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
        backupRelativePath: request.relativePath + '.wenshu.bak',
      });
    },
    lastSaveRequest: () => lastSaveRequest,
  };
}

/* ======================= App 交互夹具 ======================= */

async function renderApp(api: DesktopMock, entries: readonly WorkspaceEntry[]): Promise<void> {
  api.open.mockResolvedValue({
    status: 'selected',
    workspace: snapshot(entries),
  } as OpenWorkspaceResult);
  render(<App />);
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

async function openFileFromTree(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
  });
  await act(async () => {});
  await act(async () => {});
}

/** 活动 DOCX 标签的 Tiptap 编辑器（跳过 hidden 宿主）。 */
function docxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

/** 隐藏（非活动）DOCX 标签的编辑器；无则 null。 */
function hiddenDocxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') !== null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function ctrlF(dom: HTMLElement): void {
  act(() => {
    fireEvent.keyDown(dom, { key: 'f', ctrlKey: true });
  });
}

/** Ctrl+F 打开当前 DOCX 面板并输入查询（等待重算）。 */
async function openPanelAndQuery(query: string): Promise<void> {
  const editor = docxEditor();
  expect(editor).not.toBeNull();
  await act(async () => {});
  ctrlF(editor!.view.dom);
  const input = screen.getByLabelText('查找内容') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: query } });
    await flush();
  });
}

/** 在编辑器光标处追加一段文本（不依赖面板状态）。 */
function makeDirty(): void {
  const editor = docxEditor();
  act(() => {
    editor?.view.dispatch(editor.view.state.tr.insertText(' 编辑'));
  });
}

function dirtyTabCount(): number {
  return document.querySelectorAll('.tab .tab-dirty').length;
}

function selectionText(editor: Editor): string {
  const { from, to } = editor.view.state.selection;
  return editor.view.state.doc.textBetween(from, to);
}

function activeEditorText(): string {
  const editor = docxEditor();
  return editor?.view.state.doc.textContent ?? '';
}

/* ======================= 兼容性门禁 ======================= */

describe('WP5：兼容性门禁（read-only / degraded / saving / save-error / conflict / read-error）', () => {
  it('read-only：可查找、可导航，替换入口禁用且编辑器不可编辑', async () => {
    const api = mockDesktop({
      readDocx: async (relativePath) => ({
        status: 'loaded',
        document: docxSnapshot(relativePath, paragraphModel('abc abc'), {
          compatibility: compatibilityOf('read-only'),
        }),
      }),
    });
    await renderApp(api, [entry('ro.docx')]);
    await openFileFromTree('ro.docx');
    await openPanelAndQuery('abc');

    expect(docxEditor()?.isEditable).toBe(false);
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
    expect(screen.getByText('只读文档不支持替换')).toBeDefined();
    expect(screen.getByLabelText('替换为')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /替换当前项/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /全部替换/ })).toHaveProperty('disabled', true);
    expect(activeEditorText()).toBe('abc abc');
  });

  it('degraded 未确认：可查不可替换；确认绑定当前 revision 后同一 editor 即可替换（不重建）', async () => {
    const api = mockDesktop({
      readDocx: async (relativePath) => ({
        status: 'loaded',
        document: docxSnapshot(relativePath, paragraphModel('abc abc'), {
          compatibility: compatibilityOf('degraded'),
        }),
      }),
    });
    await renderApp(api, [entry('dg.docx')]);
    await openFileFromTree('dg.docx');
    await openPanelAndQuery('abc');

    expect(screen.getByText('文档包含不受支持内容，需先确认兼容性')).toBeDefined();
    expect(screen.getByLabelText('替换为')).toHaveProperty('disabled', true);
    const beforeConfirm = docxEditor();

    // 确认兼容性（绑定当前基线 revision）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认继续编辑并保存' }));
    });
    expect(screen.queryByText('文档包含不受支持内容，需先确认兼容性')).toBeNull();
    expect(screen.getByLabelText('替换为')).not.toHaveProperty('disabled', true);
    // 确认只更新标签状态，不重建 editor（稳定 tabId 会话保持）
    expect(docxEditor()).toBe(beforeConfirm);

    // 确认后同一 editor 直接替换
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(activeEditorText()).toBe('xyz abc');
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('已替换 1 处')).toBeDefined();
    expect(docxEditor()).toBe(beforeConfirm);

    // 保存请求携带绑定当前 revision 的确认（既有保存门禁不绕过）
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(api.saveDocx).toHaveBeenCalledTimes(1);
    expect(api.lastSaveRequest()?.compatibilityConfirmationRevision).toBe('rev-dg.docx');
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(0);
  });

  it('degraded：revision 变化后旧确认失效（重新读取后替换重新禁用）', async () => {
    const api = mockDesktop({
      readDocx: async (relativePath) => ({
        status: 'loaded',
        document: docxSnapshot(relativePath, paragraphModel('abc abc'), {
          compatibility: compatibilityOf('degraded'),
        }),
      }),
    });
    await renderApp(api, [entry('dg.docx')]);
    await openFileFromTree('dg.docx');
    await openPanelAndQuery('abc');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认继续编辑并保存' }));
    });
    const beforeReload = docxEditor();
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(dirtyTabCount()).toBe(1);

    // 保存冲突 → 确认放弃本地修改 → 重新读取（新 revision 的 degraded 快照）
    api.saveDocx.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    expect(screen.getByText('磁盘冲突')).toBeDefined();
    api.readDocx.mockResolvedValueOnce({
      status: 'loaded',
      document: docxSnapshot('dg.docx', paragraphModel('r2 正文'), {
        revision: 'rev-r2',
        compatibility: compatibilityOf('degraded'),
      }),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});

    // 新 revision 内容就位；editor 因重新读取而重建（旧会话已销毁）
    expect(activeEditorText()).toBe('r2 正文');
    expect(docxEditor()).not.toBe(beforeReload);
    expect(dirtyTabCount()).toBe(0);

    // 旧确认失效：可查找但替换重新禁用（需按新 revision 重新确认）
    await openPanelAndQuery('r2');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 1 处');
    expect(screen.getByText('文档包含不受支持内容，需先确认兼容性')).toBeDefined();
    expect(screen.getByLabelText('替换为')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '确认继续编辑并保存' })).toBeDefined();
  });

  it('saving 期间替换：editRevision 更高，旧保存完成后仍 dirty，磁盘保存的是替换前内容', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openPanelAndQuery('abc');
    makeDirty(); // ' 编辑abc abc'
    await act(async () => {
      await flush();
    });

    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('正在保存…')).toBeDefined();

    // 保存在途时经当前搜索替换：与普通键入相同的 editDocxTab 语义
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(activeEditorText()).toBe(' 编辑xyz abc');
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('已替换 1 处')).toBeDefined();

    // 磁盘保存的是替换前内容（保存在途快照）
    const request = api.lastSaveRequest();
    expect(request?.model.blocks[0]).toEqual({
      kind: 'paragraph',
      alignment: null,
      runs: [{ text: ' 编辑abc abc', marks: [] }],
    });

    // 旧保存完成：不清除保存期间替换产生的新修改
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('未保存')).toBeDefined();
    expect(activeEditorText()).toBe(' 编辑xyz abc');
  });

  it('save-error：查找与替换仍可用并产生 dirty，保存错误保留', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    makeDirty();
    api.saveDocx.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    expect(screen.getByText('写入错误')).toBeDefined();
    expect(dirtyTabCount()).toBe(1);

    await openPanelAndQuery('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(activeEditorText()).toBe(' 编辑xyz abc');
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('已替换 1 处')).toBeDefined();
  });

  it('conflict：查找与替换仍可用；重新读取后回到磁盘内容', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    makeDirty();
    api.saveDocx.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    expect(screen.getByText('磁盘冲突')).toBeDefined();

    await openPanelAndQuery('abc');
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(activeEditorText()).toBe(' 编辑xyz abc');
    expect(dirtyTabCount()).toBe(1);
    expect(screen.getByText('已替换 1 处')).toBeDefined();

    api.readDocx.mockResolvedValueOnce({
      status: 'loaded',
      document: docxSnapshot('b.docx', paragraphModel('磁盘正文'), { revision: 'rev-disk' }),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    expect(activeEditorText()).toBe('磁盘正文');
    expect(dirtyTabCount()).toBe(0);
  });

  it('read-error：带快照可查可替换；无快照不显示假可用面板', async () => {
    // 带快照 read-error：加载成功 → 冲突重读失败 → 快照保留、可查可替换
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    makeDirty();
    api.saveDocx.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    api.readDocx.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'INVALID_DOCX', message: '文件已损坏' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    // 快照保留：editor 重新挂载、dirty 保留、可查可替换
    expect(docxEditor()).not.toBeNull();
    expect(dirtyTabCount()).toBe(1);
    await openPanelAndQuery('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    expect(replaceInput).not.toHaveProperty('disabled', true);
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    expect(activeEditorText()).toBe(' 编辑xyz abc');
    expect(dirtyTabCount()).toBe(1);

    // 无快照 read-error：不挂载 editor、不显示假可用面板
    cleanup();
    const api2 = mockDesktop({
      readDocx: async () => ({
        status: 'error',
        error: { code: 'INVALID_DOCX', message: '不是有效 DOCX' },
      }),
    });
    await renderApp(api2, [entry('bad.docx')]);
    await openFileFromTree('bad.docx');
    expect(screen.getByText('无法读取文件 bad.docx')).toBeDefined();
    expect(docxEditor()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    expect(screen.getByText('打开 DOCX 文件后可查找或替换。')).toBeDefined();
  });
});

/* ======================= 多标签 / 关闭重开 / 工作区切换 / 旧 controls ======================= */

describe('WP5：多标签、关闭重开、工作区切换与旧 controls', () => {
  it('关闭后重开：新会话（新 tabId / 新 editor），查询与面板状态不残留', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openPanelAndQuery('abc');
    const closedEditor = docxEditor();
    expect(closedEditor).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭 b.docx' }));
    });
    await act(async () => {});
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
    expect(docxEditor()).toBeNull();

    // 重开同路径：新稳定 tabId → 新 editor 实例，面板默认关闭、查询为空
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await openFileFromTree('b.docx');
    const reopened = docxEditor();
    expect(reopened).not.toBeNull();
    expect(reopened).not.toBe(closedEditor);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    // 点击“查找与替换”标签是用户显式打开：面板可开，但新会话查询必须为空（旧查询不残留）
    expect(screen.getByLabelText('查找内容')).toBeDefined();
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('');
    // 空查询的确定状态：输入校验错误（不是旧查询的匹配结果）
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('查询不能为空');
    await openPanelAndQuery('abc');
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(activeEditorText()).toBe('abc abc');
  });

  it('工作区切换：清空全部标签与 controls，面板不残留', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openPanelAndQuery('abc');
    expect(docxEditor()).not.toBeNull();

    api.open.mockResolvedValueOnce({
      status: 'selected',
      workspace: snapshot([entry('c.docx')], { rootName: 'other-root' }),
    } as OpenWorkspaceResult);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await act(async () => {});

    expect(document.querySelectorAll('.tab')).toHaveLength(0);
    expect(docxEditor()).toBeNull();
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    expect(screen.getByText('打开一个 TXT 文件后可查找或替换。')).toBeDefined();
  });

  it('两个 DOCX 标签：旧标签迟到的编辑回报不污染活动面板（原子 controls）', async () => {
    const api = mockDesktop({
      readDocx: async (relativePath) => ({
        status: 'loaded',
        document: docxSnapshot(
          relativePath,
          paragraphModel(relativePath.startsWith('a') ? 'abc abc' : 'def def'),
        ),
      }),
    });
    await renderApp(api, [entry('a.docx'), entry('b.docx')]);
    await openFileFromTree('a.docx');
    await openPanelAndQuery('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await openFileFromTree('b.docx');
    await openPanelAndQuery('def');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');

    // 活动面板 = b；向隐藏的 a 编辑器写入：a 的插件只重算自己，不得污染 b 面板
    const aEditor = hiddenDocxEditor();
    expect(aEditor).not.toBeNull();
    act(() => {
      aEditor?.view.dispatch(aEditor.view.state.tr.insertText('X', 1));
    });
    await act(async () => {
      await flush();
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('def');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');

    // 切回 a：a 的查询与重算后的匹配仍在（Xabc abc 仍有两个 abc）
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a.docx/ }));
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
  });
});

/* ======================= 路径迁移（stable tabId） ======================= */

describe('WP5：重命名、移动与另存为保持稳定 tabId 搜索会话', () => {
  it('重命名：路径迁移不重建 editor，面板/查询/装饰保持', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('doc.docx')]);
    await openFileFromTree('doc.docx');
    await openPanelAndQuery('abc');
    const editorBefore = docxEditor();
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);

    // 文件管理：选择已打开文件 → 重命名
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await userEvent.setup().click(screen.getByTestId('ft-doc.docx'));
    fireEvent.contextMenu(screen.getByTestId('ft-doc.docx'), { clientX: 30, clientY: 30 });
    await userEvent.setup().click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = screen.getByTestId('fm-name-input') as HTMLInputElement;
    expect(input.value).toBe('doc.docx');
    await userEvent.setup().clear(input);
    await userEvent.setup().type(input, 'renamed.docx{Enter}');
    await act(async () => {
      await flush();
    });
    expect(api.relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'doc.docx',
      parentRelativePath: '',
      name: 'renamed.docx',
    });
    await act(async () => {
      await flush();
    });

    // 路径迁移后：同一 editor 实例、面板与查询保持、装饰保持
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(docxEditor()).toBe(editorBefore);
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /renamed.docx/ })).toBeDefined();
  });

  it('移动：目录迁移后搜索会话保持（stable tabId 不因路径变化重建）', async () => {
    const api = mockDesktop({
      relocate: vi.fn(async () => ({
        status: 'succeeded',
        mutationId: 1,
        relativePath: 'sub/doc.docx',
        kind: 'docx',
      })),
    });
    await renderApp(api, [directory('sub'), entry('doc.docx')]);
    await openFileFromTree('doc.docx');
    await openPanelAndQuery('abc');
    const editorBefore = docxEditor();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await userEvent.setup().click(screen.getByTestId('ft-doc.docx'));
    fireEvent.contextMenu(screen.getByTestId('ft-doc.docx'), { clientX: 30, clientY: 30 });
    await userEvent.setup().click(screen.getByRole('menuitem', { name: '移动到…' }));
    await userEvent.setup().click(screen.getByTestId('fm-target-sub'));
    await userEvent.setup().click(screen.getByTestId('fm-target-confirm'));
    await act(async () => {
      await flush();
    });
    expect(api.relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'doc.docx',
      parentRelativePath: 'sub',
      name: 'doc.docx',
    });
    await act(async () => {
      await flush();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(docxEditor()).toBe(editorBefore);
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
  });

  it('另存为：完成后路径迁移，面板/查询/editor 保持', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('doc.docx')]);
    await openFileFromTree('doc.docx');
    await openPanelAndQuery('abc');
    const editorBefore = docxEditor();
    expect(dirtyTabCount()).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 's' }),
      );
    });
    await userEvent.setup().click(screen.getByTestId('fm-target-root'));
    await userEvent.setup().click(screen.getByTestId('fm-target-confirm'));
    const nameInput = screen.getByTestId('fm-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('doc.docx');
    await userEvent.setup().clear(nameInput);
    await userEvent.setup().type(nameInput, 'copy.docx{Enter}');
    await act(async () => {
      await flush();
    });
    expect(api.saveDocxAs).toHaveBeenCalledTimes(1);
    await act(async () => {
      await flush();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(docxEditor()).toBe(editorBefore);
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /copy.docx/ })).toBeDefined();
    expect(activeEditorText()).toBe('abc abc');
    expect(dirtyTabCount()).toBe(0);
  });
});

/* ======================= 工作区搜索 / mutationEpoch 互不污染 ======================= */

describe('WP5：工作区结果定位与 mutationEpoch 互不污染当前搜索', () => {
  it('工作区结果定位不改写当前查找查询，定位与面板共存', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('doc.docx')]);
    await openFileFromTree('doc.docx');
    await openPanelAndQuery('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');

    // 工作区搜索同一文件：结果定位后当前查找查询保持
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '全局搜索' }));
      fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: 'abc' } });
      fireEvent.submit(screen.getByLabelText('搜索内容').closest('form') as HTMLFormElement);
    });
    await act(async () => {
      api.resolveSearch({
        status: 'completed',
        requestId: 1,
        files: [
          {
            kind: 'docx',
            relativePath: 'doc.docx',
            revision: 'rev-doc.docx',
            truncated: false,
            matches: [
              {
                from: 0,
                to: 3,
                line: 1,
                column: 1,
                matchedText: 'abc',
                preview: 'abc abc',
                previewMatchFrom: 0,
                previewMatchTo: 3,
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
    await act(async () => {
      await flush();
    });
    expect(selectionText(docxEditor()!)).toBe('abc');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();

    // 切回当前查找：查询/计数保持，装饰仍在
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
    expect(activeEditorText()).toBe('abc abc');
  });

  it('mutationEpoch 变化只作废工作区搜索，不清空当前 DOCX 搜索状态', async () => {
    const api = mockDesktop();
    await renderApp(api, [entry('doc.docx')]);
    await openFileFromTree('doc.docx');
    await openPanelAndQuery('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');

    // 先完成一次工作区搜索
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '全局搜索' }));
      fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: 'abc' } });
      fireEvent.submit(screen.getByLabelText('搜索内容').closest('form') as HTMLFormElement);
    });
    await act(async () => {
      api.resolveSearch({
        status: 'completed',
        requestId: 1,
        files: [
          {
            kind: 'docx',
            relativePath: 'doc.docx',
            revision: 'rev-doc.docx',
            truncated: false,
            matches: [
              {
                from: 0,
                to: 3,
                line: 1,
                column: 1,
                matchedText: 'abc',
                preview: 'abc abc',
                previewMatchFrom: 0,
                previewMatchTo: 3,
              },
            ],
          } as WorkspaceTextSearchFileResult,
        ],
        statistics: { scannedFiles: 1, matchedFiles: 1, totalMatches: 1, skippedFiles: 0 },
        truncated: false,
        truncatedReason: null,
      });
    });
    expect(screen.getByText(/共 1 处匹配/)).toBeDefined();

    // 新建 TXT 成功 → mutationEpoch 递增 → 只作废工作区搜索
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '新建' }));
    await userEvent.setup().click(screen.getByRole('menuitem', { name: '新建 TXT' }));
    await userEvent.setup().type(screen.getByTestId('fm-name-input'), 'brand-new{Enter}');
    await act(async () => {
      await flush();
    });
    expect(api.createText).toHaveBeenCalled();

    // 新建 TXT 会自动打开新标签；切回 DOCX 标签再验证搜索状态
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /doc\.docx/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    expect(screen.getByText('输入查询后按 Enter 或点击搜索。')).toBeDefined();
    expect(screen.queryByText(/共 1 处匹配/)).toBeNull();

    // 当前 DOCX 搜索状态不被 mutationEpoch 清空
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
  });
});
