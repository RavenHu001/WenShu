// @vitest-environment jsdom
/**
 * TASK-008 WP5 DOCX 结果定位生命周期、兼容性与混合场景回归测试（任务第 8.6 节与第 4.8 / 4.9 节）。
 *
 * ## 覆盖（WP5：生命周期、兼容性与混合场景回归）
 *
 * - loading / dirty / saving / read-only / degraded / read-error 生命周期下的结果定位；
 * - 工作区切换、标签关闭、新定位、窗口关闭与迟到回报的异步身份不变量；
 * - 仅 marks 格式变化（投影不变）可定位；文本/结构变化只提示过期；
 * - 外部修改（revision 变化）只提示过期；
 * - 搜索定位不改变编辑/保存门禁：定位后保存正常、saving 中定位不干扰保存、
 *   degraded 确认状态保留、搜索取消不影响已打开标签；
 * - TXT 与 DOCX 混合结果分别定位、多 DOCX 标签跨标签会话隔离；
 * - kind 与标签类型不一致、read-error（无快照）与 loading 中关闭等防御路径。
 *
 * 与 result-locate-docx.test.tsx（WP4 基础定位闭环）互补：本文件专注生命周期与混合场景
 * 回归，不重复已覆盖的段落/标题/列表/emoji 偏移映射基础用例。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { EditorView } from '@codemirror/view';
import { App } from '../../src/renderer/App';
import type {
  OpenWorkspaceResult,
  RefreshWorkspaceResult,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '../../src/shared/workspace';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';
import type {
  DocxCompatibilityReport,
  DocxDocumentModel,
  DocxDocumentSnapshot,
  ReadDocxDocumentResult,
  SaveDocxDocumentRequest,
  SaveDocxDocumentResult,
} from '../../src/shared/docx';
import type {
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '../../src/shared/search';
import { projectDocxModelSearchText } from '../../src/shared/docx-search-text';

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

function paragraph(text: string): DocxDocumentModel['blocks'][number] {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

function heading(level: 1 | 2 | 3, text: string): DocxDocumentModel['blocks'][number] {
  return { kind: 'heading', level, runs: [{ text, marks: [] }] };
}

/** 覆盖标题、跨 run marks、空段与嵌套列表的模型（与 WP4 定位测试同一结构）。 */
const MODEL: DocxDocumentModel = {
  schemaVersion: 1,
  blocks: [
    heading(1, '文档标题'),
    {
      kind: 'paragraph',
      alignment: null,
      runs: [
        { text: '粗体', marks: [{ type: 'bold' }] },
        { text: '与', marks: [] },
        { text: '斜体', marks: [{ type: 'italic' }] },
      ],
    },
    paragraph(''),
    {
      kind: 'bullet-list',
      level: 0,
      blocks: [
        paragraph('项目甲'),
        { kind: 'bullet-list', level: 1, blocks: [paragraph('嵌套项目')] },
      ],
    },
    paragraph('结尾文本'),
  ],
};

/** 另一 DOCX 模型（跨标签定位隔离与跨文件迟到读取用）。 */
const MODEL_B: DocxDocumentModel = {
  schemaVersion: 1,
  blocks: [heading(1, '第二文档'), paragraph('乙文档正文')],
};

const PROJECTION = projectDocxModelSearchText(MODEL);
const PROJECTION_B = projectDocxModelSearchText(MODEL_B);

/** 投影空间中某个查询的第一个匹配。 */
function projectionMatch(
  projection: typeof PROJECTION,
  query: string,
): { from: number; to: number; matchedText: string } {
  const from = projection.text.indexOf(query);
  expect(from, `查询 ${query} 必须在投影中存在`).toBeGreaterThanOrEqual(0);
  return { from, to: from + query.length, matchedText: query };
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
    revision: 'rev-doc',
    size: 10,
    model,
    compatibility: compatibilityOf('supported'),
    ...overrides,
  };
}

function loadedText(
  relativePath: string,
  content: string,
  revision: string,
): ReadTextDocumentResult {
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

interface DesktopMock {
  readonly open: ReturnType<typeof vi.fn>;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly readDocx: ReturnType<typeof vi.fn>;
  readonly saveDocx: ReturnType<typeof vi.fn>;
  readonly textWorkspace: ReturnType<typeof vi.fn>;
  readonly cancelTextWorkspace: ReturnType<typeof vi.fn>;
  /** 结算最近一次搜索（controller 每次提交递增 requestId，测试只需结算最新请求）。 */
  readonly resolveSearch: (result: WorkspaceTextSearchResult) => void;
  /** 结算最近一次 DOCX 保存（默认回显请求模型）。 */
  readonly resolveSaveDocx: (result?: SaveDocxDocumentResult) => void;
}

function mockDesktop(
  readDocxImpl: (relativePath: string) => Promise<ReadDocxDocumentResult>,
  readTextImpl: (relativePath: string) => Promise<ReadTextDocumentResult> = async () => ({
    status: 'error',
    error: { code: 'NOT_FOUND', message: '文件不存在' },
  }),
): DesktopMock {
  const searchPending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  let lastRequestId = 0;
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        lastRequestId = request.requestId;
        searchPending.set(request.requestId, { resolve });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
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
  const readText = vi.fn(readTextImpl);
  const readDocx = vi.fn(readDocxImpl);
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
      readDocx,
      saveDocx,
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
    readDocx,
    saveDocx,
    textWorkspace,
    cancelTextWorkspace,
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
        backupRelativePath: `${request.relativePath}.wenshu.bak`,
      });
    },
  };
}

function docxFileResult(
  relativePath: string,
  revision: string,
  from: number,
  to: number,
  matchedText: string,
): WorkspaceTextSearchFileResult {
  return {
    kind: 'docx',
    relativePath,
    revision,
    truncated: false,
    matches: [docxMatch(from, to, matchedText)],
  };
}

/** 单个 DOCX 匹配（投影空间偏移）。 */
function docxMatch(from: number, to: number, matchedText: string): WorkspaceTextSearchMatch {
  return {
    from,
    to,
    line: 1,
    column: from + 1,
    matchedText,
    preview: matchedText,
    previewMatchFrom: 0,
    previewMatchTo: matchedText.length,
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

function snapshot(
  entries: readonly WorkspaceEntry[] = [],
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [...entries], ...overrides };
}

function entry(relativePath: string): WorkspaceEntry {
  return { name: relativePath.split('/').pop() ?? relativePath, relativePath, kind: 'file' };
}

function docxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

function docxSelectionText(editor: Editor): string {
  const { from, to } = editor.view.state.selection;
  return editor.view.state.doc.textBetween(from, to);
}

function txtSelectionRange(): [number, number] | null {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  const view = content === null ? null : EditorView.findFromDOM(content);
  if (view === null) {
    return null;
  }
  const main = view.state.selection.main;
  return [main.from, main.to];
}

function matchButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.search-match-btn')) as HTMLButtonElement[];
}

function dirtyTabCount(): number {
  return document.querySelectorAll('.tab .tab-dirty').length;
}

async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

/** 打开搜索侧栏并提交查询（fireEvent 通道，避免 act/user-event 焦点碰撞，与 TXT 定位测试一致）。 */
async function submitSearch(query: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '搜' }));
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: query } });
    fireEvent.keyDown(screen.getByLabelText('搜索内容'), { key: 'Enter' });
    fireEvent.submit(screen.getByLabelText('搜索内容').closest('form') as HTMLFormElement);
  });
}

/** 在同一个 act 作用域内让异步定位链（读取完成 → 校验 → 下发目标 → 宿主应用）完成。 */
async function clickMatch(index: number): Promise<void> {
  await act(async () => {
    fireEvent.click(matchButtons()[index]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {});
}

/** 把活动 DOCX 编辑器光标移到文档末尾并追加文本（不影响匹配前的投影偏移）。 */
function appendDocxText(editor: Editor, text: string): void {
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dispatch(editor.view.state.tr.insertText(text));
  });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

describe('DOCX 定位生命周期：read-error / loading 关闭 / 工作区切换（WP5，第 8.6 节）', () => {
  it('read-error（无快照）结果点击：只提示读取失败，不挂载编辑器、不定位', async () => {
    const api = mockDesktop(async () => ({
      status: 'error',
      error: { code: 'INVALID_DOCX', message: '文件不是有效的 DOCX' },
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);

    expect(screen.getByText(/搜索结果已过期：doc\.docx 读取失败/)).toBeDefined();
    // 无快照的 read-error 标签不挂载 DOCX 编辑器，不伪造定位成功
    expect(docxEditor()).toBeNull();
    expect(screen.getByText('无法读取文件 doc.docx')).toBeDefined();
  });

  it('loading 中关闭 DOCX 标签：定位作废，迟到读取不定位、无过期提示', async () => {
    let resolveRead!: (result: ReadDocxDocumentResult) => void;
    const readGate = new Promise<ReadDocxDocumentResult>((resolve) => {
      resolveRead = resolve;
    });
    const api = mockDesktop(() => readGate);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    // 读取挂起时关闭 loading 标签
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭 doc.docx' }));
    });
    expect(document.querySelectorAll('.tab')).toHaveLength(0);

    // 迟到读取完成：标签已不存在，不创建编辑器、不定位、不提示
    await act(async () => {
      resolveRead({ status: 'loaded', document: docxSnapshot('doc.docx', MODEL) });
    });
    await act(async () => {});
    expect(docxEditor()).toBeNull();
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('定位等待读取期间切换工作区：迟到读取不定位、标签清空、无提示', async () => {
    let resolveRead!: (result: ReadDocxDocumentResult) => void;
    const readGate = new Promise<ReadDocxDocumentResult>((resolve) => {
      resolveRead = resolve;
    });
    const api = mockDesktop(() => readGate);
    api.open
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot([], { rootName: 'other-root' }),
      } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0); // loading 标签创建，读取挂起
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    // 读取完成前切换工作区：epoch 变化 → 旧定位作废、标签清空
    await openWorkspace();
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
    expect(screen.getByText('other-root')).toBeDefined();

    // 迟到读取完成：旧工作区结果不提交、不定位
    await act(async () => {
      resolveRead({ status: 'loaded', document: docxSnapshot('doc.docx', MODEL) });
    });
    await act(async () => {});
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
    expect(docxEditor()).toBeNull();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('定位等待读取期间提交新搜索：旧 requestId 的迟到读取不得定位或提示', async () => {
    let resolveRead!: (result: ReadDocxDocumentResult) => void;
    const readGate = new Promise<ReadDocxDocumentResult>((resolve) => {
      resolveRead = resolve;
    });
    const api = mockDesktop(() => readGate);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0); // requestId=1 的定位正在等待 DOCX 读取
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    // 新搜索 requestId=2 立即作废旧定位，不需等待新搜索完成。
    await submitSearch('新查询');
    expect(api.textWorkspace).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRead({ status: 'loaded', document: docxSnapshot('doc.docx', MODEL) });
    });
    await act(async () => {});

    expect(docxEditor()).not.toBeNull();
    expect(docxSelectionText(docxEditor()!)).toBe('');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('过期提示显示后切换工作区：提示与定位目标清空', async () => {
    const api = mockDesktop(async () => ({
      status: 'error',
      error: { code: 'NOT_FOUND', message: '文件不存在' },
    }));
    api.open
      .mockResolvedValueOnce({ status: 'selected', workspace: snapshot() } as OpenWorkspaceResult)
      .mockResolvedValueOnce({
        status: 'selected',
        workspace: snapshot([], { rootName: 'other-root' }),
      } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：doc\.docx 读取失败/)).toBeDefined();

    await openWorkspace();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
    expect(document.querySelectorAll('.tab')).toHaveLength(0);
  });
});

describe('DOCX 定位生命周期：saving / dirty / 格式与结构变化（WP5，第 4.8 / 4.9 节）', () => {
  it('saving 状态 DOCX：保存进行中定位成功，保存完成后门禁不变', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('doc.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    // 先从文件树打开
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'doc.docx' }));
    });
    await act(async () => {});
    await act(async () => {});
    expect(api.readDocx).toHaveBeenCalledTimes(1);

    // 编辑 → 发起保存（保存在途）
    appendDocxText(docxEditor()!, ' 末尾追加');
    expect(dirtyTabCount()).toBe(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    expect(api.saveDocx).toHaveBeenCalledTimes(1);
    expect(screen.getByText('正在保存…')).toBeDefined();

    // 保存在途时点击搜索结果：revision 与实时投影仍有效 → 定位成功，不干扰保存
    const match = projectionMatch(PROJECTION, '项目甲');
    await submitSearch('项目甲');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('项目甲');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
    expect(screen.getByText('正在保存…')).toBeDefined();

    // 保存正常完成（定位不改变保存门禁）
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(screen.getByText('已保存（备份 doc.docx.wenshu.bak）')).toBeDefined();
    expect(dirtyTabCount()).toBe(0);
    expect(api.saveDocx.mock.calls[0]?.[0]?.expectedRevision).toBe('rev-doc');
  });

  it('仅 marks 格式变化（粗体切换）且投影不变：定位成功，dirty 保留', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '粗体与斜体');
    await submitSearch('粗体与斜体');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('粗体与斜体');

    // 全选切换粗体：只改 marks，正文投影不变
    const editor = docxEditor()!;
    await act(async () => {
      editor.chain().focus().selectAll().toggleBold().run();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(1);

    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('粗体与斜体');
    expect(dirtyTabCount()).toBe(1); // dirty 保留，不清除
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('删除匹配块正文（结构变化）：投影偏移失效，只提示过期、不错误定位', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '嵌套项目');
    await submitSearch('嵌套项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    const editor = docxEditor()!;
    expect(docxSelectionText(editor)).toBe('嵌套项目');

    // 删除当前选中（匹配块正文）：块变空，投影长度与文本变化
    await act(async () => {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.view.state.tr.delete(from, to));
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(1);

    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：doc\.docx 的匹配位置已失效/)).toBeDefined();
    expect(docxSelectionText(docxEditor()!)).not.toBe('嵌套项目');
  });

  it('dirty 但原投影片段未变（末尾追加）：再次点击定位成功且 dirty 保留', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '嵌套项目');
    await submitSearch('嵌套项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');

    appendDocxText(docxEditor()!, ' 末尾追加');
    expect(dirtyTabCount()).toBe(1);

    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(dirtyTabCount()).toBe(1);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('定位后编辑并保存：搜索不改变编辑/保存门禁', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('文档标题');

    // 定位后继续编辑并保存：完整保存闭环正常
    appendDocxText(docxEditor()!, ' 新编辑');
    expect(dirtyTabCount()).toBe(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await act(async () => {
      api.resolveSaveDocx();
    });
    await act(async () => {});
    expect(dirtyTabCount()).toBe(0);
    expect(screen.getByText('已保存（备份 doc.docx.wenshu.bak）')).toBeDefined();
  });
});

describe('DOCX 定位兼容性：degraded / read-only / kind 防御（WP5，第 4.9 / 5.2 节）', () => {
  it('degraded 确认后定位：确认状态保留、定位成功、确认按钮消失', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL, {
        compatibility: compatibilityOf('degraded'),
      }),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '嵌套项目');
    await submitSearch('嵌套项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(screen.getByText(/确认继续编辑并保存/)).toBeDefined();

    // 确认兼容性（绑定当前 revision）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认继续编辑并保存' }));
    });
    expect(screen.getByText('已确认继续编辑')).toBeDefined();
    expect(screen.queryByText(/确认继续编辑并保存/)).toBeNull();

    // 确认后再次定位：成功，且确认状态保留
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(screen.getByText('已确认继续编辑')).toBeDefined();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('read-only DOCX 结果点击：可以定位选区但不可编辑（不开放编辑门禁）', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL, {
        compatibility: compatibilityOf('read-only'),
      }),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch(PROJECTION, '结尾文本');
    await submitSearch('结尾文本');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    const editor = docxEditor()!;
    expect(docxSelectionText(editor)).toBe('结尾文本');
    expect(editor.isEditable).toBe(false);
    // 只读文档不渲染保存按钮（不可编辑不可保存）；搜索定位不开放编辑门禁
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('搜索结果 kind 与标签类型不一致（防御）：只提示类型已变化，不定位', async () => {
    const api = mockDesktop(
      async () => ({ status: 'error', error: { code: 'NOT_FOUND', message: '不存在' } }),
      async (relativePath: string) => loadedText(relativePath, 'hello world', 'rev-a'),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    // 主进程正常不会产生 kind 与路径不一致的结果；本用例验证 App 的类型防御校验：
    // 结果声明 kind=docx，但 openFile 按路径打开的是 TXT 标签 → 只提示类型已变化，不定位
    await submitSearch('hello');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          {
            kind: 'docx',
            relativePath: 'a.txt',
            revision: 'rev-a',
            truncated: false,
            matches: [docxMatch(0, 5, 'hello')],
          },
        ]),
      );
    });
    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：a\.txt 的类型已变化/)).toBeDefined();
    // TXT 标签被打开但未错误定位（默认选区起点）
    expect(txtSelectionRange()).toEqual([0, 0]);
  });
});

describe('DOCX 定位混合场景：TXT/DOCX 混合结果与多标签会话隔离（WP5，第 8.6 节）', () => {
  it('一次查询的 TXT 与 DOCX 分组分别点击：各自标签定位、会话隔离', async () => {
    const api = mockDesktop(
      async () => ({ status: 'loaded', document: docxSnapshot('b.docx', MODEL) }),
      async (relativePath: string) => loadedText(relativePath, 'hello world', 'rev-a'),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const docxMatchPos = projectionMatch(PROJECTION, '项目甲');
    await submitSearch('项目甲');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          {
            kind: 'txt',
            relativePath: 'a.txt',
            revision: 'rev-a',
            truncated: false,
            matches: [docxMatch(0, 5, 'hello')],
          },
          docxFileResult('b.docx', 'rev-doc', docxMatchPos.from, docxMatchPos.to, '项目甲'),
        ]),
      );
    });

    // 点击 TXT 结果：打开 TXT 标签并定位
    await clickMatch(0);
    expect(txtSelectionRange()).toEqual([0, 5]);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();

    // 点击 DOCX 结果：打开 DOCX 标签并定位；TXT 标签保留
    await clickMatch(1);
    expect(docxSelectionText(docxEditor()!)).toBe('项目甲');
    expect(document.querySelectorAll('.tab')).toHaveLength(2);

    // 切回 TXT 标签：CodeMirror 选区保留（会话隔离）
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.txt/ }));
    });
    expect(txtSelectionRange()).toEqual([0, 5]);
  });

  it('两个 DOCX 标签跨标签定位：各自选区独立、互不污染', async () => {
    const api = mockDesktop(async (relativePath: string) => ({
      status: 'loaded',
      document:
        relativePath === 'a.docx' ? docxSnapshot('a.docx', MODEL) : docxSnapshot('b.docx', MODEL_B),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const aMatch = projectionMatch(PROJECTION, '嵌套项目');
    const bMatch = projectionMatch(PROJECTION_B, '乙文档正文');
    await submitSearch('文档');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('a.docx', 'rev-doc', aMatch.from, aMatch.to, aMatch.matchedText),
          docxFileResult('b.docx', 'rev-doc', bMatch.from, bMatch.to, bMatch.matchedText),
        ]),
      );
    });

    await clickMatch(0); // a.docx 定位
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    await clickMatch(1); // b.docx 定位
    expect(docxSelectionText(docxEditor()!)).toBe('乙文档正文');

    // 切回 a.docx：选区仍为 a 的匹配（会话隔离）
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.docx/ }));
    });
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
  });

  it('跨文件连续点击（读取门闩）：只定位最后一次，迟到读取不作废新定位', async () => {
    let resolveA!: (result: ReadDocxDocumentResult) => void;
    const aGate = new Promise<ReadDocxDocumentResult>((resolve) => {
      resolveA = resolve;
    });
    const api = mockDesktop((relativePath: string) =>
      relativePath === 'a.docx'
        ? aGate
        : Promise.resolve({ status: 'loaded', document: docxSnapshot('b.docx', MODEL_B) }),
    );
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const aMatch = projectionMatch(PROJECTION, '嵌套项目');
    const bMatch = projectionMatch(PROJECTION_B, '乙文档正文');
    await submitSearch('文档');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('a.docx', 'rev-doc', aMatch.from, aMatch.to, aMatch.matchedText),
          docxFileResult('b.docx', 'rev-doc', bMatch.from, bMatch.to, bMatch.matchedText),
        ]),
      );
    });

    // a 的读取挂起：点击 a 结果（loading 标签）
    await act(async () => {
      fireEvent.click(matchButtons()[0]!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    // 再点击 b 结果：b 读取立即完成并定位（新定位请求）
    await clickMatch(1);
    expect(docxSelectionText(docxEditor()!)).toBe('乙文档正文');

    // a 的读取迟到完成：其定位已被新请求作废，不得覆盖 b 的选区
    await act(async () => {
      resolveA({ status: 'loaded', document: docxSnapshot('a.docx', MODEL) });
    });
    await act(async () => {});
    expect(docxSelectionText(docxEditor()!)).toBe('乙文档正文');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('搜索取消不影响已打开 DOCX 标签与定位状态', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('doc.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'doc.docx' }));
    });
    await act(async () => {});
    await act(async () => {});
    expect(docxEditor()?.view.state.doc.textContent).toContain('文档标题');

    // 发起搜索后取消
    await submitSearch('文档');
    expect(screen.getByText('正在搜索…')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    expect(screen.getByText('已取消')).toBeDefined();

    // 已打开 DOCX 标签与会话完好（搜索取消不干扰编辑会话）
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    expect(docxEditor()?.view.state.doc.textContent).toContain('文档标题');
  });
});
