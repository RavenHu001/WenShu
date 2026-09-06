// @vitest-environment jsdom
/**
 * TASK-010 WP6：性能观察与泄漏观察（任务第 8.8 节）。
 *
 * ## 原则
 *
 * - 全部为**一次性观察**，不是 CI 基准门禁：wall-clock 只 console.log 记录，
 *   断言只使用宽松上界（防回归），不把不稳定 wall-clock 写成硬断言；
 * - 夹具全部确定性生成：典型 100 段、20,000 textblock、接近模型序列化上限、
 *   0/少量/2000/2001 匹配、全部替换 2000 项；
 * - 观察项：扫描/映射/Decoration/transaction/模型预验证/dispatch 耗时、
 *   快速输入只提交最新重算、反复开关面板与切换标签的重复订阅/控制台错误/
 *   明显内存增长。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Editor, Extension, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { App } from '../../src/renderer/App';
import { DOCX_MAX_MODEL_SERIALIZED_BYTES, type DocxDocumentModel } from '../../src/shared/docx';
import { docxModelToTiptapJson } from '../../src/shared/docx-convert';
import {
  DocxCurrentSearchController,
  createCurrentSearchPlugin,
  type CurrentSearchPluginHooks,
} from '../../src/renderer/lib/docx-current-search-plugin';

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
  document.body.innerHTML = '';
  cleanup();
  delete (window as unknown as Record<string, unknown>).desktop;
});

/* ======================= 夹具 ======================= */

const DOCX_EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

function paragraph(text: string): DocxDocumentModel['blocks'][number] {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

function modelOf(blocks: DocxDocumentModel['blocks']): DocxDocumentModel {
  return { schemaVersion: 1, blocks };
}

/** 典型 100 段 DOCX：每段 60+ 字符（中文 + 英文 + 数字），确定性生成。 */
function typical100Model(): DocxDocumentModel {
  const blocks: DocxDocumentModel['blocks'][number][] = [];
  for (let index = 0; index < 100; index += 1) {
    blocks.push(
      paragraph('第' + (index + 1) + '段：文枢工作台文档正文，包含 abc 关键字与格式测试文本段落。'),
    );
  }
  return modelOf(blocks);
}

/** 20,000 textblock 文档：每 100 段含一次 abc，正文均含「段落」，确定性生成。 */
function huge20kModel(): DocxDocumentModel {
  const blocks: DocxDocumentModel['blocks'][number][] = [];
  for (let index = 0; index < 20000; index += 1) {
    blocks.push(paragraph(index % 100 === 0 ? '内容abc段落' : '普通段落内容'));
  }
  return modelOf(blocks);
}

/** 接近模型序列化上限文档（2013 段 × 4096 字符 ≈ 8,386,188 字节，上限 8,388,608）。 */
function nearLimitModel(): DocxDocumentModel {
  const blocks: DocxDocumentModel['blocks'][number][] = [];
  const runText = 'a'.repeat(4096);
  for (let index = 0; index < 2013; index += 1) {
    blocks.push({ kind: 'paragraph', alignment: null, runs: [{ text: runText, marks: [] }] });
  }
  return modelOf(blocks);
}

/** 创建带 current-search 插件的真实 Tiptap 编辑器（测试宿主）。 */
function createSearchEditor(model: DocxDocumentModel, hooks: CurrentSearchPluginHooks): Editor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Editor({
    element: container,
    extensions: [
      ...DOCX_EDITOR_EXTENSIONS,
      Extension.create({
        name: 'wp6-current-search-host',
        addProseMirrorPlugins() {
          return [createCurrentSearchPlugin(hooks)];
        },
      }),
    ],
    content: docxModelToTiptapJson(model) as unknown as Content,
  });
}

function hooksOf(onRecompute: ReturnType<typeof vi.fn>): CurrentSearchPluginHooks {
  return { onStateChange: null, onRecompute };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 带标签计时（毫秒，两位小数）。 */
function logTiming(label: string, start: number): void {
  console.log(
    '[TASK-010-WP6-perf] ' + label + ': ' + (performance.now() - start).toFixed(1) + 'ms',
  );
}

/** 打开面板并绑定可替换权限；返回 controller 与计时入口。 */
function openAndQuery(model: DocxDocumentModel): {
  editor: Editor;
  controller: DocxCurrentSearchController;
  onRecompute: ReturnType<typeof vi.fn>;
} {
  const onRecompute = vi.fn();
  const hooks = hooksOf(onRecompute);
  const editor = createSearchEditor(model, hooks);
  const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
  controller.setReplaceEnabled(true);
  controller.open('find');
  return { editor, controller, onRecompute };
}

/* ======================= 性能观察 ======================= */

describe('WP6：性能观察（第 8.8 节；一次性观察，宽松上界）', () => {
  it('典型 100 段 DOCX：查询重算 + 装饰耗时（100 匹配）', { timeout: 30_000 }, async () => {
    const { editor, controller } = openAndQuery(typical100Model());
    try {
      const start = performance.now();
      controller.setQuery('abc');
      await flush();
      logTiming('typical100 query abc recompute+decorate', start);
      const snapshot = controller.getSnapshot();
      expect(snapshot.matches).toHaveLength(100);
      expect(snapshot.truncated).toBe(false);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(100);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-current')).toHaveLength(1);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it(
    '20,000 textblock：0 / 少量(200) / 超过 2000（截断）匹配的重算耗时',
    { timeout: 120_000 },
    async () => {
      const model = huge20kModel();
      const onRecompute = vi.fn();
      const hooks = hooksOf(onRecompute);
      const editor = createSearchEditor(model, hooks);
      const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
      try {
        controller.open('find');

        let start = performance.now();
        controller.setQuery('zzz');
        await flush();
        logTiming('20k textblocks query zzz (0 matches) recompute', start);
        expect(controller.getSnapshot().matches).toHaveLength(0);

        start = performance.now();
        controller.setQuery('abc');
        await flush();
        logTiming('20k textblocks query abc (200 matches) recompute', start);
        const few = controller.getSnapshot();
        expect(few.matches).toHaveLength(200);
        expect(few.truncated).toBe(false);

        start = performance.now();
        controller.setQuery('段落');
        await flush();
        logTiming('20k textblocks query 段落 (20000 -> truncated 2000) recompute', start);
        const many = controller.getSnapshot();
        expect(many.matches).toHaveLength(2000);
        expect(many.truncated).toBe(true);
        expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2000);
      } finally {
        controller.destroy();
        editor.destroy();
      }
    },
  );

  it(
    '接近模型序列化上限文档：截断查询重算 + 装饰耗时（一次性观察）',
    { timeout: 180_000 },
    async () => {
      const model = nearLimitModel();
      const serializedBytes = new TextEncoder().encode(JSON.stringify(model)).byteLength;
      expect(serializedBytes).toBeLessThan(DOCX_MAX_MODEL_SERIALIZED_BYTES);
      const { editor, controller } = openAndQuery(model);
      try {
        const start = performance.now();
        controller.setQuery('aa');
        await flush();
        logTiming(
          'near-limit (' + serializedBytes + ' bytes) query aa truncated recompute+decorate',
          start,
        );
        const snapshot = controller.getSnapshot();
        expect(snapshot.matches).toHaveLength(2000);
        expect(snapshot.truncated).toBe(true);
      } finally {
        controller.destroy();
        editor.destroy();
      }
    },
  );

  it('全部替换 2000 项：transaction 构建 + 模型预验证 + dispatch 耗时；单事务一次 undo', async () => {
    const model = modelOf([paragraph('a'.repeat(4000))]);
    const { editor, controller } = openAndQuery(model);
    let updates = 0;
    editor.on('update', () => {
      updates += 1;
    });
    try {
      controller.setQuery('aa');
      await flush();
      expect(controller.getSnapshot().matches).toHaveLength(2000);
      controller.setReplacement('b');
      const start = performance.now();
      controller.replaceAll();
      logTiming('replace-all 2000 items build+prevalidate+dispatch', start);
      expect(editor.view.state.doc.textContent).toBe('b'.repeat(2000));
      expect(updates).toBe(1);
      expect(controller.getSnapshot().operationMessage).toBe('已替换 2000 处');
      expect(editor.commands.undo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('a'.repeat(4000));
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('快速连续输入只提交最新重算（5 次输入合并为 1 次重算）', async () => {
    const { editor, controller, onRecompute } = openAndQuery(typical100Model());
    try {
      controller.open('find');
      onRecompute.mockClear();
      controller.setQuery('a');
      controller.setQuery('ab');
      controller.setQuery('abc');
      controller.setQuery('abcd');
      controller.setQuery('abc');
      await flush();
      expect(onRecompute).toHaveBeenCalledTimes(1);
      const snapshot = controller.getSnapshot();
      expect(snapshot.query).toBe('abc');
      expect(snapshot.matches).toHaveLength(100);
      expect(snapshot.matches.every((match) => match.matchedText === 'abc')).toBe(true);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });
});

/* ======================= 泄漏观察 ======================= */

describe('WP6：泄漏观察（第 8.8 节；重复订阅 / 装饰清理 / 控制台）', () => {
  it('反复开关面板 20 次：无重复订阅（每次状态变化恰好通知 1 次）', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksOf(onRecompute);
    const editor = createSearchEditor(modelOf([paragraph('abc abc')]), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });
    try {
      for (let cycle = 0; cycle < 20; cycle += 1) {
        controller.open('find');
        controller.setQuery('abc');
        await flush();
        expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
        expect(editor.view.dom.querySelectorAll('.wenshu-search-current')).toHaveLength(1);
        controller.close();
        expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
      }
      // 20 个周期后：重新打开 + 输入 + 重算，每次状态变化仍恰好触发一次通知（无重复订阅累积）
      const before = notifications;
      controller.open('find');
      expect(notifications).toBe(before + 1);
      controller.setQuery('xyz');
      expect(notifications).toBe(before + 2);
      await flush();
      expect(notifications).toBe(before + 3);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('两个 DOCX 标签切换 20 次：面板/查询稳定、单一输入、无控制台错误、无明显堆增长', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDesktopApp();
    const heapBefore = process.memoryUsage().heapUsed;
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByText('打开文件夹')[0] as HTMLButtonElement);
    });
    await openFileFromTree('a.docx');
    await openPanelAndQuery('abc');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '文件面板' }));
    });
    await openFileFromTree('b.docx');
    await openPanelAndQuery('def');

    for (let step = 0; step < 20; step += 1) {
      const target = step % 2 === 0 ? 'a.docx' : 'b.docx';
      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: new RegExp(target.replace('.', '\\.')) }));
      });
      await act(async () => {});
      // 每个活动标签的查询与匹配数稳定（不串线、不重复订阅导致重复渲染错误）
      const expected = target === 'a.docx' ? 'abc' : 'def';
      const inputs = screen.getAllByLabelText('查找内容');
      expect(inputs).toHaveLength(1);
      expect((inputs[0] as HTMLInputElement).value).toBe(expected);
    }
    const heapAfter = process.memoryUsage().heapUsed;
    console.log(
      '[TASK-010-WP6-perf] 20 tab switches heapUsed delta: ' +
        ((heapAfter - heapBefore) / 1024 / 1024).toFixed(1) +
        'MB (GC 噪声，仅观察)',
    );
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/* ======================= App 冒烟小夹具 ======================= */

function mockDesktopApp(): void {
  (window as unknown as Record<string, unknown>).desktop = {
    runtime: { platform: 'win32', electronVersion: '99.9.9', appVersion: '0.1.0-alpha.1' },
    workspace: {
      open: vi.fn(async () => ({
        status: 'selected',
        workspace: {
          rootName: 'ws',
          rootPath: '/ws',
          entries: [
            { relativePath: 'a.docx', name: 'a.docx', kind: 'file' },
            { relativePath: 'b.docx', name: 'b.docx', kind: 'file' },
          ],
        },
      })),
      refresh: vi.fn(async () => ({ status: 'not-open' })),
      createText: vi.fn(),
      createDocx: vi.fn(),
      createDirectory: vi.fn(),
      reveal: vi.fn(),
      relocate: vi.fn(),
      trash: vi.fn(),
    },
    document: {
      readText: vi.fn(async () => ({
        status: 'error',
        error: { code: 'NOT_FOUND', message: '文件不存在' },
      })),
      saveText: vi.fn(async () => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入失败' },
      })),
      readDocx: vi.fn(async (relativePath: string) => ({
        status: 'loaded',
        document: {
          kind: 'docx',
          name: relativePath.split('/').pop() ?? relativePath,
          relativePath,
          revision: 'rev-' + relativePath,
          size: 10,
          model: modelOf([paragraph(relativePath.startsWith('a') ? 'abc abc' : 'def def')]),
          compatibility: { level: 'supported', warnings: [] },
        },
      })),
      saveDocx: vi.fn(async () => ({
        status: 'error',
        error: { code: 'WRITE_FAILED', message: '写入失败' },
      })),
      saveTextAs: vi.fn(),
      saveDocxAs: vi.fn(),
    },
    search: { textWorkspace: vi.fn(), cancelTextWorkspace: vi.fn() },
    window: {
      setDirtyState: vi.fn(),
      requestClose: vi.fn(),
      cancelClose: vi.fn(),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  };
}

async function openFileFromTree(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name }));
  });
  await act(async () => {});
  await act(async () => {});
}

function activeDocxEditor(): Editor | null {
  const dom = Array.from(document.querySelectorAll<HTMLElement>('.docx-editor')).find(
    (el) => el.closest('[hidden]') === null,
  );
  return (dom as (HTMLElement & { __wenshuEditor?: Editor }) | undefined)?.__wenshuEditor ?? null;
}

async function openPanelAndQuery(query: string): Promise<void> {
  const editor = activeDocxEditor();
  expect(editor).not.toBeNull();
  await act(async () => {});
  act(() => {
    fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true });
  });
  const input = screen.getByLabelText('查找内容') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: query } });
    await flush();
  });
}
