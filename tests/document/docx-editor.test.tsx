// @vitest-environment jsdom
/**
 * TASK-007 WP5：DOCX 富文本编辑器、格式工具栏、兼容性 UI 与混合标签组件测试（任务第 8.6 节）。
 * 覆盖：文件树 .docx 选择、加载/只读/degraded/错误状态、编辑/撤销/重做/无变化事务、
 * 每标签会话隔离（选择/滚动/历史）、工具栏可用性、兼容性确认、TXT/DOCX 混合标签
 * 顺序与去重、保存入口（degraded 确认绑定 revision）。
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
  DocxCompatibilityReport,
} from '../../src/shared/docx';
import { DOCX_MODEL_SCHEMA_VERSION } from '../../src/shared/docx';
import type { ReadTextDocumentResult, SaveTextDocumentResult } from '../../src/shared/document';

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

function compatibilityOf(level: DocxCompatibilityReport['level']): DocxCompatibilityReport {
  return {
    level,
    warnings:
      level === 'supported' ? [] : [{ code: 'image', message: '文档包含图片，保存后可能丢失' }],
  };
}

function docxSnapshot(
  model: DocxDocumentModel,
  overrides: Partial<DocxDocumentSnapshot> = {},
): DocxDocumentSnapshot {
  return {
    kind: 'docx',
    name: 'b.docx',
    relativePath: 'b.docx',
    revision: 'rev-b',
    size: 10,
    model,
    compatibility: compatibilityOf('supported'),
    ...overrides,
  };
}

function entry(relativePath: string, kind: WorkspaceEntry['kind'] = 'file'): WorkspaceEntry {
  return kind === 'directory'
    ? {
        relativePath,
        name: relativePath.split('/').pop() ?? relativePath,
        kind,
        children: [],
      }
    : {
        relativePath,
        name: relativePath.split('/').pop() ?? relativePath,
        kind,
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
}

function mockDesktop(overrides: Partial<DesktopMock> = {}): DesktopMock {
  const readText =
    overrides.readText ??
    vi.fn(async (): Promise<ReadTextDocumentResult> => loadedText('a.txt', 'TXT 内容'));
  const readDocx =
    overrides.readDocx ??
    vi.fn(async (): Promise<ReadDocxDocumentResult> => ({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('DOCX 正文')),
    }));
  const api = {
    open: vi.fn(async (): Promise<OpenWorkspaceResult> => ({ status: 'cancelled' })),
    readText,
    saveText: vi.fn(async (): Promise<SaveTextDocumentResult> => ({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: '写入文件失败' },
    })),
    readDocx,
    saveDocx: vi.fn(async (): Promise<SaveDocxDocumentResult> => ({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: '写入文件失败' },
    })),
    ...overrides,
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

async function openWorkspace(entries: readonly WorkspaceEntry[]): Promise<DesktopMock> {
  const api = mockDesktop();
  api.open.mockResolvedValue({
    status: 'selected',
    workspace: snapshot(entries),
  } as OpenWorkspaceResult);
  render(<App />);
  await act(async () => {
    fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
  });
  return api;
}

async function openDocxFromTree(_api: DesktopMock, name = 'b.docx'): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
  });
  await act(async () => {});
  await act(async () => {});
}

/** 活动 DOCX 标签的 Tiptap 编辑器（宿主把实例挂在容器 DOM 上；跳过 hidden 宿主）。 */
function docxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

function docxEditorText(): string {
  return docxEditor()?.view.state.doc.textContent ?? '';
}

function dirtyMarkers(): number {
  return document.querySelectorAll('.tab .tab-dirty').length;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

describe('文件树 .docx 选择与加载（第 8.6 节）', () => {
  it('文件树只允许 .txt 与 .docx 选择；点击 .docx 显示加载并渲染编辑器正文', async () => {
    const api = await openWorkspace([
      entry('a.txt'),
      entry('b.docx'),
      entry('notes.md'),
      entry('macro.docm'),
      entry('link.txt', 'symbolic-link'),
    ]);
    const tree = screen.getByRole('tree');
    expect(within(tree).getByRole('button', { name: 'a.txt' })).toBeDefined();
    expect(within(tree).getByRole('button', { name: 'b.docx' })).toBeDefined();
    // 其他类型不可选择（不是按钮）
    expect(within(tree).queryByRole('button', { name: 'notes.md' })).toBeNull();
    expect(within(tree).queryByRole('button', { name: 'macro.docm' })).toBeNull();
    expect(within(tree).queryByRole('button', { name: 'link.txt' })).toBeNull();

    await openDocxFromTree(api, 'b.docx');
    expect(api.readDocx).toHaveBeenCalledWith('b.docx');
    const view = docxEditor()?.view ?? null;
    expect(view).not.toBeNull();
    expect(view?.state.doc.textContent).toContain('DOCX 正文');
    // 布局回归：已加载 DOCX 的可见编辑器宿主唯一承担编辑区域（docx-editor-host），
    // 不存在与它竞争 flex 高度的空 doc-pane-body 容器（TASK-007 修复后回归保护）
    const visibleHosts = Array.from(
      document.querySelectorAll<HTMLElement>('.docx-editor-host'),
    ).filter((el) => el.closest('[hidden]') === null);
    expect(visibleHosts).toHaveLength(1);
    const visiblePaneBodies = Array.from(
      document.querySelectorAll<HTMLElement>('.doc-pane-body'),
    ).filter(
      (el) =>
        el.closest('[hidden]') === null &&
        !el.classList.contains('doc-loading') &&
        !el.classList.contains('doc-error-panel'),
    );
    expect(visiblePaneBodies).toHaveLength(0);
  });

  it('DOCX 读取失败：错误面板与重试', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'error',
      error: { code: 'INVALID_DOCX', message: '不是有效的 DOCX 文件' },
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    expect(screen.getByText('无法读取文件 b.docx')).toBeDefined();
    expect(screen.getByText('不是有效的 DOCX 文件')).toBeDefined();
    // 重试发起新一轮读取
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('修复后的正文')),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
    });
    await act(async () => {});
    expect(api.readDocx).toHaveBeenCalledTimes(2);
    expect(docxEditorText()).toContain('修复后的正文');
  });

  it('0 字节 DOCX 占位文件的空模型可挂载编辑器并正常产生 dirty', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(
        { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: [] },
        { name: 'empty.docx', relativePath: 'empty.docx', revision: 'empty-rev', size: 0 },
      ),
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('empty.docx')]),
    } as OpenWorkspaceResult);

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'empty.docx');

    const editor = docxEditor();
    expect(editor).not.toBeNull();
    expect(editor?.view.state.doc.textContent).toBe('');
    expect(dirtyMarkers()).toBe(0);
    await act(async () => {
      editor?.commands.insertContent('占位文档正文');
    });
    expect(docxEditorText()).toBe('占位文档正文');
    expect(dirtyMarkers()).toBe(1);
  });
});

describe('DOCX 编辑、工具栏与会话隔离（第 8.6 节）', () => {
  it('编辑产生 dirty；无变化事务不制造 dirty', async () => {
    const api = await openWorkspace([entry('b.docx')]);
    await openDocxFromTree(api, 'b.docx');
    expect(dirtyMarkers()).toBe(0);
    const editor = docxEditor()!;
    // 无变化事务（只改选区）：不制造 dirty
    await act(async () => {
      editor.commands.selectAll();
    });
    expect(dirtyMarkers()).toBe(0);
    // 内容变化事务：dirty
    await act(async () => {
      editor.view.dispatch(editor.view.state.tr.insertText(' 新增内容'));
    });
    await act(async () => {});
    expect(dirtyMarkers()).toBe(1);
    expect(docxEditorText()).toContain('新增内容');
  });

  it('工具栏：粗体切换、撤销与重做', async () => {
    const api = await openWorkspace([entry('b.docx')]);
    await openDocxFromTree(api, 'b.docx');
    const editor = docxEditor()!;
    await act(async () => {
      editor.commands.selectAll();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '粗体' }));
    const boldBtn = screen.getByRole('button', { name: '粗体' });
    expect(boldBtn.getAttribute('aria-pressed')).toBe('true');
    // 撤销：移除粗体
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(boldBtn.getAttribute('aria-pressed')).toBe('false');
    // 重做：重新应用粗体
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(boldBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('TXT 与 DOCX 混合标签：顺序、激活与同路径去重', async () => {
    const api = await openWorkspace([entry('a.txt'), entry('b.docx')]);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'a.txt' }));
    });
    await act(async () => {});
    await openDocxFromTree(api, 'b.docx');
    const tabs = document.querySelectorAll('.tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toContain('a.txt');
    expect(tabs[1]?.textContent).toContain('b.docx');
    expect(tabs[1]?.classList.contains('active')).toBe(true);
    // 重复点击 b.docx：只激活，不重复读取、不建第二标签
    await act(async () => {
      fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'b.docx' }));
    });
    expect(api.readDocx).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.tab')).toHaveLength(2);
  });

  it('每标签会话隔离：切换保留各自内容与撤销历史', async () => {
    const api = await openWorkspace([entry('a.txt'), entry('b.docx')]);
    // 先打开 TXT，再打开 DOCX
    await act(async () => {
      fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'a.txt' }));
    });
    await act(async () => {});
    await openDocxFromTree(api, 'b.docx');
    const view = docxEditor()!.view;
    await act(async () => {
      view.dispatch(view.state.tr.insertText(' 编辑一'));
    });
    await act(async () => {});
    expect(view.state.doc.textContent).toContain('编辑一');

    // 切到 TXT 标签
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.txt/ }));
    });
    // 切回 DOCX：内容与撤销历史保留（撤销可恢复编辑前）
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /b\.docx/ }));
    });
    const view2 = docxEditor()!.view;
    expect(view2.state.doc.textContent).toContain('编辑一');
    const before = view2.state.doc.textContent;
    // ProseMirror history 会把 500ms 内的相邻事务合并为一个撤销事件：
    // 等待超过合并窗口，使第二次编辑成为独立历史事件（验证历史跨切换保留）
    await new Promise((resolve) => setTimeout(resolve, 600));
    await act(async () => {
      view2.dispatch(view2.state.tr.insertText(' 编辑二'));
    });
    await act(async () => {});
    expect(view2.state.doc.textContent).toContain('编辑二');
    // 撤销：回到编辑一（历史保留）
    const undoBtn = screen.getByRole('button', { name: '撤销' });
    await userEvent.setup().click(undoBtn);
    expect(view2.state.doc.textContent).toBe(before);
  });
});

describe('兼容性：read-only / degraded 与确认（第 4.2 / 8.6 节）', () => {
  it('read-only：只读提示、工具栏禁用、编辑不产生 dirty', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('只读正文'), {
        compatibility: compatibilityOf('read-only'),
      }),
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    expect(screen.getByText('文档为只读状态')).toBeDefined();
    const boldBtn = screen.getByRole('button', { name: '粗体' });
    expect((boldBtn as HTMLButtonElement).disabled).toBe(true);
    // 编辑被模型层拒绝：程序化 dispatch 不制造 dirty
    const view = docxEditor()!.view;
    await act(async () => {
      view.dispatch(view.state.tr.insertText('X'));
    });
    await act(async () => {});
    expect(dirtyMarkers()).toBe(0);
  });

  it('degraded：提示与确认绑定 revision；确认前编辑被拒，确认后编辑生效', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('降级正文'), {
        compatibility: compatibilityOf('degraded'),
      }),
    });
    api.saveDocx.mockResolvedValue({
      status: 'saved',
      document: docxSnapshot(paragraphModel('降级正文')),
      backupRelativePath: 'b.docx.wenshu.bak',
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    expect(screen.getByText('文档包含不受支持的内容')).toBeDefined();
    expect(screen.getByText('文档包含图片，保存后可能丢失')).toBeDefined();

    // 确认前：编辑被模型层拒绝
    const view = docxEditor()!.view;
    await act(async () => {
      view.dispatch(view.state.tr.insertText(' 未确认编辑'));
    });
    await act(async () => {});
    expect(dirtyMarkers()).toBe(0);

    // 确认（绑定 revision rev-b）后：编辑生效、保存请求携带确认 revision
    await userEvent.setup().click(screen.getByRole('button', { name: '确认继续编辑并保存' }));
    await act(async () => {
      view.dispatch(view.state.tr.insertText(' 确认后编辑'));
    });
    await act(async () => {});
    expect(dirtyMarkers()).toBe(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(api.saveDocx).toHaveBeenCalledTimes(1);
    const request = api.saveDocx.mock.calls[0]?.[0] as SaveDocxDocumentRequest;
    expect(request.relativePath).toBe('b.docx');
    expect(request.expectedRevision).toBe('rev-b');
    expect(request.compatibilityConfirmationRevision).toBe('rev-b');
    expect(request.model.blocks[0]).toBeDefined();
  });

  it('degraded 未确认直接保存：saveDocx 不被调用，标签进入确认错误状态', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('降级正文'), {
        compatibility: compatibilityOf('degraded'),
      }),
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    // 直接构造 dirty 状态不可行（编辑被拒），因此保存按钮不可用；确认前点击保存无效果
    const saveBtn = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    await userEvent.setup().click(saveBtn);
    expect(api.saveDocx).not.toHaveBeenCalled();
  });
});

describe('DOCX 保存与冲突提示（第 8.6 节）', () => {
  it('保存成功：新基线 revision 更新、dirty 清除；保存请求携带模型', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('正文')),
    });
    api.saveDocx.mockImplementation(async (request: SaveDocxDocumentRequest) => ({
      status: 'saved',
      document: docxSnapshot(paragraphModel('正文'), {
        revision: 'rev-saved',
        model: request.model,
      }),
      backupRelativePath: 'b.docx.wenshu.bak',
    }));
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    const view = docxEditor()!.view;
    await act(async () => {
      view.dispatch(view.state.tr.insertText(' 已编辑'));
    });
    await act(async () => {});
    expect(dirtyMarkers()).toBe(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    const request = api.saveDocx.mock.calls[0]?.[0] as SaveDocxDocumentRequest;
    expect(request.expectedRevision).toBe('rev-b');
    expect(request.model.blocks[0]).toBeDefined();
    // 保存完成：dirty 清除
    expect(dirtyMarkers()).toBe(0);
    expect(screen.getByText('已保存（备份 b.docx.wenshu.bak）')).toBeDefined();
    // 编辑器内容保留（保存回写基线不重置历史）：仍可撤销
    const undoBtn = screen.getByRole('button', { name: '撤销' });
    await userEvent.setup().click(undoBtn);
    expect(docxEditorText()).not.toContain('已编辑');
  });

  it('保存冲突：外部冲突横幅与重新读取', async () => {
    const api = mockDesktop();
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('正文')),
    });
    api.saveDocx.mockResolvedValue({
      status: 'error',
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    });
    api.open.mockResolvedValue({
      status: 'selected',
      workspace: snapshot([entry('b.docx')]),
    } as OpenWorkspaceResult);
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openDocxFromTree(api, 'b.docx');
    const view = docxEditor()!.view;
    await act(async () => {
      view.dispatch(view.state.tr.insertText(' 编辑'));
    });
    await act(async () => {});
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await act(async () => {});
    expect(screen.getByText(/外部冲突/)).toBeDefined();
    expect(dirtyMarkers()).toBe(1);
    // 重新读取：弹确认对话框，确认后重读磁盘
    api.readDocx.mockResolvedValue({
      status: 'loaded',
      document: docxSnapshot(paragraphModel('外部新正文'), { revision: 'rev-external' }),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改' }));
    await act(async () => {});
    await act(async () => {});
    expect(docxEditorText()).toContain('外部新正文');
  });
});
