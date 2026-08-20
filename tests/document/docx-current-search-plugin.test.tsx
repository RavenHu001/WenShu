// @vitest-environment jsdom
/**
 * TASK-010 WP2 ProseMirror current-search 插件/controller 测试（任务第 8.3 节 + WP0 调度结论）。
 *
 * ## 覆盖
 *
 * - 插件状态/PluginKey/DecorationSet：初始态、open/setQuery 后普通+当前匹配装饰的范围
 *   与 class、打开/关闭面板不修改正文、不 dirty、不进撤销历史；
 * - 循环导航：next/previous 环绕、TextSelection 选区、滚动/聚焦（可编辑与 read-only）；
 * - 编辑后重算（含单事务多步骤只重算一次）、外部 setContent 安全重算（旧计算不回报）、
 *   快速连续输入只采用最新结果（微任务合并）、关闭时编辑不重算、选区变化不重算；
 * - 多 editor 隔离（隐藏非活动 editor 不因其他标签更新而重算）；
 * - 销毁清理：controller/editor destroy 后无悬空监听、无回报、无异常。
 *
 * 本文件全部在测试宿主中注册插件/controller；不接 SearchSidebar/App，
 * 不实现替换 transaction。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor, Extension, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextSelection } from '@tiptap/pm/state';
import type { DocxDocumentModel } from '../../src/shared/docx';
import { docxModelToTiptapJson } from '../../src/shared/docx-convert';
import {
  CURRENT_SEARCH_CURRENT_CLASS,
  CURRENT_SEARCH_MATCH_CLASS,
  DocxCurrentSearchController,
  createCurrentSearchPlugin,
  currentSearchPluginKey,
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
});

/** 与产品 DOCX_EDITOR_EXTENSIONS 相同的扩展链（link 输入关闭）。 */
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

function modelOf(text: string): DocxDocumentModel {
  return {
    schemaVersion: 1,
    blocks: [paragraph(text)],
  };
}

function hooksWith(onRecompute: ReturnType<typeof vi.fn>): CurrentSearchPluginHooks {
  return { onStateChange: null, onRecompute };
}

/** 创建带 current-search 插件的真实 Tiptap 编辑器（测试宿主）。 */
function createSearchEditor(
  model: DocxDocumentModel,
  hooks: CurrentSearchPluginHooks,
  editable = true,
): Editor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Editor({
    element: container,
    extensions: [
      ...DOCX_EDITOR_EXTENSIONS,
      Extension.create({
        name: 'wp2-current-search-host',
        addProseMirrorPlugins() {
          return [createCurrentSearchPlugin(hooks)];
        },
      }),
    ],
    content: docxModelToTiptapJson(model) as unknown as Content,
    editable,
  });
}

/** 等待微任务合并后的重算完成（macrotask 保证 queueMicrotask 已执行）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 等待一帧（Tiptap focus 命令经 RAF 延迟调用，WP0 F7）。 */
function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function matchRanges(editor: Editor): readonly (readonly [number, number])[] {
  const state = currentSearchPluginKey.getState(editor.view.state)!;
  return state.matches.map((match) => [match.pmFrom, match.pmTo] as const);
}

/* ======================= 插件状态、快照与装饰 ======================= */

describe('WP2：插件状态、快照与装饰（第 8.3 节）', () => {
  it('初始状态：closed、空匹配、无装饰、不修改正文、无历史步骤', () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      const snapshot = controller.getSnapshot();
      expect(snapshot.open).toBe(false);
      expect(snapshot.query).toBe('');
      expect(snapshot.matches).toEqual([]);
      expect(snapshot.currentIndex).toBeNull();
      expect(snapshot.truncated).toBe(false);
      expect(snapshot.validationError).toBeNull();
      expect(snapshot.generation).toBe(0);
      const state = currentSearchPluginKey.getState(editor.view.state)!;
      expect(state.decorations.find()).toHaveLength(0);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
      expect(editor.view.state.doc.textContent).toBe('abc');
      expect(editor.commands.undo()).toBe(false);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('open + setQuery：普通/当前匹配装饰的范围与 class 正确，查找不 dirty、不进撤销历史', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      const snapshot = controller.getSnapshot();
      expect(snapshot.open).toBe(true);
      expect(snapshot.query).toBe('abc');
      expect(snapshot.matches).toHaveLength(2);
      expect(snapshot.currentIndex).toBe(0);
      expect(snapshot.truncated).toBe(false);
      expect(snapshot.validationError).toBeNull();
      expect(matchRanges(editor)).toEqual([
        [1, 4],
        [5, 8],
      ]);
      const state = currentSearchPluginKey.getState(editor.view.state)!;
      expect(state.decorations.find()).toHaveLength(2);
      const spans = editor.view.dom.querySelectorAll('.wenshu-search-match');
      expect(spans).toHaveLength(2);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-current')).toHaveLength(1);
      expect(spans[0]!.className).toBe(
        CURRENT_SEARCH_MATCH_CLASS + ' ' + CURRENT_SEARCH_CURRENT_CLASS,
      );
      expect(spans[1]!.className).toBe(CURRENT_SEARCH_MATCH_CLASS);
      // 查找不修改正文、不产生历史步骤
      expect(editor.view.state.doc.textContent).toBe('abc abc');
      expect(editor.commands.undo()).toBe(false);
      // 重算确实发生且只提交一次（open+setQuery 合并到同一个 tick）
      expect(onRecompute).toHaveBeenCalledTimes(1);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('大小写与输入校验：切换 case 与换行查询触发安全重算/清空', async () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('ABC abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      expect(controller.getSnapshot().matches).toHaveLength(2);
      controller.setCaseSensitive(true);
      await flush();
      expect(controller.getSnapshot().matches).toHaveLength(1);
      controller.setQuery('a\nb');
      await flush();
      const snapshot = controller.getSnapshot();
      expect(snapshot.validationError).toBe('查询不能包含换行');
      expect(snapshot.matches).toHaveLength(0);
      expect(currentSearchPluginKey.getState(editor.view.state)!.decorations.find()).toHaveLength(
        0,
      );
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
      expect(editor.view.state.doc.textContent).toBe('ABC abc');
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('close 移除装饰但保留查询/选项；reopen 恢复装饰并重算', async () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
      controller.close();
      const closed = controller.getSnapshot();
      expect(closed.open).toBe(false);
      expect(closed.query).toBe('abc');
      expect(closed.matches).toHaveLength(2);
      expect(currentSearchPluginKey.getState(editor.view.state)!.decorations.find()).toHaveLength(
        0,
      );
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
      expect(editor.view.state.doc.textContent).toBe('abc abc');
      controller.open('find');
      await flush();
      expect(controller.getSnapshot().open).toBe(true);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
      expect(controller.getSnapshot().matches).toHaveLength(2);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });
});

/* ======================= 循环导航、选区与焦点 ======================= */

describe('WP2：循环导航、选区与焦点（第 8.3 节）', () => {
  it('next/previous 循环导航：选区与当前装饰跟随，正文与历史不变', async () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('abc abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      expect(controller.getSnapshot().currentIndex).toBe(0);
      const selectedText = (): string => {
        const { from, to } = editor.view.state.selection;
        return editor.view.state.doc.textBetween(from, to);
      };
      controller.selectNext();
      expect(controller.getSnapshot().currentIndex).toBe(1);
      expect(selectedText()).toBe('abc');
      controller.selectNext();
      expect(controller.getSnapshot().currentIndex).toBe(2);
      controller.selectNext();
      expect(controller.getSnapshot().currentIndex).toBe(0);
      expect(selectedText()).toBe('abc');
      controller.selectPrevious();
      expect(controller.getSnapshot().currentIndex).toBe(2);
      expect(selectedText()).toBe('abc');
      // 当前装饰始终唯一
      expect(editor.view.dom.querySelectorAll('.wenshu-search-current')).toHaveLength(1);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(3);
      // 导航不修改正文、不进撤销历史
      expect(editor.view.state.doc.textContent).toBe('abc abc abc');
      expect(editor.commands.undo()).toBe(false);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('可编辑编辑器：导航后选区精确命中并聚焦（RAF 后）', async () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      controller.selectNext();
      await raf();
      const snapshot = controller.getSnapshot();
      expect(snapshot.currentIndex).toBe(1);
      const match = snapshot.matches[1]!;
      expect(editor.view.state.selection.from).toBe(match.pmFrom);
      expect(editor.view.state.selection.to).toBe(match.pmTo);
      expect(editor.view.state.doc.textBetween(match.pmFrom, match.pmTo)).toBe('abc');
      expect(editor.view.hasFocus()).toBe(true);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('read-only：装饰与选区/滚动可应用，focus 为安全 no-op，正文不变', async () => {
    const hooks = hooksWith(vi.fn());
    const editor = createSearchEditor(modelOf('abc abc'), hooks, false);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      expect(editor.isEditable).toBe(false);
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
      controller.selectNext();
      await raf();
      const snapshot = controller.getSnapshot();
      expect(snapshot.currentIndex).toBe(1);
      const match = snapshot.matches[1]!;
      expect(editor.view.state.doc.textBetween(match.pmFrom, match.pmTo)).toBe('abc');
      // 只读视图不获得 DOM 焦点（WP0 F7），但选区/滚动可定位
      expect(editor.view.hasFocus()).toBe(false);
      expect(editor.view.state.doc.textContent).toBe('abc abc');
      expect(editor.commands.undo()).toBe(false);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });
});

/* ======================= 编辑后重算、setContent 与快速查询 ======================= */

describe('WP2：重算调度（编辑后/setContent/快速输入，第 4.10 节）', () => {
  it('编辑事务后重算：匹配与当前项按最近锚点更新；单事务多步骤只重算一次', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('b');
      await flush();
      expect(controller.getSnapshot().matches).toHaveLength(1);
      expect(controller.getSnapshot().currentIndex).toBe(0);
      onRecompute.mockClear();
      // 单事务两个插入步骤：段尾插入 b（pos 4）再段首插入 x（pos 1）→ doc xabcb
      const tr = editor.view.state.tr.insertText('b', 4).insertText('x', 1);
      editor.view.dispatch(tr);
      await flush();
      expect(onRecompute).toHaveBeenCalledTimes(1);
      const snapshot = controller.getSnapshot();
      expect(snapshot.matches.map((m) => m.pmFrom)).toEqual([3, 5]);
      // 旧当前位置（pmFrom 2）之后最近的匹配仍为第一个 b（pmFrom 3）
      expect(snapshot.currentIndex).toBe(0);
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(2);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('快速连续输入：微任务合并只提交最新结果（最后一次查询生效）', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('a');
      controller.setQuery('ab');
      controller.setQuery('abc');
      await flush();
      expect(onRecompute).toHaveBeenCalledTimes(1);
      const snapshot = controller.getSnapshot();
      expect(snapshot.matches).toHaveLength(2);
      expect(snapshot.matches.every((match) => match.matchedText === 'abc')).toBe(true);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('外部 setContent：安全重算，旧结果不回报（含调度在途时 setContent）', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      // 在重算微任务运行前执行外部 setContent（emitUpdate:false，与产品宿主一致）
      editor.commands.setContent(docxModelToTiptapJson(modelOf('xyz abc')) as unknown as Content, {
        emitUpdate: false,
      });
      await flush();
      const snapshot = controller.getSnapshot();
      expect(snapshot.matches).toHaveLength(1);
      expect(snapshot.matches[0]!.pmFrom).toBe(5);
      expect(snapshot.matches[0]!.pmTo).toBe(8);
      expect(snapshot.matches[0]!.matchedText).toBe('abc');
      expect(editor.view.state.doc.textContent).toBe('xyz abc');
      expect(editor.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(1);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('面板关闭时编辑不重算，且过期匹配被清空', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      onRecompute.mockClear();
      controller.close();
      editor.view.dispatch(editor.view.state.tr.insertText('x', 1));
      await flush();
      expect(onRecompute).not.toHaveBeenCalled();
      const snapshot = controller.getSnapshot();
      expect(snapshot.matches).toHaveLength(0);
      expect(currentSearchPluginKey.getState(editor.view.state)!.decorations.find()).toHaveLength(
        0,
      );
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('纯选区变化不触发重算', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      onRecompute.mockClear();
      editor.view.dispatch(
        editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 2)),
      );
      await flush();
      expect(onRecompute).not.toHaveBeenCalled();
      expect(controller.getSnapshot().matches).toHaveLength(2);
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });
});

/* ======================= 多 editor 隔离与销毁 ======================= */

describe('WP2：多 editor 隔离与销毁清理（第 5.4 节）', () => {
  it('多 editor 隔离：一个标签的查找/重算不影响其他 editor（含隐藏非活动场景）', async () => {
    const onRecomputeA = vi.fn();
    const hooksA = hooksWith(onRecomputeA);
    const hooksB = hooksWith(vi.fn());
    const editorA = createSearchEditor(modelOf('abc abc'), hooksA);
    const editorB = createSearchEditor(modelOf('def def'), hooksB);
    const controllerA = new DocxCurrentSearchController('tab-a', editorA, hooksA);
    const controllerB = new DocxCurrentSearchController('tab-b', editorB, hooksB);
    const listenerB = vi.fn();
    controllerB.subscribe(listenerB);
    try {
      controllerA.open('find');
      controllerA.setQuery('abc');
      await flush();
      expect(controllerA.getSnapshot().matches).toHaveLength(2);
      // B 完全不受影响：初始 closed、无匹配、无装饰、无通知
      expect(controllerB.getSnapshot().open).toBe(false);
      expect(controllerB.getSnapshot().matches).toHaveLength(0);
      expect(editorB.view.dom.querySelectorAll('.wenshu-search-match')).toHaveLength(0);
      expect(listenerB).not.toHaveBeenCalled();
      // A 的编辑触发 A 自己重算，但不会触发 B 的重算/通知
      onRecomputeA.mockClear();
      editorA.view.dispatch(editorA.view.state.tr.insertText('X', 1));
      await flush();
      expect(onRecomputeA).toHaveBeenCalledTimes(1);
      expect(listenerB).not.toHaveBeenCalled();
      expect(controllerB.getSnapshot().generation).toBe(0);
      expect(editorB.view.state.doc.textContent).toBe('def def');
    } finally {
      controllerA.destroy();
      controllerB.destroy();
      editorA.destroy();
      editorB.destroy();
    }
  });

  it('销毁：controller/editor destroy 后无悬空监听、无回报、无异常（含在途重算）', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    const listener = vi.fn();
    controller.subscribe(listener);
    try {
      controller.open('find');
      controller.setQuery('abc');
      // 销毁前清空同步产生的状态通知计数（open/setQuery 各一次，属正常通知）
      listener.mockClear();
      // 在重算微任务运行前销毁：在途计算必须静默丢弃
      controller.destroy();
      editor.destroy();
      await flush();
      expect(onRecompute).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(hooks.onStateChange).toBeNull();
      expect(hooks.onRecompute).toBeNull();
    } finally {
      controller.destroy();
      editor.destroy();
    }
  });

  it('controller.destroy 后调用不再 dispatch/通知；getSnapshot 返回最后快照', async () => {
    const onRecompute = vi.fn();
    const hooks = hooksWith(onRecompute);
    const editor = createSearchEditor(modelOf('abc abc'), hooks);
    const controller = new DocxCurrentSearchController('tab-1', editor, hooks);
    const listener = vi.fn();
    controller.subscribe(listener);
    try {
      controller.open('find');
      controller.setQuery('abc');
      await flush();
      const last = controller.getSnapshot();
      expect(last.matches).toHaveLength(2);
      listener.mockClear();
      onRecompute.mockClear();
      controller.destroy();
      controller.setQuery('zzz');
      controller.selectNext();
      await flush();
      expect(listener).not.toHaveBeenCalled();
      expect(onRecompute).not.toHaveBeenCalled();
      const after = controller.getSnapshot();
      expect(after.query).toBe('abc');
      expect(after.matches).toHaveLength(2);
      expect(editor.view.state.doc.textContent).toBe('abc abc');
    } finally {
      editor.destroy();
    }
  });
});
