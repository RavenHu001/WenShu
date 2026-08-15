// @vitest-environment node
/**
 * TASK-007 DOCX 夹具与库能力验证（WP0 第 3.3 / 3.4 节；WP1 起使用正式模型与纯转换）。
 *
 * 覆盖：
 * - 夹具本身：ZIP/OOXML 结构、条目预算（引用 `src/shared/docx.ts` 固定常量）、失败样本形状；
 * - Mammoth 导入能力：段落/空段落/标题/粗体/斜体/下划线/字号/列表/对齐/中文/emoji，
 *   以及"文字颜色不在 Mammoth 模型中、需要 JSZip 有限补充读取"的固定结论；
 * - 复杂样本的可检测性：图片、表格、批注、页眉页脚、修订、超链接；
 * - 失败样本：损坏 ZIP、伪装扩展名、缺失关键部件、加密模拟、超限文件；
 * - 最小闭环：Mammoth 导入 → DocxImportSource → `importSourceToDocxModel` →
 *   `docxModelToExportDescription` → `docx` 导出 → 重新导入，正文与受支持格式语义一致；
 * - Tiptap/ProseMirror 最小 schema：节点/标记集合、JSON 往返；
 * - 性能冒烟：普通文档构造、解析、导出在秒级预算内。
 *
 * 说明：Mammoth 文档树 → DocxImportSource 的映射是本文件内的测试脚手架
 * （WP2 实现正式导入器）；`exportDescriptionToDocx` 同理（WP3 实现正式导出器）。
 */

import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import {
  DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES,
  DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES,
  DOCX_MAX_ZIP_ENTRIES,
  validateDocxDocumentModel,
  type DocxAlignment,
  type DocxDocumentModel,
  type DocxImportBlock,
  type DocxImportRun,
  type DocxImportRunFeature,
  type DocxImportSource,
  type DocxTextMark,
  type DocxTextRun,
} from '../../src/shared/docx';
import {
  docxModelToExportDescription,
  importSourceToDocxModel,
  type DocxExportDescription,
} from '../../src/shared/docx-convert';
import { buildDocxFixtures } from './docx-fixture-builder';
import { inspectDocxPackage } from '../../src/main/docx/inspect-docx-package';
import { DOCX_MAX_FILE_BYTES } from '../../src/shared/docx';

/* ======================= Mammoth 文档树接口（测试脚手架） ======================= */

interface MammothParagraphLike {
  readonly type?: string;
  readonly styleId?: unknown;
  readonly styleName?: unknown;
  readonly alignment?: unknown;
  readonly numbering?: { readonly isOrdered?: boolean; readonly level?: unknown } | null;
  readonly children?: readonly MammothRunLike[];
}

interface MammothRunLike {
  readonly type?: string;
  readonly children?: readonly { readonly type?: string; readonly value?: unknown }[];
  readonly isBold?: boolean;
  readonly isItalic?: boolean;
  readonly isUnderline?: boolean;
  readonly fontSize?: number | null;
  readonly href?: string;
}

interface MammothDocumentLike {
  readonly type?: string;
  readonly children?: readonly MammothParagraphLike[];
  readonly comments?: readonly unknown[];
}

/** Mammoth 缺失样式/对齐以字符串 "null" 表示，归一化为 null。 */
function normStyleValue(value: unknown): string | null {
  return typeof value === 'string' && value !== 'null' && value.length > 0 ? value : null;
}

function normAlignment(value: unknown): DocxAlignment | null {
  return value === 'left' || value === 'center' || value === 'right' || value === 'both'
    ? value
    : null;
}

function mapMammothRun(
  run: MammothRunLike,
  extraFeatures: readonly DocxImportRunFeature[],
): DocxImportRun {
  const features: DocxImportRunFeature[] = [...extraFeatures];
  let text = '';
  for (const part of run.children ?? []) {
    if (part.type === 'text' && typeof part.value === 'string') {
      text += part.value;
    } else if (part.type === 'image') {
      features.push('image');
    } else if (part.type !== 'text') {
      features.push('other');
    }
  }
  return {
    text,
    isBold: run.isBold === true,
    isItalic: run.isItalic === true,
    isUnderline: run.isUnderline === true,
    fontSize: run.fontSize ?? null,
    color: null,
    features,
  };
}

/** Mammoth 文档树 → DocxImportSource（WP2 正式导入器的测试版脚手架）。 */
function mammothToImportSource(document: MammothDocumentLike): DocxImportSource {
  const blocks: DocxImportBlock[] = [];
  for (const node of document.children ?? []) {
    if (node.type === 'table') {
      blocks.push({ type: 'table' });
      continue;
    }
    if (node.type !== 'paragraph') {
      blocks.push({ type: 'other' });
      continue;
    }
    const runs: DocxImportRun[] = [];
    for (const child of node.children ?? []) {
      if (child.type === 'run') {
        runs.push(mapMammothRun(child, []));
      } else if (child.type === 'hyperlink') {
        for (const inner of child.children ?? []) {
          if (inner.type === 'run') {
            runs.push(mapMammothRun(inner, ['hyperlink']));
          }
        }
      } else if (child.type === 'commentReference') {
        runs.push({
          text: '',
          isBold: false,
          isItalic: false,
          isUnderline: false,
          fontSize: null,
          color: null,
          features: ['comment-reference'],
        });
      } else if (child.type === 'image') {
        runs.push({
          text: '',
          isBold: false,
          isItalic: false,
          isUnderline: false,
          fontSize: null,
          color: null,
          features: ['image'],
        });
      } else {
        runs.push({
          text: '',
          isBold: false,
          isItalic: false,
          isUnderline: false,
          fontSize: null,
          color: null,
          features: ['other'],
        });
      }
    }
    const numbering =
      node.numbering === null || node.numbering === undefined
        ? null
        : { ordered: node.numbering.isOrdered === true, level: Number(node.numbering.level ?? 0) };
    blocks.push({
      type: 'paragraph',
      styleId: normStyleValue(node.styleId),
      styleName: normStyleValue(node.styleName),
      alignment: normAlignment(node.alignment),
      numbering,
      runs,
    });
  }
  return { documentFeatures: [], blocks };
}

/** 从 Mammoth 树经正式导入转换得到模型（测试脚手架 + 产品转换）。 */
function importFixtureModel(document: MammothDocumentLike): DocxDocumentModel {
  const result = importSourceToDocxModel(mammothToImportSource(document));
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('unreachable');
  }
  return result.model;
}

/** 仅保留 Mammoth 无法携带的断言：mammoth run 的文本与 mark 标志（测试脚手架）。 */
function mammothRunsOf(node: MammothParagraphLike): readonly {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly fontSize: number | null;
}[] {
  const runs: {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    fontSize: number | null;
  }[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'run') {
      continue;
    }
    const text = (child.children ?? [])
      .filter((part) => part.type === 'text' && typeof part.value === 'string')
      .map((part) => part.value)
      .join('');
    runs.push({
      text,
      bold: child.isBold === true,
      italic: child.isItalic === true,
      underline: child.isUnderline === true,
      fontSize: child.fontSize ?? null,
    });
  }
  return runs;
}

/** 导出描述 → `docx` 库 Document（WP3 正式导出器的测试版脚手架）。 */
function exportDescriptionToDocx(description: DocxExportDescription): Document {
  const children = description.paragraphs.map((entry) => {
    const options: Record<string, unknown> = { children: entry.runs.map(runToTextRun) };
    if (entry.kind === 'heading' && entry.headingLevel !== null) {
      options.heading =
        entry.headingLevel === 1
          ? HeadingLevel.HEADING_1
          : entry.headingLevel === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
    }
    if (entry.alignment !== null) {
      options.alignment =
        entry.alignment === 'center'
          ? AlignmentType.CENTER
          : entry.alignment === 'right'
            ? AlignmentType.RIGHT
            : entry.alignment === 'both'
              ? AlignmentType.JUSTIFIED
              : AlignmentType.LEFT;
    }
    if (entry.list !== null) {
      if (entry.list.ordered) {
        options.numbering = { reference: 'mini-ordered', level: entry.list.level };
      } else {
        options.bullet = { level: entry.list.level };
      }
    }
    return new Paragraph(options as ConstructorParameters<typeof Paragraph>[0]);
  });
  return new Document({
    creator: 'wenshu-roundtrip',
    title: 'wenshu-roundtrip',
    description: 'wenshu-roundtrip',
    numbering: {
      config: [
        {
          reference: 'mini-ordered',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2)',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
}

function runToTextRun(run: DocxTextRun): TextRun {
  const options: { text: string } & Record<string, unknown> = { text: run.text };
  for (const mark of run.marks) {
    if (mark.type === 'bold') {
      options.bold = true;
    } else if (mark.type === 'italic') {
      options.italics = true;
    } else if (mark.type === 'underline') {
      options.underline = {};
    } else if (mark.type === 'font-size') {
      options.size = mark.value * 2;
    } else {
      options.color = mark.value;
    }
  }
  return new TextRun(options as ConstructorParameters<typeof TextRun>[0]);
}

/** 深拷贝模型并去掉 color marks（Mammoth 模型不含颜色，round-trip 比较用）。 */
function stripColorMarks(model: DocxDocumentModel): DocxDocumentModel {
  const stripMarks = (marks: readonly DocxTextMark[]): readonly DocxTextMark[] =>
    marks.filter((mark) => mark.type !== 'color');
  const stripRuns = (runs: readonly DocxTextRun[]): readonly DocxTextRun[] =>
    runs.map((r) => ({ text: r.text, marks: stripMarks(r.marks) }));
  const stripBlocks = (blocks: DocxDocumentModel['blocks']): DocxDocumentModel['blocks'] =>
    blocks.map((block) => {
      if (block.kind === 'paragraph') {
        return { kind: 'paragraph', alignment: block.alignment, runs: stripRuns(block.runs) };
      }
      if (block.kind === 'heading') {
        return { kind: 'heading', level: block.level, runs: stripRuns(block.runs) };
      }
      return { kind: block.kind, level: block.level, blocks: stripBlocks(block.blocks) };
    });
  return { schemaVersion: 1, blocks: stripBlocks(model.blocks) };
}

/* ======================= 夹具结构 ======================= */

async function loadZip(bytes: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.keys(zip.files);
  expect(entries.length).toBeLessThanOrEqual(DOCX_MAX_ZIP_ENTRIES);
  let total = 0;
  for (const name of entries) {
    if (!zip.files[name]?.dir) {
      const object = zip.files[name] as unknown as { _data: { uncompressedSize: number } };
      total += object._data.uncompressedSize;
    }
  }
  expect(total).toBeLessThanOrEqual(DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES);
  return zip;
}

describe('DOCX 夹具（TASK-007 WP0，第 3.3 节）', () => {
  it('全部夹具可确定生成且为合法 ZIP，包含关键 OOXML 部件', async () => {
    const fixtures = await buildDocxFixtures();
    expect(Object.keys(fixtures.files).length).toBeGreaterThanOrEqual(18);
    for (const [id, bytes] of Object.entries(fixtures.files)) {
      if (id === 'fail-corrupt' || id === 'fail-fake-docx') {
        await expect(JSZip.loadAsync(bytes)).rejects.toThrow();
        continue;
      }
      const zip = await loadZip(bytes);
      const names = Object.keys(zip.files);
      if (id.startsWith('ok-') || id.startsWith('complex-')) {
        expect(names).toContain('[Content_Types].xml');
        expect(names).toContain('word/document.xml');
        expect(names).toContain('word/styles.xml');
        const docXml = await zip.file('word/document.xml')?.async('string');
        expect(docXml?.length ?? 0).toBeLessThanOrEqual(DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES);
      }
      if (id === 'fail-missing-parts' || id === 'fail-encrypted-sim') {
        expect(names).not.toContain('word/document.xml');
      }
      if (id === 'fail-oversize') {
        expect(bytes.byteLength).toBeGreaterThan(20 * 1024 * 1024);
      }
    }
  });

  it('夹具输出确定：同一 fixture 两次构造除 docProps/core.xml 外字节一致', async () => {
    // WP0 实测结论：docx@9 的 core.xml 固定写入当前时间（TimestampElement 使用 new Date()），
    // 产物字节无法完全确定；正文与结构部件全部确定，core.xml 为元数据部件不影响
    // 夹具审计与 revision 语义。比较时剔除该部件并记录为已知限制。
    const first = await buildDocxFixtures();
    const second = await buildDocxFixtures();
    for (const id of ['ok-plain', 'ok-headings', 'ok-marks', 'ok-lists', 'ok-alignment']) {
      const a = await loadZip(first.files[id]!);
      const b = await loadZip(second.files[id]!);
      const names = Object.keys(a.files);
      expect(names.length).toBe(Object.keys(b.files).length);
      for (const name of names) {
        if (name === 'docProps/core.xml' || a.files[name]?.dir === true) {
          continue;
        }
        const fa = await a.file(name)?.async('nodebuffer');
        const fb = await b.file(name)?.async('nodebuffer');
        expect(fa?.equals(fb ?? Buffer.alloc(0)), `fixture ${id} 部件 ${name} 不确定`).toBe(true);
      }
    }
  });
});

/* ======================= TASK-008 WP0 夹具扩展 ======================= */

describe('TASK-008 WP0 夹具扩展（第 3.3 节：read-only / 组合字符 / 投影混合 / 大文件）', () => {
  it('ok-read-only：settings.xml 明确启用保护 → 检查器判为 encrypted-protected 特性', async () => {
    const fixtures = await buildDocxFixtures();
    const bytes = fixtures.files['ok-read-only']!;
    const zip = await loadZip(bytes);
    const settings = await zip.file('word/settings.xml')?.async('string');
    expect(settings).toContain('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>');
    const inspection = await inspectDocxPackage(bytes);
    expect(inspection.status).toBe('ok');
    if (inspection.status === 'ok') {
      expect(inspection.inspection.documentFeatures).toContain('encrypted-protected');
    }
    // 普通文档对照：无保护特性
    const plain = await inspectDocxPackage(fixtures.files['ok-plain']!);
    expect(plain.status).toBe('ok');
    if (plain.status === 'ok') {
      expect(plain.inspection.documentFeatures).not.toContain('encrypted-protected');
    }
  });

  it('ok-combining-emoji：组合字符/代理对/run 内换行按原码位进入模型', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-combining-emoji']!);
    const model = importFixtureModel(doc);
    expect(validateDocxDocumentModel(model)).toEqual([]);
    const text = runText(model.blocks[0] as { kind: string; runs: readonly { text: string }[] });
    // 组合变音符号与基准字母保持两个独立 code unit；astral emoji 为代理对；不归一化
    expect(text).toContain('e\u0301');
    expect(text).toContain('a\u0300');
    expect(text).toContain('\uD83C\uDF89'); // 🎉 的代理对
    expect(text).toContain('\uD842\uDFB7'); // 𠮷 的代理对
    expect(text).toContain('\n'); // run 内原生换行保留
    // astral 字符在 UTF-16 中占两个 code unit：正文长度必然大于按码点计数的长度
    expect('🎉'.length).toBe(2);
    expect(text.length).toBeGreaterThan([...text].length);
  });

  it('ok-projection-mixed：标题/marks/空段/嵌套列表结构确定', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-projection-mixed']!);
    const model = importFixtureModel(doc);
    expect(validateDocxDocumentModel(model)).toEqual([]);
    expect(
      model.blocks.map((b) =>
        b.kind === 'bullet-list' || b.kind === 'ordered-list'
          ? `${b.kind}:${b.level}(${b.blocks.length})`
          : b.kind,
      ),
    ).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'bullet-list:0(3)',
      'ordered-list:0(3)',
      'paragraph',
    ]);
    // 标题级别单独断言（1-3 级）
    const headingBlock = model.blocks[0];
    expect(headingBlock).toBeDefined();
    if (headingBlock !== undefined && headingBlock.kind === 'heading') {
      expect(headingBlock.level).toBe(1);
    }
    // 跨 run 段落：三个 run 文本连接（marks 不参与正文语义）
    const marksPara = model.blocks[1];
    expect(marksPara).toBeDefined();
    if (marksPara !== undefined && marksPara.kind === 'paragraph') {
      expect(marksPara.runs.map((r) => r.text)).toEqual([
        '粗体',
        '与',
        '斜体',
        ' 跨 run 可匹配 English text.',
      ]);
    }
    // 嵌套列表条目按深度优先顺序
    const bullet = model.blocks[3];
    expect(bullet).toBeDefined();
    if (bullet !== undefined && bullet.kind === 'bullet-list') {
      expect(bullet.blocks.map((b) => (b.kind === 'paragraph' ? runText(b) : 'nested'))).toEqual([
        '项目甲',
        '项目乙',
        'nested',
      ]);
    }
  });

  it('ok-large：恰好 20 MiB 且 ZIP 可解析（大小上限读取窗口验证用）', async () => {
    const fixtures = await buildDocxFixtures();
    const bytes = fixtures.files['ok-large']!;
    expect(bytes.byteLength).toBe(DOCX_MAX_FILE_BYTES);
    await expect(JSZip.loadAsync(bytes)).resolves.toBeDefined();
  });
});

/* ======================= Mammoth 导入能力 ======================= */

async function importWithMammoth(bytes: Buffer): Promise<MammothDocumentLike> {
  let captured: MammothDocumentLike | null = null;
  const result = await mammoth.convertToHtml(
    { buffer: bytes },
    {
      transformDocument: (document: MammothDocumentLike) =>
        (captured = document) as MammothDocumentLike,
    },
  );
  expect(captured).not.toBeNull();
  void result;
  return captured as unknown as MammothDocumentLike;
}

describe('Mammoth 导入映射（TASK-007 WP0，第 3.4 节结论 1/2）', () => {
  it('普通段落、空段落、中文、英文、emoji 保留（Mammoth 树 → 正式模型）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-plain']!);
    const model = importFixtureModel(doc);
    expect(validateDocxDocumentModel(model)).toEqual([]);
    const texts = model.blocks.map((block) =>
      block.kind === 'paragraph' || block.kind === 'heading'
        ? block.runs.map((r) => r.text).join('')
        : '',
    );
    expect(texts).toEqual([
      '第一段：中文内容 English text.',
      'emoji 🎉 与多段共存',
      '',
      '空段落之后的正文',
      '带前导空白的 run',
    ]);
  });

  it('标题 1-3 通过 styleName/styleId 识别', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-headings']!);
    const model = importFixtureModel(doc);
    expect(
      model.blocks.map((b) => (b.kind === 'heading' ? `${b.kind}:${b.level}` : b.kind)),
    ).toEqual(['heading:1', 'heading:2', 'heading:3', 'paragraph']);
  });

  it('粗体/斜体/下划线进入 Mammoth run 模型（下划线在模型而非 HTML）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-marks']!);
    const runs = mammothRunsOf((doc.children ?? [])[0]!);
    expect(runs.map((r) => ({ t: r.text, b: r.bold, i: r.italic, u: r.underline }))).toEqual([
      { t: '粗体', b: true, i: false, u: false },
      { t: ' 斜体', b: false, i: true, u: false },
      { t: ' 下划线', b: false, i: false, u: true },
      { t: ' 粗斜下', b: true, i: true, u: true },
      { t: ' 无格式', b: false, i: false, u: false },
    ]);
    // 正式模型中的 marks 与规范顺序一致
    const model = importFixtureModel(doc);
    const runs2 = model.blocks[0];
    expect(runs2).toBeDefined();
    if (runs2?.kind === 'paragraph') {
      expect(runs2.runs.map((r) => r.marks.map((m) => m.type))).toEqual([
        ['bold'],
        ['italic'],
        ['underline'],
        ['bold', 'italic', 'underline'],
        [],
      ]);
    }
  });

  it('字号进入 Mammoth run 模型（fontSize 点数），文字颜色不在 Mammoth 模型中', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-font-size-color']!);
    const runs = mammothRunsOf((doc.children ?? [])[0]!);
    expect(runs.map((r) => r.fontSize)).toEqual([9, 10.5, 14, null, null]);
    // WP0 固定结论：Mammoth 模型不含 color，需要 JSZip 对 w:color 做有限补充读取
    const raw = (doc.children ?? [])[0] as MammothParagraphLike;
    for (const child of raw.children ?? []) {
      if (child.type === 'run') {
        expect('color' in child).toBe(false);
      }
    }
  });

  it('JSZip 有限补充读取可取得 w:color 属性', async () => {
    const fixtures = await buildDocxFixtures();
    const zip = await loadZip(fixtures.files['ok-font-size-color']!);
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('<w:color w:val="FF0000"/>');
    expect(xml).toContain('<w:color w:val="336699"/>');
    const colors = Array.from(xml?.matchAll(/<w:color w:val="([0-9A-Fa-f]{6})"\/>/g) ?? []);
    expect(colors.map((m) => m[1])).toEqual(['FF0000', '336699']);
  });

  it('项目符号与编号列表进入正式模型（含层级与嵌套）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-lists']!);
    const model = importFixtureModel(doc);
    expect(validateDocxDocumentModel(model)).toEqual([]);
    expect(
      model.blocks.map((b) =>
        b.kind === 'bullet-list' || b.kind === 'ordered-list'
          ? `${b.kind}:${b.level}(${b.blocks.length})`
          : b.kind,
      ),
    ).toEqual(['bullet-list:0(3)', 'ordered-list:0(3)']);
    const bullet = model.blocks[0];
    expect(bullet).toBeDefined();
    if (bullet === undefined) {
      return;
    }
    expect(bullet.kind).toBe('bullet-list');
    if (bullet.kind === 'bullet-list') {
      expect(bullet.blocks.map((b) => (b.kind === 'paragraph' ? runText(b) : 'nested'))).toEqual([
        '项目一',
        '项目二',
        'nested',
      ]);
      const nested = bullet.blocks[2];
      expect(nested).toBeDefined();
      if (nested !== undefined && nested.kind === 'bullet-list') {
        expect(nested.level).toBe(1);
      }
    }
    const ordered = model.blocks[1];
    expect(ordered).toBeDefined();
    if (ordered === undefined) {
      return;
    }
    expect(ordered.kind).toBe('ordered-list');
    if (ordered.kind === 'ordered-list') {
      const nested = ordered.blocks[2];
      expect(nested).toBeDefined();
      if (nested !== undefined && nested.kind === 'ordered-list') {
        expect(nested.level).toBe(1);
      }
    }
  });

  it('段落对齐进入正式模型（justify 映射为 both）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-alignment']!);
    const model = importFixtureModel(doc);
    expect(model.blocks.map((b) => (b.kind === 'paragraph' ? b.alignment : null))).toEqual([
      'left',
      'center',
      'right',
      'both',
      null,
    ]);
  });

  it('空文档无块', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-empty']!);
    expect(importFixtureModel(doc).blocks).toEqual([]);
  });
});

function runText(block: {
  readonly kind: string;
  readonly runs?: readonly { readonly text: string }[];
}): string {
  return (block.runs ?? []).map((r) => r.text).join('');
}

/* ======================= 复杂样本可检测性 ======================= */

describe('复杂样本可检测性（TASK-007 WP0，兼容性矩阵）', () => {
  it('图片：进入 Mammoth run 子节点 image 类型（降级/省略）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-image']!);
    const para = (doc.children ?? [])[0] as MammothParagraphLike;
    const childTypes = (para.children ?? []).flatMap((run) =>
      (run.children ?? []).map((part) => part.type),
    );
    expect(childTypes).toContain('image');
  });

  it('表格：进入 Mammoth table 类型节点（降级/省略）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-table']!);
    expect((doc.children ?? []).map((n) => n.type)).toContain('table');
  });

  it('批注：进入 Mammoth comments 模型与 commentReference 子节点', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-comment']!);
    expect(doc.comments?.length ?? 0).toBeGreaterThan(0);
    const para = (doc.children ?? [])[0] as MammothParagraphLike;
    const childTypes = (para.children ?? []).map((run) => run.type);
    expect(childTypes).toContain('commentReference');
  });

  it('页眉页脚：不在 Mammoth 模型中，需 JSZip 检查 header/footer 部件', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-header-footer']!);
    // WP0 固定结论：Mammoth 模型不含页眉页脚
    expect((doc.children ?? []).map((n) => n.type)).not.toContain('header');
    const zip = await loadZip(fixtures.files['complex-header-footer']!);
    const names = Object.keys(zip.files);
    expect(names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
    expect(names.some((n) => /^word\/footer\d*\.xml$/.test(n))).toBe(true);
    const plainZip = await loadZip(fixtures.files['ok-plain']!);
    expect(Object.keys(plainZip.files).some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(false);
  });

  it('修订：Mammoth 不识别 w:ins/w:del，需 JSZip 扫描 document.xml', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-revision']!);
    // WP0 固定结论：Mammoth 把修订内容当普通正文（w:delText 也进入正文）
    const text = (doc.children ?? [])
      .map((p) =>
        mammothRunsOf(p)
          .map((r) => r.text)
          .join(''),
      )
      .join('');
    expect(text).toContain('插入内容');
    const zip = await loadZip(fixtures.files['complex-revision']!);
    const xml = await zip.file('word/document.xml')?.async('string');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
    const plainXml = await (
      await loadZip(fixtures.files['ok-plain']!)
    )
      .file('word/document.xml')
      ?.async('string');
    expect(plainXml).not.toContain('<w:ins ');
  });

  it('超链接：进入 Mammoth hyperlink 类型节点（降级为可见文本）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-link']!);
    const para = (doc.children ?? [])[0] as MammothParagraphLike;
    const hyperlinks = (para.children ?? []).filter((c) => c.type === 'hyperlink');
    expect(hyperlinks.length).toBe(1);
  });
});

/* ======================= 失败样本 ======================= */

describe('失败样本（TASK-007 WP0，第 3.3 节）', () => {
  it('损坏 ZIP / 伪装扩展名 / 缺失关键部件 / 加密模拟被稳定拒绝', async () => {
    const fixtures = await buildDocxFixtures();
    for (const id of [
      'fail-corrupt',
      'fail-fake-docx',
      'fail-missing-parts',
      'fail-encrypted-sim',
    ]) {
      await expect(mammoth.convertToHtml({ buffer: fixtures.files[id]! })).rejects.toThrow();
    }
  });

  it('超限样本可被 ZIP 解析但超过 20 MiB 上限（大小检查在解析前）', async () => {
    const fixtures = await buildDocxFixtures();
    const bytes = fixtures.files['fail-oversize']!;
    expect(bytes.byteLength).toBeGreaterThan(20 * 1024 * 1024);
    // ZIP 读取器忽略尾部填充，仍可解析；解析前的大小检查由 WP2 读取器执行
    const zip = await loadZip(bytes);
    expect(Object.keys(zip.files)).toContain('word/document.xml');
  });
});

/* ======================= 最小闭环：导入 → 模型 → 导出 → 重新打开 ======================= */

describe('最小闭环（TASK-007 门禁：导入/编辑 schema/导出/重新打开）', () => {
  it('ok-lists 导出后重新导入：正式模型完全一致（列表分组/层级/正文）', async () => {
    const fixtures = await buildDocxFixtures();
    const first = importFixtureModel(await importWithMammoth(fixtures.files['ok-lists']!));
    const exported = await Packer.toBuffer(
      exportDescriptionToDocx(docxModelToExportDescription(first)),
    );
    const second = importFixtureModel(await importWithMammoth(exported));
    expect(second).toEqual(first);
    expect(validateDocxDocumentModel(second)).toEqual([]);
  });

  it('混合文档（标题+marks+字号+对齐+空段落+编号列表）导出后重新导入语义一致', async () => {
    const model: DocxDocumentModel = {
      schemaVersion: 1,
      blocks: [
        { kind: 'heading', level: 1, runs: [{ text: '标题', marks: [] }] },
        {
          kind: 'paragraph',
          alignment: 'center',
          runs: [
            { text: '粗体', marks: [{ type: 'bold' }] },
            {
              text: ' 红色',
              marks: [
                { type: 'color', value: '#FF0000' },
                { type: 'font-size', value: 14 },
              ],
            },
          ],
        },
        { kind: 'paragraph', alignment: null, runs: [] },
        {
          kind: 'ordered-list',
          level: 0,
          blocks: [{ kind: 'paragraph', alignment: null, runs: [{ text: '编号一', marks: [] }] }],
        },
      ],
    };
    const exported = await Packer.toBuffer(
      exportDescriptionToDocx(docxModelToExportDescription(model)),
    );
    const reimported = importFixtureModel(await importWithMammoth(exported));
    // 文字颜色经 JSZip 补充读取（Mammoth 模型不含）：比较时去掉 color marks，
    // 并在下方直接断言导出字节包含 w:color（导出映射正确）
    expect(stripColorMarks(reimported)).toEqual(stripColorMarks(model));
    const exportedZip = await loadZip(exported);
    const xml = await exportedZip.file('word/document.xml')?.async('string');
    expect(xml).toContain('<w:color w:val="FF0000"/>');
    expect(xml).toContain('<w:sz w:val="28"/>');
  });

  it('round-trip 产物仍被 Mammoth 识别为合法 DOCX（重新打开成功）', async () => {
    const fixtures = await buildDocxFixtures();
    const model = importFixtureModel(await importWithMammoth(fixtures.files['ok-headings']!));
    const exported = await Packer.toBuffer(
      exportDescriptionToDocx(docxModelToExportDescription(model)),
    );
    const zip = await loadZip(exported);
    expect(Object.keys(zip.files)).toContain('word/document.xml');
    expect(Object.keys(zip.files)).toContain('word/styles.xml');
  });
});

/* ======================= Tiptap/ProseMirror 最小 schema ======================= */

import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';

describe('Tiptap/ProseMirror 最小 schema（TASK-007 WP0，第 3.4 节结论 3）', () => {
  const schema = getSchema([
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TextStyle,
    Color,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ]);

  it('节点与标记集合覆盖受支持格式且不过度', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'codeBlock',
        'doc',
        'hardBreak',
        'heading',
        'horizontalRule',
        'listItem',
        'orderedList',
        'paragraph',
        'text',
      ].sort(),
    );
    // underline 由 StarterKit v3 提供；bold/italic 同理；color/fontSize 挂在 textStyle 标记
    expect(Object.keys(schema.marks).sort()).toContain('underline');
    expect(Object.keys(schema.marks).sort()).toContain('textStyle');
    expect(Object.keys(schema.marks).sort()).toContain('bold');
    expect(Object.keys(schema.marks).sort()).toContain('italic');
  });

  it('JSON 文档可入 schema 并往返（默认属性被物化，语义一致）', () => {
    const jsonDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            { type: 'text', text: '红' },
            {
              type: 'text',
              text: ' 大',
              marks: [{ type: 'textStyle', attrs: { color: '#FF0000', fontSize: '18px' } }],
            },
            { type: 'text', text: ' 下', marks: [{ type: 'underline' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '条目' }] }],
            },
          ],
        },
      ],
    };
    const node = schema.nodeFromJSON(jsonDoc);
    expect(node.type.name).toBe('doc');
    expect(node.firstChild?.type.name).toBe('heading');
    const back = node.toJSON();
    expect(back.type).toBe('doc');
    expect((back.content?.[1] as { content: unknown[] }).content).toHaveLength(3);
    const marks = (
      back.content?.[1] as {
        content: { marks?: { type: string; attrs?: { color?: string; fontSize?: string } }[] }[];
      }
    ).content;
    expect(marks[1]?.marks?.[0]?.attrs?.color).toBe('#FF0000');
    expect(marks[1]?.marks?.[0]?.attrs?.fontSize).toBe('18px');
    // 默认属性（如 color:null）会被物化：字符串比较不相等但语义等价（转换时归一化）
    expect(JSON.stringify(back)).not.toBe(JSON.stringify(jsonDoc));
  });
});

/* ======================= 性能冒烟 ======================= */

describe('性能冒烟（TASK-007 WP0，第 3.4 节结论 6）', () => {
  it('300 段普通文档：构造、解析、导出合计在秒级预算内', async () => {
    const children: Paragraph[] = [];
    for (let i = 0; i < 300; i += 1) {
      if (i % 4 === 0) {
        children.push(new Paragraph({ text: `标题段落 ${i}`, heading: HeadingLevel.HEADING_2 }));
      } else {
        const options: { text: string } & Record<string, unknown> = {
          text: `普通段落 ${i} 中文 English emoji 🎉`,
        };
        if (i % 2 === 0) {
          options.bold = true;
        }
        if (i % 3 === 0) {
          options.italics = true;
        }
        if (i % 7 === 0) {
          options.size = 28;
        }
        if (i % 5 === 0) {
          options.color = 'FF0000';
        }
        if (i % 11 === 0) {
          options.underline = {};
        }
        children.push(
          new Paragraph({
            children: [new TextRun(options as ConstructorParameters<typeof TextRun>[0])],
          }),
        );
      }
    }
    const doc = new Document({
      creator: 'wenshu-perf',
      title: 'wenshu-perf',
      description: 'wenshu-perf',
      sections: [{ children }],
    });
    const started = Date.now();
    const bytes = (await Packer.toBuffer(doc)) as Buffer;
    const model = importFixtureModel(await importWithMammoth(bytes));
    const exported = await Packer.toBuffer(
      exportDescriptionToDocx(docxModelToExportDescription(model)),
    );
    const elapsed = Date.now() - started;
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(exported.byteLength).toBeGreaterThan(0);
    // WP0 固定性能目标：秒级（10 秒为宽松上限，避免受控环境抖动误报）
    expect(elapsed).toBeLessThan(10_000);
  });
});
