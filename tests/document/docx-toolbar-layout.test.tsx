// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DocxToolbar } from '../../src/renderer/components/document/DocxToolbar';

let resizeCallback: ResizeObserverCallback | null = null;
const originalResizeObserver = globalThis.ResizeObserver;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function resize(width: number): void {
  const callback = resizeCallback;
  if (callback === null) throw new Error('expected ResizeObserver callback');
  act(() => {
    callback([{ contentRect: { width } } as ResizeObserverEntry], new TestResizeObserver(callback));
  });
}

beforeEach(() => {
  globalThis.ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  cleanup();
  resizeCallback = null;
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('DocxToolbar responsive grouping', () => {
  it('groups history/character/style/list/alignment and moves lower-priority controls into overflow', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>正文</p>' });
    const view = render(<DocxToolbar editor={editor} disabled={false} />);
    expect(screen.getByRole('toolbar', { name: 'DOCX 格式工具栏' })).toBeDefined();
    expect(screen.getByLabelText('历史')).toBeDefined();
    expect(screen.getByLabelText('字符格式')).toBeDefined();
    expect(screen.getByLabelText('段落样式组')).toBeDefined();
    const wideExtras = document.querySelector<HTMLElement>('.docx-toolbar-extras');
    const overflow = document.querySelector<HTMLDetailsElement>('.docx-toolbar-overflow');
    expect(wideExtras?.hidden).toBe(false);
    expect(overflow?.hidden).toBe(true);
    expect(within(wideExtras!).getByLabelText('列表')).toBeDefined();
    expect(within(wideExtras!).getByLabelText('对齐')).toBeDefined();

    resize(620);
    expect(wideExtras?.hidden).toBe(true);
    expect(overflow?.hidden).toBe(false);
    fireEvent.click(within(overflow!).getByLabelText('更多格式'));
    expect(within(overflow!).getByLabelText('列表')).toBeDefined();
    expect(within(overflow!).getByLabelText('字号')).toBeDefined();

    view.unmount();
    editor.destroy();
  });

  it('keeps every icon command named and disabled when the document is unavailable', () => {
    render(<DocxToolbar editor={null} disabled />);
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '粗体' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: '段落样式' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
  });
});
