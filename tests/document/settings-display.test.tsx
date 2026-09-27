// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth, redoDepth } from '@codemirror/commands';
import type { Editor } from '@tiptap/core';
import { EditorSessionHost } from '../../src/renderer/components/document/EditorSessionHost';
import { DocxEditorSessionHost } from '../../src/renderer/components/document/DocxEditorSessionHost';
import { useEditorSessions } from '../../src/renderer/lib/use-editor-sessions';
import { applyDisplayPreferences } from '../../src/renderer/lib/use-app-settings';
import { defaultSettings } from '../../src/shared/app-state';
import type { DocxDocumentModel } from '../../src/shared/docx';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

function previewAll(): void {
  for (const theme of ['dark', 'light', 'system'] as const) {
    for (const txtFontPreset of ['system', 'monospace', 'serif'] as const) {
      applyDisplayPreferences({ ...defaultSettings(), theme, txtFontPreset, txtFontSizePx: 24 });
    }
  }
}
describe('WP2 display settings preserve live editor sessions', () => {
  it('preserves the exact CodeMirror state, selection, redo history and change notification count', () => {
    const changed = vi.fn();
    function Harness() {
      const sessions = useEditorSessions(['txt']);
      const [content, setContent] = useState('original');
      return (
        <EditorSessionHost
          tabId="txt"
          content={content}
          sessions={sessions}
          onContentChange={(value) => {
            changed(value);
            setContent(value);
          }}
          onSaveRequest={vi.fn()}
        />
      );
    }
    const rendered = render(<Harness />);
    const view = EditorView.findFromDOM(rendered.container.querySelector('.cm-content')!)!;
    act(() => {
      view.dispatch({ changes: { from: 8, insert: ' draft' } });
    });
    act(() => {
      undo(view);
      view.dispatch({ selection: { anchor: 1, head: 4 } });
    });
    const state = view.state;
    const count = changed.mock.calls.length;
    expect(redoDepth(state)).toBe(1);
    act(previewAll);
    rendered.rerender(<Harness />);
    expect(EditorView.findFromDOM(rendered.container.querySelector('.cm-content')!)).toBe(view);
    expect(view.state).toBe(state);
    expect(view.state.selection.main.from).toBe(1);
    expect(view.state.selection.main.to).toBe(4);
    expect([undoDepth(view.state), redoDepth(view.state)]).toEqual([0, 1]);
    expect(changed).toHaveBeenCalledTimes(count);
  });

  it('preserves DOCX model/color, selection, editor identity, history and dirty notifications', () => {
    const original: DocxDocumentModel = {
      schemaVersion: 1,
      blocks: [
        {
          kind: 'paragraph',
          alignment: null,
          runs: [{ text: 'original', marks: [{ type: 'color', value: '#B3261E' }] }],
        },
      ],
    };
    let editor: Editor | null = null;
    const changed = vi.fn();
    function Harness() {
      const [model, setModel] = useState(original);
      return (
        <DocxEditorSessionHost
          tab={{
            kind: 'docx',
            id: 'docx',
            name: 'test.docx',
            relativePath: 'test.docx',
            model,
            document: {
              kind: 'docx',
              model: original,
              name: 'test.docx',
              relativePath: 'test.docx',
              revision: 'one',
              size: 20,
              compatibility: { level: 'supported', warnings: [] },
            },
            dirty: model !== original,
            saving: false,
            status: 'loaded-clean',
            error: null,
            compatibilityConfirmationRevision: null,
            lastBackupRelativePath: null,
          }}
          editable
          onContentChange={(_id, value) => {
            changed(value);
            setModel(value);
          }}
          onSaveRequest={vi.fn()}
          onEditorRegister={(_id, value) => {
            editor = value;
          }}
        />
      );
    }
    const rendered = render(<Harness />);
    const active = editor! as Editor;
    act(() => {
      active.commands.insertContentAt(9, ' draft');
    });
    act(() => {
      active.commands.undo();
      active.commands.setTextSelection({ from: 2, to: 5 });
    });
    const state = active.state;
    const model = active.getJSON();
    const count = changed.mock.calls.length;
    expect(active.can().redo()).toBe(true);
    act(previewAll);
    rendered.rerender(<Harness />);
    expect(editor).toBe(active);
    expect(active.state).toBe(state);
    expect(active.getJSON()).toEqual(model);
    expect(active.state.selection.from).toBe(2);
    expect(active.state.selection.to).toBe(5);
    expect(active.can().redo()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(count);
    act(() => {
      active.commands.redo();
    });
    expect(active.getText()).toBe('original draft');
  });
});
