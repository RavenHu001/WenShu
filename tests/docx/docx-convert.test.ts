/**
 * TASK-007 WP1：DOCX 纯转换测试（任务第 8.2 节）。
 * 覆盖：导入源 → 模型（样式/标题/marks/字号/颜色/列表聚合/警告/预算）、
 * 模型 → Tiptap JSON、Tiptap JSON → 模型（结构/未知节点拒绝/预算）、
 * 模型 → 导出描述，以及模型 ↔ Tiptap JSON 往返。
 */

import { describe, expect, it } from 'vitest';
import {
  DOCX_MAX_LIST_DEPTH,
  DOCX_MAX_MODEL_BLOCKS,
  DOCX_MAX_RUNS_PER_BLOCK,
  DOCX_MAX_RUN_TEXT_UTF16,
  DOCX_MODEL_SCHEMA_VERSION,
  validateDocxDocumentModel,
  type DocxAlignment,
  type DocxDocumentModel,
  type DocxImportBlock,
  type DocxImportDocumentFeature,
  type DocxImportParagraphBlock,
  type DocxImportRun,
  type DocxImportRunFeature,
  type DocxImportSource,
} from '../../src/shared/docx';
import {
  docxModelToExportDescription,
  docxModelToTiptapJson,
  importSourceToDocxModel,
  tiptapJsonToDocxModel,
} from '../../src/shared/docx-convert';

/* ======================= 测试工具 ======================= */

function sourceRun(
  text: string,
  options: Partial<Omit<DocxImportRun, 'text'>> = {},
): DocxImportRun {
  return {
    text,
    isBold: false,
    isItalic: false,
    isUnderline: false,
    fontSize: null,
    color: null,
    features: [],
    ...options,
  };
}

function sourceParagraph(
  runs: readonly DocxImportRun[],
  options: Partial<Omit<DocxImportParagraphBlock, 'type' | 'runs'>> = {},
): DocxImportParagraphBlock {
  return {
    type: 'paragraph',
    styleId: null,
    styleName: null,
    alignment: null,
    numbering: null,
    runs,
    ...options,
  };
}

function source(
  blocks: readonly DocxImportBlock[],
  documentFeatures: readonly DocxImportDocumentFeature[] = [],
): DocxImportSource {
  return { documentFeatures, blocks };
}

function okModel(sourceInput: DocxImportSource): DocxDocumentModel {
  const result = importSourceToDocxModel(sourceInput);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('unreachable');
  }
  return result.model;
}

function okImport(sourceInput: DocxImportSource) {
  const result = importSourceToDocxModel(sourceInput);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('unreachable');
  }
  return result;
}

function paragraphBlock(
  runs: readonly { text: string; marks?: unknown }[],
  alignment: DocxAlignment | null = null,
) {
  return {
    kind: 'paragraph',
    alignment,
    runs: runs.map((r) => ({ text: r.text, marks: r.marks ?? [] })),
  };
}

/* ======================= 导入源 → 模型 ======================= */

describe('importSourceToDocxModel：结构与 marks', () => {
  it('普通段落、空段落与对齐保留；空文本 run 丢弃', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('第一段')], { alignment: 'center' }),
        sourceParagraph([]),
        sourceParagraph([sourceRun(''), sourceRun('第二段')], { alignment: 'both' }),
      ]),
    );
    expect(model.blocks).toEqual([
      { kind: 'paragraph', alignment: 'center', runs: [{ text: '第一段', marks: [] }] },
      { kind: 'paragraph', alignment: null, runs: [] },
      { kind: 'paragraph', alignment: 'both', runs: [{ text: '第二段', marks: [] }] },
    ]);
    expect(validateDocxDocumentModel(model)).toEqual([]);
  });

  it('标题：英文/中文样式名与 styleId 识别 1-3 级', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('h1')], { styleName: 'Heading 1' }),
        sourceParagraph([sourceRun('h2')], { styleId: 'Heading2' }),
        sourceParagraph([sourceRun('h3')], { styleName: '标题 3' }),
        sourceParagraph([sourceRun('plain')]),
      ]),
    );
    expect(model.blocks.map((b) => (b.kind === 'heading' ? `heading:${b.level}` : b.kind))).toEqual(
      ['heading:1', 'heading:2', 'heading:3', 'paragraph'],
    );
  });

  it('标题 4-6 级降级为段落并给出 heading-level-unsupported 警告', () => {
    const result = okImport(
      source([
        sourceParagraph([sourceRun('h4')], { styleName: 'Heading 4' }),
        sourceParagraph([sourceRun('h6')], { styleId: 'Heading6' }),
      ]),
    );
    expect(result.model.blocks.every((b) => b.kind === 'paragraph')).toBe(true);
    expect(result.compatibility.warnings.map((w) => w.code)).toContain('heading-level-unsupported');
    expect(result.compatibility.level).toBe('degraded');
  });

  it('未知样式给出 unknown-style 警告；Normal/正文/空样式不警告', () => {
    const result = okImport(
      source([
        sourceParagraph([sourceRun('quote')], { styleName: 'Quote' }),
        sourceParagraph([sourceRun('normal')], { styleName: 'Normal' }),
        sourceParagraph([sourceRun('cn')], { styleName: '正文' }),
        sourceParagraph([sourceRun('none')]),
      ]),
    );
    expect(result.compatibility.warnings.map((w) => w.code)).toEqual(['unknown-style']);
  });

  it('marks：粗/斜/下划线/字号/颜色按规范顺序进入 run', () => {
    const model = okModel(
      source([
        sourceParagraph([
          sourceRun('m', {
            isBold: true,
            isItalic: true,
            isUnderline: true,
            fontSize: 10.5,
            color: '#FF0000',
          }),
        ]),
      ]),
    );
    const block = model.blocks[0];
    expect(block).toEqual({
      kind: 'paragraph',
      alignment: null,
      runs: [
        {
          text: 'm',
          marks: [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'font-size', value: 10.5 },
            { type: 'color', value: '#FF0000' },
          ],
        },
      ],
    });
  });

  it('越界字号与非法颜色 mark 丢弃，正文保留（相邻空 marks run 合并）', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('ok', { fontSize: 1639, color: '#ff0000' }), sourceRun('keep')]),
      ]),
    );
    const runs = model.blocks[0]?.kind === 'paragraph' ? model.blocks[0].runs : [];
    expect(runs.map((r) => ({ text: r.text, marks: r.marks }))).toEqual([
      { text: 'okkeep', marks: [] },
    ]);
  });

  it('相邻相同 marks 的 run 合并；超长 run 无损拆分', () => {
    const longText = 'x'.repeat(DOCX_MAX_RUN_TEXT_UTF16 + 10);
    const model = okModel(
      source([
        sourceParagraph([
          sourceRun('a', { isBold: true }),
          sourceRun('b', { isBold: true }),
          sourceRun('c'),
          sourceRun(longText, { isItalic: true }),
        ]),
      ]),
    );
    const block = model.blocks[0];
    expect(block).toBeDefined();
    if (block === undefined) {
      return;
    }
    expect(block.kind).toBe('paragraph');
    if (block.kind !== 'paragraph') {
      return;
    }
    const runs = block.runs;
    expect(runs[0]).toEqual({ text: 'ab', marks: [{ type: 'bold' }] });
    expect(runs[1]).toEqual({ text: 'c', marks: [] });
    // 4106 字符拆分为 4096 + 10 两个 run，marks 保留，文本无损
    expect(runs.length).toBe(4);
    expect(runs[2]!.text.length).toBe(DOCX_MAX_RUN_TEXT_UTF16);
    expect(runs[3]!.text.length).toBe(10);
    expect(runs[2]!.marks).toEqual([{ type: 'italic' }]);
    expect(runs[3]!.marks).toEqual([{ type: 'italic' }]);
    expect(runs.map((r) => r.text).join('')).toBe(`abc${longText}`);
  });

  it('表格块与未识别块给出稳定警告且不进入模型', () => {
    const result = okImport(
      source([{ type: 'table' }, { type: 'other' }, sourceParagraph([sourceRun('正文')])]),
    );
    expect(result.compatibility.warnings.map((w) => w.code)).toEqual([
      'table',
      'other-unrecognized',
    ]);
    expect(result.model.blocks).toHaveLength(1);
  });

  it('run 特性与文档特性映射为稳定警告', () => {
    const features: readonly DocxImportRunFeature[] = [
      'image',
      'hyperlink',
      'comment-reference',
      'field',
      'formula',
      'embedded-object',
      'other',
    ];
    const result = okImport(
      source(
        [sourceParagraph([sourceRun('带特性文本', { features })])],
        ['header-footer', 'revision'],
      ),
    );
    expect(result.compatibility.warnings.map((w) => w.code)).toEqual(
      [
        'image',
        'table',
        'header-footer',
        'comment',
        'revision',
        'field',
        'formula',
        'embedded-object',
        'hyperlink',
        'other-unrecognized',
      ].filter((code) => code !== 'table'),
    );
    expect(result.compatibility.level).toBe('read-only');
  });
});

describe('importSourceToDocxModel：列表聚合', () => {
  it('连续同级项目符号聚合为一个列表；嵌套层级正确', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('b1')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('b2')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('nested')], { numbering: { ordered: false, level: 1 } }),
        sourceParagraph([sourceRun('after')]),
      ]),
    );
    expect(model.blocks).toEqual([
      {
        kind: 'bullet-list',
        level: 0,
        blocks: [
          paragraphBlock([{ text: 'b1' }]),
          paragraphBlock([{ text: 'b2' }]),
          { kind: 'bullet-list', level: 1, blocks: [paragraphBlock([{ text: 'nested' }])] },
        ],
      },
      paragraphBlock([{ text: 'after' }]),
    ]);
  });

  it('编号列表与项目符号列表同级切换：各自成列表', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('bullet')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('ordered1')], { numbering: { ordered: true, level: 0 } }),
        sourceParagraph([sourceRun('ordered2')], { numbering: { ordered: true, level: 0 } }),
        sourceParagraph([sourceRun('bullet2')], { numbering: { ordered: false, level: 0 } }),
      ]),
    );
    expect(
      model.blocks.map((b) =>
        b.kind === 'bullet-list' || b.kind === 'ordered-list' ? b.kind : b.kind,
      ),
    ).toEqual(['bullet-list', 'ordered-list', 'bullet-list']);
    const ordered = model.blocks[1];
    expect(ordered).toBeDefined();
    if (ordered === undefined) {
      return;
    }
    expect(ordered.kind).toBe('ordered-list');
    if (ordered.kind === 'ordered-list') {
      expect(ordered.blocks).toHaveLength(2);
    }
  });

  it('层级跳变：0 → 2 直接嵌套（level 保留 2）；回到 1 时重新嵌套', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('a')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('deep')], { numbering: { ordered: false, level: 2 } }),
        sourceParagraph([sourceRun('mid')], { numbering: { ordered: false, level: 1 } }),
      ]),
    );
    const top = model.blocks[0];
    expect(top).toBeDefined();
    if (top === undefined) {
      return;
    }
    expect(top.kind).toBe('bullet-list');
    if (top.kind !== 'bullet-list') {
      return;
    }
    expect(top.level).toBe(0);
    expect(top.blocks).toEqual([
      paragraphBlock([{ text: 'a' }]),
      { kind: 'bullet-list', level: 2, blocks: [paragraphBlock([{ text: 'deep' }])] },
      { kind: 'bullet-list', level: 1, blocks: [paragraphBlock([{ text: 'mid' }])] },
    ]);
  });

  it('列表条目支持标题样式与 marks（编号优先于样式判断）', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('带格式条目', { isBold: true })], {
          styleName: 'Heading 1',
          numbering: { ordered: true, level: 0 },
        }),
      ]),
    );
    expect(model.blocks).toEqual([
      {
        kind: 'ordered-list',
        level: 0,
        blocks: [
          {
            kind: 'paragraph',
            alignment: null,
            runs: [{ text: '带格式条目', marks: [{ type: 'bold' }] }],
          },
        ],
      },
    ]);
  });

  it('5 层嵌套合法；层级钳制到 0-4', () => {
    const model = okModel(
      source([
        sourceParagraph([sourceRun('l0')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('l1')], { numbering: { ordered: false, level: 1 } }),
        sourceParagraph([sourceRun('l2')], { numbering: { ordered: false, level: 2 } }),
        sourceParagraph([sourceRun('l3')], { numbering: { ordered: false, level: 3 } }),
        sourceParagraph([sourceRun('l4')], { numbering: { ordered: false, level: 4 } }),
        sourceParagraph([sourceRun('l5clamp')], { numbering: { ordered: false, level: 99 } }),
      ]),
    );
    expect(validateDocxDocumentModel(model)).toEqual([]);
    const top = model.blocks[0];
    expect(top).toBeDefined();
    if (top === undefined) {
      return;
    }
    expect(top.kind).toBe('bullet-list');
    if (top.kind === 'bullet-list') {
      const l1 = top.blocks[1];
      expect(l1).toBeDefined();
      if (l1 === undefined) {
        return;
      }
      expect(l1.kind).toBe('bullet-list');
      if (l1.kind === 'bullet-list') {
        const l2 = l1.blocks[1];
        expect(l2).toBeDefined();
        if (l2 === undefined) {
          return;
        }
        expect(l2.kind).toBe('bullet-list');
        if (l2.kind === 'bullet-list') {
          const l3 = l2.blocks[1];
          expect(l3).toBeDefined();
          if (l3 === undefined) {
            return;
          }
          expect(l3.kind).toBe('bullet-list');
          if (l3.kind === 'bullet-list') {
            const l4 = l3.blocks[1];
            expect(l4).toBeDefined();
            if (l4 === undefined) {
              return;
            }
            expect(l4.kind).toBe('bullet-list');
            if (l4.kind === 'bullet-list') {
              // level 99 被钳制为 4：作为同级条目追加（不再嵌套）
              expect(l4.blocks[1]).toEqual(paragraphBlock([{ text: 'l5clamp' }]));
            }
          }
        }
      }
    }
  });
});

describe('importSourceToDocxModel：预算与兼容性等级', () => {
  it('块数超过上限返回 limit-exceeded(blocks)，不返回部分模型', () => {
    const blocks: DocxImportBlock[] = [];
    for (let i = 0; i < DOCX_MAX_MODEL_BLOCKS + 1; i += 1) {
      blocks.push(sourceParagraph([sourceRun(`p${i}`)]));
    }
    const result = importSourceToDocxModel(source(blocks));
    expect(result.status).toBe('limit-exceeded');
    if (result.status === 'limit-exceeded') {
      expect(result.reason).toBe('blocks');
    }
  });

  it('单段 run 数超过上限返回 limit-exceeded(runs)', () => {
    const runs: DocxImportRun[] = [];
    for (let i = 0; i < DOCX_MAX_RUNS_PER_BLOCK + 1; i += 1) {
      runs.push(sourceRun(`r${i}`, i % 2 === 0 ? { isBold: true } : {}));
    }
    const result = importSourceToDocxModel(source([sourceParagraph(runs)]));
    expect(result.status).toBe('limit-exceeded');
    if (result.status === 'limit-exceeded') {
      expect(result.reason).toBe('runs');
    }
  });

  it('supported / degraded / read-only 等级计算正确', () => {
    expect(okImport(source([sourceParagraph([sourceRun('x')])])).compatibility.level).toBe(
      'supported',
    );
    const degraded = okImport(source([{ type: 'table' }, sourceParagraph([sourceRun('x')])]));
    expect(degraded.compatibility.level).toBe('degraded');
    const readOnly = okImport(source([sourceParagraph([sourceRun('x')])], ['encrypted-protected']));
    expect(readOnly.compatibility.level).toBe('read-only');
  });

  it('导入产物模型必然通过校验', () => {
    const inputs: DocxImportSource[] = [
      source([
        sourceParagraph([sourceRun('a', { isBold: true, fontSize: 14, color: '#FF0000' })], {
          alignment: 'center',
        }),
      ]),
      source([
        sourceParagraph([sourceRun('h')], { styleName: '标题 1' }),
        sourceParagraph([sourceRun('b1')], { numbering: { ordered: false, level: 0 } }),
        sourceParagraph([sourceRun('n')], { numbering: { ordered: true, level: 1 } }),
      ]),
    ];
    for (const input of inputs) {
      const model = okModel(input);
      expect(validateDocxDocumentModel(model)).toEqual([]);
    }
  });
});

/* ======================= 模型 → Tiptap JSON ======================= */

describe('docxModelToTiptapJson', () => {
  const model: DocxDocumentModel = {
    schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
    blocks: [
      {
        kind: 'paragraph',
        alignment: 'both',
        runs: [
          { text: '粗体', marks: [{ type: 'bold' }] },
          {
            text: ' 红色大号',
            marks: [
              { type: 'color', value: '#FF0000' },
              { type: 'font-size', value: 14 },
            ],
          },
          { text: ' 普通', marks: [] },
        ],
      },
      { kind: 'heading', level: 2, runs: [{ text: '小标题', marks: [{ type: 'underline' }] }] },
      { kind: 'paragraph', alignment: null, runs: [] },
      {
        kind: 'bullet-list',
        level: 0,
        blocks: [
          { kind: 'paragraph', alignment: null, runs: [{ text: '条目一', marks: [] }] },
          { kind: 'paragraph', alignment: null, runs: [{ text: '条目二', marks: [] }] },
          {
            kind: 'ordered-list',
            level: 1,
            blocks: [
              { kind: 'paragraph', alignment: null, runs: [{ text: '嵌套编号', marks: [] }] },
            ],
          },
        ],
      },
    ],
  };

  it('段落/标题/对齐映射（both → justify）/marks（textStyle 合并）正确', () => {
    const json = docxModelToTiptapJson(model);
    expect(json.type).toBe('doc');
    const paragraph = json.content?.[0];
    expect(paragraph).toEqual({
      type: 'paragraph',
      attrs: { textAlign: 'justify' },
      content: [
        { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
        {
          type: 'text',
          text: ' 红色大号',
          marks: [{ type: 'textStyle', attrs: { color: '#FF0000', fontSize: '14px' } }],
        },
        { type: 'text', text: ' 普通' },
      ],
    });
    const heading = json.content?.[1];
    expect(heading).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '小标题', marks: [{ type: 'underline' }] }],
    });
  });

  it('空段落输出为无 content 的 paragraph', () => {
    const json = docxModelToTiptapJson(model);
    expect(json.content?.[2]).toEqual({ type: 'paragraph' });
  });

  it('列表条目分组：段落开新条目，嵌套列表追加到当前条目', () => {
    const json = docxModelToTiptapJson(model);
    const list = json.content?.[3];
    expect(list).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '条目一' }] }],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '条目二' }] },
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套编号' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

/* ======================= Tiptap JSON → 模型 ======================= */

describe('tiptapJsonToDocxModel', () => {
  it('合法 JSON 转换为模型：justify → both、颜色大写、字号解析、列表 level 由深度推导', () => {
    const result = tiptapJsonToDocxModel({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'justify' },
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '10.5px' } }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
                {
                  type: 'orderedList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.model.blocks).toEqual([
      {
        kind: 'paragraph',
        alignment: 'both',
        runs: [
          {
            text: 'x',
            marks: [
              { type: 'font-size', value: 10.5 },
              { type: 'color', value: '#FF0000' },
            ],
          },
        ],
      },
      {
        kind: 'bullet-list',
        level: 0,
        blocks: [
          { kind: 'paragraph', alignment: null, runs: [{ text: 'a', marks: [] }] },
          { kind: 'paragraph', alignment: null, runs: [{ text: 'b', marks: [] }] },
          {
            kind: 'ordered-list',
            level: 1,
            blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text: 'c', marks: [] }] }],
          },
        ],
      },
    ]);
    expect(validateDocxDocumentModel(result.model)).toEqual([]);
  });

  it('marks 乱序输入被规范化为规范顺序', () => {
    const result = tiptapJsonToDocxModel({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'italic' }, { type: 'bold' }, { type: 'underline' }],
            },
          ],
        },
      ],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.model.blocks[0]).toEqual({
        kind: 'paragraph',
        alignment: null,
        runs: [{ text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }],
      });
    }
  });

  it('相邻相同 marks 的文本节点合并；空文本节点丢弃', () => {
    const result = tiptapJsonToDocxModel({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'text', text: '' },
            { type: 'text', text: 'c' },
          ],
        },
      ],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.model.blocks[0]).toEqual({
        kind: 'paragraph',
        alignment: null,
        runs: [
          { text: 'ab', marks: [{ type: 'bold' }] },
          { text: 'c', marks: [] },
        ],
      });
    }
  });

  it('未知节点 / 未知 mark / 危险属性 / 越界值拒绝', () => {
    const cases: unknown[] = [
      { type: 'doc', content: [{ type: 'image' }] },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://x' } }] },
            ],
          },
        ],
      },
      { type: 'doc', content: [{ type: 'paragraph', attrs: { foo: 1 }, content: [] }] },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'textStyle', attrs: { background: 'red' } }],
              },
            ],
          },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
            ],
          },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'textStyle', attrs: { fontSize: '14' } }],
              },
            ],
          },
        ],
      },
      { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 }, content: [] }] },
      {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'text', text: '直接文本' }] }],
          },
        ],
      },
      {
        type: 'doc',
        content: [{ type: 'bulletList', content: [{ type: 'paragraph', content: [] }] }],
      },
      { type: 'doc', content: [{ type: 'listItem', content: [] }] },
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'paragraph', content: [] }] }],
      },
      null,
      'x',
      { type: 'doc', content: 'x' },
    ];
    for (const json of cases) {
      const result = tiptapJsonToDocxModel(json);
      expect(result.status, JSON.stringify(json)).toBe('invalid');
    }
  });

  it('列表嵌套深度超过上限拒绝', () => {
    let content: unknown = [{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }];
    for (let i = 0; i <= DOCX_MAX_LIST_DEPTH; i += 1) {
      content = [{ type: 'listItem', content }];
    }
    const result = tiptapJsonToDocxModel({
      type: 'doc',
      content: [{ type: 'bulletList', content }],
    });
    expect(result.status).toBe('invalid');
  });

  it('块数超过上限拒绝', () => {
    const content: unknown[] = [];
    for (let i = 0; i < DOCX_MAX_MODEL_BLOCKS + 1; i += 1) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] });
    }
    const result = tiptapJsonToDocxModel({ type: 'doc', content });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.violations.join(' ')).toContain('块数超过上限');
    }
  });
});

/* ======================= 往返 ======================= */

describe('模型 ↔ Tiptap JSON 往返', () => {
  it('规范模型往返后完全一致', () => {
    const model: DocxDocumentModel = {
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [
        { kind: 'paragraph', alignment: 'center', runs: [{ text: '居中', marks: [] }] },
        {
          kind: 'paragraph',
          alignment: null,
          runs: [
            { text: '粗斜', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { text: ' 下划线', marks: [{ type: 'underline' }] },
          ],
        },
        {
          kind: 'heading',
          level: 3,
          runs: [{ text: '三号标题', marks: [{ type: 'color', value: '#336699' }] }],
        },
        { kind: 'paragraph', alignment: null, runs: [] },
        {
          kind: 'ordered-list',
          level: 0,
          blocks: [
            { kind: 'paragraph', alignment: null, runs: [{ text: '第一', marks: [] }] },
            {
              kind: 'paragraph',
              alignment: 'right',
              runs: [{ text: '第二（右对齐）', marks: [] }],
            },
            {
              kind: 'bullet-list',
              level: 1,
              blocks: [
                { kind: 'paragraph', alignment: null, runs: [{ text: '嵌套项', marks: [] }] },
              ],
            },
          ],
        },
        {
          kind: 'bullet-list',
          level: 0,
          blocks: [
            { kind: 'paragraph', alignment: 'both', runs: [{ text: '两端对齐项', marks: [] }] },
          ],
        },
      ],
    };
    const json = docxModelToTiptapJson(model);
    const back = tiptapJsonToDocxModel(json);
    expect(back.status).toBe('ok');
    if (back.status === 'ok') {
      expect(back.model).toEqual(model);
    }
  });

  it('导入 → 模型 → Tiptap JSON → 模型：列表与 marks 语义保持', () => {
    const imported = okImport(
      source([
        sourceParagraph([sourceRun('b1', { isBold: true })], {
          numbering: { ordered: false, level: 0 },
        }),
        sourceParagraph([sourceRun('n')], { numbering: { ordered: false, level: 1 } }),
        sourceParagraph([sourceRun('o1')], { numbering: { ordered: true, level: 0 } }),
      ]),
    );
    const json = docxModelToTiptapJson(imported.model);
    const back = tiptapJsonToDocxModel(json);
    expect(back.status).toBe('ok');
    if (back.status === 'ok') {
      expect(back.model).toEqual(imported.model);
    }
  });
});

/* ======================= 模型 → 导出描述 ======================= */

describe('docxModelToExportDescription', () => {
  it('拍平嵌套列表为带 (ordered, level) 的段落序列', () => {
    const model: DocxDocumentModel = {
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [
        { kind: 'heading', level: 1, runs: [{ text: '标题', marks: [] }] },
        {
          kind: 'paragraph',
          alignment: 'center',
          runs: [{ text: '正文', marks: [{ type: 'bold' }] }],
        },
        {
          kind: 'bullet-list',
          level: 0,
          blocks: [
            { kind: 'paragraph', alignment: null, runs: [{ text: '条目一', marks: [] }] },
            { kind: 'paragraph', alignment: null, runs: [{ text: '条目二', marks: [] }] },
            {
              kind: 'ordered-list',
              level: 1,
              blocks: [
                { kind: 'paragraph', alignment: null, runs: [{ text: '嵌套编号', marks: [] }] },
              ],
            },
          ],
        },
      ],
    };
    const description = docxModelToExportDescription(model);
    expect(description.paragraphs).toEqual([
      {
        kind: 'heading',
        headingLevel: 1,
        alignment: null,
        list: null,
        runs: [{ text: '标题', marks: [] }],
      },
      {
        kind: 'paragraph',
        headingLevel: null,
        alignment: 'center',
        list: null,
        runs: [{ text: '正文', marks: [{ type: 'bold' }] }],
      },
      {
        kind: 'paragraph',
        headingLevel: null,
        alignment: null,
        list: { ordered: false, level: 0 },
        runs: [{ text: '条目一', marks: [] }],
      },
      {
        kind: 'paragraph',
        headingLevel: null,
        alignment: null,
        list: { ordered: false, level: 0 },
        runs: [{ text: '条目二', marks: [] }],
      },
      {
        kind: 'paragraph',
        headingLevel: null,
        alignment: null,
        list: { ordered: true, level: 1 },
        runs: [{ text: '嵌套编号', marks: [] }],
      },
    ]);
  });
});
