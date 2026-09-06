// @vitest-environment jsdom
/**
 * TASK-010 WP4 替换当前项 / 全部替换与模型预验证测试（任务第 8.4 / 8.5 节 + WP0 冻结）。
 *
 * 覆盖：单/跨同 marks/跨不同 marks 起点格式继承；空/短/长/中文/emoji 替换；
 * 段落/标题/列表结构保持；执行瞬间复验（stale 拒绝 0 dispatch）；read-only/未确认
 * 权限命令内拒绝；替换输入校验；逆序单 transaction 全部替换（无位置漂移、一次
 * undo/redo、update 计数=1）；每个匹配继承各自起点 marks；0 匹配无操作；
 * 2000/2001 预算；模型预算失败 0 dispatch；快速重复点击不重复应用；
 * 替换结果仍含查询时安全重算、不递归重复执行。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor, Extension, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { DOCX_MAX_MODEL_SERIALIZED_BYTES, type DocxDocumentModel } from '../../src/shared/docx';
import { docxModelToTiptapJson, tiptapJsonToDocxModel } from '../../src/shared/docx-convert';
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

const editors: Editor[] = [];
const controllers: DocxCurrentSearchController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

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

function createSearchEditor(
  model: DocxDocumentModel,
  hooks: CurrentSearchPluginHooks,
  editable = true,
): Editor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = new Editor({
    element: container,
    extensions: [
      ...DOCX_EDITOR_EXTENSIONS,
      Extension.create({
        name: 'wp4-current-search-host',
        addProseMirrorPlugins() {
          return [createCurrentSearchPlugin(hooks)];
        },
      }),
    ],
    content: docxModelToTiptapJson(model) as unknown as Content,
    editable,
  });
  editors.push(editor);
  return editor;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 公开 API 提取当前文档的文本节点序列（text + mark 类型名）。 */
function textRunsOf(editor: Editor): readonly { text: string; marks: string[] }[] {
  const runs: { text: string; marks: string[] }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      runs.push({ text: node.text ?? '', marks: node.marks.map((mark) => mark.type.name) });
    }
    return true;
  });
  return runs;
}

interface Host {
  readonly editor: Editor;
  readonly controller: DocxCurrentSearchController;
  readonly updates: () => number;
}

/** 打开面板并完成一次查询（flush 重算）。 */
async function hostWithQuery(
  model: DocxDocumentModel,
  query: string,
  options: { readonly editable?: boolean; readonly replaceEnabled?: boolean } = {},
): Promise<Host> {
  const onRecompute = vi.fn();
  const hooks: CurrentSearchPluginHooks = { onStateChange: null, onRecompute };
  const editor = createSearchEditor(model, hooks, options.editable ?? true);
  const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
  controllers.push(controller);
  controller.setReplaceEnabled(options.replaceEnabled ?? true);
  let updates = 0;
  editor.on('update', () => {
    updates += 1;
  });
  controller.open('find');
  controller.setQuery(query);
  await flush();
  return { editor, controller, updates: () => updates };
}

function currentMessage(controller: DocxCurrentSearchController): string | null {
  return controller.getSnapshot().operationMessage;
}

describe('WP4：替换当前项（第 8.4 节）', () => {
  it('单 run 替换：短/长/中文/emoji/组合字符，一次 undo/redo，操作反馈', async () => {
    const { editor, controller } = await hostWithQuery(modelOf([paragraph('A')]), 'A');
    controller.setReplacement('中😀e\u0301');
    controller.replaceCurrent();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('中😀e\u0301');
    expect(currentMessage(controller)).toBe('已替换 1 处');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('A');
    expect(editor.commands.redo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('中😀e\u0301');
    // 替换走普通可撤销编辑事务：模型可转换
    expect(tiptapJsonToDocxModel(editor.getJSON()).status).toBe('ok');
  });

  it('跨不同 marks run：替换继承匹配起点 marks，未匹配格式保持', async () => {
    const model = modelOf([
      {
        kind: 'paragraph',
        alignment: null,
        runs: [
          { text: 'AB', marks: [{ type: 'bold' }] },
          { text: 'CD', marks: [] },
          { text: 'EF', marks: [{ type: 'italic' }] },
        ],
      },
    ]);
    const { editor, controller } = await hostWithQuery(model, 'BCD');
    controller.setReplacement('XY');
    controller.replaceCurrent();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('AXYEF');
    const runs = textRunsOf(editor);
    expect(
      runs
        .filter((run) => run.marks.includes('bold'))
        .map((run) => run.text)
        .join(''),
    ).toBe('AXY');
    expect(
      runs
        .filter((run) => run.marks.includes('italic'))
        .map((run) => run.text)
        .join(''),
    ).toBe('EF');
  });

  it('空替换 = 删除；标题结构与周围文字保持', async () => {
    const model = modelOf([
      { kind: 'heading', level: 2, runs: [{ text: '章节XYZ', marks: [] }] },
      paragraph('abcXYZdef'),
    ]);
    const { editor, controller } = await hostWithQuery(model, 'XYZ');
    controller.setReplacement('');
    controller.replaceCurrent();
    await flush();
    const converted = tiptapJsonToDocxModel(editor.getJSON());
    expect(converted.status).toBe('ok');
    if (converted.status === 'ok') {
      expect(converted.model.blocks[0]).toEqual({
        kind: 'heading',
        level: 2,
        runs: [{ text: '章节', marks: [] }],
      });
      expect(converted.model.blocks[1]).toEqual({
        kind: 'paragraph',
        alignment: null,
        runs: [{ text: 'abcXYZdef', marks: [] }],
      });
    }
  });

  it('执行瞬间复验：范围已失效（先编辑后替换）→ 拒绝且 0 dispatch', async () => {
    const { editor, controller, updates } = await hostWithQuery(modelOf([paragraph('abc')]), 'b');
    editor.view.dispatch(editor.view.state.tr.insertText('X', 1));
    const beforeUpdates = updates();
    controller.replaceCurrent();
    expect(currentMessage(controller)).toBe('匹配已过期，请重新搜索');
    expect(updates()).toBe(beforeUpdates);
    expect(editor.view.state.doc.textContent).toBe('Xabc');
  });

  it('权限命令内拒绝：read-only（editor 不可编辑）与 replaceEnabled=false 均 0 dispatch', async () => {
    const readOnly = await hostWithQuery(modelOf([paragraph('abc')]), 'b', {
      editable: false,
      replaceEnabled: false,
    });
    readOnly.controller.setReplacement('X');
    readOnly.controller.replaceCurrent();
    expect(currentMessage(readOnly.controller)).toBe('当前文档不可替换');
    expect(readOnly.editor.view.state.doc.textContent).toBe('abc');

    // editor 可编辑但权限未确认（degraded 未确认等价）：同样命令内拒绝
    const unconfirmed = await hostWithQuery(modelOf([paragraph('abc')]), 'b', {
      editable: true,
      replaceEnabled: false,
    });
    unconfirmed.controller.setReplacement('X');
    unconfirmed.controller.replaceCurrent();
    expect(currentMessage(unconfirmed.controller)).toBe('当前文档不可替换');
    expect(unconfirmed.editor.view.state.doc.textContent).toBe('abc');
  });

  it('替换输入校验：含换行拒绝且 0 dispatch', async () => {
    const { editor, controller, updates } = await hostWithQuery(modelOf([paragraph('abc')]), 'b');
    controller.setReplacement('x\ny');
    const before = updates();
    controller.replaceCurrent();
    expect(currentMessage(controller)).toBe('替换不能包含换行');
    expect(updates()).toBe(before);
    expect(editor.view.state.doc.textContent).toBe('abc');
  });
});

describe('WP4：全部替换（第 8.5 节）', () => {
  it('逆序单 transaction：不同长度替换无位置漂移，一次 undo/redo，update 计数=1', async () => {
    const { editor, controller, updates } = await hostWithQuery(
      modelOf([paragraph('aaZZaa')]),
      'aa',
    );
    controller.setReplacement('XY');
    controller.replaceAll();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('XYZZXY');
    expect(updates()).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('aaZZaa');
    expect(editor.commands.redo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('XYZZXY');
  });

  it('每个匹配继承各自起点 marks（同查询命中不同格式上下文）', async () => {
    const model = modelOf([
      {
        kind: 'paragraph',
        alignment: null,
        runs: [
          { text: 'x', marks: [{ type: 'bold' }] },
          { text: 'x', marks: [] },
          { text: 'x', marks: [{ type: 'italic' }] },
        ],
      },
    ]);
    const { editor, controller } = await hostWithQuery(model, 'x');
    controller.setReplacement('Y');
    controller.replaceAll();
    await flush();
    const runs = textRunsOf(editor);
    expect(runs.map((run) => run.text)).toEqual(['Y', 'Y', 'Y']);
    expect(runs.map((run) => run.marks)).toEqual([['bold'], [], ['italic']]);
  });

  it('段落/标题/列表结构保持（空替换删除全部匹配）', async () => {
    const model = modelOf([
      { kind: 'heading', level: 2, runs: [{ text: '章节XYZ', marks: [] }] },
      paragraph('abcXYZdef'),
      {
        kind: 'bullet-list',
        level: 0,
        blocks: [paragraph('项XYZ项')],
      },
    ]);
    const { editor, controller } = await hostWithQuery(model, 'XYZ');
    controller.setReplacement('');
    controller.replaceAll();
    await flush();
    const converted = tiptapJsonToDocxModel(editor.getJSON());
    expect(converted.status).toBe('ok');
    if (converted.status === 'ok') {
      const blocks = converted.model.blocks;
      // Tiptap TrailingNode（WP0 F2）：列表结尾追加空段落
      expect(blocks).toHaveLength(4);
      expect(blocks[0]).toEqual({ kind: 'heading', level: 2, runs: [{ text: '章节', marks: [] }] });
      expect(blocks[1]).toEqual({
        kind: 'paragraph',
        alignment: null,
        runs: [{ text: 'abcdef', marks: [] }],
      });
      expect(blocks[2]).toEqual({
        kind: 'bullet-list',
        level: 0,
        blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text: '项项', marks: [] }] }],
      });
    }
  });

  it('0 匹配无操作：不 dispatch、不 dirty、不产生成功假提示', async () => {
    const { editor, controller, updates } = await hostWithQuery(
      modelOf([paragraph('hello')]),
      'zzz',
    );
    controller.setReplacement('x');
    const before = updates();
    controller.replaceAll();
    expect(updates()).toBe(before);
    expect(editor.view.state.doc.textContent).toBe('hello');
    expect(currentMessage(controller)).toBeNull();
  });

  it('2000 项允许；2001+ 截断整体拒绝（0 部分替换）', async () => {
    const { editor, controller, updates } = await hostWithQuery(
      modelOf([paragraph('a'.repeat(4000) + 'x')]),
      'aa',
    );
    controller.setReplacement('b');
    controller.replaceAll();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('b'.repeat(2000) + 'x');
    expect(updates()).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.view.state.doc.textContent).toBe('a'.repeat(4000) + 'x');

    // 第 2001 个匹配：全部替换整体拒绝
    const over = await hostWithQuery(modelOf([paragraph('a'.repeat(4000))]), 'a');
    over.controller.setReplacement('b');
    const beforeOver = over.updates();
    over.controller.replaceAll();
    expect(currentMessage(over.controller)).toBe('匹配超过 2000 处，全部替换已被禁用');
    expect(over.updates()).toBe(beforeOver);
    expect(over.editor.view.state.doc.textContent).toBe('a'.repeat(4000));
    // Bulk editing in jsdom is a behavioral check, not a 5 s performance budget.
  }, 15_000);

  it('快速重复点击不重复应用：第二次无匹配 → 无操作', async () => {
    const { editor, controller, updates } = await hostWithQuery(modelOf([paragraph('aaa')]), 'a');
    controller.setReplacement('b');
    controller.replaceAll();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('bbb');
    expect(updates()).toBe(1);
    controller.replaceAll();
    await flush();
    expect(editor.view.state.doc.textContent).toBe('bbb');
    expect(updates()).toBe(1);
  });

  it('替换结果仍含查询时安全重算，不递归重复执行', async () => {
    const { editor, controller, updates } = await hostWithQuery(modelOf([paragraph('a')]), 'a');
    controller.setReplacement('aa');
    controller.replaceAll();
    await flush();
    // 只 dispatch 一次；重算后新 doc 中仍有 2 个匹配，但命令不会自动递归
    expect(editor.view.state.doc.textContent).toBe('aa');
    expect(updates()).toBe(1);
    expect(controller.getSnapshot().matches).toHaveLength(2);
  });

  it('替换结果仍匹配查询时，当前项前进到替换区间之后的下一处', async () => {
    const { editor, controller, updates } = await hostWithQuery(
      modelOf([paragraph('foo foo')]),
      'foo',
    );
    controller.setReplacement('Foo');
    controller.replaceCurrent();
    await flush();

    expect(editor.view.state.doc.textContent).toBe('Foo foo');
    expect(updates()).toBe(1);
    const snapshot = controller.getSnapshot();
    expect(snapshot.matches).toHaveLength(2);
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.matches[snapshot.currentIndex!]!.pmFrom).toBe(5);
  });

  it(
    '模型预算失败：接近序列化上限文档的替换候选超限 → 0 dispatch、0 dirty',
    { timeout: 60_000 },
    async () => {
      const blocks: DocxDocumentModel['blocks'][number][] = [];
      const runText = 'a'.repeat(4096);
      // 2013 段 × 4096 字符 ≈ 8,386,188 序列化字节（上限 8,388,608，余量 < 4096）
      for (let index = 0; index < 2013; index += 1) {
        blocks.push({ kind: 'paragraph', alignment: null, runs: [{ text: runText, marks: [] }] });
      }
      const serializedBytes = new TextEncoder().encode(JSON.stringify(modelOf(blocks))).byteLength;
      expect(serializedBytes).toBeLessThan(DOCX_MAX_MODEL_SERIALIZED_BYTES);
      expect(DOCX_MAX_MODEL_SERIALIZED_BYTES - serializedBytes).toBeLessThan(4096);
      const { editor, controller, updates } = await hostWithQuery(modelOf(blocks), 'aa');
      // 替换输入上限内（4096）的替换也会使候选序列化超限
      controller.setReplacement('b'.repeat(4096));
      const beforeLength = editor.view.state.doc.textContent.length;
      const beforeUpdates = updates();
      controller.replaceCurrent();
      expect(currentMessage(controller)).toBe('替换结果超出文档模型预算或结构无效，已取消');
      expect(updates()).toBe(beforeUpdates);
      expect(editor.view.state.doc.textContent.length).toBe(beforeLength);
    },
  );
});
