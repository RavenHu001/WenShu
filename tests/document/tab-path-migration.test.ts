/**
 * TASK-009 WP1：stable tabId 与纯路径迁移状态机测试。
 * 覆盖：单文件路径迁移、目录前缀迁移（段边界）、save-as 开始/完成/失败纯转移、
 * 批量关闭（删除后）、saving 阻止迁移、路径冲突拒绝、运行时/顺序/活动标签保持。
 * 全部为纯状态转移，不涉及文件系统 IPC。
 */

import { describe, expect, it } from 'vitest';
import { DOCX_MODEL_SCHEMA_VERSION, type DocxDocumentSnapshot } from '../../src/shared/docx';
import type { TextDocumentSnapshot } from '../../src/shared/document';
import {
  closeTabsByRelativePaths,
  completeSaveAs,
  createEmptyModel,
  editTab,
  failSaveAs,
  isDocxTab,
  migrateDescendantTabPaths,
  migrateTabPath,
  openDocxTab,
  openTab,
  startSaveAs,
  tabById,
  updateTab,
  validateDocumentTabsModel,
  type DocxDocumentTabState,
  type DocumentTabsModel,
  type DocumentTabRuntime,
} from '../../src/renderer/lib/document-tabs';
import type { TextDocumentTabState } from '../../src/renderer/lib/text-document-tabs';

/* ======================= 测试工具 ======================= */

function txtRuntime(overrides: Partial<DocumentTabRuntime> = {}): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 1,
    saveInFlight: false,
    latestContent: '',
    latestModel: null,
    ...overrides,
  };
}

function docxRuntime(overrides: Partial<DocumentTabRuntime> = {}): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 1,
    saveInFlight: false,
    latestContent: null,
    latestModel: { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: [] },
    ...overrides,
  };
}

function setRuntime(
  model: DocumentTabsModel,
  tabId: string,
  runtime: DocumentTabRuntime,
): DocumentTabsModel {
  const next = new Map(model.runtime);
  next.set(tabId, runtime);
  return { state: model.state, runtime: next };
}

function textSnapshotOf(revision: string, relativePath = 'a.txt'): TextDocumentSnapshot {
  return {
    name: relativePath.split('/').at(-1) ?? relativePath,
    relativePath,
    content: `内容 ${revision}`,
    byteLength: 10,
    revision,
    hasUtf8Bom: false,
    lineEnding: 'lf',
  };
}

function docxSnapshotOf(
  revision: string,
  relativePath = 'a.docx',
  overrides: Partial<DocxDocumentSnapshot> = {},
): DocxDocumentSnapshot {
  return {
    kind: 'docx',
    name: relativePath.split('/').at(-1) ?? relativePath,
    relativePath,
    revision,
    size: 10,
    model: {
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [
        { kind: 'paragraph', alignment: null, runs: [{ text: `基线 ${revision}`, marks: [] }] },
      ],
    },
    compatibility: { level: 'supported', warnings: [] },
    ...overrides,
  };
}

/** 打开并加载一个 TXT 标签（stable tabId；同路径已存在时只激活）。 */
function loadedTxtTab(
  model: DocumentTabsModel,
  tabId: string,
  relativePath: string,
  content = 'hello',
): DocumentTabsModel {
  let next = openTab(model, relativePath, tabId);
  next = setRuntime(next, tabId, txtRuntime({ latestContent: content }));
  next = updateTab(next, tabId, (target) => {
    if (isDocxTab(target)) {
      return target;
    }
    return {
      ...target,
      status: 'loaded-clean',
      document: textSnapshotOf('r1', relativePath),
      content,
    };
  });
  return next;
}

/** 打开并加载一个 DOCX 标签（stable tabId；同路径已存在时只激活）。 */
function loadedDocxTab(
  model: DocumentTabsModel,
  tabId: string,
  relativePath: string,
  overrides: Partial<DocxDocumentSnapshot> = {},
): DocumentTabsModel {
  let next = openDocxTab(model, relativePath, tabId);
  next = setRuntime(next, tabId, docxRuntime());
  const snapshot = docxSnapshotOf('r1', relativePath, overrides);
  next = updateTab(next, tabId, (target) => {
    if (!isDocxTab(target)) {
      return target;
    }
    return {
      ...target,
      status: 'loaded-clean',
      document: snapshot,
      model: snapshot.model,
    };
  });
  return next;
}

describe('单文件路径迁移（migrateTabPath）', () => {
  it('TXT：只改 relativePath/name 与基线快照，id/顺序/活动/dirty/运行时保持', () => {
    const tabId = 't1';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt', 'hello');
    model = editTab(model, tabId, 'hello-edited'); // dirty + editRevision 1
    const runtimeBefore = model.runtime.get(tabId);
    const migrated = migrateTabPath(model, tabId, 'sub/b.txt');
    const tab = tabById(migrated, tabId) as TextDocumentTabState;
    expect(tab.relativePath).toBe('sub/b.txt');
    expect(tab.name).toBe('b.txt');
    expect(tab.id).toBe(tabId);
    expect(tab.dirty).toBe(true);
    expect(tab.content).toBe('hello-edited');
    expect(tab.document?.relativePath).toBe('sub/b.txt');
    expect(tab.document?.name).toBe('b.txt');
    expect(tab.document?.revision).toBe('r1');
    expect(migrated.state.activeTabId).toBe(tabId);
    expect(migrated.state.tabs).toHaveLength(1);
    expect(migrated.runtime.get(tabId)).toBe(runtimeBefore);
    expect(validateDocumentTabsModel(migrated)).toEqual([]);
  });

  it('DOCX：伴随备份路径跟随主文档；从未保存（无备份）保持 null', () => {
    const tabId = 't2';
    let model = loadedDocxTab(
      openDocxTab(createEmptyModel(), 'dir/a.docx', tabId),
      tabId,
      'dir/a.docx',
    );
    // 模拟一次保存后的备份提示
    model = updateTab(model, tabId, (target) => ({
      ...target,
      lastBackupRelativePath: 'dir/a.docx.wenshu.bak',
    }));
    const migrated = migrateTabPath(model, tabId, 'dir2/A.docx');
    const tab = tabById(migrated, tabId) as DocxDocumentTabState;
    expect(tab.relativePath).toBe('dir2/A.docx');
    expect(tab.lastBackupRelativePath).toBe('dir2/A.docx.wenshu.bak');
    expect(tab.document?.relativePath).toBe('dir2/A.docx');
    expect(validateDocumentTabsModel(migrated)).toEqual([]);

    const tabId2 = 't3';
    const neverSaved = loadedDocxTab(
      openDocxTab(createEmptyModel(), 'x.docx', tabId2),
      tabId2,
      'x.docx',
    );
    const migrated2 = migrateTabPath(neverSaved, tabId2, 'y.docx');
    const tab2 = tabById(migrated2, tabId2) as DocxDocumentTabState;
    expect(tab2.lastBackupRelativePath).toBeNull();
  });

  it('目标路径已被其他标签占用 → 整次拒绝', () => {
    const a = 't1';
    const b = 't2';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', a), a, 'a.txt');
    model = loadedTxtTab(model, b, 'b.txt');
    const before = model;
    const migrated = migrateTabPath(model, a, 'b.txt');
    expect(migrated).toBe(before);
  });

  it('目标标签正在保存 → 整次拒绝（防止在途保存写回旧路径）', () => {
    const tabId = 't1';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt');
    model = updateTab(model, tabId, (target) => ({ ...target, status: 'saving', saving: true }));
    model = setRuntime(model, tabId, txtRuntime({ saveInFlight: true, latestContent: 'hello' }));
    const before = model;
    expect(migrateTabPath(model, tabId, 'b.txt')).toBe(before);
  });

  it('未知 id 与同路径为安全无操作', () => {
    const tabId = 't1';
    const model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt');
    expect(migrateTabPath(model, 'missing', 'b.txt')).toBe(model);
    expect(migrateTabPath(model, tabId, 'a.txt')).toBe(model);
  });
});

describe('目录前缀迁移（migrateDescendantTabPaths）', () => {
  function threeTabs(): {
    model: DocumentTabsModel;
    ids: { ab: string; ab2: string; aTxt: string };
  } {
    const ids = { ab: 't1', ab2: 't2', aTxt: 't3' } as const;
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a/b/c.txt', ids.ab), ids.ab, 'a/b/c.txt');
    model = loadedTxtTab(model, ids.ab2, 'a/b2.txt');
    model = loadedTxtTab(model, ids.aTxt, 'a.txt');
    return { model, ids };
  }

  it('段边界：a/b 迁移自身与后代，a/b2 与 a.txt 不误命中；顺序/活动/运行时保持', () => {
    const { model, ids } = threeTabs();
    const runtimeBefore = model.runtime;
    const migrated = migrateDescendantTabPaths(model, 'a/b', 'm');
    expect(migrated.state.tabs.map((t) => t.relativePath)).toEqual([
      'm/c.txt',
      'a/b2.txt',
      'a.txt',
    ]);
    expect(migrated.state.tabs.map((t) => t.id)).toEqual([ids.ab, ids.ab2, ids.aTxt]);
    expect(migrated.state.activeTabId).toBe(ids.aTxt); // 原活动标签（a.txt）保持
    expect(migrated.runtime).toBe(runtimeBefore);
    const moved = tabById(migrated, ids.ab) as TextDocumentTabState;
    expect(moved.document?.relativePath).toBe('m/c.txt');
    expect(moved.document?.name).toBe('c.txt');
    expect(validateDocumentTabsModel(migrated)).toEqual([]);
  });

  it('目录自身（精确前缀）也迁移；后代可迁移到工作区根（toPrefix 空串）', () => {
    // 目录自身作为精确前缀匹配（理论上目录不会成为标签，纯函数仍按规则处理）
    const ids = { d: 't1', f: 't2' } as const;
    let model = loadedTxtTab(openTab(createEmptyModel(), 'd', ids.d), ids.d, 'd', 'dir-content');
    model = loadedTxtTab(model, ids.f, 'd/f.txt');
    const migrated = migrateDescendantTabPaths(model, 'd', 'm');
    expect(migrated.state.tabs.map((t) => t.relativePath)).toEqual(['m', 'm/f.txt']);
    expect(tabById(migrated, ids.d)?.name).toBe('m');
    expect(validateDocumentTabsModel(migrated)).toEqual([]);

    // 后代迁移到根：d/f.txt → f.txt
    const ids2 = { f: 't3' };
    const rootModel = loadedTxtTab(
      openTab(createEmptyModel(), 'd/f.txt', ids2.f),
      ids2.f,
      'd/f.txt',
    );
    const toRoot = migrateDescendantTabPaths(rootModel, 'd', '');
    expect(toRoot.state.tabs.map((t) => t.relativePath)).toEqual(['f.txt']);
    expect(tabById(toRoot, ids2.f)?.name).toBe('f.txt');
    expect(validateDocumentTabsModel(toRoot)).toEqual([]);
  });

  it('任一受影响标签正在保存 → 整次迁移无操作（不部分迁移）', () => {
    const { model, ids } = threeTabs();
    let savingModel = updateTab(model, ids.ab, (target) => ({
      ...target,
      status: 'saving',
      saving: true,
    }));
    savingModel = setRuntime(
      savingModel,
      ids.ab,
      txtRuntime({ saveInFlight: true, latestContent: 'x' }),
    );
    expect(migrateDescendantTabPaths(savingModel, 'a/b', 'm')).toBe(savingModel);
  });

  it('迁移后路径冲突（目标已被其他标签占用）→ 整次拒绝', () => {
    const ids = { a: 't1', m: 't2' } as const;
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a/b.txt', ids.a), ids.a, 'a/b.txt');
    model = loadedTxtTab(model, ids.m, 'm/b.txt');
    expect(migrateDescendantTabPaths(model, 'a', 'm')).toBe(model);
  });

  it('无受影响标签为安全无操作', () => {
    const tabId = 't1';
    const model = loadedTxtTab(openTab(createEmptyModel(), 'x.txt', tabId), tabId, 'x.txt');
    expect(migrateDescendantTabPaths(model, 'no-such', 'm')).toBe(model);
  });
});

describe('批量关闭（closeTabsByRelativePaths）', () => {
  function threeTabs(): { model: DocumentTabsModel; ids: { a: string; b: string; c: string } } {
    const ids = { a: 't1', b: 't2', c: 't3' } as const;
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', ids.a), ids.a, 'a.txt');
    model = loadedTxtTab(model, ids.b, 'b.txt');
    model = loadedTxtTab(model, ids.c, 'c/d.txt');
    return { model, ids };
  }

  it('按精确相对路径关闭；运行时释放；无关标签与活动标签保持', () => {
    const { model, ids } = threeTabs();
    const closed = closeTabsByRelativePaths(model, ['b.txt', 'c/d.txt']);
    expect(closed.state.tabs.map((t) => t.relativePath)).toEqual(['a.txt']);
    expect(closed.state.activeTabId).toBe(ids.a);
    expect(closed.runtime.has(ids.a)).toBe(true);
    expect(closed.runtime.has(ids.b)).toBe(false);
    expect(closed.runtime.has(ids.c)).toBe(false);
    expect(validateDocumentTabsModel(closed)).toEqual([]);
  });

  it('关闭活动标签后按 closeTab 规则激活邻居', () => {
    const { model, ids } = threeTabs();
    const closed = closeTabsByRelativePaths(model, ['a.txt', 'b.txt']);
    expect(closed.state.tabs.map((t) => t.relativePath)).toEqual(['c/d.txt']);
    expect(closed.state.activeTabId).toBe(ids.c);
  });

  it('saving 标签跳过（防御；删除前 controller 已阻止）', () => {
    const { model, ids } = threeTabs();
    let savingModel = updateTab(model, ids.b, (target) => ({
      ...target,
      status: 'saving',
      saving: true,
    }));
    savingModel = setRuntime(
      savingModel,
      ids.b,
      txtRuntime({ saveInFlight: true, latestContent: 'x' }),
    );
    const closed = closeTabsByRelativePaths(savingModel, ['a.txt', 'b.txt']);
    expect(closed.state.tabs.map((t) => t.relativePath)).toEqual(['b.txt', 'c/d.txt']);
    expect(validateDocumentTabsModel(closed)).toEqual([]);
  });

  it('空列表与未知路径为安全无操作', () => {
    const { model } = threeTabs();
    expect(closeTabsByRelativePaths(model, [])).toBe(model);
    expect(closeTabsByRelativePaths(model, ['missing.txt'])).toBe(model);
  });
});

describe('save-as 纯转移（startSaveAs / completeSaveAs / failSaveAs）', () => {
  it('TXT：start → 成功完成：迁移到新路径、基线替换、dirty 清除、saving 释放', () => {
    const tabId = 't1';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt', 'hello');
    model = editTab(model, tabId, 'hello-v2'); // dirty
    const started = startSaveAs(model, tabId);
    const saving = tabById(started, tabId) as TextDocumentTabState;
    expect(saving.saving).toBe(true);
    expect(saving.status).toBe('saving');
    expect(started.runtime.get(tabId)?.saveInFlight).toBe(true);

    const captured = started.runtime.get(tabId)!.editRevision; // 1
    const completed = completeSaveAs(
      started,
      tabId,
      captured,
      'sub/b.txt',
      textSnapshotOf('r2', 'sub/b.txt'),
    );
    const tab = tabById(completed, tabId) as TextDocumentTabState;
    expect(tab.status).toBe('loaded-clean');
    expect(tab.saving).toBe(false);
    expect(tab.dirty).toBe(false);
    expect(tab.relativePath).toBe('sub/b.txt');
    expect(tab.name).toBe('b.txt');
    expect(tab.document?.revision).toBe('r2');
    expect(tab.document?.relativePath).toBe('sub/b.txt');
    expect(completed.runtime.get(tabId)?.saveInFlight).toBe(false);
    expect(completed.state.activeTabId).toBe(tabId);
    expect(validateDocumentTabsModel(completed)).toEqual([]);
  });

  it('TXT：保存期间继续编辑 → 完成保留新内容与 dirty（不变量 9 语义）', () => {
    const tabId = 't1';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt', 'v1');
    model = editTab(model, tabId, 'v2');
    const started = startSaveAs(model, tabId);
    const captured = started.runtime.get(tabId)!.editRevision; // 1
    const during = editTab(started, tabId, 'v3'); // editRevision 2
    const completed = completeSaveAs(
      during,
      tabId,
      captured,
      'b.txt',
      textSnapshotOf('r2', 'b.txt'),
    );
    const tab = tabById(completed, tabId) as TextDocumentTabState;
    expect(tab.status).toBe('loaded-dirty');
    expect(tab.dirty).toBe(true);
    expect(tab.content).toBe('v3');
    expect(tab.relativePath).toBe('b.txt');
    expect(tab.document?.revision).toBe('r2');
  });

  it('DOCX：完成时模型替换、确认重置、备份提示取返回路径', () => {
    const tabId = 't2';
    const model = loadedDocxTab(
      openDocxTab(createEmptyModel(), 'dir/a.docx', tabId),
      tabId,
      'dir/a.docx',
    );
    const started = startSaveAs(model, tabId);
    const completed = completeSaveAs(
      started,
      tabId,
      started.runtime.get(tabId)!.editRevision,
      'dir2/b.docx',
      docxSnapshotOf('r2', 'dir2/b.docx'),
      'dir2/b.docx.wenshu.bak',
    );
    const tab = tabById(completed, tabId) as DocxDocumentTabState;
    expect(tab.status).toBe('loaded-clean');
    expect(tab.relativePath).toBe('dir2/b.docx');
    expect(tab.document?.revision).toBe('r2');
    expect(tab.lastBackupRelativePath).toBe('dir2/b.docx.wenshu.bak');
    expect(tab.compatibilityConfirmationRevision).toBeNull();
    expect(completed.runtime.get(tabId)?.saveInFlight).toBe(false);
    expect(validateDocumentTabsModel(completed)).toEqual([]);
  });

  it('startSaveAs 门禁：loading / read-only / 已在保存 / save-error / 无快照均拒绝', () => {
    // loading
    const loading = openDocxTab(createEmptyModel(), 'a.docx', 't1');
    expect(startSaveAs(loading, 't1')).toBe(loading);
    // 无快照（loading 标签 + runtime）
    const noSnap = setRuntime(loading, 't1', docxRuntime());
    expect(startSaveAs(noSnap, 't1')).toBe(noSnap);
    // read-only
    const ro = loadedDocxTab(openDocxTab(createEmptyModel(), 'r.docx', 't2'), 't2', 'r.docx', {
      compatibility: {
        level: 'read-only',
        warnings: [{ code: 'encrypted-protected', message: 'x' }],
      },
    });
    const roTab = tabById(ro, 't2');
    if (roTab !== null) {
      const roModel = updateTab(ro, 't2', (target) => {
        if (!isDocxTab(target)) {
          return target;
        }
        return { ...target, status: 'read-only' };
      });
      expect(startSaveAs(roModel, 't2')).toBe(roModel);
    }
    // save-error
    const se = loadedTxtTab(openTab(createEmptyModel(), 'e.txt', 't3'), 't3', 'e.txt');
    const seModel = updateTab(se, 't3', (target) => ({
      ...target,
      status: 'save-error',
      dirty: true,
      error: { code: 'WRITE_FAILED', message: 'x' },
    }));
    expect(startSaveAs(seModel, 't3')).toBe(seModel);
    // 已在保存
    const busy = loadedTxtTab(openTab(createEmptyModel(), 'b.txt', 't4'), 't4', 'b.txt');
    const busyModel = updateTab(busy, 't4', (target) => ({
      ...target,
      status: 'saving',
      saving: true,
    }));
    const busyWithRuntime = setRuntime(
      busyModel,
      't4',
      txtRuntime({ saveInFlight: true, latestContent: 'x' }),
    );
    expect(startSaveAs(busyWithRuntime, 't4')).toBe(busyWithRuntime);
  });

  it('DOCX degraded 未确认的 save-as → COMPATIBILITY_CONFIRMATION_REQUIRED（不绕过确认）', () => {
    const tabId = 't5';
    const model = loadedDocxTab(openDocxTab(createEmptyModel(), 'd.docx', tabId), tabId, 'd.docx', {
      compatibility: { level: 'degraded', warnings: [{ code: 'image', message: 'x' }] },
    });
    const started = startSaveAs(model, tabId);
    const tab = tabById(started, tabId) as DocxDocumentTabState;
    expect(tab.status).toBe('save-error');
    expect(tab.error?.code).toBe('COMPATIBILITY_CONFIRMATION_REQUIRED');
    expect(tab.saving).toBe(false);
    expect(started.runtime.get(tabId)?.saveInFlight).toBe(false);
  });

  it('failSaveAs：回到 save-error、路径不变、dirty 保留、saving 释放', () => {
    const tabId = 't1';
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', tabId), tabId, 'a.txt', 'v1');
    model = editTab(model, tabId, 'v2');
    const started = startSaveAs(model, tabId);
    const failed = failSaveAs(started, tabId, { code: 'WRITE_FAILED', message: '写入失败' });
    const tab = tabById(failed, tabId) as TextDocumentTabState;
    expect(tab.status).toBe('save-error');
    expect(tab.saving).toBe(false);
    expect(tab.dirty).toBe(true);
    expect(tab.error?.code).toBe('WRITE_FAILED');
    expect(tab.relativePath).toBe('a.txt'); // 源路径不变
    expect(failed.runtime.get(tabId)?.saveInFlight).toBe(false);
    expect(validateDocumentTabsModel(failed)).toEqual([]);
  });

  it('completeSaveAs 守卫：非 save-as 状态、kind 不匹配、目标路径冲突均拒绝', () => {
    // 未在保存：无操作
    const idle = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', 't1'), 't1', 'a.txt');
    const idleAfter = completeSaveAs(idle, 't1', 0, 'b.txt', textSnapshotOf('r2', 'b.txt'));
    expect(idleAfter).toBe(idle);
    // kind 不匹配：TXT 标签给 DOCX 快照
    const startedTxt = startSaveAs(idle, 't1');
    const kindMismatch = completeSaveAs(
      startedTxt,
      't1',
      0,
      'b.txt',
      docxSnapshotOf('r2', 'b.txt'),
    );
    expect(kindMismatch).toBe(startedTxt);
    // 目标路径冲突
    let model = loadedTxtTab(openTab(createEmptyModel(), 'a.txt', 't1'), 't1', 'a.txt');
    model = loadedTxtTab(model, 't2', 'b.txt');
    const startedConflict = startSaveAs(model, 't1');
    const conflict = completeSaveAs(
      startedConflict,
      't1',
      startedConflict.runtime.get('t1')!.editRevision,
      'b.txt',
      textSnapshotOf('r2', 'b.txt'),
    );
    expect(conflict).toBe(startedConflict);
  });
});

describe('迁移后模型不变量', () => {
  it('全部迁移/关闭/save-as 转移后 validateDocumentTabsModel 无违反', () => {
    const ids = { a: 't1', b: 't2', c: 't3' };
    let model = loadedDocxTab(
      openDocxTab(createEmptyModel(), 'a/x.docx', ids.a),
      ids.a,
      'a/x.docx',
    );
    model = loadedTxtTab(model, ids.b, 'a/y.txt');
    model = loadedTxtTab(model, ids.c, 'z.txt');
    model = migrateDescendantTabPaths(model, 'a', 'm');
    model = migrateTabPath(model, ids.c, 'z2.txt');
    model = closeTabsByRelativePaths(model, ['z2.txt']);
    const started = startSaveAs(model, ids.a);
    model = completeSaveAs(
      started,
      ids.a,
      started.runtime.get(ids.a)!.editRevision,
      'final.docx',
      docxSnapshotOf('r2', 'final.docx'),
      'final.docx.wenshu.bak',
    );
    expect(validateDocumentTabsModel(model)).toEqual([]);
    // 目录迁移 m/x.docx → save-as 完成 → final.docx；m/y.txt 保持
    expect(model.state.tabs.map((t) => t.relativePath)).toEqual(['final.docx', 'm/y.txt']);
  });
});
