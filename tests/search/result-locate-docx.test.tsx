// @vitest-environment jsdom
/**
 * TASK-008 WP4 DOCX 搜索结果打开与富文本定位测试（任务第 8.6 节）。
 *
 * 覆盖：点击未打开 / 已打开 / loading DOCX 结果；段落、标题、跨 run marks、
 * 嵌套列表与 emoji 的 UTF-16 投影偏移定位；read-only 可定位不可编辑；
 * degraded 未确认也可定位且不自动确认；dirty 但原投影片段未变时定位成功且 dirty
 * 保留；仅格式变化（对齐）且投影未变时定位成功；匹配前插入/结构变化导致投影偏移
 * 失效时只提示过期、不错误定位；外部修改导致 revision 不同；定位不修改模型、
 * 不制造 dirty、不触发保存；新定位覆盖旧定位。
 *
 * 标签关闭、工作区切换、read-error 与 loading 去重共享 App 通用 openFile 流程，
 * 与既有 TXT 定位测试（result-locate.test.tsx）同一代码路径。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
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
  SaveDocxDocumentResult,
} from '../../src/shared/docx';
import type {
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '../../src/shared/search';
import { projectDocxModelSearchText } from '../../src/shared/docx-search-text';
import { tiptapJsonToDocxModel } from '../../src/shared/docx-convert';

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

/** 覆盖标题、跨 run marks、空段、嵌套列表与 emoji 的模型。 */
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
        { text: ' English text.', marks: [] },
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
    paragraph('emoji 🎉 结尾'),
  ],
};

const PROJECTION = projectDocxModelSearchText(MODEL);

/** 投影空间中某个查询的匹配（第一个匹配）。 */
function projectionMatch(query: string): { from: number; to: number; matchedText: string } {
  const from = PROJECTION.text.indexOf(query);
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

interface DesktopMock {
  readonly open: ReturnType<typeof vi.fn>;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly readDocx: ReturnType<typeof vi.fn>;
  readonly saveDocx: ReturnType<typeof vi.fn>;
  readonly textWorkspace: ReturnType<typeof vi.fn>;
  readonly cancelTextWorkspace: ReturnType<typeof vi.fn>;
  /** 结算最近一次搜索（controller 每次提交递增 requestId，测试只需结算最新请求）。 */
  readonly resolveSearch: (result: WorkspaceTextSearchResult) => void;
}

function mockDesktop(
  readDocxImpl: (relativePath: string) => Promise<ReadDocxDocumentResult>,
): DesktopMock {
  const pending = new Map<number, { resolve: (result: WorkspaceTextSearchResult) => void }>();
  let lastRequestId = 0;
  const textWorkspace = vi.fn(
    (request: WorkspaceTextSearchRequest) =>
      new Promise<WorkspaceTextSearchResult>((resolve) => {
        lastRequestId = request.requestId;
        pending.set(request.requestId, { resolve });
      }),
  );
  const cancelTextWorkspace = vi.fn(async () => undefined);
  const open = vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' }));
  const readText = vi.fn(async (): Promise<ReadTextDocumentResult> => ({
    status: 'error',
    error: { code: 'NOT_FOUND', message: '文件不存在' },
  }));
  const saveText = vi.fn(async (): Promise<SaveTextDocumentResult> => ({
    status: 'error',
    error: { code: 'WRITE_FAILED', message: '写入文件失败' },
  }));
  const readDocx = vi.fn(readDocxImpl);
  const saveDocx = vi.fn(async (): Promise<SaveDocxDocumentResult> => ({
    status: 'error',
    error: { code: 'WRITE_FAILED', message: '写入文件失败' },
  }));
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open,
      refresh: vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' })),
    },
    document: { readText, saveText, readDocx, saveDocx },
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
    resolveSearch: (result) => pending.get(lastRequestId)?.resolve(result),
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

function snapshot(entries: readonly WorkspaceEntry[] = []): WorkspaceSnapshot {
  return { rootName: 'test-root', rootPath: '/test-root', entries: [...entries] };
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

function matchButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.search-match-btn')) as HTMLButtonElement[];
}

async function openWorkspace(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
}

/** 打开搜索侧栏并提交查询（fireEvent 通道，避免 act/user-event 焦点碰撞，与 TXT 定位测试一致）。 */
async function submitSearch(query: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
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

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

describe('DOCX 搜索结果打开与定位（第 8.6 节）', () => {
  it('未打开 DOCX：创建唯一标签，读取完成后按投影定位到标题 / 跨 run marks / 嵌套列表 / emoji', async () => {
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

    for (const query of ['文档标题', '粗体与斜体', '嵌套项目', '项目甲', '🎉']) {
      const match = projectionMatch(query);
      await submitSearch(query);
      await act(async () => {
        api.resolveSearch(
          completedResult(1, [
            docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
          ]),
        );
      });
      await clickMatch(0);
      const editor = docxEditor();
      expect(editor, `查询 ${query}`).not.toBeNull();
      expect(docxSelectionText(editor!), `查询 ${query} 的选区文本`).toBe(match.matchedText);
      expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
    }
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    expect(api.readDocx).toHaveBeenCalledTimes(1); // 同路径只读取一次
  });

  it('已打开 DOCX：只激活原标签，不重复读取，定位成功', async () => {
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

    const match = projectionMatch('嵌套项目');
    await submitSearch('嵌套项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(api.readDocx).toHaveBeenCalledTimes(1); // 不重复读取
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('loading DOCX：等待原读取，不创建第二标签', async () => {
    let resolveRead!: (result: ReadDocxDocumentResult) => void;
    const readGate = new Promise<ReadDocxDocumentResult>((resolve) => {
      resolveRead = resolve;
    });
    const api = mockDesktop(() => readGate);
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('doc.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();
    // 从文件树打开 → loading（读取挂起）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'doc.docx' }));
    });
    expect(document.querySelectorAll('.tab')).toHaveLength(1);

    const match = projectionMatch('嵌套项目');
    await submitSearch('嵌套项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    // 读取挂起时点击结果：等待原读取，不创建第二标签
    await act(async () => {
      fireEvent.click(matchButtons()[0]!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelectorAll('.tab')).toHaveLength(1);
    expect(api.readDocx).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead({ status: 'loaded', document: docxSnapshot('doc.docx', MODEL) });
    });
    await act(async () => {});
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('read-only 文档：可以定位选区，但不可编辑', async () => {
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

    const match = projectionMatch('文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    const editor = docxEditor()!;
    expect(docxSelectionText(editor)).toBe('文档标题');
    expect(editor.isEditable).toBe(false);
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('degraded 未确认也可定位，且不自动确认兼容性', async () => {
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

    const match = projectionMatch('嵌套项目');
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
    // 定位不等于确认编辑兼容性：degraded 确认按钮仍存在（未被自动确认）
    expect(screen.getByText(/确认继续编辑并保存/)).toBeDefined();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('dirty 但原投影片段未变时定位成功且 dirty 保留', async () => {
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

    const match = projectionMatch('项目甲');
    await submitSearch('项目甲');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    // 先打开并编辑：把选区移到文档末尾并追加文本（不影响匹配前的偏移）
    await clickMatch(0);
    const editor = docxEditor()!;
    expect(docxSelectionText(editor)).toBe('项目甲');
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.dispatch(editor.view.state.tr.insertText(' 末尾追加'));
    });
    await act(async () => {});
    expect(document.querySelector('.tab-dirty')).not.toBeNull(); // 已 dirty

    // 再次点击同一结果：原范围仍精确等于匹配文本 → 允许定位，dirty 保留
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('项目甲');
    expect(document.querySelector('.tab-dirty')).not.toBeNull();
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('仅格式变化（对齐）且投影未变时定位成功', async () => {
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

    const match = projectionMatch('粗体与斜体');
    await submitSearch('粗体与斜体');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    const editor = docxEditor()!;
    // 只改段落对齐（格式变化），正文投影不变
    await act(async () => {
      editor.chain().focus().setTextAlign('right').run();
    });
    await act(async () => {});
    expect(document.querySelector('.tab-dirty')).not.toBeNull();

    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('粗体与斜体');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('匹配前正文插入导致投影偏移变化：只提示过期，不错误定位', async () => {
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

    const match = projectionMatch('嵌套项目');
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
    // 在文档开头（标题文本内部）插入文字：匹配偏移整体后移
    await act(async () => {
      editor.commands.setTextSelection(1);
      editor.view.dispatch(editor.view.state.tr.insertText('前置文本'));
    });
    await act(async () => {});

    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：doc\.docx 的匹配位置已失效/)).toBeDefined();
    // 不错误选中旧位置
    expect(docxSelectionText(docxEditor()!)).not.toBe('嵌套项目');
  });

  it('结构变化（插入空段落）导致投影与块映射不一致：只提示过期', async () => {
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

    const match = projectionMatch('嵌套项目');
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
    // 在首个块之后插入空段落：文本块序列变化（doc.child(0).nodeSize 为首块结束位置）
    await act(async () => {
      editor.view.dispatch(
        editor.view.state.tr.insert(
          editor.view.state.doc.child(0).nodeSize,
          editor.schema.nodes.paragraph!.create(),
        ),
      );
    });
    await act(async () => {});

    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：doc\.docx 的匹配位置已失效/)).toBeDefined();
  });

  it('外部修改导致 revision 不同：只提示过期，不定位', async () => {
    const api = mockDesktop(async () => ({
      status: 'loaded',
      document: docxSnapshot('doc.docx', MODEL, { revision: 'rev-current' }),
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot(),
    } as OpenWorkspaceResult);
    render(<App />);
    await openWorkspace();

    const match = projectionMatch('文档标题');
    await submitSearch('文档标题');
    // 搜索结果携带旧 revision（磁盘已在读取后变化）
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-old', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    expect(screen.getByText(/搜索结果已过期：doc\.docx 的内容已被外部修改/)).toBeDefined();
  });

  it('新定位覆盖旧定位：连续点击两个匹配只应用最后一个', async () => {
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

    await submitSearch('项目');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          {
            kind: 'docx',
            relativePath: 'doc.docx',
            revision: 'rev-doc',
            truncated: false,
            matches: [
              docxMatch(projectionMatch('项目甲').from, projectionMatch('项目甲').to, '项目甲'),
              docxMatch(
                projectionMatch('嵌套项目').from,
                projectionMatch('嵌套项目').to,
                '嵌套项目',
              ),
            ],
          },
        ]),
      );
    });
    await clickMatch(0);
    expect(docxSelectionText(docxEditor()!)).toBe('项目甲');
    await clickMatch(1);
    // 新定位作废旧定位：最终选区为最后一个匹配
    expect(docxSelectionText(docxEditor()!)).toBe('嵌套项目');
    expect(screen.queryByText(/搜索结果已过期/)).toBeNull();
  });

  it('定位不修改模型、不制造 dirty、不触发保存', async () => {
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

    const match = projectionMatch('文档标题');
    await submitSearch('文档标题');
    await act(async () => {
      api.resolveSearch(
        completedResult(1, [
          docxFileResult('doc.docx', 'rev-doc', match.from, match.to, match.matchedText),
        ]),
      );
    });
    await clickMatch(0);
    const editor = docxEditor()!;
    expect(docxSelectionText(editor)).toBe('文档标题');
    // 模型未变（经模型往返验证，忽略 Tiptap 注入的默认 attrs）、不 dirty、未保存
    const roundTrip = tiptapJsonToDocxModel(editor.getJSON());
    expect(roundTrip.status).toBe('ok');
    if (roundTrip.status === 'ok') {
      expect(roundTrip.model).toEqual(MODEL);
    }
    expect(document.querySelector('.tab-dirty')).toBeNull();
    expect(api.saveDocx).not.toHaveBeenCalled();
  });
});
