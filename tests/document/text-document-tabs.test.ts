/**
 * 多 TXT 标签页第 5 节不变量的纯逻辑测试骨架 —— TASK-005 WP0。
 *
 * 本文件把第 5 节固定不变量写成可执行的纯逻辑断言：
 *
 * - 不变量 1：`tabs` 中 `id` 和 `relativePath` 唯一；
 * - 不变量 2：`tabs` 为空时 `activeTabId === null`；
 * - 不变量 3：`tabs` 非空时 `activeTabId` 必须引用现有标签；
 * - 不变量 4：`saving` 与 runtime 在途保存请求双向一致；
 * - 不变量 5：dirty 清除只来自与当前编辑修订匹配的成功保存；
 * - 不变量 6：异步结果提交前的"工作区会话 + 目标标签 + 请求编号"三重校验。
 *
 * 状态转移（打开、去重、激活、关闭、工作区失效）由 WP1 在 reducer 中实现，
 * 届时为每个转移补充"转移前后不变量保持"的测试；本骨架校验函数将作为那些
 * 测试的断言入口。
 */

import { describe, expect, it } from 'vitest';
import type {
  TabRuntimeMap,
  TextDocumentTabState,
  TextDocumentsUiState,
  TextTabRuntime,
} from '../../src/renderer/lib/text-document-tabs';
import {
  asyncResultStillValid,
  saveCompletionClearsDirty,
  validateTextDocumentsState,
} from '../../src/renderer/lib/text-document-tabs';

function tab(
  id: string,
  relativePath: string,
  overrides: Partial<Omit<TextDocumentTabState, 'id' | 'relativePath'>> = {},
): TextDocumentTabState {
  return {
    id,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    status: 'loaded-clean',
    document: null,
    content: '',
    dirty: false,
    saving: false,
    error: null,
    ...overrides,
  };
}

function state(
  tabs: readonly TextDocumentTabState[],
  activeTabId: string | null,
): TextDocumentsUiState {
  return { tabs, activeTabId };
}

function runtime(
  entries: ReadonlyArray<readonly [string, Partial<TextTabRuntime>]>,
): TabRuntimeMap {
  const map = new Map<string, TextTabRuntime>();
  for (const [tabId, overrides] of entries) {
    map.set(tabId, {
      editRevision: 0,
      readRequestId: 1,
      saveInFlight: false,
      latestContent: '',
      ...overrides,
    });
  }
  return map;
}

describe('不变量 1：id 与 relativePath 唯一', () => {
  it('合法状态：空集合不违反', () => {
    expect(validateTextDocumentsState(state([], null))).toEqual([]);
  });

  it('合法状态：单标签不违反', () => {
    const tabs = [tab('t1', 'a.txt')];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual([]);
  });

  it('合法状态：同名不同路径可以并存', () => {
    const tabs = [tab('t1', 'a.txt'), tab('t2', 'sub/a.txt')];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual([]);
  });

  it('id 重复时报告违反', () => {
    const tabs = [tab('t1', 'a.txt'), tab('t1', 'b.txt')];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual(['标签 id 重复: t1']);
  });

  it('relativePath 重复时报告违反（路径处于任意状态都不允许）', () => {
    const tabs = [tab('t1', 'a.txt'), tab('t2', 'a.txt', { status: 'loading' })];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual([
      '标签 relativePath 重复: a.txt',
    ]);
  });
});

describe('不变量 2：tabs 为空时 activeTabId === null', () => {
  it('合法状态：空集合且 activeTabId 为 null', () => {
    expect(validateTextDocumentsState(state([], null))).toEqual([]);
  });

  it('空集合但 activeTabId 非 null 时报告违反', () => {
    expect(validateTextDocumentsState(state([], 'ghost'))).toEqual([
      'tabs 为空时 activeTabId 必须为 null',
    ]);
  });
});

describe('不变量 3：activeTabId 必须引用现有标签', () => {
  it('合法状态：引用现有标签', () => {
    const tabs = [tab('t1', 'a.txt'), tab('t2', 'b.txt')];
    expect(validateTextDocumentsState(state(tabs, 't2'))).toEqual([]);
  });

  it('非空集合但 activeTabId 为 null 时报告违反', () => {
    const tabs = [tab('t1', 'a.txt')];
    expect(validateTextDocumentsState(state(tabs, null))).toEqual([
      'activeTabId null 未引用现有标签',
    ]);
  });

  it('引用不存在的 id 时报告违反', () => {
    const tabs = [tab('t1', 'a.txt')];
    expect(validateTextDocumentsState(state(tabs, 'ghost'))).toEqual([
      'activeTabId ghost 未引用现有标签',
    ]);
  });
});

describe('不变量 4：saving 与 runtime 在途保存请求双向一致', () => {
  it('合法状态：无 runtime 且无 saving', () => {
    const tabs = [tab('t1', 'a.txt')];
    expect(validateTextDocumentsState(state(tabs, 't1'), runtime([]))).toEqual([]);
  });

  it('合法状态：saving 标签与 runtime 在途保存一一对应', () => {
    const tabs = [tab('t1', 'a.txt'), tab('t2', 'b.txt', { status: 'saving', saving: true })];
    expect(
      validateTextDocumentsState(state(tabs, 't2'), runtime([['t2', { saveInFlight: true }]])),
    ).toEqual([]);
  });

  it('saving 但 runtime 不存在时报告违反', () => {
    const tabs = [tab('t1', 'a.txt', { status: 'saving', saving: true })];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual([
      '标签 t1 为 saving 但没有在途保存请求',
    ]);
  });

  it('saving 但 runtime 无在途保存时报告违反', () => {
    const tabs = [tab('t1', 'a.txt', { status: 'saving', saving: true })];
    expect(validateTextDocumentsState(state(tabs, 't1'), runtime([['t1', {}]]))).toEqual([
      '标签 t1 为 saving 但没有在途保存请求',
    ]);
  });

  it('非 saving 但 runtime 存在在途保存时报告违反', () => {
    const tabs = [tab('t1', 'a.txt')];
    expect(
      validateTextDocumentsState(state(tabs, 't1'), runtime([['t1', { saveInFlight: true }]])),
    ).toEqual(['标签 t1 非 saving 但 runtime 存在在途保存请求']);
  });

  it('runtime 在途保存引用不存在的标签时报告违反', () => {
    expect(
      validateTextDocumentsState(state([], null), runtime([['ghost', { saveInFlight: true }]])),
    ).toEqual(['runtime 在途保存引用了不存在的标签 ghost']);
  });
});

describe('状态形状', () => {
  it('非法 status 值报告违反（类型系统外数据的运行时防护）', () => {
    const tabs = [tab('t1', 'a.txt', { status: 'not-a-status' as never })];
    expect(validateTextDocumentsState(state(tabs, 't1'))).toEqual(['未知标签状态 not-a-status']);
  });
});

describe('不变量 5：dirty 清除只来自与当前编辑修订匹配的成功保存', () => {
  it('修订号匹配时允许清除 dirty', () => {
    expect(saveCompletionClearsDirty(3, 3)).toBe(true);
  });

  it('修订号不匹配（保存期间有新编辑）时禁止清除 dirty', () => {
    expect(saveCompletionClearsDirty(3, 4)).toBe(false);
  });
});

describe('不变量 6：异步结果提交前的三重有效性校验', () => {
  it('工作区会话、目标标签、请求编号全部有效时允许提交', () => {
    expect(
      asyncResultStillValid({
        workspaceSessionValid: true,
        tabExists: true,
        requestIdCurrent: true,
      }),
    ).toBe(true);
  });

  it('工作区会话已失效时拒绝提交', () => {
    expect(
      asyncResultStillValid({
        workspaceSessionValid: false,
        tabExists: true,
        requestIdCurrent: true,
      }),
    ).toBe(false);
  });

  it('目标标签已关闭时拒绝提交', () => {
    expect(
      asyncResultStillValid({
        workspaceSessionValid: true,
        tabExists: false,
        requestIdCurrent: true,
      }),
    ).toBe(false);
  });

  it('请求编号已过期时拒绝提交', () => {
    expect(
      asyncResultStillValid({
        workspaceSessionValid: true,
        tabExists: true,
        requestIdCurrent: false,
      }),
    ).toBe(false);
  });
});
