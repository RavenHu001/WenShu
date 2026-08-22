// @vitest-environment jsdom
/**
 * TASK-010 WP3 App 集成测试：DOCX 当前查找面板、快捷键与活动 editor 接入
 * （任务第 8.7 节）。
 *
 * 覆盖：Ctrl+F / Ctrl+H 打开 DOCX 面板并即时搜索（计数+装饰）、F3/Shift+F3 与
 * Enter/Shift+Enter 导航、Escape 关闭并恢复焦点、TXT/DOCX 混合切换（同一时刻只显示
 * 活动 kind 的面板，查询隔离）、多 DOCX 标签 controls 隔离、read-only/degraded 可查找
 * 且替换不可用原因明确、loading DOCX 不显示假可用面板、关闭标签后面板清理。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  compatibility: DocxCompatibilityReport = compatibilityOf('supported'),
): DocxDocumentSnapshot {
  return {
    kind: 'docx',
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    revision: 'rev-' + relativePath,
    size: 10,
    model,
    compatibility,
  };
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

interface DesktopMock {
  readonly open: ReturnType<typeof vi.fn>;
  readonly readText: ReturnType<typeof vi.fn>;
  readonly readDocx: ReturnType<typeof vi.fn>;
}

/** 按相对路径返回 DOCX 读取结果（默认 b.docx 为 'abc abc' 支持文档）；支持 Promise（loading 场景）。 */
function mockDesktop(
  options: {
    readonly txt?: Readonly<Record<string, string>>;
    readonly docx?: Readonly<
      Record<string, ReadDocxDocumentResult | Promise<ReadDocxDocumentResult>>
    >;
    readonly defaultDocx?: ReadDocxDocumentResult;
  } = {},
): DesktopMock {
  const readText = vi.fn(async (relativePath: string): Promise<ReadTextDocumentResult> =>
    loadedText(relativePath, options.txt?.[relativePath] ?? 'TXT 内容'),
  );
  const readDocx = vi.fn(async (relativePath: string): Promise<ReadDocxDocumentResult> => {
    const result = options.docx?.[relativePath] ??
      options.defaultDocx ?? {
        status: 'loaded',
        document: docxSnapshot(relativePath, paragraphModel('abc abc')),
      };
    return (await result) as ReadDocxDocumentResult;
  });
  const api = {
    open: vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' })),
    readText,
    readDocx,
  };
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9' },
    workspace: {
      open: api.open,
      refresh: vi.fn(async (): Promise<RefreshWorkspaceResult> => ({ status: 'not-open' })),
    },
    document: {
      readText: api.readText,
      saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      })),
      readDocx: api.readDocx,
      saveDocx: vi.fn(async (): Promise<SaveDocxDocumentResult> => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入文件失败' },
      })),
    },
    search: {
      textWorkspace: vi.fn(),
      cancelTextWorkspace: vi.fn(),
    },
    window: {
      setDirtyState: vi.fn(async () => undefined),
      requestClose: vi.fn(async () => undefined),
      cancelClose: vi.fn(async () => undefined),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  };
  return api;
}

async function openWorkspace(entries: readonly WorkspaceEntry[]): Promise<void> {
  const api = mockDesktop();
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
  await act(async () => {});
}

/** 活动 DOCX 标签的 Tiptap 编辑器（跳过 hidden 宿主）。 */
function docxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function ctrlF(dom: HTMLElement): void {
  act(() => {
    fireEvent.keyDown(dom, { key: 'f', ctrlKey: true });
  });
}

function ctrlH(dom: HTMLElement): void {
  act(() => {
    fireEvent.keyDown(dom, { key: 'h', ctrlKey: true });
  });
}

async function openDocxPanelAndQuery(query: string): Promise<void> {
  const editor = docxEditor();
  expect(editor).not.toBeNull();
  // 多冲刷一轮：宿主挂载 → controls 注册 → DocumentPane effect → App 状态
  await act(async () => {});
  ctrlF(editor!.view.dom);
  const input = screen.getByLabelText('查找内容') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: query } });
    await flush();
  });
  return;
}

describe('WP3：DOCX 当前查找 App 集成（第 8.7 节）', () => {
  it('Ctrl+F 打开 DOCX 面板：即时搜索、计数与匹配装饰', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('第 1 / 2 处');
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
    expect(docxEditor()!.view.dom.querySelectorAll('.wenshu-search-current')).toHaveLength(1);
    // 查找不修改正文
    expect(docxEditor()!.view.state.doc.textContent).toBe('abc abc');
  });

  it('Ctrl+H 打开面板；支持文档替换可用（WP4 启用）', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    ctrlH(docxEditor()!.view.dom);
    expect(screen.getByLabelText('查找内容')).toBeDefined();
    // WP4：可编辑支持文档替换输入可用，不再显示"即将可用"原因
    expect(screen.getByLabelText('替换为')).not.toHaveProperty('disabled', true);
    expect(screen.queryByText('替换功能将在后续版本提供')).toBeNull();
    // 尚无匹配：替换按钮因无匹配而禁用（不是权限禁用）
    expect(screen.getByRole('button', { name: /全部替换/ })).toHaveProperty('disabled', true);
  });

  it('F3/Shift+F3（编辑器）与 Enter/Shift+Enter（面板）循环导航并选中匹配', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    const editor = docxEditor()!;
    const selected = (): string => {
      const { from, to } = editor.view.state.selection;
      return editor.view.state.doc.textBetween(from, to);
    };
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: 'F3' });
    });
    expect(selected()).toBe('abc');
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: 'F3', shiftKey: true });
    });
    const input = screen.getByLabelText('查找内容');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(selected()).toBe('abc');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(selected()).toBe('abc');
    // 循环导航不修改正文
    expect(editor.view.state.doc.textContent).toBe('abc abc');
  });

  it('Escape 关闭面板并恢复编辑器焦点', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    const editor = docxEditor()!;
    fireEvent.keyDown(screen.getByLabelText('查找内容'), { key: 'Escape' });
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    // 关闭面板移除装饰
    expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
    await act(async () => {
      await raf();
    });
    expect(editor.view.hasFocus()).toBe(true);
  });

  it('混合 TXT/DOCX：同一时刻只显示活动 kind 的面板，查询按标签隔离', async () => {
    await openWorkspace([entry('a.txt'), entry('b.docx')]);
    // 先打开 TXT：查找与替换标签显示 CodeMirror 面板
    await openFileFromTree('a.txt');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(document.querySelector('.cm-search input[name="search"]')).not.toBeNull();
    expect(screen.queryByLabelText('查找内容')).toBeNull();

    // 切到 DOCX：先回文件活动栏（搜索侧栏激活时文件树被 hidden），再打开 b.docx
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    expect(screen.queryByRole('textbox', { name: /查找/ })).not.toBeNull();
    expect(document.querySelector('.cm-search input[name="search"]')).toBeNull();

    // 切回 TXT：DOCX 面板消失，CodeMirror 面板仍在
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.txt/ }));
    });
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    // 再次切到 DOCX：DOCX 面板恢复且查询保留
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    expect(screen.getByLabelText('查找内容')).toBeDefined();
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
  });

  it('多 DOCX 标签：每个标签独立查询状态，切换不串线', async () => {
    await openWorkspace([entry('a.docx'), entry('b.docx')]);
    await openFileFromTree('a.docx');
    await openDocxPanelAndQuery('abc');
    // 先回文件活动栏再打开第二个 DOCX（搜索侧栏激活时文件树被 hidden）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('def');
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('def');
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.docx/ }));
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('abc');
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    expect((screen.getByLabelText('查找内容') as HTMLInputElement).value).toBe('def');
  });

  it('read-only DOCX：可查找，替换原因明确且不可执行', async () => {
    const api = mockDesktop({
      docx: {
        'ro.docx': {
          status: 'loaded',
          document: docxSnapshot(
            'ro.docx',
            paragraphModel('abc abc'),
            compatibilityOf('read-only'),
          ),
        },
      },
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('ro.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openFileFromTree('ro.docx');
    await openDocxPanelAndQuery('abc');
    expect(screen.getByText('只读文档不支持替换')).toBeDefined();
    expect(screen.getByLabelText('替换为')).toHaveProperty('disabled', true);
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
  });

  it('degraded 未确认 DOCX：可查找，替换原因明确且不可执行', async () => {
    const api = mockDesktop({
      docx: {
        'dg.docx': {
          status: 'loaded',
          document: docxSnapshot('dg.docx', paragraphModel('abc abc'), compatibilityOf('degraded')),
        },
      },
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('dg.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openFileFromTree('dg.docx');
    await openDocxPanelAndQuery('abc');
    expect(screen.getByText('文档包含不受支持内容，需先确认兼容性')).toBeDefined();
    expect(document.querySelector('.docx-search-status')?.textContent).toBe('第 1 / 2 处');
  });

  it('loading DOCX：不显示假可用面板；读取完成后面板可用', async () => {
    let resolveRead: ((result: ReadDocxDocumentResult) => void) | null = null;
    const api = mockDesktop({
      docx: {
        'slow.docx': new Promise<ReadDocxDocumentResult>((resolve) => {
          resolveRead = resolve;
        }),
      },
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('slow.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openFileFromTree('slow.docx');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '搜索面板' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    expect(screen.getByText('打开 DOCX 文件后可查找或替换。')).toBeDefined();
    // 读取完成 → 宿主挂载 → 面板可用
    await act(async () => {
      resolveRead?.({
        status: 'loaded',
        document: docxSnapshot('slow.docx', paragraphModel('abc abc')),
      });
      await flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '查找与替换' }));
    });
    expect(screen.getByLabelText('查找内容')).toBeDefined();
  });

  it('关闭 DOCX 标签：面板消失且活动 controls 清理', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    expect(screen.getByLabelText('查找内容')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭 b.docx' }));
    });
    // 干净标签直接关闭；无活动文档时回到 TXT 空状态文案
    await act(async () => {});
    expect(screen.queryByLabelText('查找内容')).toBeNull();
    expect(screen.getByText('打开一个 TXT 文件后可查找或替换。')).toBeDefined();
  });

  it('WP4：替换当前项 → 内容变化并进入 dirty，一次 undo 恢复', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    expect(replaceInput).not.toHaveProperty('disabled', true);
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /替换当前项/ }));
      await flush();
    });
    const editor = docxEditor()!;
    expect(editor.view.state.doc.textContent).toBe('xyz abc');
    expect(document.querySelectorAll('.tab .tab-dirty').length).toBe(1);
    expect(screen.getByText('已替换 1 处')).toBeDefined();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('abc abc');
  });

  it('WP4：全部替换 → 单次应用、dirty、操作数量反馈与一次 undo', async () => {
    await openWorkspace([entry('b.docx')]);
    await openFileFromTree('b.docx');
    await openDocxPanelAndQuery('abc');
    const replaceInput = screen.getByLabelText('替换为') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(replaceInput, { target: { value: 'xyz' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /全部替换/ }));
      await flush();
    });
    const editor = docxEditor()!;
    expect(editor.view.state.doc.textContent).toBe('xyz xyz');
    expect(document.querySelectorAll('.tab .tab-dirty').length).toBe(1);
    expect(screen.getByText('已替换 2 处')).toBeDefined();
    // 全部替换是一次可撤销编辑事务
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('abc abc');
    expect(editor.commands.redo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('xyz xyz');
  });
});
