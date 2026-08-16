/**
 * TASK-007 WP4 + TASK-009 WP1：多类型标签（TXT/DOCX 判别联合）纯状态模型测试。
 * 覆盖：混合标签不变量校验、DOCX 打开/读取/编辑/保存/冲突/确认状态机、
 * degraded 与 read-only 门禁、保存期间继续编辑、同路径去重（按相对路径、与稳定 tabId 解耦）、
 * 关闭邻接激活、TXT 分支共存。
 */

import { describe, expect, it } from 'vitest';
import {
  DOCX_MODEL_SCHEMA_VERSION,
  type DocxCompatibilityReport,
  type DocxDocumentModel,
  type DocxDocumentSnapshot,
  type ReadDocxDocumentResult,
  type SaveDocxDocumentResult,
} from '../../src/shared/docx';
import {
  applyDocxReadResult,
  asyncResultStillValid,
  closeTab,
  completeDocxSave,
  confirmDocxCompatibility,
  createEmptyModel,
  dirtyTabCount,
  editDocxTab,
  editTab,
  hasDirtyTabs,
  hasSavingTabs,
  invalidateWorkspace,
  isDocxTab,
  openDocxTab,
  openTab,
  saveCompletionClearsDirty,
  startDocxSave,
  tabById,
  updateTab,
  updateTabRuntime,
  validateDocumentTabsModel,
  type DocxDocumentTabState,
  type DocumentTabsModel,
  type DocumentTabRuntime,
} from '../../src/renderer/lib/document-tabs';

/* ======================= 测试工具 ======================= */

/** 稳定 tabId 分配：单调递增、不可由路径推导（模拟 controller 的分配器）。 */
let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

/** 打开 TXT 并返回新标签的稳定 id。 */
function openTxt(
  model: DocumentTabsModel,
  relativePath: string,
): { model: DocumentTabsModel; id: string } {
  const id = nextTabId();
  return { model: openTab(model, relativePath, id), id };
}

/** 打开 DOCX 并返回新标签的稳定 id。 */
function openDocx(
  model: DocumentTabsModel,
  relativePath: string,
): { model: DocumentTabsModel; id: string } {
  const id = nextTabId();
  return { model: openDocxTab(model, relativePath, id), id };
}

function modelOf(text = 'x'): DocxDocumentModel {
  return {
    schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
    blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text, marks: [] }] }],
  };
}

function compatibilityOf(level: DocxCompatibilityReport['level']): DocxCompatibilityReport {
  return {
    level,
    warnings:
      level === 'supported' ? [] : [{ code: 'image', message: '文档包含图片，保存后可能丢失' }],
  };
}

function snapshotOf(
  revision: string,
  overrides: Partial<DocxDocumentSnapshot> = {},
): DocxDocumentSnapshot {
  const model = modelOf(`基线 ${revision}`);
  return {
    kind: 'docx',
    name: 'a.docx',
    relativePath: 'a.docx',
    revision,
    size: 10,
    model,
    compatibility: compatibilityOf('supported'),
    ...overrides,
  };
}

function loadedResult(snapshot: DocxDocumentSnapshot): ReadDocxDocumentResult {
  return { status: 'loaded', document: snapshot };
}

function errorResult(code: 'INVALID_DOCX' | 'READ_FAILED'): ReadDocxDocumentResult {
  return { status: 'error', error: { code, message: '读取文件失败' } };
}

function savedResult(snapshot: DocxDocumentSnapshot): SaveDocxDocumentResult {
  return { status: 'saved', document: snapshot, backupRelativePath: 'a.docx.wenshu.bak' };
}

function saveErrorResult(code: 'CONFLICT' | 'WRITE_FAILED'): SaveDocxDocumentResult {
  return { status: 'error', error: { code, message: '保存失败' } };
}

function docxRuntime(overrides: Partial<DocumentTabRuntime> = {}): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 1,
    saveInFlight: false,
    latestContent: null,
    latestModel: modelOf(),
    ...overrides,
  };
}

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

/** 创建/覆盖标签运行时条目（controller 在读取开始时创建；模型转移只更新既有条目）。 */
function setRuntime(
  model: DocumentTabsModel,
  tabId: string,
  runtime: DocumentTabRuntime,
): DocumentTabsModel {
  const next = new Map(model.runtime);
  next.set(tabId, runtime);
  return { state: model.state, runtime: next };
}

/** 打开并加载一个 DOCX 标签，返回加载后的模型与稳定 id。 */
function openedDocxTab(
  relativePath = 'a.docx',
  snapshot = snapshotOf('r1'),
): { model: DocumentTabsModel; id: string } {
  const { model: opened, id } = openDocx(createEmptyModel(), relativePath);
  let model = setRuntime(opened, id, docxRuntime());
  model = applyDocxReadResult(model, id, loadedResult(snapshot));
  return { model, id };
}

function expectViolation(model: DocumentTabsModel, fragment: string): void {
  const violations = validateDocumentTabsModel(model);
  expect(violations.join(' ')).toContain(fragment);
}

describe('多类型标签不变量（第 5.3 节）', () => {
  it('空模型合法', () => {
    expect(validateDocumentTabsModel(createEmptyModel())).toEqual([]);
  });

  it('TXT 与 DOCX 混合模型合法', () => {
    const txt = openTxt(createEmptyModel(), 'a.txt');
    let model = setRuntime(txt.model, txt.id, txtRuntime({ latestContent: 'x' }));
    const docx = openDocx(model, 'b.docx');
    model = setRuntime(docx.model, docx.id, docxRuntime());
    model = applyDocxReadResult(
      model,
      docx.id,
      loadedResult(snapshotOf('r1', { relativePath: 'b.docx', name: 'b.docx' })),
    );
    expect(validateDocumentTabsModel(model)).toEqual([]);
    expect(dirtyTabCount(model)).toBe(0);
    expect(hasDirtyTabs(model)).toBe(false);
    expect(hasSavingTabs(model)).toBe(false);
  });

  it('stable tabId：id 与 relativePath 解耦，同路径去重保留原 id（WP1 第 4.5 节）', () => {
    const first = openTxt(createEmptyModel(), 'a.txt');
    const firstId = first.id;
    expect(firstId).not.toBe('a.txt'); // 稳定 id 不可由路径推导
    // 用不同候选 id 再次打开同一路径：只激活原标签，原 id 保留
    const again = openTxt(first.model, 'a.txt');
    expect(again.model.state.tabs).toHaveLength(1);
    expect(again.model.state.tabs[0]!.id).toBe(firstId);
    expect(again.id).not.toBe(firstId); // 候选 id 未被采用
    expect(again.model.state.activeTabId).toBe(firstId);
    // 跨类型打开同一路径同样去重：TXT 已打开时 DOCX 语义只激活原标签
    const docxAttempt = openDocx(again.model, 'a.txt');
    expect(docxAttempt.model.state.tabs).toHaveLength(1);
    expect(isDocxTab(docxAttempt.model.state.tabs[0]!)).toBe(false);
    expect(docxAttempt.model.state.tabs[0]!.id).toBe(firstId);
  });

  it('DOCX 分支运行时不得携带 latestContent；TXT 分支不得携带 latestModel', () => {
    const docx = openedDocxTab();
    const docxTab = tabById(docx.model, docx.id);
    expect(isDocxTab(docxTab!)).toBe(true);
    expectViolation(
      {
        ...docx.model,
        runtime: new Map([[docx.id, { ...docx.model.runtime.get(docx.id)!, latestContent: 'x' }]]),
      },
      '不得携带 latestContent',
    );
    const txt = openTxt(createEmptyModel(), 't.txt');
    expectViolation(
      {
        ...txt.model,
        runtime: new Map([
          [
            txt.id,
            {
              editRevision: 0,
              readRequestId: 1,
              saveInFlight: false,
              latestContent: 'x',
              latestModel: modelOf(),
            },
          ],
        ]),
      },
      '不得携带 latestModel',
    );
  });

  it('DOCX 非 loading/read-error 必须有基线快照', () => {
    const docx = openedDocxTab();
    const tab = tabById(docx.model, docx.id) as DocxDocumentTabState;
    const missing = {
      ...docx.model,
      state: { ...docx.model.state, tabs: [{ ...tab, document: null }] },
    };
    expectViolation(missing, '没有基线快照');
  });

  it('dirty 与 loaded-clean 不一致报告违反', () => {
    const docx = openedDocxTab();
    const tab = tabById(docx.model, docx.id) as DocxDocumentTabState;
    const dirtyClean = {
      ...docx.model,
      state: { ...docx.model.state, tabs: [{ ...tab, dirty: true }] },
    };
    expectViolation(dirtyClean, 'dirty 但状态为 loaded-clean');
  });

  it('saving ↔ saveInFlight 双向一致', () => {
    const docx = openedDocxTab();
    expectViolation(
      {
        ...docx.model,
        runtime: new Map([[docx.id, { ...docx.model.runtime.get(docx.id)!, saveInFlight: true }]]),
      },
      '在途保存',
    );
    const base = openedDocxTab();
    const edited = editDocxTab(base.model, base.id, modelOf('编辑后'));
    const saving = startDocxSave(edited, base.id);
    expect(validateDocumentTabsModel(saving)).toEqual([]);
    const tab = tabById(saving, base.id);
    expect(isDocxTab(tab) && tab.saving).toBe(true);
  });

  it('degraded 未确认进入 saving 报告违反（不变量 10）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const base = openedDocxTab('a.docx', degraded);
    const edited = editDocxTab(base.model, base.id, modelOf('编辑'));
    const tab = tabById(edited, base.id) as DocxDocumentTabState;
    expectViolation(
      {
        ...edited,
        state: { ...edited.state, tabs: [{ ...tab, status: 'saving' as const, saving: true }] },
        runtime: new Map([[base.id, { ...edited.runtime.get(base.id)!, saveInFlight: true }]]),
      },
      'degraded 未确认即进入 saving',
    );
  });

  it('read-only 发起保存报告违反（不变量 11）', () => {
    const readOnly = snapshotOf('r1', { compatibility: compatibilityOf('read-only') });
    const base = openedDocxTab('a.docx', readOnly);
    const tab = tabById(base.model, base.id) as DocxDocumentTabState;
    // read-only 标签被强行置为 saving（异常路径）→ 报告违反
    expectViolation(
      {
        ...base.model,
        state: { ...base.model.state, tabs: [{ ...tab, saving: true }] },
        runtime: new Map([[base.id, { ...base.model.runtime.get(base.id)!, saveInFlight: true }]]),
      },
      'read-only 不得发起保存',
    );
  });
});

describe('DOCX 标签状态机', () => {
  it('打开占位 → 读取完成：loaded-clean、模型就位、运行时快照、确认重置', () => {
    const opened = openDocx(createEmptyModel(), 'a.docx');
    const loading = tabById(opened.model, opened.id);
    expect(isDocxTab(loading)).toBe(true);
    expect(loading?.status).toBe('loading');
    let model = updateTabRuntime(opened.model, opened.id, () => docxRuntime());
    model = applyDocxReadResult(model, opened.id, loadedResult(snapshotOf('r1')));
    const tab = tabById(model, opened.id);
    expect(isDocxTab(tab)).toBe(true);
    if (isDocxTab(tab)) {
      expect(tab.status).toBe('loaded-clean');
      expect(tab.document?.revision).toBe('r1');
      expect(tab.model?.blocks[0]).toBeDefined();
      expect(tab.dirty).toBe(false);
      expect(tab.compatibilityConfirmationRevision).toBeNull();
    }
    expect(model.runtime.get(opened.id)?.latestModel).not.toBeNull();
    expect(validateDocumentTabsModel(model)).toEqual([]);
  });

  it('读取失败：read-error，错误保留', () => {
    const opened = openDocx(createEmptyModel(), 'a.docx');
    let model = updateTabRuntime(opened.model, opened.id, () => docxRuntime({ latestModel: null }));
    model = applyDocxReadResult(model, opened.id, errorResult('INVALID_DOCX'));
    const tab = tabById(model, opened.id);
    expect(isDocxTab(tab) && tab.status).toBe('read-error');
  });

  it('read-only 文档：读取后进入 read-only，编辑与保存都被拒绝', () => {
    const readOnly = snapshotOf('r1', { compatibility: compatibilityOf('read-only') });
    const base = openedDocxTab('a.docx', readOnly);
    const tab = tabById(base.model, base.id);
    expect(isDocxTab(tab) && tab.status).toBe('read-only');
    const edited = editDocxTab(base.model, base.id, modelOf('编辑'));
    expect(tabById(edited, base.id)).toEqual(tab);
    const saved = startDocxSave(edited, base.id);
    expect(tabById(saved, base.id)).toEqual(tab);
  });

  it('编辑：dirty 置位、修订号递增；clean 状态转入 loaded-dirty', () => {
    const base = openedDocxTab();
    const edited = editDocxTab(base.model, base.id, modelOf('编辑后'));
    const tab = tabById(edited, base.id);
    expect(isDocxTab(tab)).toBe(true);
    if (isDocxTab(tab)) {
      expect(tab.status).toBe('loaded-dirty');
      expect(tab.dirty).toBe(true);
      const editedBlock = tab.model?.blocks[0];
      expect(editedBlock?.kind === 'paragraph' ? editedBlock.runs[0]?.text : undefined).toBe(
        '编辑后',
      );
    }
    expect(edited.runtime.get(base.id)?.editRevision).toBe(1);
    const latestBlock = edited.runtime.get(base.id)?.latestModel?.blocks[0];
    expect(latestBlock?.kind === 'paragraph' ? latestBlock.runs[0]?.text : undefined).toBe(
      '编辑后',
    );
  });

  it('保存：saving 状态 → 成功且修订匹配时清除 dirty；保存期间编辑保留后续修改（不变量 9）', () => {
    // 无并发编辑：保存成功 → loaded-clean
    const base = openedDocxTab();
    let model = editDocxTab(base.model, base.id, modelOf('编辑'));
    model = startDocxSave(model, base.id);
    const saving = tabById(model, base.id);
    expect(isDocxTab(saving) && saving.status).toBe('saving');
    const saved = completeDocxSave(
      model,
      base.id,
      model.runtime.get(base.id)!.editRevision,
      savedResult(snapshotOf('r2')),
    );
    const cleanTab = tabById(saved, base.id);
    expect(isDocxTab(cleanTab)).toBe(true);
    if (isDocxTab(cleanTab)) {
      expect(cleanTab.status).toBe('loaded-clean');
      expect(cleanTab.dirty).toBe(false);
      expect(cleanTab.document?.revision).toBe('r2');
      const cleanBlock = cleanTab.model?.blocks[0];
      expect(cleanBlock?.kind === 'paragraph' ? cleanBlock.runs[0]?.text : undefined).toBe(
        '基线 r2',
      );
    }
    expect(validateDocumentTabsModel(saved)).toEqual([]);

    // 保存期间继续编辑：旧保存成功不清除新 dirty
    const base2 = openedDocxTab();
    let model2 = editDocxTab(base2.model, base2.id, modelOf('编辑一'));
    const captured = model2.runtime.get(base2.id)!.editRevision;
    model2 = startDocxSave(model2, base2.id);
    model2 = editDocxTab(model2, base2.id, modelOf('编辑二'));
    model2 = completeDocxSave(model2, base2.id, captured, savedResult(snapshotOf('r2')));
    const dirtyTab = tabById(model2, base2.id);
    expect(isDocxTab(dirtyTab)).toBe(true);
    if (isDocxTab(dirtyTab)) {
      expect(dirtyTab.status).toBe('loaded-dirty');
      expect(dirtyTab.dirty).toBe(true);
      const block = dirtyTab.model?.blocks[0];
      expect(block?.kind === 'paragraph' ? block.runs[0]?.text : undefined).toBe('编辑二');
    }
  });

  it('保存冲突：CONFLICT → conflict 状态，dirty 保留', () => {
    const base = openedDocxTab();
    let model = editDocxTab(base.model, base.id, modelOf('编辑'));
    model = startDocxSave(model, base.id);
    model = completeDocxSave(
      model,
      base.id,
      model.runtime.get(base.id)!.editRevision,
      saveErrorResult('CONFLICT'),
    );
    const tab = tabById(model, base.id);
    expect(isDocxTab(tab) && tab.status).toBe('conflict');
    expect(isDocxTab(tab) && tab.dirty).toBe(true);
  });

  it('保存失败：save-error，dirty 保留', () => {
    const base = openedDocxTab();
    let model = editDocxTab(base.model, base.id, modelOf('编辑'));
    model = startDocxSave(model, base.id);
    model = completeDocxSave(
      model,
      base.id,
      model.runtime.get(base.id)!.editRevision,
      saveErrorResult('WRITE_FAILED'),
    );
    const tab = tabById(model, base.id);
    expect(isDocxTab(tab) && tab.status).toBe('save-error');
  });

  it('clean 标签不发起保存；无模型/无快照不发起保存', () => {
    const clean = openedDocxTab();
    const afterClean = startDocxSave(clean.model, clean.id);
    expect(tabById(afterClean, clean.id)).toEqual(tabById(clean.model, clean.id));
    const noSnapshot = openDocx(createEmptyModel(), 'a.docx');
    const afterNoSnapshot = startDocxSave(noSnapshot.model, noSnapshot.id);
    expect(afterNoSnapshot.state.tabs).toHaveLength(1);
    expect(isDocxTab(afterNoSnapshot.state.tabs[0]!) && afterNoSnapshot.state.tabs[0]!.status).toBe(
      'loading',
    );
  });
});

describe('degraded 兼容性确认（第 4.2 节）', () => {
  it('degraded 未确认：编辑被模型层拒绝；clean 标签保存无操作（不变量 10）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const base = openedDocxTab('a.docx', degraded);
    // 编辑被模型层拒绝（不变量 10）
    const edited = editDocxTab(base.model, base.id, modelOf('编辑'));
    const tab = tabById(edited, base.id);
    expect(isDocxTab(tab) && tab.dirty).toBe(false);
    // clean 标签不发起保存（无操作，不进入 saving）
    const saved = startDocxSave(edited, base.id);
    expect(tabById(saved, base.id)).toEqual(tab);
  });

  it('degraded 未确认的 dirty 标签保存 → save-error（COMPATIBILITY_CONFIRMATION_REQUIRED，防御路径）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const base = openedDocxTab('a.docx', degraded);
    // 直接构造"已 dirty 但未确认"的标签（绕过编辑门禁的异常路径）
    const tab = tabById(base.model, base.id) as DocxDocumentTabState;
    const model: DocumentTabsModel = {
      ...base.model,
      state: {
        ...base.model.state,
        tabs: [{ ...tab, status: 'loaded-dirty', model: modelOf('编辑'), dirty: true }],
      },
    };
    const saved = startDocxSave(model, base.id);
    const savingTab = tabById(saved, base.id);
    expect(isDocxTab(savingTab) && savingTab.status).toBe('save-error');
    expect(isDocxTab(savingTab) && savingTab.error?.code).toBe(
      'COMPATIBILITY_CONFIRMATION_REQUIRED',
    );
    expect(isDocxTab(savingTab) && savingTab.saving).toBe(false);
    // 确认后：错误清除、恢复 loaded-dirty、可保存
    const confirmed = confirmDocxCompatibility(saved, base.id, 'r1');
    const confirmedTab = tabById(confirmed, base.id);
    expect(isDocxTab(confirmedTab) && confirmedTab.status).toBe('loaded-dirty');
    expect(isDocxTab(confirmedTab) && confirmedTab.error).toBeNull();
    const saving = startDocxSave(confirmed, base.id);
    const savingTab2 = tabById(saving, base.id)!;
    expect(isDocxTab(savingTab2) && savingTab2.status).toBe('saving');
    expect(validateDocumentTabsModel(saving)).toEqual([]);
  });

  it('确认绑定 revision：确认后编辑与保存放行', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const base = openedDocxTab('a.docx', degraded);
    const model = confirmDocxCompatibility(base.model, base.id, 'r1');
    const confirmed = tabById(model, base.id);
    expect(isDocxTab(confirmed)).toBe(true);
    if (isDocxTab(confirmed)) {
      expect(confirmed.compatibilityConfirmationRevision).toBe('r1');
      expect(confirmed.status).toBe('loaded-clean');
      expect(confirmed.error).toBeNull();
    }
    const edited = editDocxTab(model, base.id, modelOf('编辑'));
    const editedTab = tabById(edited, base.id)!;
    expect(isDocxTab(editedTab) && editedTab.dirty).toBe(true);
    const saving = startDocxSave(edited, base.id);
    const savingTab2 = tabById(saving, base.id)!;
    expect(isDocxTab(savingTab2) && savingTab2.status).toBe('saving');
    expect(validateDocumentTabsModel(saving)).toEqual([]);
  });

  it('确认只对当前 revision 有效：重新读取不同 revision 后确认被重置', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const base = openedDocxTab('a.docx', degraded);
    let model = confirmDocxCompatibility(base.model, base.id, 'r1');
    // 外部重读：新 revision 的 degraded 快照
    model = applyDocxReadResult(
      model,
      base.id,
      loadedResult(snapshotOf('r2', { compatibility: compatibilityOf('degraded') })),
    );
    const tab = tabById(model, base.id) as DocxDocumentTabState;
    expect(tab.compatibilityConfirmationRevision).toBeNull();
    // 旧确认已失效：即使被强行置为 dirty，保存也被拒绝（不变量 10 防御路径）
    const dirtyTab = {
      ...tab,
      status: 'loaded-dirty' as const,
      model: modelOf('编辑'),
      dirty: true,
    } as DocxDocumentTabState;
    const saved = startDocxSave(
      { ...model, state: { ...model.state, tabs: [{ ...dirtyTab }] } },
      base.id,
    );
    const savedTab = tabById(saved, base.id)!;
    expect(isDocxTab(savedTab) && savedTab.error?.code).toBe('COMPATIBILITY_CONFIRMATION_REQUIRED');
  });
});

describe('关闭 / 失效 / 选择器', () => {
  it('混合标签关闭：活动标签优先激活右侧，saving 标签禁止关闭', () => {
    const a = openTxt(createEmptyModel(), 'a.txt');
    let model = setRuntime(a.model, a.id, txtRuntime());
    const b = openDocx(model, 'b.docx');
    model = setRuntime(b.model, b.id, docxRuntime());
    model = applyDocxReadResult(
      model,
      b.id,
      loadedResult(snapshotOf('r1', { relativePath: 'b.docx', name: 'b.docx' })),
    );
    const c = openDocx(model, 'c.docx');
    model = setRuntime(c.model, c.id, docxRuntime());
    model = applyDocxReadResult(
      model,
      c.id,
      loadedResult(snapshotOf('r1', { relativePath: 'c.docx', name: 'c.docx' })),
    );
    model = editDocxTab(model, b.id, modelOf('编辑'));
    model = startDocxSave(model, b.id);
    // saving 标签禁止关闭
    const blocked = closeTab(model, b.id);
    expect(blocked.state.tabs).toHaveLength(3);
    // 关闭活动 c.docx → 激活右侧（无右侧 → 左侧 b.docx）
    const closed = closeTab(model, c.id);
    expect(closed.state.tabs.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(closed.state.activeTabId).toBe(b.id);
    expect(validateDocumentTabsModel(closed)).toEqual([]);
  });

  it('关闭最后一个标签回到欢迎页；工作区失效清空全部', () => {
    const base = openedDocxTab();
    const closed = closeTab(base.model, base.id);
    expect(closed.state.tabs).toEqual([]);
    expect(closed.state.activeTabId).toBeNull();
    expect(invalidateWorkspace()).toEqual(createEmptyModel());
  });

  it('TXT 分支在联合模型内保持既有语义（编辑/脏/保存完成匹配）', () => {
    const txt = openTxt(createEmptyModel(), 'a.txt');
    let model = setRuntime(txt.model, txt.id, txtRuntime());
    model = updateTab(model, txt.id, (target) => ({ ...target, status: 'loaded-clean' }));
    model = editTab(model, txt.id, 'hello');
    const tab = tabById(model, txt.id);
    expect(tab?.dirty).toBe(true);
    expect(model.runtime.get(txt.id)?.editRevision).toBe(1);
    // 编辑修订号匹配判定可复用
    expect(saveCompletionClearsDirty(1, 1)).toBe(true);
    expect(saveCompletionClearsDirty(1, 2)).toBe(false);
    // 异步结果三重有效性
    expect(
      asyncResultStillValid({
        workspaceSessionValid: true,
        tabExists: true,
        requestIdCurrent: true,
      }),
    ).toBe(true);
    expect(
      asyncResultStillValid({
        workspaceSessionValid: false,
        tabExists: true,
        requestIdCurrent: true,
      }),
    ).toBe(false);
  });
});
