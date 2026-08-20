// @vitest-environment node
/**
 * TASK-010 WP1 纯模块测试：当前 DOCX 查找的输入校验、literal 匹配、实时 textblock 投影、
 * 投影范围到 PM 位置映射与当前索引（任务第 8.2 节 + WP0 冻结结论）。
 *
 * ## 覆盖
 *
 * - 输入校验：空查询/超长（4096/4097）/换行（\\r、\\n）；替换长度与换行（空替换合法）；
 * - literal 匹配：大小写敏感/不敏感（ASCII-only 折叠）、中文、emoji 代理对、组合字符、
 *   重复字符非重叠规则、相邻匹配、无匹配、2000/2001 预算截断、自定义上限、换行查询防御；
 * - 与工作区 matcher（matchText）实测一致：同一语料 from/to/matchedText/truncated 全等；
 * - 投影：projectPmTextblocks 复用 joinDocxTextBlocks，与 projectDocxModelSearchText 在
 *   段落/标题/空段/跨 run marks/项目符号/编号/嵌套列表/emoji/组合字符模型上逐块一致；
 * - 映射：UTF-16 偏移公式（pos+1+块内偏移）、跨块/越界/空范围拒绝、真实 PM doc 闭环；
 * - 当前索引：初选、next/previous 循环、内容变化后的最近匹配；
 * - 预算级一次性性能观察（20,000 块投影 + 查找 + 映射）。
 */

import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { DocxBlock, DocxDocumentModel } from '../../src/shared/docx';
import { docxModelToTiptapJson } from '../../src/shared/docx-convert';
import { projectDocxModelSearchText } from '../../src/shared/docx-search-text';
import { matchText } from '../../src/main/search/match-text';
import {
  CURRENT_SEARCH_INPUT_ERROR_MESSAGES,
  CURRENT_SEARCH_MAX_INPUT_UTF16,
  CURRENT_SEARCH_MAX_MATCHES,
  findLiteralMatches,
  mapProjectionRangeToPm,
  nextCurrentIndex,
  pickInitialCurrentIndex,
  pickRecentCurrentIndex,
  previousCurrentIndex,
  projectPmTextblocks,
  searchCurrentDocProjection,
  validateCurrentSearchQuery,
  validateCurrentSearchReplacement,
  type PmMatch,
  type PmTextBlock,
} from '../../src/renderer/lib/docx-current-search';

/** 与产品 DOCX_EDITOR_EXTENSIONS 相同的扩展链（link 输入关闭）。 */
const schema = getSchema([
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]);

function paragraph(text: string): DocxBlock {
  return {
    kind: 'paragraph',
    alignment: null,
    runs: text.length === 0 ? [] : [{ text, marks: [] }],
  };
}

function heading(level: 1 | 2 | 3, text: string): DocxBlock {
  return { kind: 'heading', level, runs: [{ text, marks: [] }] };
}

function modelOf(blocks: readonly DocxBlock[]): DocxDocumentModel {
  return { schemaVersion: 1, blocks };
}

/** 模型 → Tiptap JSON → ProseMirror 文档（公开 schema API，无 DOM）。 */
function modelToPmDoc(model: DocxDocumentModel): PmNode {
  return schema.nodeFromJSON(docxModelToTiptapJson(model) as unknown as Record<string, unknown>);
}

/** 通过公开节点 API 收集 textblock（顺序与模型深度优先一致）。 */
function pmTextBlocks(doc: PmNode): readonly PmTextBlock[] {
  const blocks: PmTextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ text: node.textContent, pos });
    }
    return true;
  });
  return blocks;
}

/** 覆盖段落/标题/空段/跨 run marks/项目符号/编号/嵌套列表/emoji/组合字符的模型。 */
const MARKS_MODEL = modelOf([
  heading(1, '一级标题'),
  {
    kind: 'paragraph',
    alignment: 'center',
    runs: [
      { text: '粗体', marks: [{ type: 'bold' }] },
      { text: '与', marks: [] },
      { text: '斜体', marks: [{ type: 'italic' }] },
    ],
  },
  paragraph(''),
  {
    kind: 'bullet-list',
    level: 0,
    blocks: [
      paragraph('项目甲'),
      paragraph('项目乙'),
      { kind: 'bullet-list', level: 1, blocks: [paragraph('嵌套项目')] },
    ],
  },
  {
    kind: 'ordered-list',
    level: 0,
    blocks: [
      paragraph('编号一'),
      paragraph('编号二'),
      { kind: 'ordered-list', level: 1, blocks: [paragraph('嵌套编号')] },
    ],
  },
  paragraph('emoji 🎉 与组合字符 e\u0301 结尾'),
]);

/* ======================= 输入校验 ======================= */

describe('WP1：查询/替换输入校验（第 4.3 / 4.6 节）', () => {
  it('查询：空、4096 边界、4097 超长、\\n 与 \\r 换行', () => {
    expect(validateCurrentSearchQuery('')).toEqual({ ok: false, error: 'EMPTY_QUERY' });
    expect(validateCurrentSearchQuery('a'.repeat(CURRENT_SEARCH_MAX_INPUT_UTF16))).toEqual({
      ok: true,
    });
    expect(validateCurrentSearchQuery('a'.repeat(CURRENT_SEARCH_MAX_INPUT_UTF16 + 1))).toEqual({
      ok: false,
      error: 'QUERY_TOO_LONG',
    });
    expect(validateCurrentSearchQuery('a\nb')).toEqual({ ok: false, error: 'QUERY_HAS_NEWLINE' });
    expect(validateCurrentSearchQuery('a\rb')).toEqual({ ok: false, error: 'QUERY_HAS_NEWLINE' });
    expect(validateCurrentSearchQuery('a\r\nb')).toEqual({ ok: false, error: 'QUERY_HAS_NEWLINE' });
  });

  it('替换：空合法、4096 边界、4097 超长、换行拒绝', () => {
    expect(validateCurrentSearchReplacement('')).toEqual({ ok: true });
    expect(validateCurrentSearchReplacement('a'.repeat(CURRENT_SEARCH_MAX_INPUT_UTF16))).toEqual({
      ok: true,
    });
    expect(
      validateCurrentSearchReplacement('a'.repeat(CURRENT_SEARCH_MAX_INPUT_UTF16 + 1)),
    ).toEqual({ ok: false, error: 'REPLACEMENT_TOO_LONG' });
    expect(validateCurrentSearchReplacement('a\nb')).toEqual({
      ok: false,
      error: 'REPLACEMENT_HAS_NEWLINE',
    });
    expect(validateCurrentSearchReplacement('a\rb')).toEqual({
      ok: false,
      error: 'REPLACEMENT_HAS_NEWLINE',
    });
  });

  it('错误文案稳定且与 WP0 冻结文案一致', () => {
    expect(CURRENT_SEARCH_INPUT_ERROR_MESSAGES.EMPTY_QUERY).toBe('查询不能为空');
    expect(CURRENT_SEARCH_INPUT_ERROR_MESSAGES.QUERY_TOO_LONG).toBe('查询超过 4096 个 UTF-16 单元');
    expect(CURRENT_SEARCH_INPUT_ERROR_MESSAGES.QUERY_HAS_NEWLINE).toBe('查询不能包含换行');
    expect(CURRENT_SEARCH_INPUT_ERROR_MESSAGES.REPLACEMENT_TOO_LONG).toBe(
      '替换超过 4096 个 UTF-16 单元',
    );
    expect(CURRENT_SEARCH_INPUT_ERROR_MESSAGES.REPLACEMENT_HAS_NEWLINE).toBe('替换不能包含换行');
  });
});

/* ======================= literal 匹配 ======================= */

describe('WP1：literal 匹配语义（第 4.3 / 4.4 节）', () => {
  it('大小写敏感：精确匹配、非重叠、从左到右', () => {
    const outcome = findLiteralMatches('xxabcabc', 'abc', true);
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [2, 5],
      [5, 8],
    ]);
    expect(outcome.matches.map((m) => m.matchedText)).toEqual(['abc', 'abc']);
    expect(outcome.truncated).toBe(false);
  });

  it('大小写不敏感：只折叠 ASCII 字母（与 Task 6 一致，不做 Unicode 规范化）', () => {
    const outcome = findLiteralMatches('aBc ABC', 'abc', false);
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 3],
      [4, 7],
    ]);
    // É/é 不折叠：UTF-16 码位不同，不匹配（CodeMirror 会匹配，差异见 WP0 报告 F3）
    expect(findLiteralMatches('É', 'é', false).matches).toHaveLength(0);
    expect(findLiteralMatches('é', 'É', false).matches).toHaveLength(0);
    // 中文字符不受大小写影响
    expect(findLiteralMatches('中文文本', '文本', false).matches).toHaveLength(1);
  });

  it('中文、emoji 代理对、组合字符按 UTF-16 code unit 匹配', () => {
    const text = 'emoji 🎉🎉 与组合字符 e\u0301 结尾';
    const emoji = findLiteralMatches(text, '🎉', true);
    expect(emoji.matches.map((m) => [m.from, m.to])).toEqual([
      [6, 8],
      [8, 10],
    ]);
    expect(emoji.matches[0]!.matchedText).toBe('🎉');
    const combining = findLiteralMatches(text, 'e\u0301', true);
    expect(combining.matches).toHaveLength(1);
    expect(combining.matches[0]!.from).toBe(text.indexOf('e\u0301'));
    expect(combining.matches[0]!.to).toBe(text.indexOf('e\u0301') + 2);
    expect(findLiteralMatches('中文', '中文', true).matches).toHaveLength(1);
  });

  it('重复字符非重叠规则：aaaa 查 aa 命中 [0,2]/[2,4]，不命中 [1,3]', () => {
    const outcome = findLiteralMatches('aaaa', 'aa', true);
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(outcome.truncated).toBe(false);
  });

  it('相邻匹配：abab 查 ab 命中 [0,2]/[2,4]', () => {
    const outcome = findLiteralMatches('abab', 'ab', true);
    expect(outcome.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('无匹配与空查询/换行查询防御', () => {
    expect(findLiteralMatches('hello', 'zzz', true).matches).toHaveLength(0);
    expect(findLiteralMatches('hello', 'zzz', true).truncated).toBe(false);
    expect(findLiteralMatches('abc', '', true)).toEqual({ matches: [], truncated: false });
    // 换行查询是输入层错误；matcher 防御性返回空（绝不跨人工 \\n 匹配）
    expect(findLiteralMatches('a\nb', 'a\nb', true)).toEqual({ matches: [], truncated: false });
  });

  it('2000 项允许、2001 项截断（第 4.4 节）', () => {
    const text = 'a'.repeat(4000);
    const exact = findLiteralMatches(text, 'aa', true);
    expect(exact.matches).toHaveLength(2000);
    expect(exact.truncated).toBe(false);
    const over = findLiteralMatches(text, 'a', true);
    expect(over.matches).toHaveLength(2000);
    expect(over.truncated).toBe(true);
    // 自定义上限：5 个候选只收 3 个并标记截断
    const capped = findLiteralMatches('aaaaaa', 'a', true, 3);
    expect(capped.matches).toHaveLength(3);
    expect(capped.truncated).toBe(true);
    expect(CURRENT_SEARCH_MAX_MATCHES).toBe(2000);
  });
});

/* ======================= 与工作区 matcher 实测一致 ======================= */

describe('WP1：与工作区 matcher（matchText）实测一致（WP0 F3 冻结）', () => {
  const corpus: readonly { text: string; query: string; caseSensitive: boolean }[] = [
    { text: 'Hello hello HELLO', query: 'hello', caseSensitive: false },
    { text: 'Hello hello HELLO', query: 'hello', caseSensitive: true },
    { text: '中文文本 中文', query: '中文', caseSensitive: false },
    { text: 'emoji 🎉🎉 与 e\u0301', query: '🎉', caseSensitive: true },
    { text: 'aaaa', query: 'aa', caseSensitive: true },
    { text: 'ababab', query: 'ab', caseSensitive: true },
    { text: '第一段\n第二段\n第三段', query: '第二段', caseSensitive: false },
    { text: 'AaAaAa', query: 'aa', caseSensitive: false },
    { text: '没有匹配内容', query: 'zzz', caseSensitive: true },
  ];

  it('from/to/matchedText/truncated 与 matchText 全等（合法单行查询）', () => {
    for (const entry of corpus) {
      const ours = findLiteralMatches(entry.text, entry.query, entry.caseSensitive, 2000);
      const reference = matchText(entry.text, entry.query, {
        caseSensitive: entry.caseSensitive,
        maxMatchesPerFile: 2000,
      });
      expect(ours.matches.map((m) => [m.from, m.to, m.matchedText])).toEqual(
        reference.matches.map((m) => [m.from, m.to, m.matchedText]),
      );
      expect(ours.truncated).toBe(reference.truncated);
    }
  });

  it('2000/2001 边界的 truncated 与 matchText 一致', () => {
    const text = 'a'.repeat(4000);
    const oursExact = findLiteralMatches(text, 'aa', true);
    const refExact = matchText(text, 'aa', { caseSensitive: true, maxMatchesPerFile: 2000 });
    expect(oursExact.truncated).toBe(refExact.truncated);
    const oursOver = findLiteralMatches(text, 'a', true);
    const refOver = matchText(text, 'a', { caseSensitive: true, maxMatchesPerFile: 2000 });
    expect(oursOver.matches).toHaveLength(refOver.matches.length);
    expect(oursOver.truncated).toBe(refOver.truncated);
  });
});

/* ======================= 投影与 PM 位置映射 ======================= */

describe('WP1：实时 textblock 投影与范围映射（第 4.2 节）', () => {
  it('projectPmTextblocks 与 projectDocxModelSearchText 逐块一致（同一 join 规则）', () => {
    const pmDoc = modelToPmDoc(MARKS_MODEL);
    const projection = projectPmTextblocks(pmTextBlocks(pmDoc));
    const modelProjection = projectDocxModelSearchText(MARKS_MODEL);
    expect(projection.text).toBe(modelProjection.text);
    expect(projection.blocks).toEqual(modelProjection.blocks);
    expect(projection.pmBlocks).toHaveLength(modelProjection.blocks.length);
    expect(projection.pmBlocks.map((b) => b.text)).toEqual(
      modelProjection.blocks.map((b) => b.text),
    );
    // 空段落保留为空文本块；相邻块区间连续（恰一个人工 \\n）
    expect(projection.blocks[2]!.text).toBe('');
    for (let index = 1; index < projection.blocks.length; index += 1) {
      expect(projection.blocks[index]!.from).toBe(projection.blocks[index - 1]!.to + 1);
    }
  });

  it('空模型：空投影、无块、无 pmBlocks', () => {
    const projection = projectPmTextblocks([]);
    expect(projection.text).toBe('');
    expect(projection.blocks).toEqual([]);
    expect(projection.pmBlocks).toEqual([]);
  });

  it('映射公式：PM 位置 = 块内容起点（pos+1）+ 块内 UTF-16 偏移', () => {
    const pmBlocks: readonly PmTextBlock[] = [
      { pos: 0, text: 'abc' },
      { pos: 4, text: 'def' },
    ];
    const projection = projectPmTextblocks(pmBlocks);
    expect(projection.text).toBe('abc\ndef');
    const first = mapProjectionRangeToPm(projection, 0, 2)!;
    expect(first).toEqual({
      from: 0,
      to: 2,
      matchedText: 'ab',
      blockOrdinal: 0,
      pmFrom: 1,
      pmTo: 3,
    });
    const second = mapProjectionRangeToPm(projection, 4, 7)!;
    expect(second.blockOrdinal).toBe(1);
    // 公式：pos(4) + 1 + 块内偏移(0) = 5；长度 3 → pmTo 8
    expect(second.pmFrom).toBe(5);
    expect(second.pmTo).toBe(8);
    expect(second.matchedText).toBe('def');
  });

  it('中文/emoji/组合字符的块内 UTF-16 偏移映射到真实 PM doc 精确命中', () => {
    const pmDoc = modelToPmDoc(MARKS_MODEL);
    const projection = projectPmTextblocks(pmTextBlocks(pmDoc));
    const probes: readonly string[] = [
      '一级标题',
      '粗体与斜体',
      '项目乙',
      '嵌套编号',
      '🎉',
      'e\u0301',
      '结尾',
    ];
    for (const probe of probes) {
      const { matches } = searchCurrentDocProjection(projection, probe, true);
      expect(matches, probe).toHaveLength(1);
      const match = matches[0]!;
      expect(pmDoc.textBetween(match.pmFrom, match.pmTo), probe).toBe(probe);
      expect(match.pmTo - match.pmFrom).toBe(probe.length);
      expect(match.matchedText).toBe(probe);
    }
  });

  it('跨块/越界/空范围映射拒绝（不猜测、不跨人工 \\n）', () => {
    const projection = projectPmTextblocks([
      { pos: 0, text: 'abc' },
      { pos: 4, text: 'def' },
    ]);
    // 覆盖人工 \\n 的范围
    expect(mapProjectionRangeToPm(projection, 2, 5)).toBeNull();
    expect(mapProjectionRangeToPm(projection, 3, 4)).toBeNull();
    // 越界与空范围
    expect(mapProjectionRangeToPm(projection, -1, 1)).toBeNull();
    expect(mapProjectionRangeToPm(projection, 0, 100)).toBeNull();
    expect(mapProjectionRangeToPm(projection, 3, 2)).toBeNull();
    expect(mapProjectionRangeToPm(projection, 1, 1)).toBeNull();
  });

  it('searchCurrentDocProjection：换行查询防御为空，合法查询返回映射结果与截断', () => {
    const projection = projectPmTextblocks([
      { pos: 0, text: 'abc' },
      { pos: 4, text: 'abc' },
    ]);
    expect(searchCurrentDocProjection(projection, 'a\nb', true)).toEqual({
      matches: [],
      truncated: false,
    });
    const outcome = searchCurrentDocProjection(projection, 'abc', true);
    expect(outcome.matches.map((m) => m.blockOrdinal)).toEqual([0, 1]);
    expect(outcome.matches.map((m) => [m.pmFrom, m.pmTo])).toEqual([
      [1, 4],
      [5, 8],
    ]);
    expect(outcome.truncated).toBe(false);
  });

  it('预算级：20,000 块投影 + 查找 + 映射（一次性性能观察，宽松上界）', () => {
    const pmBlocks: PmTextBlock[] = [];
    for (let index = 0; index < 20_000; index += 1) {
      pmBlocks.push({ pos: index * 2, text: 'x' });
    }
    const started = Date.now();
    const projection = projectPmTextblocks(pmBlocks);
    const outcome = searchCurrentDocProjection(projection, 'x', true);
    const elapsed = Date.now() - started;
    console.log('[TASK-010-WP1-perf] 20k projection+search+map ' + elapsed + 'ms');
    expect(projection.blocks).toHaveLength(20_000);
    expect(outcome.matches).toHaveLength(2000);
    expect(outcome.truncated).toBe(true);
    expect(outcome.matches[0]!.pmFrom).toBe(1);
    expect(elapsed).toBeLessThan(10_000);
  });
});

/* ======================= 当前索引 ======================= */

describe('WP1：当前索引初选与循环导航（第 4.3 节）', () => {
  function matchesOf(pmFroms: readonly number[]): readonly PmMatch[] {
    return pmFroms.map((pmFrom, index) => ({
      from: index,
      to: index + 1,
      matchedText: 'x',
      blockOrdinal: index,
      pmFrom,
      pmTo: pmFrom + 1,
    }));
  }

  it('初选：第一个 pmFrom >= 锚点的匹配，否则循环到第一个；空结果返回 null', () => {
    const matches = matchesOf([5, 10, 15]);
    expect(pickInitialCurrentIndex(matches, 0)).toBe(0);
    expect(pickInitialCurrentIndex(matches, 5)).toBe(0);
    expect(pickInitialCurrentIndex(matches, 6)).toBe(1);
    expect(pickInitialCurrentIndex(matches, 10)).toBe(1);
    expect(pickInitialCurrentIndex(matches, 11)).toBe(2);
    expect(pickInitialCurrentIndex(matches, 16)).toBe(0);
    expect(pickInitialCurrentIndex([], 0)).toBeNull();
  });

  it('next/previous 循环；无匹配或未知当前索引的确定行为', () => {
    const matches = matchesOf([5, 10, 15]);
    expect(nextCurrentIndex(matches, 0)).toBe(1);
    expect(nextCurrentIndex(matches, 2)).toBe(0);
    expect(nextCurrentIndex(matches, null)).toBe(0);
    expect(previousCurrentIndex(matches, 2)).toBe(1);
    expect(previousCurrentIndex(matches, 0)).toBe(2);
    expect(previousCurrentIndex(matches, null)).toBe(2);
    expect(nextCurrentIndex([], 0)).toBeNull();
    expect(previousCurrentIndex([], 0)).toBeNull();
    expect(nextCurrentIndex([], null)).toBeNull();
    expect(previousCurrentIndex([], null)).toBeNull();
  });

  it('内容变化后的最近匹配：优先 pmFrom >= 旧锚点，否则循环到第一个', () => {
    // 编辑前当前项在 pmFrom 5（块内插入 2 个字符后整体右移 2）
    const after = matchesOf([7, 12, 17]);
    expect(pickRecentCurrentIndex(after, 5)).toBe(0); // 7 >= 5
    expect(pickRecentCurrentIndex(after, 12)).toBe(1);
    expect(pickRecentCurrentIndex(after, 13)).toBe(2);
    expect(pickRecentCurrentIndex(after, 18)).toBe(0); // 循环
    expect(pickRecentCurrentIndex(after, null)).toBe(0);
    expect(pickRecentCurrentIndex([], 5)).toBeNull();
  });
});
