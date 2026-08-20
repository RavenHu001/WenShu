// @vitest-environment jsdom
/**
 * TASK-010 WP0 技术验证：当前 DOCX 查找与替换的编辑器事务/资源语义假设（任务第 3.3 节）。
 *
 * ## 覆盖
 *
 * - 实时 ProseMirror 文档按 node.isTextblock 深度优先收集文本块，结果与 Task 8 的
 *   joinDocxTextBlocks / projectDocxModelSearchText 顺序和文本一致；
 * - 单个匹配跨越多个相邻 text node / marks run 时稳定映射为一个 PM 选区；
 * - 匹配不跨规范投影的人工 \n；查询/替换输入均为单行（含换行拒绝）；
 * - 中文、emoji、代理对、组合字符的 UTF-16 偏移与 PM 位置映射一致；
 * - Decoration 同时标记全部匹配与当前匹配，文档事务后经 mapping 安全更新，
 *   应用/清空装饰不修改正文、不 dirty、不进入撤销历史；
 * - insertText 与 replaceWith 对单 run / 跨同 marks / 跨不同 marks / 空替换的实际
 *   marks 行为；替换继承匹配起点 marks、保留段落/标题/列表结构；
 * - 多个匹配按文档逆序写入同一个 transaction，不发生位置漂移，一次 undo/redo 完整
 *   恢复/重做；2000 项允许、第 2001 项起截断并整体拒绝全部替换（0 部分替换）；
 * - 候选 transaction 的 doc.toJSON() 在 dispatch 前经 tiptapJsonToDocxModel 与现有
 *   模型预算校验；非法模型 / 超序列化预算时 0 dispatch、文档不变；
 * - read-only 编辑器可显示装饰、选区与滚动，替换命令拒绝；degraded 未确认不可替换、
 *   确认绑定 revision 后同一 editor 即可替换；saving 期间替换不被旧保存完成清除；
 * - 接近 DOCX_MAX_MODEL_SERIALIZED_BYTES 与 20,000 文本块文档的一次性性能观察。
 *
 * 本文件全部为测试脚手架（WP1/WP2/WP4 移植为产品模块时保持语义）；不接产品 UI，
 * 不修改产品代码，不实现正式 matcher / plugin / controller / replace。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Editor, Extension, type Content } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Mark as PmMark } from '@tiptap/pm/model';
import {
  DOCX_MAX_MODEL_BLOCKS,
  DOCX_MAX_MODEL_SERIALIZED_BYTES,
  DOCX_MODEL_SCHEMA_VERSION,
  validateDocxDocumentModel,
  type DocxCompatibilityReport,
  type DocxDocumentModel,
  type DocxDocumentSnapshot,
} from '../../src/shared/docx';
import { docxModelToTiptapJson, tiptapJsonToDocxModel } from '../../src/shared/docx-convert';
import {
  joinDocxTextBlocks,
  projectDocxModelSearchText,
  type DocxSearchTextProjection,
} from '../../src/shared/docx-search-text';
import { matchText } from '../../src/main/search/match-text';
import {
  applyDocxReadResult,
  completeDocxSave,
  confirmDocxCompatibility,
  createEmptyModel,
  editDocxTab,
  isDocxTab,
  openDocxTab,
  startDocxSave,
  tabById,
  validateDocumentTabsModel,
  type DocumentTabRuntime,
} from '../../src/renderer/lib/document-tabs';

/** 当前文档查找的固定预算（TASK-010 第 4.3 / 4.4 / 4.6 节）。 */
const CURRENT_DOC_MAX_QUERY_UTF16 = 4096;
const CURRENT_DOC_MAX_MATCHES = 2000;

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

/* ======================= 最小 Tiptap/ProseMirror 夹具 ======================= */

/** 与产品 DOCX_EDITOR_EXTENSIONS 相同的扩展链（link 输入关闭）。 */
const DOCX_EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

/** 与 TASK-008 WP0 同构的模型：标题 + 跨 run marks + 空段 + 嵌套列表 + emoji/组合字符。 */
const TASK8_LIKE_MODEL: DocxDocumentModel = {
  schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
  blocks: [
    { kind: 'heading', level: 1, runs: [{ text: '定位标题', marks: [] }] },
    {
      kind: 'paragraph',
      alignment: null,
      runs: [
        { text: '粗体', marks: [{ type: 'bold' }] },
        { text: '跨', marks: [] },
        { text: 'run', marks: [{ type: 'italic' }] },
      ],
    },
    { kind: 'paragraph', alignment: null, runs: [] },
    {
      kind: 'bullet-list',
      level: 0,
      blocks: [
        { kind: 'paragraph', alignment: null, runs: [{ text: '列表条目', marks: [] }] },
        {
          kind: 'bullet-list',
          level: 1,
          blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text: '嵌套条目', marks: [] }] }],
        },
      ],
    },
    {
      kind: 'paragraph',
      alignment: null,
      runs: [{ text: 'emoji 🎉 与组合字符 e\u0301 结尾', marks: [] }],
    },
  ],
};

function paragraph(text: string): DocxDocumentModel['blocks'][number] {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

function modelOf(blocks: DocxDocumentModel['blocks']): DocxDocumentModel {
  return { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks };
}

/** 创建真实 Tiptap 编辑器（公开 API；与产品宿主同扩展链）。 */
function createEditor(
  model: DocxDocumentModel,
  editable = true,
  extra: readonly Extension[] = [],
): Editor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Editor({
    element: container,
    extensions: [...DOCX_EDITOR_EXTENSIONS, ...extra],
    content: docxModelToTiptapJson(model) as unknown as Content,
    editable,
  });
}

/* ======================= 实时 textblock 投影与范围映射（Task 8 规则） ======================= */

interface LiveProjection extends DocxSearchTextProjection {
  /** textblock 节点起始位置（文档顺序，与 blocks 一一对应）。 */
  readonly pmBlocks: readonly { readonly text: string; readonly pos: number }[];
}

/** 从实时 PM 文档按 node.isTextblock 深度优先收集文本块并与 Task 8 共用 join 规则。 */
function liveProjection(editor: Editor): LiveProjection {
  const pmBlocks: { text: string; pos: number }[] = [];
  editor.view.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      pmBlocks.push({ text: node.textContent, pos });
    }
    return true;
  });
  const joined = joinDocxTextBlocks(pmBlocks.map((block) => block.text));
  return { ...joined, pmBlocks };
}

interface PmMatch {
  /** 投影文本范围（UTF-16）。 */
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
  /** textblock 序号（文档顺序，0 起始）。 */
  readonly blockOrdinal: number;
  /** 映射后的 PM 选区范围。 */
  readonly pmFrom: number;
  readonly pmTo: number;
}

/** 映射公式（TASK-008 WP0 冻结 / TASK-010 第 4.2 节）：块内容起点 pos + 1 + 块内 UTF-16 偏移。 */
function mapMatchRange(live: LiveProjection, from: number, to: number): PmMatch {
  const blockIndex = live.blocks.findIndex((block) => block.from <= from && to <= block.to);
  if (blockIndex === -1) {
    throw new Error('match must be fully contained in a single textblock');
  }
  const block = live.blocks[blockIndex]!;
  const pmBlock = live.pmBlocks[blockIndex]!;
  const pmFrom = pmBlock.pos + 1 + (from - block.from);
  const pmTo = pmFrom + (to - from);
  return {
    from,
    to,
    matchedText: live.text.slice(from, to),
    blockOrdinal: blockIndex,
    pmFrom,
    pmTo,
  };
}

interface ScanOutcome {
  readonly live: LiveProjection;
  readonly matches: readonly PmMatch[];
  readonly truncated: boolean;
}

/** 复用 Task 6 literal matcher 语义（ASCII-only 大小写折叠、从左到右非重叠），作用于实时投影。 */
function scan(editor: Editor, query: string, caseSensitive: boolean): ScanOutcome {
  const live = liveProjection(editor);
  const outcome = matchText(live.text, query, {
    caseSensitive,
    maxMatchesPerFile: CURRENT_DOC_MAX_MATCHES,
  });
  return {
    live,
    truncated: outcome.truncated,
    matches: outcome.matches.map((match) => mapMatchRange(live, match.from, match.to)),
  };
}

/* ======================= 输入校验脚手架（第 4.3 / 4.6 节） ======================= */

function validateQueryInput(query: string): string | null {
  if (query.length === 0) {
    return '查询不能为空';
  }
  if (query.length > CURRENT_DOC_MAX_QUERY_UTF16) {
    return '查询超过 4096 个 UTF-16 单元';
  }
  if (/[\r\n]/.test(query)) {
    return '查询不能包含换行';
  }
  return null;
}

function validateReplacementInput(replacement: string): string | null {
  if (replacement.length > CURRENT_DOC_MAX_QUERY_UTF16) {
    return '替换超过 4096 个 UTF-16 单元';
  }
  if (/[\r\n]/.test(replacement)) {
    return '替换不能包含换行';
  }
  return null;
}

/* ======================= Decoration 脚手架（第 4.5 节公开 API） ======================= */

const wp0SearchKey = new PluginKey<DecorationSet>('wp0-current-search');

function decorationExtension(): Extension {
  return Extension.create({
    name: 'wp0-current-search-decoration',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: wp0SearchKey,
          state: {
            init: () => DecorationSet.empty,
            apply: (tr, value, _oldState, newState) => {
              const meta = tr.getMeta(wp0SearchKey);
              if (meta !== undefined) {
                return meta as DecorationSet;
              }
              return value.map(tr.mapping, newState.doc);
            },
          },
          props: {
            decorations(state) {
              return wp0SearchKey.getState(state) ?? DecorationSet.empty;
            },
          },
        }),
      ];
    },
  });
}

function buildDecorationSet(
  editor: Editor,
  matches: readonly PmMatch[],
  currentIndex: number | null,
): DecorationSet {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.pmFrom, match.pmTo, {
      class: index === currentIndex ? 'wp0-search-match wp0-search-current' : 'wp0-search-match',
    }),
  );
  return DecorationSet.create(editor.state.doc, decorations);
}

function applyDecorations(editor: Editor, set: DecorationSet): void {
  editor.view.dispatch(editor.view.state.tr.setMeta(wp0SearchKey, set));
}

/* ======================= 替换事务脚手架（第 4.6 / 4.7 节） ======================= */

interface ReplaceResult {
  readonly ok: boolean;
  readonly dispatched: boolean;
  readonly reason: string | null;
}

function okResult(dispatched: boolean): ReplaceResult {
  return { ok: true, dispatched, reason: null };
}

function failResult(reason: string): ReplaceResult {
  return { ok: false, dispatched: false, reason };
}

interface ReplacePermission {
  readonly editable: boolean;
  /** degraded 未确认时为 false（绑定当前 revision 的确认由标签状态派生）。 */
  readonly confirmed: boolean;
}

/** 非空替换继承匹配起点 marks；空替换 = 删除；dispatch 前对最终 doc 做模型转换与预算校验。 */
function replaceRangeScaffold(
  editor: Editor,
  match: PmMatch,
  replacement: string,
  permission: ReplacePermission,
): ReplaceResult {
  if (!permission.editable) {
    return failResult('read-only');
  }
  if (!permission.confirmed) {
    return failResult('not-confirmed');
  }
  const validationError = validateReplacementInput(replacement);
  if (validationError !== null) {
    return failResult(validationError);
  }
  const startMarks = startCharMarks(editor, match.pmFrom);
  let tr = editor.state.tr;
  if (replacement.length === 0) {
    tr = tr.delete(match.pmFrom, match.pmTo);
  } else {
    tr = tr.replaceWith(match.pmFrom, match.pmTo, editor.schema.text(replacement, startMarks));
  }
  const converted = tiptapJsonToDocxModel(tr.doc.toJSON());
  if (converted.status !== 'ok') {
    return failResult('model-invalid');
  }
  editor.view.dispatch(tr);
  return okResult(true);
}

/** 执行瞬间重新投影并复验当前范围：不信任 UI 中的旧范围（第 4.6 节）。 */
function replaceCurrentScaffold(
  editor: Editor,
  query: string,
  caseSensitive: boolean,
  expected: PmMatch,
  replacement: string,
  permission: ReplacePermission,
): ReplaceResult {
  const fresh = scan(editor, query, caseSensitive).matches.find(
    (match) => match.pmFrom === expected.pmFrom && match.pmTo === expected.pmTo,
  );
  if (fresh === undefined) {
    return failResult('stale-range');
  }
  return replaceRangeScaffold(editor, fresh, replacement, permission);
}

/** 起点字符 marks：匹配起点所在 text 节点的 marks（跨不同 marks 边界时不取边界前 marks）。 */
function startCharMarks(editor: Editor, from: number): readonly PmMark[] {
  const $from = editor.state.doc.resolve(from);
  let found: readonly PmMark[] = [];
  $from.parent.forEach((child, offset) => {
    const start = $from.start() + offset;
    if (child.isText && start <= from && from < start + child.nodeSize) {
      found = child.marks;
    }
  });
  if (found.length === 0) {
    const node = editor.state.doc.nodeAt(from);
    if (node !== null && node.isText) {
      found = node.marks;
    }
  }
  return found;
}

/** 逆序单 transaction 全部替换；最多 2000 项，truncated（第 2001 项起）整体拒绝；每个匹配继承各自起点 marks。 */
function replaceAllScaffold(
  editor: Editor,
  matches: readonly PmMatch[],
  replacement: string,
  permission: ReplacePermission,
  truncated: boolean,
): ReplaceResult {
  if (!permission.editable) {
    return failResult('read-only');
  }
  if (!permission.confirmed) {
    return failResult('not-confirmed');
  }
  const validationError = validateReplacementInput(replacement);
  if (validationError !== null) {
    return failResult(validationError);
  }
  if (matches.length === 0) {
    return okResult(false);
  }
  if (truncated || matches.length > CURRENT_DOC_MAX_MATCHES) {
    return failResult('over-budget');
  }
  const schema = editor.schema;
  let tr = editor.state.tr;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    const startMarks = startCharMarks(editor, match.pmFrom);
    if (replacement.length === 0) {
      tr = tr.delete(match.pmFrom, match.pmTo);
    } else {
      tr = tr.replaceWith(match.pmFrom, match.pmTo, schema.text(replacement, startMarks));
    }
  }
  const converted = tiptapJsonToDocxModel(tr.doc.toJSON());
  if (converted.status !== 'ok') {
    return failResult('model-invalid');
  }
  editor.view.dispatch(tr);
  return okResult(true);
}

/** 公开 API 提取当前文档的文本节点序列（text + mark 类型名）。 */
function textRunsOf(
  editor: Editor,
): readonly { readonly text: string; readonly marks: readonly string[] }[] {
  const runs: { text: string; marks: string[] }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      runs.push({ text: node.text ?? '', marks: node.marks.map((mark) => mark.type.name) });
    }
    return true;
  });
  return runs;
}

/** 性能观察计时助手（一次性记录，非基准门禁）。 */
function timed<T>(label: string, fn: () => T): { value: T; ms: number } {
  const started = Date.now();
  const value = fn();
  const ms = Date.now() - started;
  console.log('[TASK-010-WP0-perf] ' + label + ' ' + ms + 'ms');
  return { value, ms };
}

/* ======================= 纯状态夹具（degraded / saving 语义） ======================= */

function docxRuntime(model: DocxDocumentModel): DocumentTabRuntime {
  return {
    editRevision: 0,
    readRequestId: 1,
    saveInFlight: false,
    latestContent: null,
    latestModel: model,
  };
}

function snapshotOf(
  model: DocxDocumentModel,
  revision: string,
  compatibility: DocxCompatibilityReport,
): DocxDocumentSnapshot {
  return {
    kind: 'docx',
    name: 'a.docx',
    relativePath: 'a.docx',
    revision,
    size: 10,
    model,
    compatibility,
  };
}

function compatibilityOf(level: DocxCompatibilityReport['level']): DocxCompatibilityReport {
  return {
    level,
    warnings:
      level === 'supported' ? [] : [{ code: 'image', message: '文档包含图片，保存后可能丢失' }],
  };
}

function openedDocxTab(
  model: DocxDocumentModel,
  compatibility: DocxCompatibilityReport,
  revision = 'r1',
): { model: ReturnType<typeof openDocxTab>; id: string } {
  const opened = openDocxTab(createEmptyModel(), 'a.docx', 'tab-1');
  const withRuntime = {
    state: opened.state,
    runtime: new Map<string, DocumentTabRuntime>([['tab-1', docxRuntime(model)]]),
  };
  const loaded = applyDocxReadResult(withRuntime, 'tab-1', {
    status: 'loaded',
    document: snapshotOf(model, revision, compatibility),
  });
  return { model: loaded, id: 'tab-1' };
}

/* ======================= 近序列化上限 / 20,000 块夹具 ======================= */

function nearLimitModel(): DocxDocumentModel {
  const blocks: DocxDocumentModel['blocks'][number][] = [];
  const runText = 'a'.repeat(4096);
  for (let index = 0; index < 1800; index += 1) {
    blocks.push({ kind: 'paragraph', alignment: null, runs: [{ text: runText, marks: [] }] });
  }
  return modelOf(blocks);
}

let nearLimit: { readonly model: DocxDocumentModel; readonly editor: Editor } | null = null;

function nearLimitFixture(): { readonly model: DocxDocumentModel; readonly editor: Editor } {
  if (nearLimit === null) {
    const model = nearLimitModel();
    nearLimit = { model, editor: createEditor(model, true, [decorationExtension()]) };
  }
  return nearLimit;
}

afterAll(() => {
  nearLimit?.editor.destroy();
  nearLimit = null;
});

/* ======================= 实时投影与 Task 8 规则 ======================= */

describe('WP0：实时 textblock 投影与 Task 8 规则（任务第 3.3 节）', () => {
  it('PM 深度优先 textblock 与 joinDocxTextBlocks / projectDocxModelSearchText 完全一致', () => {
    const editor = createEditor(TASK8_LIKE_MODEL);
    try {
      const live = liveProjection(editor);
      const modelProjection = projectDocxModelSearchText(TASK8_LIKE_MODEL);
      expect(live.text).toBe(modelProjection.text);
      expect(live.blocks.map((block) => block.text)).toEqual(
        modelProjection.blocks.map((b) => b.text),
      );
      expect(live.blocks.map((block) => block.from)).toEqual(
        modelProjection.blocks.map((b) => b.from),
      );
      expect(live.blocks.map((block) => block.to)).toEqual(modelProjection.blocks.map((b) => b.to));
      expect(live.pmBlocks).toHaveLength(modelProjection.blocks.length);
      // 空段落保留为空文本块；相邻块区间连续（恰好一个人工 \n）
      expect(live.blocks[2]!.text).toBe('');
      for (let index = 1; index < live.blocks.length; index += 1) {
        expect(live.blocks[index]!.from).toBe(live.blocks[index - 1]!.to + 1);
      }
    } finally {
      editor.destroy();
    }
  });

  it('跨 marks run 匹配稳定映射为单一 PM 选区', () => {
    const editor = createEditor(TASK8_LIKE_MODEL);
    try {
      const query = '粗体跨run';
      const { matches } = scan(editor, query, true);
      expect(matches).toHaveLength(1);
      const match = matches[0]!;
      expect(match.blockOrdinal).toBe(1);
      expect(editor.view.state.doc.textBetween(match.pmFrom, match.pmTo)).toBe(query);
      expect(editor.commands.setTextSelection({ from: match.pmFrom, to: match.pmTo })).toBe(true);
      expect(editor.view.state.selection.from).toBe(match.pmFrom);
      expect(editor.view.state.selection.to).toBe(match.pmTo);
      // 选区命令不修改正文
      expect(editor.view.state.doc.textContent).toBe(
        liveProjection(editor)
          .pmBlocks.map((block) => block.text)
          .join(''),
      );
    } finally {
      editor.destroy();
    }
  });

  it('查询/替换单行约束：人工 \\n 分隔符不可被跨越，换行与超长输入被拒绝', () => {
    const editor = createEditor(modelOf([paragraph('abc'), paragraph('def')]));
    try {
      const live = liveProjection(editor);
      expect(live.text).toBe('abc\ndef');
      // 每个匹配完整位于单个文本块（查询不含换行时恒成立；这里显式断言）
      const { matches } = scan(editor, 'b', true);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.blockOrdinal).toBe(0);
      // 换行查询/替换：稳定输入错误，不静默裁剪
      expect(validateQueryInput('c\nd')).toBe('查询不能包含换行');
      expect(validateQueryInput('ab\r')).toBe('查询不能包含换行');
      expect(validateReplacementInput('x\ny')).toBe('替换不能包含换行');
      // 长度预算：4096 允许，4097 拒绝
      expect(validateQueryInput('a'.repeat(4096))).toBeNull();
      expect(validateQueryInput('a'.repeat(4097))).toBe('查询超过 4096 个 UTF-16 单元');
      expect(validateReplacementInput('b'.repeat(4096))).toBeNull();
      expect(validateReplacementInput('b'.repeat(4097))).toBe('替换超过 4096 个 UTF-16 单元');
      expect(validateQueryInput('')).toBe('查询不能为空');
    } finally {
      editor.destroy();
    }
  });

  it('中文/emoji/代理对/组合字符的 UTF-16 偏移映射精确', () => {
    const editor = createEditor(modelOf([paragraph('emoji 🎉 与组合字符 e\u0301 与 𠮷 结尾')]));
    try {
      const probe = (token: string, expectedLength: number): void => {
        const { matches } = scan(editor, token, true);
        expect(matches).toHaveLength(1);
        const match = matches[0]!;
        expect(match.pmTo - match.pmFrom).toBe(expectedLength);
        expect(editor.view.state.doc.textBetween(match.pmFrom, match.pmTo)).toBe(token);
      };
      // 🎉 为代理对：2 个 UTF-16 code unit
      probe('🎉', 2);
      // 组合字符：基准字母 + U+0301，两个独立 code unit
      probe('e\u0301', 2);
      // CJK 扩展区字符（代理对）
      probe('𠮷', 2);
      probe('字符', 2);
    } finally {
      editor.destroy();
    }
  });
});

/* ======================= Decoration 与事务后更新 ======================= */

describe('WP0：Decoration 与事务后更新（任务第 3.3 / 4.5 节）', () => {
  it('普通/当前匹配 Decoration 同时标记并渲染 class；不修改正文、不进入撤销历史', () => {
    const editor = createEditor(modelOf([paragraph('abc abc')]), true, [decorationExtension()]);
    try {
      const { matches } = scan(editor, 'abc', true);
      expect(matches).toHaveLength(2);
      const docBefore = editor.view.state.doc.textContent;
      applyDecorations(editor, buildDecorationSet(editor, matches, 0));
      const set = wp0SearchKey.getState(editor.view.state);
      expect(set).not.toBeNull();
      expect(set!.find()).toHaveLength(2);
      expect(editor.view.dom.querySelectorAll('.wp0-search-match')).toHaveLength(2);
      expect(editor.view.dom.querySelectorAll('.wp0-search-current')).toHaveLength(1);
      // 装饰不修改正文、不进撤销历史
      expect(editor.view.state.doc.textContent).toBe(docBefore);
      editor.commands.undo();
      expect(editor.view.state.doc.textContent).toBe(docBefore);
      // 清空装饰（等价关闭面板）也不修改正文
      applyDecorations(editor, DecorationSet.empty);
      expect(editor.view.dom.querySelectorAll('.wp0-search-match')).toHaveLength(0);
      expect(editor.view.state.doc.textContent).toBe(docBefore);
    } finally {
      editor.destroy();
    }
  });

  it('文档事务后 DecorationSet 经 mapping 安全更新（插入前移）', () => {
    const editor = createEditor(modelOf([paragraph('abc abc')]), true, [decorationExtension()]);
    try {
      const { matches } = scan(editor, 'abc', true);
      applyDecorations(editor, buildDecorationSet(editor, matches, 0));
      // 在第一个匹配起点前插入 "XX"（段内位置 1）：无 meta 的文档事务触发 mapping
      editor.view.dispatch(editor.view.state.tr.insertText('XX', 1));
      const mapped = wp0SearchKey.getState(editor.view.state)!.find();
      expect(mapped).toHaveLength(2);
      expect(mapped[0]!.from).toBe(3);
      expect(mapped[0]!.to).toBe(6);
      expect(mapped[1]!.from).toBe(7);
      expect(mapped[1]!.to).toBe(10);
      expect(editor.view.state.doc.textBetween(3, 6)).toBe('abc');
      // 重算后应用新集合（等价"编辑后重算，不保留错误装饰"）
      const rescan = scan(editor, 'abc', true);
      applyDecorations(editor, buildDecorationSet(editor, rescan.matches, 0));
      const rebuilt = wp0SearchKey.getState(editor.view.state)!.find();
      expect(rebuilt).toHaveLength(2);
      expect(rebuilt[0]!.from).toBe(3);
      expect(rebuilt[0]!.to).toBe(6);
    } finally {
      editor.destroy();
    }
  });
});

/* ======================= 替换事务语义 ======================= */

describe('WP0：替换事务与起点 marks 继承（任务第 3.3 / 4.6 / 4.7 节）', () => {
  it('单 run 替换：短/长/中文/emoji/组合字符/相同文本替换后模型合法', () => {
    const editor = createEditor(modelOf([paragraph('A')]));
    try {
      const { matches } = scan(editor, 'A', true);
      const replacement = '中😀e\u0301';
      const result = replaceRangeScaffold(editor, matches[0]!, replacement, {
        editable: true,
        confirmed: true,
      });
      expect(result).toEqual({ ok: true, dispatched: true, reason: null });
      expect(editor.view.state.doc.textContent).toBe(replacement);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('A');
      // 相同文本替换：文档不变但仍是可撤销事务（与 CodeMirror 替换语义一致）
      const same = replaceRangeScaffold(editor, matches[0]!, 'A', {
        editable: true,
        confirmed: true,
      });
      expect(same.ok).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('跨同 marks run：insertText 与显式 replaceWith 都继承起点 marks，冻结显式 replaceWith', () => {
    const model = modelOf([
      {
        kind: 'paragraph',
        alignment: null,
        runs: [
          { text: 'AB', marks: [{ type: 'bold' }] },
          { text: 'CD', marks: [] },
        ],
      },
    ]);
    const first = createEditor(model);
    try {
      const match = scan(first, 'BC', true).matches[0]!;
      first.view.dispatch(first.view.state.tr.insertText('XY', match.pmFrom, match.pmTo));
      const runs = textRunsOf(first);
      expect(runs.map((run) => run.text).join('')).toBe('AXYD');
      // PM 会把相邻同 marks 文本合并：断言按 marks 分组的文本（不依赖节点是否合并）
      expect(
        runs
          .filter((run) => run.marks.includes('bold'))
          .map((run) => run.text)
          .join(''),
      ).toBe('AXY');
      expect(
        runs
          .filter((run) => run.marks.length === 0)
          .map((run) => run.text)
          .join(''),
      ).toBe('D');
    } finally {
      first.destroy();
    }
    const second = createEditor(model);
    try {
      const match = scan(second, 'BC', true).matches[0]!;
      const startMarks = startCharMarks(second, match.pmFrom);
      second.view.dispatch(
        second.view.state.tr.replaceWith(
          match.pmFrom,
          match.pmTo,
          second.schema.text('XY', startMarks),
        ),
      );
      const runs = textRunsOf(second);
      expect(
        runs
          .filter((run) => run.marks.includes('bold'))
          .map((run) => run.text)
          .join(''),
      ).toBe('AXY');
      expect(
        runs
          .filter((run) => run.marks.length === 0)
          .map((run) => run.text)
          .join(''),
      ).toBe('D');
      // 冻结决策：替换统一使用显式 replaceWith + 起点 marks（不依赖 insertText 内部实现）
      const converted = tiptapJsonToDocxModel(second.getJSON());
      expect(converted.status).toBe('ok');
    } finally {
      second.destroy();
    }
  });

  it('跨不同 marks run：替换继承匹配起点 marks，未匹配格式保持', () => {
    const editor = createEditor(
      modelOf([
        {
          kind: 'paragraph',
          alignment: null,
          runs: [
            { text: 'AB', marks: [{ type: 'bold' }] },
            { text: 'CD', marks: [] },
            { text: 'EF', marks: [{ type: 'italic' }] },
          ],
        },
      ]),
    );
    try {
      const { matches } = scan(editor, 'BCD', true);
      const result = replaceRangeScaffold(editor, matches[0]!, 'XY', {
        editable: true,
        confirmed: true,
      });
      expect(result.ok).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('AXYEF');
      const runs = textRunsOf(editor);
      expect(
        runs
          .filter((run) => run.marks.includes('bold'))
          .map((run) => run.text)
          .join(''),
      ).toBe('AXY');
      expect(
        runs
          .filter((run) => run.marks.includes('italic'))
          .map((run) => run.text)
          .join(''),
      ).toBe('EF');
      const converted = tiptapJsonToDocxModel(editor.getJSON());
      expect(converted.status).toBe('ok');
      if (converted.status === 'ok') {
        const firstBlock = converted.model.blocks[0]!;
        expect(firstBlock.kind).toBe('paragraph');
        if (firstBlock.kind === 'paragraph') {
          expect(firstBlock.runs).toEqual([
            { text: 'AXY', marks: [{ type: 'bold' }] },
            { text: 'EF', marks: [{ type: 'italic' }] },
          ]);
        }
      }
    } finally {
      editor.destroy();
    }
  });

  it('空替换 = 删除；段落/标题/列表结构保持', () => {
    const editor = createEditor(
      modelOf([
        { kind: 'heading', level: 2, runs: [{ text: '章节XYZ', marks: [] }] },
        paragraph('abcXYZdef'),
        {
          kind: 'bullet-list',
          level: 0,
          blocks: [paragraph('项XYZ项')],
        },
      ]),
    );
    try {
      const scanned = scan(editor, 'XYZ', true);
      expect(scanned.matches).toHaveLength(3);
      const result = replaceAllScaffold(
        editor,
        scanned.matches,
        '',
        {
          editable: true,
          confirmed: true,
        },
        scanned.truncated,
      );
      expect(result).toEqual({ ok: true, dispatched: true, reason: null });
      const converted = tiptapJsonToDocxModel(editor.getJSON());
      expect(converted.status).toBe('ok');
      if (converted.status === 'ok') {
        const blocks = converted.model.blocks;
        // WP0 实测：Tiptap v3 StarterKit 默认 TrailingNode —— 文档以列表结尾时
        // 编辑器 doc 会在末尾追加一个空 paragraph；空替换本身不改变块结构。
        expect(blocks).toHaveLength(4);
        expect(blocks[0]).toEqual({
          kind: 'heading',
          level: 2,
          runs: [{ text: '章节', marks: [] }],
        });
        expect(blocks[1]).toEqual({
          kind: 'paragraph',
          alignment: null,
          runs: [{ text: 'abcdef', marks: [] }],
        });
        expect(blocks[2]).toEqual({
          kind: 'bullet-list',
          level: 0,
          blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text: '项项', marks: [] }] }],
        });
        expect(blocks[3]).toEqual({ kind: 'paragraph', alignment: null, runs: [] });
      }
    } finally {
      editor.destroy();
    }
  });

  it('每个匹配继承各自起点 marks（同查询命中不同格式上下文）', () => {
    const editor = createEditor(
      modelOf([
        {
          kind: 'paragraph',
          alignment: null,
          runs: [
            { text: 'x', marks: [{ type: 'bold' }] },
            { text: 'x', marks: [] },
            { text: 'x', marks: [{ type: 'italic' }] },
          ],
        },
      ]),
    );
    try {
      const scanned = scan(editor, 'x', true);
      expect(scanned.matches).toHaveLength(3);
      const result = replaceAllScaffold(
        editor,
        scanned.matches,
        'Y',
        {
          editable: true,
          confirmed: true,
        },
        scanned.truncated,
      );
      expect(result.ok).toBe(true);
      const runs = textRunsOf(editor);
      expect(runs.map((run) => run.text)).toEqual(['Y', 'Y', 'Y']);
      expect(runs.map((run) => run.marks)).toEqual([['bold'], [], ['italic']]);
    } finally {
      editor.destroy();
    }
  });

  it('执行瞬间复验：范围已失效时替换拒绝且 0 dispatch', () => {
    const editor = createEditor(modelOf([paragraph('abc')]));
    try {
      const stale = scan(editor, 'b', true).matches[0]!;
      editor.view.dispatch(editor.view.state.tr.insertText('X', 0));
      const result = replaceCurrentScaffold(editor, 'b', true, stale, 'Z', {
        editable: true,
        confirmed: true,
      });
      expect(result).toEqual({ ok: false, dispatched: false, reason: 'stale-range' });
      expect(editor.view.state.doc.textContent).toBe('Xabc');
    } finally {
      editor.destroy();
    }
  });

  it('非法模型候选：dispatch 前经 tiptapJsonToDocxModel 校验失败 → 0 dispatch、文档不变', () => {
    const editor = createEditor(modelOf([paragraph('abc')]));
    try {
      const match = scan(editor, 'abc', true).matches[0]!;
      const hardBreakType = editor.schema.nodes.hardBreak;
      if (hardBreakType === undefined) {
        throw new Error('hardBreak node missing from schema');
      }
      const tr = editor.state.tr.replaceWith(match.pmFrom, match.pmTo, hardBreakType.create());
      const converted = tiptapJsonToDocxModel(tr.doc.toJSON());
      expect(converted.status).toBe('invalid');
      if (converted.status === 'invalid') {
        expect(converted.violations.join(' ')).toContain('只允许 text 节点');
      }
      const before = editor.view.state.doc.textContent;
      // 校验失败路径不 dispatch（与 replaceRangeScaffold 的 model-invalid 分支等价）
      expect(editor.view.state.doc.textContent).toBe(before);
      expect(editor.view.state.selection.from).toBe(editor.view.state.selection.to);
    } finally {
      editor.destroy();
    }
  });

  it('逆序单 transaction 全部替换：不同长度替换不发生位置漂移，一次 undo/redo 完整恢复', () => {
    const editor = createEditor(modelOf([paragraph('aaZZaa')]));
    try {
      const { matches } = scan(editor, 'aa', true);
      expect(matches.map((match) => [match.pmFrom, match.pmTo])).toEqual([
        [1, 3],
        [5, 7],
      ]);
      const result = replaceAllScaffold(
        editor,
        matches,
        'XY',
        {
          editable: true,
          confirmed: true,
        },
        false,
      );
      expect(result.ok).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('XYZZXY');
      expect(editor.commands.undo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('aaZZaa');
      expect(editor.commands.redo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('XYZZXY');
      // 全部替换只产生一个历史事件：再次 undo 无操作
      expect(editor.commands.undo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('aaZZaa');
      expect(editor.commands.undo()).toBe(false);
      expect(editor.view.state.doc.textContent).toBe('aaZZaa');
    } finally {
      editor.destroy();
    }
  });

  it('2000 项允许、2001+ 截断并整体拒绝全部替换（无部分替换）', () => {
    const editor = createEditor(modelOf([paragraph('a'.repeat(4000))]));
    try {
      // 2000 项恰好允许
      const exact = scan(editor, 'aa', true);
      expect(exact.matches).toHaveLength(2000);
      expect(exact.truncated).toBe(false);
      const exactResult = replaceAllScaffold(
        editor,
        exact.matches,
        'b',
        {
          editable: true,
          confirmed: true,
        },
        exact.truncated,
      );
      expect(exactResult.ok).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('b'.repeat(2000));
      // 一次 undo 恢复全部 2000 项
      expect(editor.commands.undo()).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('a'.repeat(4000));
      // 第 2001 个匹配：扫描标记 truncated，全部替换整体拒绝、0 修改
      const over = scan(editor, 'a', true);
      expect(over.matches).toHaveLength(2000);
      expect(over.truncated).toBe(true);
      const overResult = replaceAllScaffold(
        editor,
        over.matches,
        'b',
        {
          editable: true,
          confirmed: true,
        },
        over.truncated,
      );
      expect(overResult).toEqual({ ok: false, dispatched: false, reason: 'over-budget' });
      expect(editor.view.state.doc.textContent).toBe('a'.repeat(4000));
    } finally {
      editor.destroy();
    }
  });

  it('0 匹配全部替换：无操作、不 dispatch', () => {
    const editor = createEditor(modelOf([paragraph('hello')]));
    try {
      const { matches } = scan(editor, 'zzz', true);
      expect(matches).toHaveLength(0);
      const result = replaceAllScaffold(
        editor,
        matches,
        'x',
        {
          editable: true,
          confirmed: true,
        },
        false,
      );
      expect(result).toEqual({ ok: true, dispatched: false, reason: null });
      expect(editor.view.state.doc.textContent).toBe('hello');
    } finally {
      editor.destroy();
    }
  });

  it('预算失败：接近序列化上限文档的替换候选超限 → 0 dispatch、0 dirty', () => {
    const { model, editor } = nearLimitFixture();
    try {
      const serializedBytes = new TextEncoder().encode(JSON.stringify(model)).byteLength;
      expect(serializedBytes).toBeGreaterThan(7_000_000);
      expect(serializedBytes).toBeLessThan(DOCX_MAX_MODEL_SERIALIZED_BYTES);
      expect(validateDocxDocumentModel(model)).toEqual([]);
      const baseConverted = tiptapJsonToDocxModel(editor.getJSON());
      expect(baseConverted.status).toBe('ok');
      const match = scan(editor, 'aa', true).matches[0]!;
      const replacement = 'b'.repeat(1_000_000);
      const startMarks = editor.state.doc.resolve(match.pmFrom).marks();
      const candidateTr = editor.state.tr.replaceWith(
        match.pmFrom,
        match.pmTo,
        editor.schema.text(replacement, startMarks),
      );
      const converted = tiptapJsonToDocxModel(candidateTr.doc.toJSON());
      expect(converted.status).toBe('invalid');
      if (converted.status === 'invalid') {
        expect(converted.violations.join(' ')).toContain('序列化大小超过上限');
      }
      // 预算失败：不 dispatch（文档与选区完全不变）
      const beforeLength = editor.view.state.doc.textContent.length;
      expect(beforeLength).toBe(4096 * 1800);
      expect(editor.view.state.doc.textContent.length).toBe(beforeLength);
    } finally {
      // 共享夹具由 afterAll 销毁
    }
  });
});

/* ======================= read-only / degraded / saving ======================= */

describe('WP0：read-only / degraded / saving 语义（任务第 3.3 / 4.8 节）', () => {
  it('read-only：可显示装饰、选区和滚动；替换命令防御性拒绝且不 dispatch', () => {
    const editor = createEditor(modelOf([paragraph('abc abc')]), false, [decorationExtension()]);
    try {
      expect(editor.isEditable).toBe(false);
      const container = editor.view.dom;
      expect(container.getAttribute('contenteditable')).toBe('false');
      const { matches } = scan(editor, 'abc', true);
      applyDecorations(editor, buildDecorationSet(editor, matches, 0));
      expect(wp0SearchKey.getState(editor.view.state)!.find()).toHaveLength(2);
      expect(
        editor.commands.setTextSelection({ from: matches[0]!.pmFrom, to: matches[0]!.pmTo }),
      ).toBe(true);
      expect(() => editor.commands.scrollIntoView()).not.toThrow();
      const before = editor.view.state.doc.textContent;
      const result = replaceAllScaffold(
        editor,
        matches,
        'x',
        {
          editable: false,
          confirmed: true,
        },
        false,
      );
      expect(result).toEqual({ ok: false, dispatched: false, reason: 'read-only' });
      expect(editor.view.state.doc.textContent).toBe(before);
      expect(container.getAttribute('contenteditable')).toBe('false');
    } finally {
      editor.destroy();
    }
  });

  it('degraded 未确认：查找可用、替换被权限门拒绝；确认绑定 revision 后同一 editor 可替换', () => {
    const degradedModel = modelOf([paragraph('abc')]);
    const { model: stateModel, id } = openedDocxTab(
      degradedModel,
      compatibilityOf('degraded'),
      'r1',
    );
    const tab = tabById(stateModel, id);
    expect(isDocxTab(tab)).toBe(true);
    expect(tab?.status).toBe('loaded-clean');
    const confirmed =
      isDocxTab(tab) && tab.compatibilityConfirmationRevision === tab.document?.revision;
    expect(confirmed).toBe(false);

    const editor = createEditor(degradedModel);
    try {
      const match = scan(editor, 'abc', true).matches[0]!;
      const before = editor.view.state.doc.textContent;
      const denied = replaceRangeScaffold(editor, match, 'X', {
        editable: true,
        confirmed: false,
      });
      expect(denied).toEqual({ ok: false, dispatched: false, reason: 'not-confirmed' });
      expect(editor.view.state.doc.textContent).toBe(before);

      // 复用既有确认入口（绑定当前 revision），不重建 editor
      const confirmedModel = confirmDocxCompatibility(stateModel, id, 'r1');
      const confirmedTab = tabById(confirmedModel, id);
      expect(isDocxTab(confirmedTab) && confirmedTab.compatibilityConfirmationRevision).toBe('r1');
      const allowed = replaceRangeScaffold(editor, scan(editor, 'abc', true).matches[0]!, 'X', {
        editable: true,
        confirmed: true,
      });
      expect(allowed.ok).toBe(true);
      expect(editor.view.state.doc.textContent).toBe('X');

      // 新 revision 读取后旧确认失效：再次拒绝
      const reread = applyDocxReadResult(confirmedModel, id, {
        status: 'loaded',
        document: snapshotOf(degradedModel, 'r2', compatibilityOf('degraded')),
      });
      const rereadTab = tabById(reread, id);
      expect(isDocxTab(rereadTab) && rereadTab.compatibilityConfirmationRevision).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it('saving 期间替换：旧保存完成不清除保存期间产生的新修改', () => {
    const baseModel = modelOf([paragraph('abc')]);
    const dirtyModel = modelOf([paragraph('abd')]);
    const nextModel = modelOf([paragraph('axd')]);
    const { model: opened, id } = openedDocxTab(baseModel, compatibilityOf('supported'), 'r1');
    // 先有未保存修改才能发起保存（startDocxSave 对 loaded-clean 是无操作）
    const dirty = editDocxTab(opened, id, dirtyModel);
    expect(tabById(dirty, id)?.status).toBe('loaded-dirty');
    const saving = startDocxSave(dirty, id);
    const savingTab = tabById(saving, id);
    expect(savingTab?.status).toBe('saving');
    expect(savingTab?.saving).toBe(true);
    const capturedEditRevision = saving.runtime.get(id)!.editRevision;
    // saving 期间替换 = editDocxTab（Tiptap 宿主在同一路径上报新模型）
    const edited = editDocxTab(saving, id, nextModel);
    expect(tabById(edited, id)?.dirty).toBe(true);
    expect(edited.runtime.get(id)!.editRevision).toBe(capturedEditRevision + 1);
    // 旧保存完成（捕获的是保存开始时的 editRevision）：不得清除后续修改
    const completed = completeDocxSave(edited, id, capturedEditRevision, {
      status: 'saved',
      document: snapshotOf(nextModel, 'r2', compatibilityOf('supported')),
      backupRelativePath: 'a.docx.wenshu.bak',
    });
    const completedTab = tabById(completed, id);
    expect(isDocxTab(completedTab)).toBe(true);
    if (isDocxTab(completedTab)) {
      expect(completedTab.status).toBe('loaded-dirty');
      expect(completedTab.dirty).toBe(true);
      expect(completedTab.saving).toBe(false);
      expect(completedTab.model).toBe(nextModel);
    }
    expect(validateDocumentTabsModel(completed)).toEqual([]);
  });
});

/* ======================= 性能观察（一次性，非基准门禁） ======================= */

describe('WP0：接近上限文档性能观察（任务第 4.10 节；一次性记录）', () => {
  it('20,000 文本块：投影/扫描/装饰/一次输入事务', { timeout: 60_000 }, () => {
    const model = modelOf(Array.from({ length: DOCX_MAX_MODEL_BLOCKS }, () => paragraph('x')));
    const editor = createEditor(model, true, [decorationExtension()]);
    try {
      const projection = timed('20k-live-projection', () => liveProjection(editor));
      expect(projection.value.pmBlocks).toHaveLength(DOCX_MAX_MODEL_BLOCKS);
      const scanned = timed('20k-scan', () => scan(editor, 'x', true));
      expect(scanned.value.matches).toHaveLength(2000);
      expect(scanned.value.truncated).toBe(true);
      const decorated = timed('20k-decoration', () =>
        buildDecorationSet(editor, scanned.value.matches, 0),
      );
      timed('20k-apply-decorations', () => applyDecorations(editor, decorated.value));
      expect(wp0SearchKey.getState(editor.view.state)!.find()).toHaveLength(2000);
      const beforeLength = editor.view.state.doc.textContent.length;
      timed('20k-insert-text', () => {
        editor.view.dispatch(
          editor.view.state.tr.insertText('y', editor.view.state.doc.content.size),
        );
      });
      expect(editor.view.state.doc.textContent.length).toBe(beforeLength + 1);
    } finally {
      editor.destroy();
    }
  });

  it(
    '接近 DOCX_MAX_MODEL_SERIALIZED_BYTES：投影/扫描/装饰与预算失败候选转换',
    { timeout: 60_000 },
    () => {
      const { model, editor } = nearLimitFixture();
      const serializedBytes = new TextEncoder().encode(JSON.stringify(model)).byteLength;
      console.log(
        '[TASK-010-WP0-perf] near-limit serializedBytes=' +
          serializedBytes +
          ' limit=' +
          DOCX_MAX_MODEL_SERIALIZED_BYTES,
      );
      const projection = timed('near-limit-live-projection', () => liveProjection(editor));
      expect(projection.value.pmBlocks).toHaveLength(1800);
      const scanned = timed('near-limit-scan-aa', () => scan(editor, 'aa', true));
      expect(scanned.value.matches).toHaveLength(2000);
      expect(scanned.value.truncated).toBe(true);
      const decorated = timed('near-limit-decoration', () =>
        buildDecorationSet(editor, scanned.value.matches, 0),
      );
      timed('near-limit-apply-decorations', () => applyDecorations(editor, decorated.value));
      expect(wp0SearchKey.getState(editor.view.state)!.find()).toHaveLength(2000);
      const match = scanned.value.matches[0]!;
      const startMarks = editor.state.doc.resolve(match.pmFrom).marks();
      const candidateTr = editor.state.tr.replaceWith(
        match.pmFrom,
        match.pmTo,
        editor.schema.text('b'.repeat(1_000_000), startMarks),
      );
      const converted = timed('near-limit-candidate-model-check', () =>
        tiptapJsonToDocxModel(candidateTr.doc.toJSON()),
      );
      expect(converted.value.status).toBe('invalid');
      if (converted.value.status === 'invalid') {
        expect(converted.value.violations.join(' ')).toContain('序列化大小超过上限');
      }
      const beforeLength = editor.view.state.doc.textContent.length;
      expect(beforeLength).toBe(4096 * 1800);
    },
  );
});
