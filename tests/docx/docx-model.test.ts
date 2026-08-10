/**
 * TASK-007 WP1：DocxDocumentModel 运行时校验、固定预算与兼容性报告测试（任务第 8.2 节）。
 * 覆盖：合法模型、全部非法结构、schemaVersion 拒绝、节点/文本/marks/列表深度/序列化预算、
 * 兼容性等级计算与警告去重排序。
 */

import { describe, expect, it } from 'vitest';
import {
  DOCX_MAX_LIST_DEPTH,
  DOCX_MAX_LIST_LEVEL,
  DOCX_MAX_MARKS_PER_RUN,
  DOCX_MAX_MODEL_BLOCKS,
  DOCX_MAX_MODEL_SERIALIZED_BYTES,
  DOCX_MAX_RUNS_PER_BLOCK,
  DOCX_MAX_RUN_TEXT_UTF16,
  DOCX_MODEL_SCHEMA_VERSION,
  docxCompatibilityReport,
  docxCompatibilityWarning,
  isValidDocxDocumentModel,
  validateDocxDocumentModel,
  type DocxBlock,
  type DocxDocumentModel,
  type DocxTextMark,
  type DocxTextRun,
} from '../../src/shared/docx';

function run(text: string, marks: readonly DocxTextMark[] = []): DocxTextRun {
  return { text, marks };
}

function para(runs: readonly DocxTextRun[]): DocxDocumentModel {
  return {
    schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
    blocks: [{ kind: 'paragraph', alignment: null, runs }],
  };
}

function modelWith(blocks: DocxDocumentModel['blocks']): DocxDocumentModel {
  return { schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks };
}

describe('validateDocxDocumentModel：合法模型', () => {
  it('空文档合法', () => {
    expect(validateDocxDocumentModel(modelWith([]))).toEqual([]);
    expect(isValidDocxDocumentModel(modelWith([]))).toBe(true);
  });

  it('段落/标题/列表/全部 marks/对齐合法', () => {
    const model = modelWith([
      {
        kind: 'paragraph',
        alignment: 'center',
        runs: [
          run('正文', [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'font-size', value: 10.5 },
            { type: 'color', value: '#FF0000' },
          ]),
        ],
      },
      { kind: 'heading', level: 2, runs: [run('标题')] },
      {
        kind: 'bullet-list',
        level: 0,
        blocks: [{ kind: 'paragraph', alignment: null, runs: [run('条目')] }],
      },
      {
        kind: 'ordered-list',
        level: 1,
        blocks: [{ kind: 'paragraph', alignment: 'right', runs: [run('编号条目')] }],
      },
    ]);
    expect(validateDocxDocumentModel(model)).toEqual([]);
  });

  it('空段落（无 run）与空 run 文本合法', () => {
    expect(validateDocxDocumentModel(para([]))).toEqual([]);
    expect(validateDocxDocumentModel(para([run('')]))).toEqual([]);
  });

  it('列表嵌套到最大深度合法（5 层）', () => {
    // 结构：[p0, L0[p1, L1[p2, L2[p3, L3[p4]]]]]，每个列表块首条目为段落
    let blocks: DocxDocumentModel['blocks'] = [
      { kind: 'paragraph', alignment: null, runs: [run('最深条目')] },
    ];
    for (let level = DOCX_MAX_LIST_DEPTH - 1; level >= 0; level -= 1) {
      blocks = [
        { kind: 'paragraph', alignment: null, runs: [run(`层 ${level}`)] },
        { kind: 'bullet-list', level, blocks },
      ];
    }
    expect(validateDocxDocumentModel(modelWith(blocks))).toEqual([]);
  });
});

describe('validateDocxDocumentModel：非法结构', () => {
  it('非普通对象 / 缺失 blocks / blocks 非数组', () => {
    expect(validateDocxDocumentModel(null)).not.toEqual([]);
    expect(validateDocxDocumentModel('x')).not.toEqual([]);
    expect(validateDocxDocumentModel([])).not.toEqual([]);
    expect(validateDocxDocumentModel({ schemaVersion: DOCX_MODEL_SCHEMA_VERSION })).not.toEqual([]);
    expect(
      validateDocxDocumentModel({ schemaVersion: DOCX_MODEL_SCHEMA_VERSION, blocks: 'x' }),
    ).not.toEqual([]);
  });

  it('未知 schemaVersion 必须拒绝，不猜测迁移', () => {
    const violations = validateDocxDocumentModel({ schemaVersion: 2, blocks: [] });
    expect(violations.join(' ')).toContain('未知 schemaVersion');
    expect(validateDocxDocumentModel({ schemaVersion: 0, blocks: [] }).join(' ')).toContain(
      '未知 schemaVersion',
    );
  });

  it('未知块类型 / 块非对象', () => {
    expect(validateDocxDocumentModel(modelWith([{ kind: 'image' } as never]))).not.toEqual([]);
    expect(validateDocxDocumentModel(modelWith([null as never]))).not.toEqual([]);
    expect(validateDocxDocumentModel(modelWith(['x' as never]))).not.toEqual([]);
  });

  it('段落：非法对齐 / 缺少 runs / runs 非数组 / run 非法', () => {
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'paragraph', alignment: 'middle' as never, runs: [] }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'paragraph', alignment: null } as never])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'paragraph', alignment: null, runs: 'x' as never }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'paragraph', alignment: null, runs: [null as never] }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'paragraph', alignment: null, runs: [{} as never] }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'paragraph', alignment: null, runs: [run(1 as never)] }]),
      ),
    ).not.toEqual([]);
  });

  it('标题：级别只能是 1-3', () => {
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'heading', level: 0 as never, runs: [] }])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'heading', level: 4 as never, runs: [] }])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'heading', level: 1.5 as never, runs: [] }])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'heading', level: '1' as never, runs: [] }])),
    ).not.toEqual([]);
  });

  it('marks：未知类型 / 额外字段 / 重复 / 乱序', () => {
    expect(validateDocxDocumentModel(para([run('x', [{ type: 'strike' } as never])]))).not.toEqual(
      [],
    );
    expect(
      validateDocxDocumentModel(para([run('x', [{ type: 'bold', extra: 1 } as never])])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(para([run('x', [{ type: 'bold' }, { type: 'bold' }])])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(para([run('x', [{ type: 'italic' }, { type: 'bold' }])])),
    ).not.toEqual([]);
  });

  it('font-size：越界与非数字拒绝', () => {
    for (const value of [0, -1, 1639, Number.NaN, Number.POSITIVE_INFINITY, '14' as never]) {
      const violations = validateDocxDocumentModel(
        para([run('x', [{ type: 'font-size', value } as never])]),
      );
      expect(violations.join(' ')).toContain('字号越界');
    }
    expect(
      validateDocxDocumentModel(para([run('x', [{ type: 'font-size', value: 1638 }])])),
    ).toEqual([]);
  });

  it('color：必须为规范大写 #RRGGBB', () => {
    for (const value of ['#ff0000', 'FF0000', '#FFF', '#GGGGGG', '', 1 as never]) {
      const violations = validateDocxDocumentModel(
        para([run('x', [{ type: 'color', value } as never])]),
      );
      expect(violations.join(' ')).toContain('颜色必须是规范');
    }
    expect(
      validateDocxDocumentModel(para([run('x', [{ type: 'color', value: '#336699' }])])),
    ).toEqual([]);
  });

  it('列表：层级越界 / 空列表 / 首条目为列表 / 深度越界', () => {
    expect(
      validateDocxDocumentModel(
        modelWith([
          { kind: 'bullet-list', level: DOCX_MAX_LIST_LEVEL + 1, blocks: [para([]).blocks[0]!] },
        ]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'bullet-list', level: -1, blocks: [para([]).blocks[0]!] }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([{ kind: 'bullet-list', level: 0.5, blocks: [para([]).blocks[0]!] }]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(modelWith([{ kind: 'bullet-list', level: 0, blocks: [] }])),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([
          {
            kind: 'bullet-list',
            level: 0,
            blocks: [{ kind: 'bullet-list', level: 1, blocks: [para([]).blocks[0]!] }],
          },
        ]),
      ),
    ).not.toEqual([]);
    expect(
      validateDocxDocumentModel(
        modelWith([
          {
            kind: 'bullet-list',
            level: 0,
            blocks: [
              para([]).blocks[0]!,
              {
                kind: 'ordered-list',
                level: 1,
                blocks: [
                  para([]).blocks[0]!,
                  {
                    kind: 'bullet-list',
                    level: 2,
                    blocks: [
                      para([]).blocks[0]!,
                      {
                        kind: 'ordered-list',
                        level: 3,
                        blocks: [
                          para([]).blocks[0]!,
                          {
                            kind: 'bullet-list',
                            level: 4,
                            blocks: [
                              para([]).blocks[0]!,
                              {
                                kind: 'ordered-list',
                                level: 5,
                                blocks: [para([]).blocks[0]!],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ).join(' '),
    ).toContain('列表嵌套深度');
  });
});

describe('validateDocxDocumentModel：固定预算', () => {
  it('块数超过上限拒绝（含嵌套列表条目块的计数）', () => {
    const blocks: DocxBlock[] = [];
    for (let i = 0; i < DOCX_MAX_MODEL_BLOCKS + 1; i += 1) {
      blocks.push({ kind: 'paragraph', alignment: null, runs: [run('x')] });
    }
    expect(validateDocxDocumentModel(modelWith(blocks)).join(' ')).toContain('模型块数超过上限');
    // 顶层块数未超限但嵌套条目使总块数超限：预算按全部块（含嵌套）计数
    const nestedBlocks: DocxBlock[] = [];
    for (let i = 0; i < 15_000; i += 1) {
      nestedBlocks.push({
        kind: 'bullet-list',
        level: 0,
        blocks: [
          { kind: 'paragraph', alignment: null, runs: [run('a')] },
          { kind: 'paragraph', alignment: null, runs: [run('b')] },
        ],
      });
    }
    expect(validateDocxDocumentModel(modelWith(nestedBlocks)).join(' ')).toContain(
      '模型块数超过上限',
    );
  });
  it('单块 run 数超过上限拒绝（513 个交替格式 run）', () => {
    const runs: DocxTextRun[] = [];
    for (let i = 0; i < DOCX_MAX_RUNS_PER_BLOCK + 1; i += 1) {
      runs.push(run(`r${i}`, i % 2 === 0 ? [{ type: 'bold' }] : []));
    }
    expect(validateDocxDocumentModel(para(runs)).join(' ')).toContain('run 数超过上限');
  });

  it('单 run 文本超过上限拒绝（4097 UTF-16 单元）', () => {
    expect(
      validateDocxDocumentModel(para([run('x'.repeat(DOCX_MAX_RUN_TEXT_UTF16 + 1))])).join(' '),
    ).toContain('run 文本超过上限');
    expect(validateDocxDocumentModel(para([run('x'.repeat(DOCX_MAX_RUN_TEXT_UTF16))]))).toEqual([]);
  });

  it('marks 数超过上限拒绝（9 个重复 mark）', () => {
    const marks: DocxTextMark[] = [];
    for (let i = 0; i < DOCX_MAX_MARKS_PER_RUN + 1; i += 1) {
      marks.push({ type: 'bold' });
    }
    expect(validateDocxDocumentModel(para([run('x', marks)])).join(' ')).toContain(
      'marks 数超过上限',
    );
  });

  it('序列化大小超过上限拒绝（3 000 块 × 4000 字符文本）', () => {
    // 每块文本 4000 < 4096 单 run 上限，总文本约 12M 字符 > 8 MiB
    const blocks: DocxBlock[] = [];
    for (let i = 0; i < 3000; i += 1) {
      blocks.push({ kind: 'paragraph', alignment: null, runs: [run('y'.repeat(4000))] });
    }
    const violations = validateDocxDocumentModel(modelWith(blocks));
    expect(violations.join(' ')).toContain('模型序列化大小超过上限');
    void DOCX_MAX_MODEL_SERIALIZED_BYTES;
  });
});

describe('docxCompatibilityReport', () => {
  it('无警告 → supported', () => {
    const report = docxCompatibilityReport([]);
    expect(report.level).toBe('supported');
    expect(report.warnings).toEqual([]);
  });

  it('有可降级警告 → degraded，去重并按规范顺序', () => {
    const report = docxCompatibilityReport([
      [docxCompatibilityWarning('table'), docxCompatibilityWarning('image')],
      [docxCompatibilityWarning('table')],
    ]);
    expect(report.level).toBe('degraded');
    expect(report.warnings.map((w) => w.code)).toEqual(['image', 'table']);
  });

  it('含只读码 → read-only', () => {
    const report = docxCompatibilityReport([[docxCompatibilityWarning('encrypted-protected')]]);
    expect(report.level).toBe('read-only');
    const report2 = docxCompatibilityReport([[docxCompatibilityWarning('embedded-object')]]);
    expect(report2.level).toBe('read-only');
    // 只读码与降级码混合仍为 read-only
    const report3 = docxCompatibilityReport([
      [docxCompatibilityWarning('encrypted-protected'), docxCompatibilityWarning('image')],
    ]);
    expect(report3.level).toBe('read-only');
    expect(report3.warnings.map((w) => w.code)).toEqual(['image', 'encrypted-protected']);
  });

  it('警告消息稳定且不含内部信息', () => {
    for (const code of [
      'image',
      'table',
      'header-footer',
      'comment',
      'revision',
      'field',
      'formula',
      'embedded-object',
      'hyperlink',
      'unknown-style',
      'heading-level-unsupported',
      'encrypted-protected',
      'other-unrecognized',
    ] as const) {
      const warning = docxCompatibilityWarning(code);
      expect(warning.message.length).toBeGreaterThan(0);
      expect(JSON.stringify(warning)).not.toContain('\\');
    }
  });
});
