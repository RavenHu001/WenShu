// @vitest-environment jsdom
/**
 * TASK-010 WP3 DOCX 当前查找面板组件测试（任务第 8.7 节）。
 *
 * 用假 controls（实现 DocxCurrentSearchControls 窄接口）直接渲染
 * DocxCurrentSearchPanel：验证即时查询、计数/截断/输入错误、大小写、
 * 按钮与键盘导航、Escape 关闭与焦点恢复、WP3 替换区禁用与 read-only/degraded
 * 不可用原因、focusMode 聚焦。
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocxCurrentSearchPanel } from '../../src/renderer/components/search/DocxCurrentSearchPanel';
import type { DocxCurrentSearchControls } from '../../src/renderer/lib/docx-current-search-plugin';
import type { DocxCurrentSearchSnapshot } from '../../src/renderer/lib/docx-current-search-plugin';

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
});

function emptySnapshot(
  overrides: Partial<DocxCurrentSearchSnapshot> = {},
): DocxCurrentSearchSnapshot {
  return {
    open: true,
    query: '',
    replacement: '',
    caseSensitive: false,
    matches: [],
    currentIndex: null,
    truncated: false,
    validationError: null,
    generation: 0,
    ...overrides,
  };
}

interface FakeCalls {
  readonly open: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly setQuery: ReturnType<typeof vi.fn>;
  readonly setCaseSensitive: ReturnType<typeof vi.fn>;
  readonly selectNext: ReturnType<typeof vi.fn>;
  readonly selectPrevious: ReturnType<typeof vi.fn>;
  readonly focusEditor: ReturnType<typeof vi.fn>;
}

interface FakeHarness {
  readonly controls: DocxCurrentSearchControls;
  readonly calls: FakeCalls;
  readonly getSnapshot: () => DocxCurrentSearchSnapshot;
  readonly setSnapshot: (snapshot: DocxCurrentSearchSnapshot) => void;
}

function fakeControls(initial: DocxCurrentSearchSnapshot): FakeHarness {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const calls: FakeCalls = {
    open: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    setCaseSensitive: vi.fn(),
    selectNext: vi.fn(),
    selectPrevious: vi.fn(),
    focusEditor: vi.fn(),
  };
  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  const controls: DocxCurrentSearchControls = {
    tabId: 'tab-1',
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: (mode) => {
      calls.open(mode);
      snapshot = { ...snapshot, open: true };
      emit();
    },
    close: () => {
      calls.close();
      snapshot = { ...snapshot, open: false };
      emit();
    },
    setQuery: (query) => {
      calls.setQuery(query);
      snapshot = { ...snapshot, query };
      emit();
    },
    setCaseSensitive: (value) => {
      calls.setCaseSensitive(value);
      snapshot = { ...snapshot, caseSensitive: value };
      emit();
    },
    selectNext: () => {
      calls.selectNext();
    },
    selectPrevious: () => {
      calls.selectPrevious();
    },
    focusEditor: () => {
      calls.focusEditor();
    },
  };
  return {
    controls,
    calls,
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      snapshot = next;
      emit();
    },
  };
}

function match(from: number, to: number, pmFrom: number, pmTo: number) {
  return { from, to, matchedText: 'x', blockOrdinal: 0, pmFrom, pmTo };
}

function renderPanel(
  harness: FakeHarness,
  options: { replaceReason?: string; focusMode?: 'find' | 'replace' | null } = {},
): void {
  render(
    <DocxCurrentSearchPanel
      controls={harness.controls}
      replaceAvailability={{
        available: false,
        reason: options.replaceReason ?? '替换功能将在后续版本提供',
      }}
      focusMode={options.focusMode ?? null}
    />,
  );
}

describe('WP3：DOCX 当前查找面板组件（第 8.7 节）', () => {
  it('查询输入受控自快照：输入即调用 setQuery 并即时反映', () => {
    const harness = fakeControls(emptySnapshot());
    renderPanel(harness);
    const input = screen.getByLabelText('查找内容') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(harness.calls.setQuery).toHaveBeenCalledWith('abc');
    expect(input.value).toBe('abc');
  });

  it('计数：无匹配/当前序号/截断提示/输入错误', () => {
    const harness = fakeControls(
      emptySnapshot({
        matches: [match(0, 3, 1, 4), match(4, 7, 5, 8), match(8, 11, 9, 12)],
        currentIndex: 1,
      }),
    );
    renderPanel(harness);
    expect(screen.getByText('第 2 / 3 处')).toBeDefined();

    act(() => harness.setSnapshot(emptySnapshot()));
    expect(screen.getByText('无匹配')).toBeDefined();

    act(() =>
      harness.setSnapshot(
        emptySnapshot({
          matches: [match(0, 3, 1, 4), match(4, 7, 5, 8)],
          currentIndex: 1,
          truncated: true,
        }),
      ),
    );
    expect(screen.getByText('第 2 / 2 处（匹配超过 2000 处）')).toBeDefined();

    act(() => harness.setSnapshot(emptySnapshot({ validationError: '查询不能包含换行' })));
    expect(screen.getByText('查询不能包含换行')).toBeDefined();
    expect(screen.queryByText('无匹配')).toBeNull();
  });

  it('大小写开关与上一/下一按钮；无匹配时按钮禁用', () => {
    const harness = fakeControls(emptySnapshot({ matches: [match(0, 3, 1, 4)], currentIndex: 0 }));
    renderPanel(harness);
    fireEvent.click(screen.getByRole('checkbox', { name: /区分大小写/ }));
    expect(harness.calls.setCaseSensitive).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '上一个匹配' }));
    fireEvent.click(screen.getByRole('button', { name: '下一个匹配' }));
    expect(harness.calls.selectPrevious).toHaveBeenCalledTimes(1);
    expect(harness.calls.selectNext).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '上一个匹配' })).not.toHaveProperty('disabled', true);

    act(() => harness.setSnapshot(emptySnapshot()));
    expect(screen.getByRole('button', { name: '上一个匹配' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '下一个匹配' })).toHaveProperty('disabled', true);
  });

  it('键盘：Enter/Shift+Enter/F3/Shift+F3 导航，Escape 关闭并恢复编辑器焦点', () => {
    const harness = fakeControls(emptySnapshot({ matches: [match(0, 3, 1, 4)], currentIndex: 0 }));
    renderPanel(harness);
    const input = screen.getByLabelText('查找内容');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(harness.calls.selectNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(harness.calls.selectPrevious).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'F3' });
    expect(harness.calls.selectNext).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: 'F3', shiftKey: true });
    expect(harness.calls.selectPrevious).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(harness.calls.close).toHaveBeenCalledTimes(1);
    expect(harness.calls.focusEditor).toHaveBeenCalledTimes(1);
    // 关闭后面板卸载（快照 open=false）
    expect(screen.queryByLabelText('查找内容')).toBeNull();
  });

  it('focusMode=find 打开时聚焦查找输入框', () => {
    const harness = fakeControls(emptySnapshot());
    renderPanel(harness, { focusMode: 'find' });
    expect(document.activeElement).toBe(screen.getByLabelText('查找内容'));
  });

  it('WP3 替换区：输入与按钮禁用、显示不可用原因（read-only/degraded/默认）', () => {
    const harness = fakeControls(emptySnapshot());
    const reasons: readonly string[] = [
      '只读文档不支持替换',
      '文档包含不受支持内容，需先确认兼容性',
      '替换功能将在后续版本提供',
    ];
    for (const reason of reasons) {
      cleanup();
      renderPanel(harness, { replaceReason: reason });
      expect(screen.getByLabelText('替换为')).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: /替换当前项/ })).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: /全部替换/ })).toHaveProperty('disabled', true);
      expect(screen.getByText(reason)).toBeDefined();
    }
  });
});
