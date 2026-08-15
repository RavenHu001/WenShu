// @vitest-environment jsdom
/**
 * TASK-008 WP4 DocxEditorSessionHost 定位协议直接测试（任务第 8.6 节）。
 *
 * 覆盖：宿主从 ProseMirror 公开节点 API 生成同规则文本块投影并二次校验；
 * 投影偏移 → PM 位置映射（textblock 内容起点 + 块内 UTF-16 偏移，跨 run marks /
 * emoji 代理对）；二次校验拒绝（范围越界 / 匹配文本不符）时回报 stale 且不改选区；
 * 同一定位目标只应用一次（同对象 rerender 不重复抢焦点、不重复回报）；
 * applied / stale 回报携带正确 locateId。
 *
 * 说明：App 校验后、宿主应用前再次编辑的竞态由 App 层实时投影校验先行拦截
 * （见 result-locate-docx.test.tsx"匹配前正文插入"用例），宿主的同规则投影二次
 * 校验是同一校验链在编辑器侧的最后一道兜底；本文件直接验证该兜底行为。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { DocxEditorSessionHost } from '../../src/renderer/components/document/DocxEditorSessionHost';
import type { DocxDocumentModel, DocxDocumentSnapshot } from '../../src/shared/docx';
import { projectDocxModelSearchText } from '../../src/shared/docx-search-text';
import type { DocxDocumentTabState } from '../../src/renderer/lib/document-tabs';
import type { EditorLocateTarget } from '../../src/renderer/components/document/EditorSessionHost';

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

function tabOf(model: DocxDocumentModel): DocxDocumentTabState {
  const snapshot: DocxDocumentSnapshot = {
    kind: 'docx',
    name: 'doc.docx',
    relativePath: 'doc.docx',
    revision: 'rev-doc',
    size: 10,
    model,
    compatibility: { level: 'supported', warnings: [] },
  };
  return {
    kind: 'docx',
    id: 'doc.docx',
    relativePath: 'doc.docx',
    name: 'doc.docx',
    status: 'loaded-clean',
    document: snapshot,
    model,
    dirty: false,
    saving: false,
    error: null,
    compatibilityConfirmationRevision: null,
    lastBackupRelativePath: null,
  };
}

function targetOf(locateId: number, query: string): EditorLocateTarget {
  const from = PROJECTION.text.indexOf(query);
  return { locateId, from, to: from + query.length, matchedText: query };
}

function hostEditor(container: HTMLElement): Editor {
  const dom = container.querySelector<HTMLElement & { __wenshuEditor?: Editor }>('.docx-editor');
  if (dom === null || dom.__wenshuEditor === undefined) {
    throw new Error('docx editor not mounted');
  }
  return dom.__wenshuEditor;
}

function selectionText(editor: Editor): string {
  const { from, to } = editor.view.state.selection;
  return editor.view.state.doc.textBetween(from, to);
}

function renderHost(locateTarget: EditorLocateTarget | null): {
  readonly container: HTMLElement;
  readonly outcomeSpy: ReturnType<typeof vi.fn>;
  readonly rerender: (target: EditorLocateTarget | null) => void;
} {
  const outcomeSpy = vi.fn();
  const { container, rerender } = render(
    <DocxEditorSessionHost
      tab={tabOf(MODEL)}
      editable
      onContentChange={vi.fn()}
      onSaveRequest={vi.fn()}
      onEditorRegister={vi.fn()}
      {...(locateTarget !== null ? { locateTarget } : {})}
      onLocateOutcome={outcomeSpy}
    />,
  );
  return {
    container,
    outcomeSpy,
    rerender: (next) =>
      rerender(
        <DocxEditorSessionHost
          tab={tabOf(MODEL)}
          editable
          onContentChange={vi.fn()}
          onSaveRequest={vi.fn()}
          onEditorRegister={vi.fn()}
          {...(next !== null ? { locateTarget: next } : {})}
          onLocateOutcome={outcomeSpy}
        />,
      ),
  };
}

afterEach(() => {
  cleanup();
});

describe('DocxEditorSessionHost 定位协议（TASK-008 WP4，第 8.6 节）', () => {
  it('合法目标：宿主生成同规则投影、映射为 PM 位置并设置选区，回报 applied 携带 locateId', () => {
    const { container, outcomeSpy } = renderHost(targetOf(7, '嵌套项目'));
    expect(selectionText(hostEditor(container))).toBe('嵌套项目');
    expect(outcomeSpy).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).toHaveBeenCalledWith(7, 'applied');
  });

  it('跨 run marks 与 emoji 代理对的块内 UTF-16 偏移映射精确', () => {
    const first = renderHost(targetOf(1, '粗体与斜体'));
    expect(selectionText(hostEditor(first.container))).toBe('粗体与斜体');
    cleanup();
    const second = renderHost(targetOf(2, '🎉'));
    expect(selectionText(hostEditor(second.container))).toBe('🎉');
    expect(second.outcomeSpy).toHaveBeenCalledWith(2, 'applied');
  });

  it('二次校验拒绝（匹配文本不符）：不改选区，回报 stale 携带 locateId', () => {
    // 偏移合法但匹配文本与实际内容不符（等价于 App 校验后到宿主应用前发生编辑）
    const from = PROJECTION.text.indexOf('嵌套项目');
    const staleTarget: EditorLocateTarget = {
      locateId: 3,
      from,
      to: from + '嵌套项目'.length,
      matchedText: '不存在的文本',
    };
    const { container, outcomeSpy } = renderHost(staleTarget);
    expect(outcomeSpy).toHaveBeenCalledWith(3, 'stale');
    expect(selectionText(hostEditor(container))).toBe('');
  });

  it('范围越界 / 跨块映射失败：按过期处理，回报 stale，不设置选区', () => {
    const { container, outcomeSpy } = renderHost({
      locateId: 4,
      from: PROJECTION.text.length + 10,
      to: PROJECTION.text.length + 12,
      matchedText: 'xx',
    });
    expect(outcomeSpy).toHaveBeenCalledWith(4, 'stale');
    expect(selectionText(hostEditor(container))).toBe('');
  });

  it('同一定位目标只应用一次：同对象 rerender 不重复抢焦点、不重复回报', () => {
    const sameTarget = targetOf(5, '项目甲');
    const { container, outcomeSpy, rerender } = renderHost(sameTarget);
    const editor = hostEditor(container);
    expect(selectionText(editor)).toBe('项目甲');
    expect(outcomeSpy).toHaveBeenCalledTimes(1);

    // 人为移动选区后，用同一目标对象 rerender：不得重新应用、不得重复回报
    act(() => {
      editor.commands.setTextSelection(1);
    });
    rerender(sameTarget);
    act(() => {});
    expect(selectionText(editor)).not.toBe('项目甲');
    expect(outcomeSpy).toHaveBeenCalledTimes(1);
  });
});
