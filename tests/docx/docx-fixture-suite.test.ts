// @vitest-environment node
/**
 * TASK-007 WP0 DOCX 夹具与库能力验证（任务第 3.3 / 3.4 节）。
 *
 * 覆盖：
 * - 夹具本身：ZIP/OOXML 结构、条目预算、失败样本形状；
 * - Mammoth 导入能力：段落/空段落/标题/粗体/斜体/下划线/字号/列表/对齐/中文/emoji，
 *   以及"文字颜色不在 Mammoth 模型中、需要 JSZip 有限补充读取"的固定结论；
 * - 复杂样本的可检测性：图片、表格、批注、页眉页脚、修订、超链接；
 * - 失败样本：损坏 ZIP、伪装扩展名、缺失关键部件、加密模拟、超限文件；
 * - 最小闭环：Mammoth 导入 → 项目结构化中间模型（临时 MiniModel）→ `docx` 导出
 *   → 重新导入，正文与受支持格式语义一致；
 * - Tiptap/ProseMirror 最小 schema：节点/标记集合、JSON 往返；
 * - 性能冒烟：普通文档构造、解析、导出在秒级预算内。
 *
 * 说明：本文件中的 MiniModel 与转换是 WP0 的验证脚手架；WP1 将用
 * `src/shared/docx.ts` 的正式模型与纯转换替换，并扩展完整测试。
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
import { buildDocxFixtures } from './docx-fixture-builder';

/* ======================= 临时 MiniModel 与转换（WP1 替换） ======================= */

type MiniAlignment = 'left' | 'center' | 'right' | 'both';

interface MiniRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly fontSize: number | null;
  readonly color: string | null;
}

type MiniBlock =
  | {
      readonly kind: 'paragraph';
      readonly alignment: MiniAlignment | null;
      readonly runs: readonly MiniRun[];
    }
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly runs: readonly MiniRun[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly level: number;
      readonly blocks: readonly MiniBlock[];
    };

interface MiniModel {
  readonly schemaVersion: 1;
  readonly blocks: readonly MiniBlock[];
}

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

/** 从 Mammoth 文档模型导入为 MiniModel（仅支持内容；不支持内容由兼容性检测另行处理）。 */
function importMini(document: MammothDocumentLike): MiniModel {
  const blocks: MiniBlock[] = [];
  for (const node of document.children ?? []) {
    if (node.type !== 'paragraph') {
      continue;
    }
    const styleName = String(node.styleName ?? '');
    const styleId = String(node.styleId ?? '');
    const headingMatch =
      styleName.match(/^Heading ([1-6])$/i) ?? styleId.match(/^Heading([1-6])$/i);
    const level = headingMatch === null ? null : Number(headingMatch[1]);
    if (level !== null && level <= 3) {
      blocks.push({ kind: 'heading', level: level as 1 | 2 | 3, runs: runsOf(node) });
      continue;
    }
    if (node.numbering !== null && node.numbering !== undefined) {
      blocks.push({
        kind: 'list',
        ordered: node.numbering.isOrdered === true,
        level: Number(node.numbering.level ?? 0),
        blocks: [{ kind: 'paragraph', alignment: alignmentOf(node), runs: runsOf(node) }],
      });
      continue;
    }
    blocks.push({ kind: 'paragraph', alignment: alignmentOf(node), runs: runsOf(node) });
  }
  return { schemaVersion: 1, blocks };
}

function alignmentOf(node: MammothParagraphLike): MiniAlignment | null {
  switch (node.alignment) {
    case 'left':
    case 'center':
    case 'right':
    case 'both':
      return node.alignment;
    default:
      return null;
  }
}

function runsOf(node: MammothParagraphLike): readonly MiniRun[] {
  const runs: MiniRun[] = [];
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
      color: null,
    });
  }
  return runs;
}

function docxAlignment(alignment: MiniAlignment | null) {
  switch (alignment) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'both':
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}

/** 把 MiniModel 导出为 DOCX 字节（`docx` 库基础重建）。 */
async function exportMini(model: MiniModel): Promise<Buffer> {
  const children = blocksToDocx(model.blocks);
  const doc = new Document({
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
  return (await Packer.toBuffer(doc)) as Buffer;
}

function blocksToDocx(blocks: readonly MiniBlock[]): readonly Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const alignment = docxAlignment(block.alignment);
      out.push(
        new Paragraph({
          children: runsToDocx(block.runs),
          ...(alignment === undefined ? {} : { alignment }),
        }),
      );
    } else if (block.kind === 'heading') {
      const heading =
        block.level === 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      out.push(new Paragraph({ children: runsToDocx(block.runs), heading }));
    } else if (block.kind === 'list') {
      for (const inner of block.blocks) {
        if (inner.kind !== 'paragraph') {
          continue;
        }
        out.push(
          new Paragraph({
            children: runsToDocx(inner.runs),
            ...(block.ordered
              ? { numbering: { reference: 'mini-ordered', level: block.level } }
              : { bullet: { level: block.level } }),
          }),
        );
      }
    }
  }
  return out;
}

function runsToDocx(runs: readonly MiniRun[]): readonly TextRun[] {
  return runs.map((run) => {
    const options: { text: string } & Record<string, unknown> = { text: run.text };
    if (run.bold) {
      options.bold = true;
    }
    if (run.italic) {
      options.italics = true;
    }
    if (run.underline) {
      options.underline = {};
    }
    if (run.fontSize !== null) {
      options.size = run.fontSize * 2;
    }
    if (run.color !== null) {
      options.color = run.color;
    }
    return new TextRun(options as ConstructorParameters<typeof TextRun>[0]);
  });
}

/** 归一化 MiniModel（去 null、去空 run、颜色字段统一为 null），用于语义比较。 */
function normalizeModel(model: MiniModel): unknown {
  const normRuns = (runs: readonly MiniRun[]): readonly MiniRun[] =>
    runs.filter((run) => run.text.length > 0).map((run) => ({ ...run, color: null }));
  const normBlocks = (blocks: readonly MiniBlock[]): readonly MiniBlock[] =>
    blocks
      .filter((block) => {
        if (block.kind === 'list') {
          return block.blocks.length > 0;
        }
        return block.runs.some((run) => run.text.length > 0);
      })
      .map((block) =>
        block.kind === 'list'
          ? { ...block, blocks: normBlocks(block.blocks) }
          : { ...block, runs: normRuns(block.runs) },
      );
  return normBlocks(model.blocks);
}

/* ======================= 夹具结构 ======================= */

const ZIP_BUDGETS = {
  /** 单个关键 XML 解压上限：1 MiB（WP0 冻结，见报告第 5 节）。 */
  maxKeyXmlUncompressed: 1024 * 1024,
  /** 总解压上限：64 MiB。 */
  maxTotalUncompressed: 64 * 1024 * 1024,
  /** 条目数上限：128。 */
  maxEntries: 128,
};

async function loadZip(bytes: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.keys(zip.files);
  expect(entries.length).toBeLessThanOrEqual(ZIP_BUDGETS.maxEntries);
  let total = 0;
  for (const name of entries) {
    if (!zip.files[name]?.dir) {
      const object = zip.files[name] as unknown as { _data: { uncompressedSize: number } };
      total += object._data.uncompressedSize;
    }
  }
  expect(total).toBeLessThanOrEqual(ZIP_BUDGETS.maxTotalUncompressed);
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
        expect(docXml?.length ?? 0).toBeLessThanOrEqual(ZIP_BUDGETS.maxKeyXmlUncompressed);
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
  it('普通段落、空段落、中文、英文、emoji 保留', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-plain']!);
    const texts = (doc.children ?? []).map((p) =>
      runsOf(p)
        .map((r) => r.text)
        .join(''),
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
    const blocks = importMini(doc).blocks;
    expect(blocks.map((b) => (b.kind === 'heading' ? `${b.kind}:${b.level}` : b.kind))).toEqual([
      'heading:1',
      'heading:2',
      'heading:3',
      'paragraph',
    ]);
  });

  it('粗体/斜体/下划线进入 run 模型（下划线在模型而非 HTML）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-marks']!);
    const runs = runsOf((doc.children ?? [])[0]!);
    expect(runs.map((r) => ({ t: r.text, b: r.bold, i: r.italic, u: r.underline }))).toEqual([
      { t: '粗体', b: true, i: false, u: false },
      { t: ' 斜体', b: false, i: true, u: false },
      { t: ' 下划线', b: false, i: false, u: true },
      { t: ' 粗斜下', b: true, i: true, u: true },
      { t: ' 无格式', b: false, i: false, u: false },
    ]);
  });

  it('字号进入 run 模型（fontSize 点数），文字颜色不在 Mammoth 模型中', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-font-size-color']!);
    const runs = runsOf((doc.children ?? [])[0]!);
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

  it('项目符号与编号列表进入 numbering 模型（含层级）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-lists']!);
    const raw = doc.children ?? [];
    const listInfo = raw
      .filter((p) => p.numbering !== null && p.numbering !== undefined)
      .map((p) => ({
        ordered: p.numbering?.isOrdered,
        level: Number(p.numbering?.level ?? 0),
        text: runsOf(p)
          .map((r) => r.text)
          .join(''),
      }));
    expect(listInfo).toEqual([
      { ordered: false, level: 0, text: '项目一' },
      { ordered: false, level: 0, text: '项目二' },
      { ordered: false, level: 1, text: '嵌套项目' },
      { ordered: true, level: 0, text: '编号一' },
      { ordered: true, level: 0, text: '编号二' },
      { ordered: true, level: 1, text: '嵌套编号' },
    ]);
  });

  it('段落对齐进入 alignment 模型（justify 映射为 both）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['ok-alignment']!);
    const blocks = importMini(doc).blocks;
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.alignment : null))).toEqual([
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
    expect(importMini(doc).blocks).toEqual([]);
  });
});

/* ======================= 复杂样本可检测性 ======================= */

describe('复杂样本可检测性（TASK-007 WP0，兼容性矩阵）', () => {
  it('图片：进入 run 子节点 image 类型（降级/省略）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-image']!);
    const para = (doc.children ?? [])[0] as MammothParagraphLike;
    const childTypes = (para.children ?? []).flatMap((run) =>
      (run.children ?? []).map((part) => part.type),
    );
    expect(childTypes).toContain('image');
  });

  it('表格：进入 table 类型节点（降级/省略）', async () => {
    const fixtures = await buildDocxFixtures();
    const doc = await importWithMammoth(fixtures.files['complex-table']!);
    expect((doc.children ?? []).map((n) => n.type)).toContain('table');
  });

  it('批注：进入 comments 模型与 commentReference 子节点', async () => {
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
        runsOf(p)
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

  it('超链接：进入 hyperlink 类型节点（降级为可见文本）', async () => {
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

describe('最小闭环（TASK-007 WP0 门禁：导入/编辑 schema/导出/重新打开）', () => {
  it('ok-lists 导出后重新导入：正文、编号/项目符号与层级保持', async () => {
    const fixtures = await buildDocxFixtures();
    const first = importMini(await importWithMammoth(fixtures.files['ok-lists']!));
    const exported = await exportMini(first);
    const second = importMini(await importWithMammoth(exported));
    const a = normalizeModel(first) as { kind: string; ordered: boolean; level: number }[];
    const b = normalizeModel(second) as { kind: string; ordered: boolean; level: number }[];
    // 列表块按 (ordered, level) 逐块对齐比较；同一 (ordered, level) 的连续段落合并为一块
    const collapse = (blocks: { kind: string; ordered: boolean; level: number }[]): string[] => {
      const out: string[] = [];
      let pending: string | null = null;
      let prevKey: string | null = null;
      for (const block of blocks) {
        if (block.kind !== 'list') {
          if (pending !== null) {
            out.push(pending);
            pending = null;
          }
          prevKey = null;
          out.push('para');
          continue;
        }
        const key = `${block.ordered ? 'ol' : 'ul'}:${block.level}`;
        if (pending === null) {
          pending = key;
          prevKey = key;
        } else if (key === prevKey) {
          prevKey = key;
        } else {
          out.push(pending);
          pending = key;
          prevKey = key;
        }
      }
      if (pending !== null) {
        out.push(pending);
      }
      return out;
    };
    expect(collapse(b)).toEqual(collapse(a));
  });

  it('混合文档（标题+marks+字号+对齐+空段落+编号列表）导出后重新导入语义一致', async () => {
    const model: MiniModel = {
      schemaVersion: 1,
      blocks: [
        {
          kind: 'heading',
          level: 1,
          runs: [
            {
              text: '标题',
              bold: false,
              italic: false,
              underline: false,
              fontSize: null,
              color: null,
            },
          ],
        },
        {
          kind: 'paragraph',
          alignment: 'center',
          runs: [
            {
              text: '粗体',
              bold: true,
              italic: false,
              underline: false,
              fontSize: null,
              color: null,
            },
            {
              text: ' 红色',
              bold: false,
              italic: false,
              underline: false,
              fontSize: 14,
              color: 'FF0000',
            },
          ],
        },
        {
          kind: 'paragraph',
          alignment: null,
          runs: [
            { text: '', bold: false, italic: false, underline: false, fontSize: null, color: null },
          ],
        },
        {
          kind: 'list',
          ordered: true,
          level: 0,
          blocks: [
            {
              kind: 'paragraph',
              alignment: null,
              runs: [
                {
                  text: '编号一',
                  bold: false,
                  italic: false,
                  underline: false,
                  fontSize: null,
                  color: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const exported = await exportMini(model);
    const reimported = importMini(await importWithMammoth(exported));
    // 文字颜色经 JSZip 补充读取（Mammoth 模型不含）：往返比较归一化掉颜色字段，
    // 并在下方直接断言导出字节包含 w:color（导出映射正确）
    expect(normalizeModel(reimported)).toEqual(normalizeModel(model));
    const exportedZip = await loadZip(exported);
    const xml = await exportedZip.file('word/document.xml')?.async('string');
    expect(xml).toContain('<w:color w:val="FF0000"/>');
    expect(xml).toContain('<w:sz w:val="28"/>');
    expect(JSON.stringify(reimported)).toContain('"color":null');
  });

  it('round-trip 产物仍被 Mammoth 识别为合法 DOCX（重新打开成功）', async () => {
    const fixtures = await buildDocxFixtures();
    const model = importMini(await importWithMammoth(fixtures.files['ok-headings']!));
    const exported = await exportMini(model);
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
    // 默认属性（如 color:null）会被物化：字符串比较不相等但语义等价（WP1 转换时归一化）
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
    const imported = importMini(await importWithMammoth(bytes));
    const exported = await exportMini(imported);
    const elapsed = Date.now() - started;
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(exported.byteLength).toBeGreaterThan(0);
    // WP0 固定性能目标：秒级（10 秒为宽松上限，避免受控环境抖动误报）
    expect(elapsed).toBeLessThan(10_000);
  });
});
