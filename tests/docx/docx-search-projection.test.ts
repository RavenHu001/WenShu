// @vitest-environment node
/**
 * TASK-008 WP0 技术验证：DOCX 规范正文投影与 ProseMirror 文本块映射（任务第 3.3 节）。
 *
 * ## 冻结的投影规则（任务第 4.3 节，WP0 冻结后 WP1 固化到 `src/shared/docx-search-text.ts`）
 *
 * 1. 按文档顺序深度优先遍历模型；
 * 2. 普通段落与标题各形成一个文本块；
 * 3. 列表块自身不产生文字，列表内段落/标题按深度优先顺序形成文本块；
 * 4. 单个文本块内容为全部 run 的 `text` 原样连接，marks/字号/颜色/对齐/标题等级
 *    与列表序号不进入搜索文本；
 * 5. 相邻文本块之间插入恰好一个人工 `\n`；
 * 6. 空段落仍保留为空文本块和相邻分隔边界；
 * 7. 不在文档开头或结尾额外插入换行；
 * 8. 投影偏移使用 UTF-16 code unit，与 JavaScript 字符串和 ProseMirror 文本位置一致；
 * 9. 投影结果携带仅供进程内映射使用的文本块序号、投影 `from/to` 与块正文；
 * 10. 投影函数不依赖 Electron、Node.js、Mammoth、Tiptap、ProseMirror、DOM 或文件系统。
 *
 * 本文件中的 `projectDocxModelSearchText` 是测试脚手架（与 TASK-007 WP0 的
 * `mammothToImportSource` 同类）：WP1 把同一规则实现为产品模块；本文件同时用
 * 真实 ProseMirror schema（与产品 DOCX_EDITOR_EXTENSIONS 相同扩展链）验证
 * "模型投影与由同一模型生成的 Tiptap/ProseMirror 文本块投影一致"。
 */

import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  DOCX_MAX_MODEL_BLOCKS,
  type DocxBlock,
  type DocxDocumentModel,
  type DocxImportSource,
} from '../../src/shared/docx';
import { docxModelToTiptapJson, importSourceToDocxModel } from '../../src/shared/docx-convert';
import { inspectDocxPackage } from '../../src/main/docx/inspect-docx-package';
import { importDocxDocument } from '../../src/main/docx/import-docx';
import { matchText } from '../../src/main/search/match-text';
import { buildDocxFixtures } from './docx-fixture-builder';
import { projectDocxModelSearchText } from './docx-search-projection-scaffold';

/* ======================= ProseMirror 侧文本块投影（公开 API） ======================= */

/** 与产品 `DOCX_EDITOR_EXTENSIONS` 相同的扩展链（link 输入关闭）。 */
const schema = getSchema([
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]);

export interface PmTextBlock {
  readonly text: string;
  /** textblock 节点的起始位置（公开 position API）。 */
  readonly pos: number;
  readonly nodeSize: number;
}

/** 通过 ProseMirror 公开节点 API 收集全部 textblock：顺序与模型深度优先一致。 */
function pmTextBlocks(doc: PmNode): readonly PmTextBlock[] {
  const blocks: PmTextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ text: node.textContent, pos, nodeSize: node.nodeSize });
    }
    return true;
  });
  return blocks;
}

/** 模型 → Tiptap JSON → ProseMirror 文档（公开 schema API，无 DOM）。 */
function modelToPmDoc(model: DocxDocumentModel): PmNode {
  return schema.nodeFromJSON(docxModelToTiptapJson(model) as unknown as Record<string, unknown>);
}

/* ======================= 模型样例 ======================= */

function paragraph(text: string): DocxBlock {
  // 产品模型（导入/转换）不会产生空文本 run：空 run 在导入与 Tiptap JSON 转换中都被跳过，
  // 且 ProseMirror nodeFromJSON 拒绝空 text 节点。空文本按 runs: [] 建模（与产品一致）。
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

const MARKS_MODEL = modelOf([
  heading(1, '一级标题'),
  {
    kind: 'paragraph',
    alignment: 'center',
    runs: [
      { text: '粗体', marks: [{ type: 'bold' }] },
      { text: '与', marks: [] },
      { text: '斜体', marks: [{ type: 'italic' }] },
      {
        text: ' 红色',
        marks: [
          { type: 'color', value: '#FF0000' },
          { type: 'font-size', value: 14 },
        ],
      },
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

/* ======================= 验证 ======================= */

describe('DOCX 规范正文投影（TASK-008 WP0，第 4.3 节冻结规则）', () => {
  it('空模型：空投影文本、无文本块', () => {
    const projection = projectDocxModelSearchText(modelOf([]));
    expect(projection.text).toBe('');
    expect(projection.blocks).toEqual([]);
  });

  it('单段：块文本即 run 连接，无额外换行', () => {
    const projection = projectDocxModelSearchText(modelOf([paragraph('只有一段')]));
    expect(projection.text).toBe('只有一段');
    expect(projection.blocks).toEqual([{ ordinal: 0, from: 0, to: 4, text: '只有一段' }]);
  });

  it('多段与空段：恰好一个人工换行、开头结尾无额外换行、空段保留', () => {
    const projection = projectDocxModelSearchText(
      modelOf([paragraph('第一段'), paragraph(''), paragraph('第三段')]),
    );
    expect(projection.text).toBe('第一段\n\n第三段');
    expect(projection.blocks).toEqual([
      { ordinal: 0, from: 0, to: 3, text: '第一段' },
      { ordinal: 1, from: 4, to: 4, text: '' },
      { ordinal: 2, from: 5, to: 8, text: '第三段' },
    ]);
  });

  it('标题 1-3 各形成一个文本块，级别不进入搜索文本', () => {
    const projection = projectDocxModelSearchText(
      modelOf([heading(1, '甲'), heading(2, '乙'), heading(3, '丙')]),
    );
    expect(projection.text).toBe('甲\n乙\n丙');
    expect(projection.blocks.map((b) => b.text)).toEqual(['甲', '乙', '丙']);
  });

  it('marks/字号/颜色/对齐不进入投影；run 原样拼接', () => {
    const projection = projectDocxModelSearchText(MARKS_MODEL);
    expect(projection.blocks[1]!.text).toBe('粗体与斜体 红色');
    expect(projection.text).toContain('粗体与斜体');
  });

  it('列表块自身无文字；条目按深度优先形成文本块（与嵌套结构无关）', () => {
    const projection = projectDocxModelSearchText(MARKS_MODEL);
    const expected = [
      '一级标题',
      '粗体与斜体 红色',
      '',
      '项目甲',
      '项目乙',
      '嵌套项目',
      '编号一',
      '编号二',
      '嵌套编号',
      'emoji 🎉 与组合字符 e\u0301 结尾',
    ];
    expect(projection.blocks.map((b) => b.text)).toEqual(expected);
    expect(projection.text).toBe(expected.join('\n'));
  });

  it('UTF-16 偏移：中文、emoji 代理对与组合字符按 code unit 计数', () => {
    const projection = projectDocxModelSearchText(MARKS_MODEL);
    const last = projection.blocks[projection.blocks.length - 1]!;
    // 'emoji 🎉 与组合字符 e\u0301 结尾'：🎉 占 2 个 code unit
    const emojiIndex = last.text.indexOf('🎉');
    expect(emojiIndex).toBe(6); // 'emoji ' 6 个单元
    expect(last.from + emojiIndex).toBe(projection.text.indexOf('🎉'));
    // 组合字符 e + U+0301 是两个独立 code unit
    const combining = last.text.indexOf('e\u0301');
    expect(combining).toBeGreaterThan(0);
    expect(last.text.charCodeAt(combining + 1)).toBe(0x0301);
  });

  it('run 内原生换行保留在块文本中，不产生额外文本块', () => {
    const projection = projectDocxModelSearchText(
      modelOf([
        {
          kind: 'paragraph',
          alignment: null,
          runs: [{ text: '第一行\n第二行', marks: [] }],
        },
      ]),
    );
    expect(projection.blocks).toHaveLength(1);
    expect(projection.text).toBe('第一行\n第二行');
    expect(projection.blocks[0]).toEqual({ ordinal: 0, from: 0, to: 7, text: '第一行\n第二行' });
  });

  it('查询不跨块：合法（无换行）查询的每个匹配完整落在单个文本块内', () => {
    const projection = projectDocxModelSearchText(MARKS_MODEL);
    const queries = ['粗体与斜体', '项目乙', '嵌套项目', '编号二', 'emoji', '一级标题', '结尾'];
    for (const query of queries) {
      const outcome = matchText(projection.text, query, { caseSensitive: true });
      for (const match of outcome.matches) {
        const block = projection.blocks.find((b) => b.from <= match.from && match.to <= b.to);
        expect(block, `查询 ${query} 的匹配必须完整位于一个文本块内`).toBeDefined();
      }
    }
  });

  it('预算级模型：20,000 块线性投影、边界偏移正确且耗时可控', () => {
    const blocks: DocxBlock[] = [];
    for (let i = 0; i < DOCX_MAX_MODEL_BLOCKS; i += 1) {
      blocks.push(paragraph(`段落${i}文本`));
    }
    const started = Date.now();
    const projection = projectDocxModelSearchText(modelOf(blocks));
    const elapsed = Date.now() - started;
    expect(projection.blocks).toHaveLength(DOCX_MAX_MODEL_BLOCKS);
    expect(projection.blocks[0]!.from).toBe(0);
    // 相邻块之间恰好一个 `\n`：from 链与 to 链连续（块序号/偏移不变量）
    for (let i = 1; i < projection.blocks.length; i += 1) {
      expect(projection.blocks[i]!.from).toBe(projection.blocks[i - 1]!.to + 1);
    }
    expect(projection.blocks[19999]!.text).toBe('段落19999文本');
    expect(projection.blocks[19999]!.to).toBe(projection.text.length);
    expect(projection.blocks[19999]!.from).toBeGreaterThan(19999);
    // WP0 冻结性能目标：最大合法模型投影在宽松预算内（受控环境抖动不误报）
    expect(elapsed).toBeLessThan(5_000);
  });
});

/* ======================= 投影 ↔ ProseMirror 文本块等价 ======================= */

describe('模型投影与 ProseMirror 文本块一致（TASK-008 WP0，第 3.3 节）', () => {
  it('MARKS_MODEL：文本块顺序、正文与 UTF-16 长度逐块一致', () => {
    const projection = projectDocxModelSearchText(MARKS_MODEL);
    const pmDoc = modelToPmDoc(MARKS_MODEL);
    const pmBlocks = pmTextBlocks(pmDoc);
    expect(pmBlocks.map((b) => b.text)).toEqual(projection.blocks.map((b) => b.text));
    // PM 公开位置映射：内容区间 [pos+1, pos+nodeSize-1) 与块投影偏移长度一致
    projection.blocks.forEach((block, index) => {
      const pm = pmBlocks[index]!;
      expect(pm.nodeSize - 2).toBe(block.text.length);
      expect(pmDoc.textBetween(pm.pos + 1, pm.pos + pm.nodeSize - 1)).toBe(block.text);
    });
  });

  it('空段落映射为空 PM textblock 且内容区间为空', () => {
    const projection = projectDocxModelSearchText(
      modelOf([paragraph('a'), paragraph(''), paragraph('b')]),
    );
    const pmBlocks = pmTextBlocks(
      modelToPmDoc(projection && modelOf([paragraph('a'), paragraph(''), paragraph('b')])),
    );
    expect(pmBlocks.map((b) => b.text)).toEqual(['a', '', 'b']);
    const emptyIndex = pmBlocks.findIndex((b) => b.text === '');
    const empty = pmBlocks[emptyIndex]!;
    expect(pmBlocks[emptyIndex]!.nodeSize).toBe(2);
    expect(empty.pos + 1).toBe(empty.pos + empty.nodeSize - 1);
  });

  it('夹具真实导入（Mammoth + 产品导入器）的模型投影与 PM 文本块一致', async () => {
    const fixtures = await buildDocxFixtures();
    const ids = [
      'ok-plain',
      'ok-headings',
      'ok-marks',
      'ok-font-size-color',
      'ok-lists',
      'ok-alignment',
      'ok-combining-emoji',
      'ok-projection-mixed',
      'ok-read-only',
    ];
    for (const id of ids) {
      const inspection = await inspectDocxPackage(fixtures.files[id]!);
      expect(inspection.status, id).toBe('ok');
      if (inspection.status !== 'ok') {
        continue;
      }
      const imported = await importDocxDocument(fixtures.files[id]!, inspection.inspection);
      expect(imported.status, id).toBe('ok');
      if (imported.status !== 'ok') {
        continue;
      }
      const model = imported.model;
      const projection = projectDocxModelSearchText(model);
      const pmBlocks = pmTextBlocks(modelToPmDoc(model));
      expect(
        pmBlocks.map((b) => b.text),
        `${id} 文本块正文`,
      ).toEqual(projection.blocks.map((b) => b.text));
      projection.blocks.forEach((block, index) => {
        const pm = pmBlocks[index]!;
        expect(pm.nodeSize - 2, `${id} 块 ${index} UTF-16 长度`).toBe(block.text.length);
      });
      // 空模型特例：ok-empty 无块，PM 侧也无 textblock
      if (id === 'ok-empty') {
        expect(projection.blocks).toEqual([]);
      }
    }
  });

  it('ok-empty 空文档：投影与 PM 均无文本块', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await inspectDocxPackage(fixtures.files['ok-empty']!);
    expect(inspection.status).toBe('ok');
    if (inspection.status !== 'ok') {
      return;
    }
    const imported = await importDocxDocument(fixtures.files['ok-empty']!, inspection.inspection);
    expect(imported.status).toBe('ok');
    if (imported.status !== 'ok') {
      return;
    }
    const model = imported.model;
    expect(model.blocks).toEqual([]);
    expect(projectDocxModelSearchText(model).blocks).toEqual([]);
    expect(pmTextBlocks(modelToPmDoc(model))).toEqual([]);
  });
});

/* ======================= 投影脚手架语义自检（导入转换复用） ======================= */

describe('投影脚手架与导入转换一致性', () => {
  it('ok-projection-mixed 夹具经完整导入后的投影文本与预期一致', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await inspectDocxPackage(fixtures.files['ok-projection-mixed']!);
    expect(inspection.status).toBe('ok');
    if (inspection.status !== 'ok') {
      return;
    }
    const imported = await importDocxDocument(
      fixtures.files['ok-projection-mixed']!,
      inspection.inspection,
    );
    expect(imported.status).toBe('ok');
    if (imported.status !== 'ok') {
      return;
    }
    const projection = projectDocxModelSearchText(imported.model);
    expect(projection.blocks.map((b) => b.text)).toEqual([
      '投影标题',
      '粗体与斜体 跨 run 可匹配 English text.',
      '',
      '项目甲',
      '项目乙',
      '嵌套项目',
      '编号一',
      '编号二',
      '嵌套编号',
      '普通段落 emoji 🎉 结尾',
    ]);
  });

  it('导入源脚手架（mammothToImportSource 等价输入）不改变投影语义', () => {
    const source: DocxImportSource = {
      documentFeatures: [],
      blocks: [
        {
          type: 'paragraph',
          styleId: 'Heading1',
          styleName: 'Heading 1',
          alignment: null,
          numbering: null,
          runs: [
            {
              text: '标题甲',
              isBold: false,
              isItalic: false,
              isUnderline: false,
              fontSize: null,
              color: null,
              features: [],
            },
          ],
        },
      ],
    };
    const converted = importSourceToDocxModel(source);
    expect(converted.status).toBe('ok');
    if (converted.status !== 'ok') {
      return;
    }
    const projection = projectDocxModelSearchText(converted.model);
    expect(projection.text).toBe('标题甲');
  });
});
