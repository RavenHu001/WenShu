/**
 * TASK-007 WP4：多类型标签（TXT/DOCX 判别联合）纯状态模型测试（任务第 8.5 节 / 第 5.3 节不变量）。
 * 覆盖：混合标签不变量校验、DOCX 打开/读取/编辑/保存/冲突/确认状态机、
 * degraded 与 read-only 门禁、保存期间继续编辑、同路径去重、关闭邻接激活、TXT 分支共存。
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

/** 打开并加载一个 DOCX 标签，返回加载后的模型。 */
function openedDocxTab(relativePath = 'a.docx', snapshot = snapshotOf('r1')): DocumentTabsModel {
  let model = openDocxTab(createEmptyModel(), relativePath);
  model = setRuntime(model, relativePath, docxRuntime());
  model = applyDocxReadResult(model, relativePath, loadedResult(snapshot));
  return model;
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
    let model = openTab(createEmptyModel(), 'a.txt');
    model = setRuntime(model, 'a.txt', txtRuntime({ latestContent: 'x' }));
    model = openDocxTab(model, 'b.docx');
    model = setRuntime(model, 'b.docx', docxRuntime());
    model = applyDocxReadResult(
      model,
      'b.docx',
      loadedResult(snapshotOf('r1', { relativePath: 'b.docx', name: 'b.docx' })),
    );
    expect(validateDocumentTabsModel(model)).toEqual([]);
    expect(dirtyTabCount(model)).toBe(0);
    expect(hasDirtyTabs(model)).toBe(false);
    expect(hasSavingTabs(model)).toBe(false);
  });

  it('id / relativePath 唯一性：TXT 与 DOCX 同一路径只能存在一个标签', () => {
    const model = openDocxTab(openedDocxTab('a.docx'), 'a.docx');
    expect(model.state.tabs).toHaveLength(1);
    expect(isDocxTab(model.state.tabs[0]!)).toBe(true);
    // DOCX 已打开时用 TXT 语义打开同一路径：只激活原标签
    const viaText = openTab(model, 'a.docx');
    expect(viaText.state.tabs).toHaveLength(1);
    expect(isDocxTab(viaText.state.tabs[0]!)).toBe(true);
  });

  it('DOCX 分支运行时不得携带 latestContent；TXT 分支不得携带 latestModel', () => {
    const docx = openedDocxTab();
    const docxTab = tabById(docx, 'a.docx');
    expect(isDocxTab(docxTab!)).toBe(true);
    expectViolation(
      {
        ...docx,
        runtime: new Map([['a.docx', { ...docx.runtime.get('a.docx')!, latestContent: 'x' }]]),
      },
      '不得携带 latestContent',
    );
    const txt = openTab(createEmptyModel(), 't.txt');
    expectViolation(
      {
        ...txt,
        runtime: new Map([
          [
            't.txt',
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
    const model = openedDocxTab();
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
    const missing = { ...model, state: { ...model.state, tabs: [{ ...tab, document: null }] } };
    expectViolation(missing, '没有基线快照');
  });

  it('dirty 与 loaded-clean 不一致报告违反', () => {
    const model = openedDocxTab();
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
    const dirtyClean = { ...model, state: { ...model.state, tabs: [{ ...tab, dirty: true }] } };
    expectViolation(dirtyClean, 'dirty 但状态为 loaded-clean');
  });

  it('saving ↔ saveInFlight 双向一致', () => {
    const model = openedDocxTab();
    expectViolation(
      {
        ...model,
        runtime: new Map([['a.docx', { ...model.runtime.get('a.docx')!, saveInFlight: true }]]),
      },
      '在途保存',
    );
    const saving = startDocxSave(
      editDocxTab(openedDocxTab(), 'a.docx', modelOf('编辑后')),
      'a.docx',
    );
    expect(validateDocumentTabsModel(saving)).toEqual([]);
    const tab = tabById(saving, 'a.docx');
    expect(isDocxTab(tab) && tab.saving).toBe(true);
  });

  it('degraded 未确认进入 saving 报告违反（不变量 10）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    let model = openedDocxTab('a.docx', degraded);
    model = editDocxTab(model, 'a.docx', modelOf('编辑'));
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
    expectViolation(
      {
        ...model,
        state: { ...model.state, tabs: [{ ...tab, status: 'saving' as const, saving: true }] },
        runtime: new Map([['a.docx', { ...model.runtime.get('a.docx')!, saveInFlight: true }]]),
      },
      'degraded 未确认即进入 saving',
    );
  });

  it('read-only 发起保存报告违反（不变量 11）', () => {
    const readOnly = snapshotOf('r1', { compatibility: compatibilityOf('read-only') });
    const model = openedDocxTab('a.docx', readOnly);
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
    // read-only 标签被强行置为 saving（异常路径）→ 报告违反
    expectViolation(
      {
        ...model,
        state: { ...model.state, tabs: [{ ...tab, saving: true }] },
        runtime: new Map([['a.docx', { ...model.runtime.get('a.docx')!, saveInFlight: true }]]),
      },
      'read-only 不得发起保存',
    );
  });
});

describe('DOCX 标签状态机', () => {
  it('打开占位 → 读取完成：loaded-clean、模型就位、运行时快照、确认重置', () => {
    let model = openDocxTab(createEmptyModel(), 'a.docx');
    const loading = tabById(model, 'a.docx');
    expect(isDocxTab(loading)).toBe(true);
    expect(loading?.status).toBe('loading');
    model = updateTabRuntime(model, 'a.docx', () => docxRuntime());
    model = applyDocxReadResult(model, 'a.docx', loadedResult(snapshotOf('r1')));
    const tab = tabById(model, 'a.docx');
    expect(isDocxTab(tab)).toBe(true);
    if (isDocxTab(tab)) {
      expect(tab.status).toBe('loaded-clean');
      expect(tab.document?.revision).toBe('r1');
      expect(tab.model?.blocks[0]).toBeDefined();
      expect(tab.dirty).toBe(false);
      expect(tab.compatibilityConfirmationRevision).toBeNull();
    }
    expect(model.runtime.get('a.docx')?.latestModel).not.toBeNull();
    expect(validateDocumentTabsModel(model)).toEqual([]);
  });

  it('读取失败：read-error，错误保留', () => {
    let model = openDocxTab(createEmptyModel(), 'a.docx');
    model = updateTabRuntime(model, 'a.docx', () => docxRuntime({ latestModel: null }));
    model = applyDocxReadResult(model, 'a.docx', errorResult('INVALID_DOCX'));
    const tab = tabById(model, 'a.docx');
    expect(isDocxTab(tab) && tab.status).toBe('read-error');
  });

  it('read-only 文档：读取后进入 read-only，编辑与保存都被拒绝', () => {
    const readOnly = snapshotOf('r1', { compatibility: compatibilityOf('read-only') });
    const model = openedDocxTab('a.docx', readOnly);
    const tab = tabById(model, 'a.docx');
    expect(isDocxTab(tab) && tab.status).toBe('read-only');
    const edited = editDocxTab(model, 'a.docx', modelOf('编辑'));
    expect(tabById(edited, 'a.docx')).toEqual(tab);
    const saved = startDocxSave(edited, 'a.docx');
    expect(tabById(saved, 'a.docx')).toEqual(tab);
  });

  it('编辑：dirty 置位、修订号递增；clean 状态转入 loaded-dirty', () => {
    const model = openedDocxTab();
    const edited = editDocxTab(model, 'a.docx', modelOf('编辑后'));
    const tab = tabById(edited, 'a.docx');
    expect(isDocxTab(tab)).toBe(true);
    if (isDocxTab(tab)) {
      expect(tab.status).toBe('loaded-dirty');
      expect(tab.dirty).toBe(true);
      const editedBlock = tab.model?.blocks[0];
      expect(editedBlock?.kind === 'paragraph' ? editedBlock.runs[0]?.text : undefined).toBe(
        '编辑后',
      );
    }
    expect(edited.runtime.get('a.docx')?.editRevision).toBe(1);
    const latestBlock = edited.runtime.get('a.docx')?.latestModel?.blocks[0];
    expect(latestBlock?.kind === 'paragraph' ? latestBlock.runs[0]?.text : undefined).toBe(
      '编辑后',
    );
  });

  it('保存：saving 状态 → 成功且修订匹配时清除 dirty；保存期间编辑保留后续修改（不变量 9）', () => {
    // 无并发编辑：保存成功 → loaded-clean
    let model = openedDocxTab();
    model = editDocxTab(model, 'a.docx', modelOf('编辑'));
    model = startDocxSave(model, 'a.docx');
    const saving = tabById(model, 'a.docx');
    expect(isDocxTab(saving) && saving.status).toBe('saving');
    const saved = completeDocxSave(
      model,
      'a.docx',
      model.runtime.get('a.docx')!.editRevision,
      savedResult(snapshotOf('r2')),
    );
    const cleanTab = tabById(saved, 'a.docx');
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
    let model2 = openedDocxTab();
    model2 = editDocxTab(model2, 'a.docx', modelOf('编辑一'));
    const captured = model2.runtime.get('a.docx')!.editRevision;
    model2 = startDocxSave(model2, 'a.docx');
    model2 = editDocxTab(model2, 'a.docx', modelOf('编辑二'));
    model2 = completeDocxSave(model2, 'a.docx', captured, savedResult(snapshotOf('r2')));
    const dirtyTab = tabById(model2, 'a.docx');
    expect(isDocxTab(dirtyTab)).toBe(true);
    if (isDocxTab(dirtyTab)) {
      expect(dirtyTab.status).toBe('loaded-dirty');
      expect(dirtyTab.dirty).toBe(true);
      const block = dirtyTab.model?.blocks[0];
      expect(block?.kind === 'paragraph' ? block.runs[0]?.text : undefined).toBe('编辑二');
    }
  });

  it('保存冲突：CONFLICT → conflict 状态，dirty 保留', () => {
    let model = openedDocxTab();
    model = editDocxTab(model, 'a.docx', modelOf('编辑'));
    model = startDocxSave(model, 'a.docx');
    model = completeDocxSave(
      model,
      'a.docx',
      model.runtime.get('a.docx')!.editRevision,
      saveErrorResult('CONFLICT'),
    );
    const tab = tabById(model, 'a.docx');
    expect(isDocxTab(tab) && tab.status).toBe('conflict');
    expect(isDocxTab(tab) && tab.dirty).toBe(true);
  });

  it('保存失败：save-error，dirty 保留', () => {
    let model = openedDocxTab();
    model = editDocxTab(model, 'a.docx', modelOf('编辑'));
    model = startDocxSave(model, 'a.docx');
    model = completeDocxSave(
      model,
      'a.docx',
      model.runtime.get('a.docx')!.editRevision,
      saveErrorResult('WRITE_FAILED'),
    );
    const tab = tabById(model, 'a.docx');
    expect(isDocxTab(tab) && tab.status).toBe('save-error');
  });

  it('clean 标签不发起保存；无模型/无快照不发起保存', () => {
    const clean = startDocxSave(openedDocxTab(), 'a.docx');
    expect(tabById(clean, 'a.docx')).toEqual(tabById(openedDocxTab(), 'a.docx'));
    const noSnapshot = startDocxSave(openDocxTab(createEmptyModel(), 'a.docx'), 'a.docx');
    expect(noSnapshot.state.tabs).toHaveLength(1);
    expect(isDocxTab(noSnapshot.state.tabs[0]!) && noSnapshot.state.tabs[0]!.status).toBe(
      'loading',
    );
  });
});

describe('degraded 兼容性确认（第 4.2 节）', () => {
  it('degraded 未确认：编辑被模型层拒绝；clean 标签保存无操作（不变量 10）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    const model = openedDocxTab('a.docx', degraded);
    // 编辑被模型层拒绝（不变量 10）
    const edited = editDocxTab(model, 'a.docx', modelOf('编辑'));
    const tab = tabById(edited, 'a.docx');
    expect(isDocxTab(tab) && tab.dirty).toBe(false);
    // clean 标签不发起保存（无操作，不进入 saving）
    const saved = startDocxSave(edited, 'a.docx');
    expect(tabById(saved, 'a.docx')).toEqual(tab);
  });

  it('degraded 未确认的 dirty 标签保存 → save-error（COMPATIBILITY_CONFIRMATION_REQUIRED，防御路径）', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    let model = openedDocxTab('a.docx', degraded);
    // 直接构造"已 dirty 但未确认"的标签（绕过编辑门禁的异常路径）
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
    model = {
      ...model,
      state: {
        ...model.state,
        tabs: [{ ...tab, status: 'loaded-dirty', model: modelOf('编辑'), dirty: true }],
      },
    };
    const saved = startDocxSave(model, 'a.docx');
    const savingTab = tabById(saved, 'a.docx');
    expect(isDocxTab(savingTab) && savingTab.status).toBe('save-error');
    expect(isDocxTab(savingTab) && savingTab.error?.code).toBe(
      'COMPATIBILITY_CONFIRMATION_REQUIRED',
    );
    expect(isDocxTab(savingTab) && savingTab.saving).toBe(false);
    // 确认后：错误清除、恢复 loaded-dirty、可保存
    const confirmed = confirmDocxCompatibility(saved, 'a.docx', 'r1');
    const confirmedTab = tabById(confirmed, 'a.docx');
    expect(isDocxTab(confirmedTab) && confirmedTab.status).toBe('loaded-dirty');
    expect(isDocxTab(confirmedTab) && confirmedTab.error).toBeNull();
    const saving = startDocxSave(confirmed, 'a.docx');
    const savingTab2 = tabById(saving, 'a.docx')!;
    expect(isDocxTab(savingTab2) && savingTab2.status).toBe('saving');
    expect(validateDocumentTabsModel(saving)).toEqual([]);
  });

  it('确认绑定 revision：确认后编辑与保存放行', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    let model = openedDocxTab('a.docx', degraded);
    model = confirmDocxCompatibility(model, 'a.docx', 'r1');
    const confirmed = tabById(model, 'a.docx');
    expect(isDocxTab(confirmed)).toBe(true);
    if (isDocxTab(confirmed)) {
      expect(confirmed.compatibilityConfirmationRevision).toBe('r1');
      expect(confirmed.status).toBe('loaded-clean');
      expect(confirmed.error).toBeNull();
    }
    const edited = editDocxTab(model, 'a.docx', modelOf('编辑'));
    const editedTab = tabById(edited, 'a.docx')!;
    expect(isDocxTab(editedTab) && editedTab.dirty).toBe(true);
    const saving = startDocxSave(edited, 'a.docx');
    const savingTab2 = tabById(saving, 'a.docx')!;
    expect(isDocxTab(savingTab2) && savingTab2.status).toBe('saving');
    expect(validateDocumentTabsModel(saving)).toEqual([]);
  });

  it('确认只对当前 revision 有效：重新读取不同 revision 后确认被重置', () => {
    const degraded = snapshotOf('r1', { compatibility: compatibilityOf('degraded') });
    let model = openedDocxTab('a.docx', degraded);
    model = confirmDocxCompatibility(model, 'a.docx', 'r1');
    // 外部重读：新 revision 的 degraded 快照
    model = applyDocxReadResult(
      model,
      'a.docx',
      loadedResult(snapshotOf('r2', { compatibility: compatibilityOf('degraded') })),
    );
    const tab = tabById(model, 'a.docx') as DocxDocumentTabState;
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
      'a.docx',
    );
    const savedTab = tabById(saved, 'a.docx')!;
    expect(isDocxTab(savedTab) && savedTab.error?.code).toBe('COMPATIBILITY_CONFIRMATION_REQUIRED');
  });
});

describe('关闭 / 失效 / 选择器', () => {
  it('混合标签关闭：活动标签优先激活右侧，saving 标签禁止关闭', () => {
    let model = openTab(createEmptyModel(), 'a.txt');
    model = setRuntime(model, 'a.txt', txtRuntime());
    model = openDocxTab(model, 'b.docx');
    model = setRuntime(model, 'b.docx', docxRuntime());
    model = applyDocxReadResult(
      model,
      'b.docx',
      loadedResult(snapshotOf('r1', { relativePath: 'b.docx', name: 'b.docx' })),
    );
    model = openDocxTab(model, 'c.docx');
    model = setRuntime(model, 'c.docx', docxRuntime());
    model = applyDocxReadResult(
      model,
      'c.docx',
      loadedResult(snapshotOf('r1', { relativePath: 'c.docx', name: 'c.docx' })),
    );
    model = editDocxTab(model, 'b.docx', modelOf('编辑'));
    model = startDocxSave(model, 'b.docx');
    // saving 标签禁止关闭
    const blocked = closeTab(model, 'b.docx');
    expect(blocked.state.tabs).toHaveLength(3);
    // 关闭活动 c.docx → 激活右侧（无右侧 → 左侧 b.docx）
    const closed = closeTab(model, 'c.docx');
    expect(closed.state.tabs.map((t) => t.id)).toEqual(['a.txt', 'b.docx']);
    expect(closed.state.activeTabId).toBe('b.docx');
    expect(validateDocumentTabsModel(closed)).toEqual([]);
  });

  it('关闭最后一个标签回到欢迎页；工作区失效清空全部', () => {
    const model = openedDocxTab();
    const closed = closeTab(model, 'a.docx');
    expect(closed.state.tabs).toEqual([]);
    expect(closed.state.activeTabId).toBeNull();
    expect(invalidateWorkspace()).toEqual(createEmptyModel());
  });

  it('TXT 分支在联合模型内保持既有语义（编辑/脏/保存完成匹配）', () => {
    let model = openTab(createEmptyModel(), 'a.txt');
    model = setRuntime(model, 'a.txt', txtRuntime());
    model = updateTab(model, 'a.txt', (target) => ({ ...target, status: 'loaded-clean' }));
    model = editTab(model, 'a.txt', 'hello');
    const tab = tabById(model, 'a.txt');
    expect(tab?.dirty).toBe(true);
    expect(model.runtime.get('a.txt')?.editRevision).toBe(1);
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
