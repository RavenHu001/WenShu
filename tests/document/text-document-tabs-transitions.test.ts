/**
 * 多 TXT 标签页纯状态转移测试 —— TASK-005 WP1。
 *
 * 覆盖第 8.2 节要求的全部纯状态与不变量场景：
 *
 * - 首个标签、新标签追加和活动标签变化；
 * - 同一路径去重（含 loading 与 error 状态）、同名不同路径并存；
 * - 关闭非活动标签；关闭活动标签右侧优先、否则左侧、最后欢迎页；
 * - 不存在的 tabId 操作安全无效果；
 * - dirty / saving / error / conflict 只更新目标标签；
 * - 工作区失效一次清空全部标签和运行时元数据；
 * - 任意状态转移后保持第 5 节不变量（校验器断言）。
 *
 * 本文件只依赖纯状态模块，不接入 React、IPC 或 CodeMirror。
 */

import { describe, expect, it } from 'vitest';
import type { TextDocumentSnapshot } from '../../src/shared/document';
import type {
  TabRuntimeMap,
  TextDocumentTabState,
  TextTabsModel,
  TextTabRuntime,
} from '../../src/renderer/lib/text-document-tabs';
import {
  activeTab,
  activateTab,
  closeTab,
  createEmptyModel,
  dirtyTabCount,
  editTab,
  hasDirtyTabs,
  hasSavingTabs,
  invalidateWorkspace,
  openTab,
  tabById,
  updateTab,
  updateTabRuntime,
  validateTextTabsModel,
} from '../../src/renderer/lib/text-document-tabs';

function tab(
  id: string,
  overrides: Partial<Omit<TextDocumentTabState, 'id' | 'relativePath'>> = {},
): TextDocumentTabState {
  return {
    id,
    relativePath: id,
    name: id.split('/').pop() ?? id,
    status: 'loaded-clean',
    document: null,
    content: '',
    dirty: false,
    saving: false,
    error: null,
    ...overrides,
  };
}

function runtimeEntry(overrides: Partial<TextTabRuntime> = {}): TextTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 1,
    saveInFlight: false,
    latestContent: '',
    ...overrides,
  };
}

function model(
  tabs: readonly TextDocumentTabState[],
  activeTabId: string | null,
  runtime?: TabRuntimeMap,
): TextTabsModel {
  return { state: { tabs, activeTabId }, runtime: runtime ?? new Map() };
}

function snapshotFor(path: string): TextDocumentSnapshot {
  return {
    name: path.split('/').pop() ?? path,
    relativePath: path,
    content: 'disk',
    byteLength: 4,
    revision: 'a'.repeat(64),
    hasUtf8Bom: false,
    lineEnding: 'none',
  };
}

/** 断言模型满足第 5 节全部可校验不变量。 */
function expectValid(actual: TextTabsModel): void {
  expect(validateTextTabsModel(actual)).toEqual([]);
}

describe('WP1 打开与去重（第 8.2 节）', () => {
  it('首个标签：空模型打开后创建唯一的 loading 占位标签并激活', () => {
    const next = openTab(createEmptyModel(), 'a.txt');

    expect(next.state.tabs).toHaveLength(1);
    expect(next.state.activeTabId).toBe('a.txt');
    expect(next.state.tabs[0]).toMatchObject({
      id: 'a.txt',
      relativePath: 'a.txt',
      name: 'a.txt',
      status: 'loading',
      content: '',
      dirty: false,
      saving: false,
    });
    expectValid(next);
  });

  it('新标签追加到序列末尾并立即激活', () => {
    let next = openTab(createEmptyModel(), 'a.txt');
    next = openTab(next, 'b.txt');

    expect(next.state.tabs.map((item) => item.id)).toEqual(['a.txt', 'b.txt']);
    expect(next.state.activeTabId).toBe('b.txt');
    expectValid(next);
  });

  it('再次打开已打开路径只激活原标签，不创建第二会话', () => {
    let next = openTab(createEmptyModel(), 'a.txt');
    next = openTab(next, 'b.txt');

    const reference = next;
    expect(openTab(next, 'b.txt')).toBe(reference);
    expect(next.state.tabs).toHaveLength(2);
    expectValid(next);
  });

  it('路径处于 loading 时再次打开同样去重，且不重置原标签', () => {
    const initial = model(
      [tab('a.txt', { status: 'loading' }), tab('b.txt', { status: 'loading' })],
      'a.txt',
    );

    const next = openTab(initial, 'b.txt');

    expect(next.state.tabs.map((item) => item.id)).toEqual(['a.txt', 'b.txt']);
    expect(next.state.activeTabId).toBe('b.txt');
    expect(next.state.tabs[1]).toMatchObject({ status: 'loading', content: '' });
    expectValid(next);
  });

  it('路径处于错误状态时再次打开只激活原错误标签，不清除错误', () => {
    const readErrorTab = tab('a.txt', {
      status: 'read-error',
      error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
    });
    const initial = model([readErrorTab, tab('b.txt')], 'b.txt');

    const next = openTab(initial, 'a.txt');

    expect(next.state.tabs).toHaveLength(2);
    expect(next.state.activeTabId).toBe('a.txt');
    expect(next.state.tabs[0]).toEqual(readErrorTab);
    expectValid(next);
  });

  it('同名不同路径可以并存', () => {
    let next = openTab(createEmptyModel(), 'a.txt');
    next = openTab(next, 'sub/a.txt');

    expect(next.state.tabs.map((item) => item.relativePath)).toEqual(['a.txt', 'sub/a.txt']);
    expect(next.state.tabs.map((item) => item.name)).toEqual(['a.txt', 'a.txt']);
    expectValid(next);
  });
});

describe('WP1 活动标签（第 8.2 节）', () => {
  it('激活只改变活动标签，不改变标签顺序与各标签内容', () => {
    const a = tab('a.txt', { content: 'A', dirty: true, status: 'loaded-dirty' });
    const b = tab('b.txt', { content: 'B' });
    const initial = model([a, b], 'a.txt');

    const next = activateTab(initial, 'b.txt');

    expect(next.state.activeTabId).toBe('b.txt');
    expect(next.state.tabs).toEqual([a, b]);
    expectValid(next);
  });

  it('激活未知 id 安全无效果（返回原引用）', () => {
    const initial = model([tab('a.txt')], 'a.txt');
    expect(activateTab(initial, 'ghost')).toBe(initial);
  });

  it('激活已是活动标签无效果（返回原引用）', () => {
    const initial = model([tab('a.txt'), tab('b.txt')], 'a.txt');
    expect(activateTab(initial, 'a.txt')).toBe(initial);
  });

  it('标签切换不产生 dirty、不改变正文（选择器随动）', () => {
    const initial = model([tab('a.txt'), tab('b.txt')], 'a.txt');
    const next = activateTab(initial, 'b.txt');

    expect(activeTab(next)?.id).toBe('b.txt');
    expect(activeTab(initial)?.id).toBe('a.txt');
    expect(next.state.tabs.every((item) => !item.dirty)).toBe(true);
    expectValid(next);
  });
});

describe('WP1 关闭标签（第 8.2 节）', () => {
  it('关闭非活动标签不改变当前活动标签', () => {
    const initial = model([tab('a.txt'), tab('b.txt'), tab('c.txt')], 'a.txt');

    const next = closeTab(initial, 'b.txt');

    expect(next.state.tabs.map((item) => item.id)).toEqual(['a.txt', 'c.txt']);
    expect(next.state.activeTabId).toBe('a.txt');
    expectValid(next);
  });

  it('关闭活动标签优先激活其右侧标签', () => {
    const initial = model([tab('a.txt'), tab('b.txt'), tab('c.txt')], 'a.txt');

    expect(closeTab(initial, 'a.txt').state.activeTabId).toBe('b.txt');

    const middle = model([tab('a.txt'), tab('b.txt'), tab('c.txt')], 'b.txt');
    expect(closeTab(middle, 'b.txt').state.activeTabId).toBe('c.txt');
  });

  it('没有右侧标签时激活左侧标签', () => {
    const initial = model([tab('a.txt'), tab('b.txt'), tab('c.txt')], 'c.txt');

    const next = closeTab(initial, 'c.txt');

    expect(next.state.tabs.map((item) => item.id)).toEqual(['a.txt', 'b.txt']);
    expect(next.state.activeTabId).toBe('b.txt');
    expectValid(next);
  });

  it('关闭最后一个标签后回到欢迎页', () => {
    const initial = model([tab('a.txt')], 'a.txt');

    const next = closeTab(initial, 'a.txt');

    expect(next.state.tabs).toEqual([]);
    expect(next.state.activeTabId).toBeNull();
    expectValid(next);
  });

  it('关闭未知 id 安全无效果（返回原引用）', () => {
    const initial = model([tab('a.txt')], 'a.txt');
    expect(closeTab(initial, 'ghost')).toBe(initial);
  });

  it('关闭标签同时释放其运行时元数据', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry()],
      ['b.txt', runtimeEntry()],
    ]);
    const initial = model([tab('a.txt'), tab('b.txt')], 'a.txt', runtime);

    const next = closeTab(initial, 'b.txt');

    expect(next.runtime.has('a.txt')).toBe(true);
    expect(next.runtime.has('b.txt')).toBe(false);
    expectValid(next);
  });

  it('saving 标签禁止关闭（返回原引用，运行时保留）', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry({ saveInFlight: true })],
    ]);
    const initial = model([tab('a.txt', { status: 'saving', saving: true })], 'a.txt', runtime);

    expect(closeTab(initial, 'a.txt')).toBe(initial);
    expect(initial.state.tabs).toHaveLength(1);
    expect(initial.runtime.has('a.txt')).toBe(true);
    expectValid(initial);
  });
});

describe('WP1 目标标签更新只作用于目标标签（第 8.2 节）', () => {
  it('editTab 只更新目标标签的正文与 dirty，其他标签不受影响', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry()],
      ['b.txt', runtimeEntry()],
    ]);
    const initial = model(
      [
        tab('a.txt', { content: 'A' }),
        tab('b.txt', { content: 'B', dirty: true, status: 'loaded-dirty' }),
      ],
      'a.txt',
      runtime,
    );

    const next = editTab(initial, 'a.txt', 'A1');

    expect(next.state.tabs[0]).toMatchObject({
      relativePath: 'a.txt',
      content: 'A1',
      dirty: true,
      status: 'loaded-dirty',
    });
    expect(next.state.tabs[1]).toMatchObject({ content: 'B', dirty: true, status: 'loaded-dirty' });
    expect(next.runtime.get('a.txt')?.editRevision).toBe(1);
    expect(next.runtime.get('a.txt')?.latestContent).toBe('A1');
    expect(next.runtime.get('b.txt')?.editRevision).toBe(0);
    expectValid(next);
  });

  it('editTab 内容未变化时无操作（不递增修订、不标记 dirty）', () => {
    const runtime = new Map<string, TextTabRuntime>([['a.txt', runtimeEntry()]]);
    const initial = model([tab('a.txt', { content: 'A' })], 'a.txt', runtime);

    expect(editTab(initial, 'a.txt', 'A')).toBe(initial);
    expect(initial.runtime.get('a.txt')?.editRevision).toBe(0);
  });

  it('editTab 未知 id 或不可编辑状态安全无效果', () => {
    const loading = model([tab('a.txt', { status: 'loading' })], 'a.txt');
    expect(editTab(loading, 'a.txt', 'x')).toBe(loading);

    const readErrorNoDoc = model([tab('a.txt', { status: 'read-error' })], 'a.txt');
    expect(editTab(readErrorNoDoc, 'a.txt', 'x')).toBe(readErrorNoDoc);

    const unknown = model([tab('a.txt')], 'a.txt');
    expect(editTab(unknown, 'ghost', 'x')).toBe(unknown);
  });

  it('editTab 允许 read-error 但已有成功快照的标签继续编辑，并保留 read-error 状态', () => {
    const runtime = new Map<string, TextTabRuntime>([['a.txt', runtimeEntry()]]);
    const initial = model(
      [
        tab('a.txt', {
          status: 'read-error',
          document: snapshotFor('a.txt'),
          content: 'old',
          error: { code: 'NOT_FOUND', message: '文件不存在或已被移除' },
        }),
      ],
      'a.txt',
      runtime,
    );

    const next = editTab(initial, 'a.txt', 'new');

    expect(next.state.tabs[0]).toMatchObject({ status: 'read-error', content: 'new', dirty: true });
    expectValid(next);
  });

  it('editTab 在 save-error / conflict 状态下编辑：保留状态并清除错误', () => {
    for (const status of ['save-error', 'conflict'] as const) {
      const runtime = new Map<string, TextTabRuntime>([['a.txt', runtimeEntry()]]);
      const initial = model(
        [
          tab('a.txt', {
            status,
            content: 'old',
            dirty: true,
            error: { code: 'WRITE_FAILED', message: '写入文件失败' },
          }),
        ],
        'a.txt',
        runtime,
      );

      const next = editTab(initial, 'a.txt', 'new');

      expect(next.state.tabs[0]).toMatchObject({
        status,
        content: 'new',
        dirty: true,
        error: null,
      });
      expectValid(next);
    }
  });

  it('editTab 在 saving 状态允许编辑并保留 saving 状态', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry({ saveInFlight: true })],
    ]);
    const initial = model(
      [tab('a.txt', { status: 'saving', saving: true, content: 'old', dirty: true })],
      'a.txt',
      runtime,
    );

    const next = editTab(initial, 'a.txt', 'new');

    expect(next.state.tabs[0]).toMatchObject({ status: 'saving', saving: true, content: 'new' });
    expectValid(next);
  });

  it('updateTab 只更新目标标签（conflict 错误只落在目标标签）', () => {
    const initial = model([tab('a.txt'), tab('b.txt', { content: 'B' })], 'a.txt');

    const next = updateTab(initial, 'a.txt', (current) => ({
      ...current,
      status: 'conflict',
      dirty: true,
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    }));

    expect(next.state.tabs[0]).toMatchObject({
      status: 'conflict',
      dirty: true,
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    });
    expect(next.state.tabs[1]).toEqual(tab('b.txt', { content: 'B' }));
    expect(next.state.activeTabId).toBe('a.txt');
    expectValid(next);
  });

  it('updateTab 未知 id 或 updater 返回原引用时无操作', () => {
    const initial = model([tab('a.txt')], 'a.txt');
    expect(updateTab(initial, 'ghost', (current) => current)).toBe(initial);
    expect(updateTab(initial, 'a.txt', (current) => current)).toBe(initial);
  });

  it('updateTab 置 saving 与 updateTabRuntime 置 saveInFlight 后保持不变量 4', () => {
    const runtime = new Map<string, TextTabRuntime>([['a.txt', runtimeEntry()]]);
    let next = model([tab('a.txt')], 'a.txt', runtime);

    next = updateTab(next, 'a.txt', (current) => ({ ...current, status: 'saving', saving: true }));
    next = updateTabRuntime(next, 'a.txt', (entry) => ({ ...entry, saveInFlight: true }));

    expectValid(next);
  });

  it('updateTabRuntime 只更新目标标签，未知 id 无操作', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry({ saveInFlight: true })],
      ['b.txt', runtimeEntry()],
    ]);
    const initial = model(
      [tab('a.txt', { status: 'saving', saving: true }), tab('b.txt')],
      'a.txt',
      runtime,
    );

    const next = updateTabRuntime(initial, 'a.txt', (entry) => ({
      ...entry,
      readRequestId: 7,
      latestContent: 'X',
    }));

    expect(next.runtime.get('a.txt')).toMatchObject({
      readRequestId: 7,
      saveInFlight: true,
      latestContent: 'X',
    });
    expect(next.runtime.get('b.txt')).toEqual(runtimeEntry());
    expect(updateTabRuntime(initial, 'ghost', (entry) => entry)).toBe(initial);
    expectValid(next);
  });
});

describe('WP1 工作区失效（第 8.2 节）', () => {
  it('一次清空全部标签、活动标签与全部运行时元数据', () => {
    const runtime = new Map<string, TextTabRuntime>([
      ['a.txt', runtimeEntry({ saveInFlight: true })],
      ['b.txt', runtimeEntry({ editRevision: 3 })],
    ]);
    const initial = model(
      [
        tab('a.txt', { status: 'saving', saving: true }),
        tab('b.txt', { content: 'B', dirty: true, status: 'loaded-dirty' }),
      ],
      'a.txt',
      runtime,
    );

    const next = invalidateWorkspace();

    expect(next.state.tabs).toEqual([]);
    expect(next.state.activeTabId).toBeNull();
    expect(next.runtime.size).toBe(0);
    expect(initial.state.tabs).toHaveLength(2);
    expectValid(next);
  });
});

describe('WP1 选择器（第 8.2 节）', () => {
  it('activeTab / tabById 返回正确标签，缺失时返回 null', () => {
    const initial = model([tab('a.txt'), tab('b.txt')], 'b.txt');

    expect(activeTab(initial)?.id).toBe('b.txt');
    expect(tabById(initial, 'a.txt')?.id).toBe('a.txt');
    expect(tabById(initial, 'ghost')).toBeNull();

    expect(activeTab(model([], null))).toBeNull();
  });

  it('dirty 与 saving 聚合选择器', () => {
    const none = model([tab('a.txt'), tab('b.txt')], 'a.txt');
    expect(hasDirtyTabs(none)).toBe(false);
    expect(dirtyTabCount(none)).toBe(0);
    expect(hasSavingTabs(none)).toBe(false);

    const oneDirty = model(
      [tab('a.txt', { dirty: true, status: 'loaded-dirty' }), tab('b.txt')],
      'a.txt',
    );
    expect(hasDirtyTabs(oneDirty)).toBe(true);
    expect(dirtyTabCount(oneDirty)).toBe(1);

    const twoDirty = model(
      [
        tab('a.txt', { dirty: true, status: 'loaded-dirty' }),
        tab('b.txt', { dirty: true, status: 'loaded-dirty' }),
      ],
      'a.txt',
    );
    expect(dirtyTabCount(twoDirty)).toBe(2);

    const saving = model([tab('a.txt', { status: 'saving', saving: true })], 'a.txt');
    expect(hasSavingTabs(saving)).toBe(true);
  });
});

describe('WP1 不变量保持（第 8.2 节）', () => {
  it('连续转移链每步后均满足第 5 节不变量', () => {
    let next = createEmptyModel();
    expectValid(next);

    next = openTab(next, 'a.txt');
    expectValid(next);
    next = openTab(next, 'b.txt');
    expectValid(next);
    next = openTab(next, 'sub/a.txt');
    expectValid(next);

    next = activateTab(next, 'a.txt');
    expectValid(next);
    next = editTab(next, 'a.txt', '编辑');
    expectValid(next);

    next = updateTab(next, 'b.txt', (current) => ({
      ...current,
      status: 'conflict',
      dirty: true,
      error: { code: 'CONFLICT', message: '文件已被外部修改，保存被拒绝' },
    }));
    expectValid(next);

    next = closeTab(next, 'sub/a.txt');
    expectValid(next);
    next = closeTab(next, 'a.txt');
    expectValid(next);
    next = closeTab(next, 'b.txt');
    expectValid(next);

    expect(next.state.tabs).toEqual([]);
    expect(next.state.activeTabId).toBeNull();
    expectValid(next);
  });

  it('转移不修改入参（纯函数）', () => {
    const runtime = new Map<string, TextTabRuntime>([['a.txt', runtimeEntry()]]);
    const initial = model([tab('a.txt', { content: 'A' })], 'a.txt', runtime);
    const tabsBefore = initial.state.tabs;
    const runtimeBefore = initial.runtime;

    openTab(initial, 'b.txt');
    activateTab(initial, 'a.txt');
    editTab(initial, 'a.txt', 'X');
    closeTab(initial, 'a.txt');

    expect(initial.state.tabs).toBe(tabsBefore);
    expect(initial.state.activeTabId).toBe('a.txt');
    expect(initial.runtime).toBe(runtimeBefore);
    expect(initial.runtime.get('a.txt')).toEqual(runtimeEntry());
  });
});
