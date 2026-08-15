/**
 * TASK-007 WP0 DOCX 夹具构造器 —— 用 `docx` 库确定性地生成全部测试夹具（任务第 3.3 节）。
 *
 * ## 用途与约束
 *
 * - 全部夹具在内存中构造（Buffer），不提交二进制夹具，不包含真实用户文档；
 * - 构造参数（creator/title/description/created/modified/批注日期）全部固定，
 *   输出确定可审计；
 * - 夹具命名按用途分组：`ok-*` 为应被支持的普通样本，`complex-*` 为含不支持
 *   特性的复杂样本（应产生确定兼容性警告），`fail-*` 为失败样本
 *   （损坏/伪装/超限/加密模拟/缺失关键部件）；
 * - 失败样本"加密模拟"不是真实 Office 加密文件，只复刻了加密包的部件布局
 *   （EncryptionInfo + EncryptedPackage，无 [Content_Types].xml / word/document.xml），
 *   用于验证"缺失关键 OOXML 部件 → 稳定拒绝"的检查路径；
 * - 超限样本用"合法 DOCX + 追加 21 MiB 填充"构造（ZIP 读取器忽略尾部数据），
 *   用于验证文件大小上限检查（读取前拒绝），与 WP2 的大小检查顺序一致；
 * - 修订样本通过 JSZip 对合法文档的 document.xml 做有限 XML 补丁
 *   （w:ins / w:del 标记），用于验证修订检测路径。
 */

import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { DOCX_MAX_FILE_BYTES } from '../../src/shared/docx';
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type ICommentsOptions,
  type INumberingOptions,
} from 'docx';

/** 固定文档元数据（docx@9 的 core.xml 时间戳总是取当前时间，见 suite 注释；其余元数据固定）。 */
export const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

/** 1×1 像素 PNG（测试图像，无隐私内容）。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 超过上限的填充量：21 MiB（上限 20 MiB 的 105%）。 */
const OVERSIZE_PADDING_BYTES = 21 * 1024 * 1024;

function makeDocument(children: readonly (Paragraph | Table)[]): Document {
  return new Document({
    creator: 'wenshu-fixture',
    title: 'wenshu-fixture',
    description: 'wenshu-fixture',
    sections: [{ children: [...children] }],
  });
}

/** 项目符号 / 编号列表共用编号配置（确定性）。 */
const NUMBERING: INumberingOptions = {
  config: [
    {
      reference: 'ordered-list',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START },
      ],
    },
    {
      reference: 'bullet-list',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.START },
      ],
    },
  ],
};

async function pack(document: Document): Promise<Buffer> {
  return (await Packer.toBuffer(document)) as Buffer;
}

async function buildPlain(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({ children: [new TextRun('第一段：中文内容 English text.')] }),
      new Paragraph({ children: [new TextRun('emoji 🎉 与多段共存')] }),
      new Paragraph(''),
      new Paragraph({ children: [new TextRun('空段落之后的正文')] }),
      new Paragraph({ children: [new TextRun('带前导空白的 run')] }),
    ]),
  );
}

async function buildEmpty(): Promise<Buffer> {
  return pack(makeDocument([]));
}

async function buildHeadings(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({ text: '一级标题', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: '二级标题', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: '三级标题', heading: HeadingLevel.HEADING_3 }),
      new Paragraph({ text: '标题后的正文' }),
    ]),
  );
}

async function buildMarks(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({
        children: [
          new TextRun({ text: '粗体', bold: true }),
          new TextRun({ text: ' 斜体', italics: true }),
          new TextRun({ text: ' 下划线', underline: {} }),
          new TextRun({ text: ' 粗斜下', bold: true, italics: true, underline: {} }),
          new TextRun({ text: ' 无格式' }),
        ],
      }),
    ]),
  );
}

async function buildFontSizeColor(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({
        children: [
          new TextRun({ text: '九磅', size: 18 }),
          new TextRun({ text: ' 十点五磅', size: 21 }),
          new TextRun({ text: ' 十四磅', size: 28 }),
          new TextRun({ text: ' 红色', color: 'FF0000' }),
          new TextRun({ text: ' 蓝灰', color: '336699' }),
        ],
      }),
    ]),
  );
}

async function buildLists(): Promise<Buffer> {
  return pack(
    new Document({
      creator: 'wenshu-fixture',
      title: 'wenshu-fixture',
      description: 'wenshu-fixture',
      numbering: NUMBERING,
      sections: [
        {
          children: [
            new Paragraph({ text: '项目一', bullet: { level: 0 } }),
            new Paragraph({ text: '项目二', bullet: { level: 0 } }),
            new Paragraph({ text: '嵌套项目', bullet: { level: 1 } }),
            new Paragraph({ text: '编号一', numbering: { reference: 'ordered-list', level: 0 } }),
            new Paragraph({ text: '编号二', numbering: { reference: 'ordered-list', level: 0 } }),
            new Paragraph({ text: '嵌套编号', numbering: { reference: 'ordered-list', level: 1 } }),
          ],
        },
      ],
    }),
  );
}

async function buildAlignment(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({ text: '左对齐', alignment: AlignmentType.LEFT }),
      new Paragraph({ text: '居中', alignment: AlignmentType.CENTER }),
      new Paragraph({ text: '右对齐', alignment: AlignmentType.RIGHT }),
      new Paragraph({ text: '两端对齐', alignment: AlignmentType.JUSTIFIED }),
      new Paragraph({ text: '未指定对齐' }),
    ]),
  );
}

async function buildComplexImage(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({
        children: [
          new ImageRun({ type: 'png', data: TINY_PNG, transformation: { width: 10, height: 10 } }),
        ],
      }),
      new Paragraph({ text: '图片后的正文' }),
    ]),
  );
}

async function buildComplexTable(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph('单元格 A1')] }),
              new TableCell({ children: [new Paragraph('单元格 B1')] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph('单元格 A2')] }),
              new TableCell({ children: [new Paragraph('单元格 B2')] }),
            ],
          }),
        ],
      }),
      new Paragraph({ text: '表格后的正文' }),
    ]),
  );
}

async function buildComplexHeaderFooter(): Promise<Buffer> {
  const doc = new Document({
    creator: 'wenshu-fixture',
    title: 'wenshu-fixture',
    description: 'wenshu-fixture',
    sections: [
      {
        children: [new Paragraph({ text: '正文内容' })],
        headers: { default: new Header({ children: [new Paragraph('页眉文字')] }) },
        footers: { default: new Footer({ children: [new Paragraph('页脚文字')] }) },
      },
    ],
  });
  return pack(doc);
}

async function buildComplexComment(): Promise<Buffer> {
  const comments: ICommentsOptions = {
    children: [
      {
        id: 0,
        author: 'wenshu-fixture',
        initials: 'WF',
        date: FIXED_DATE,
        children: [new Paragraph('这是一条批注')],
      },
    ],
  };
  const doc = new Document({
    creator: 'wenshu-fixture',
    title: 'wenshu-fixture',
    description: 'wenshu-fixture',
    comments,
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new CommentRangeStart(0),
              new TextRun('被批注的文字'),
              new CommentRangeEnd(0),
              new CommentReference(0),
            ],
          }),
        ],
      },
    ],
  });
  return pack(doc);
}

/** 修订样本：对合法文档的 document.xml 做有限补丁（w:ins / w:del）。 */
async function buildComplexRevision(): Promise<Buffer> {
  const base = await buildPlain();
  const zip = await JSZip.loadAsync(base);
  let xml = await zip.file('word/document.xml')?.async('string');
  if (xml === undefined) {
    throw new Error('fixture: document.xml missing from base docx');
  }
  const ins = `<w:ins w:id="1" w:author="wenshu-fixture" w:date="2026-01-01T00:00:00Z"><w:r><w:t>插入内容</w:t></w:r></w:ins>`;
  const del = `<w:del w:id="2" w:author="wenshu-fixture" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>删除内容</w:delText></w:r></w:del>`;
  if (!xml.includes('</w:p>')) {
    throw new Error('fixture: unexpected document.xml shape');
  }
  xml = xml.replace('</w:p>', `${ins}${del}</w:p>`);
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function buildComplexLink(): Promise<Buffer> {
  const doc = new Document({
    creator: 'wenshu-fixture',
    title: 'wenshu-fixture',
    description: 'wenshu-fixture',
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ExternalHyperlink({
                children: [new TextRun('链接文本')],
                link: 'https://example.com/fixture',
              }),
            ],
          }),
        ],
      },
    ],
  });
  return pack(doc);
}

async function buildFailureCorrupt(): Promise<Buffer> {
  return Buffer.from(
    'this is definitely not a zip file. padding padding padding padding padding padding padding padding',
    'utf8',
  );
}

async function buildFailureFake(): Promise<Buffer> {
  return Buffer.from('plain text pretending to be a docx file', 'utf8');
}

async function buildFailureMissingParts(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** 加密模拟：只含 EncryptionInfo + EncryptedPackage 的 ZIP，无关键 OOXML 部件。 */
async function buildFailureEncryptedSim(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('EncryptionInfo', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  zip.file('EncryptedPackage', Buffer.from([9, 9, 9, 9, 9, 9]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** 超限样本：合法 DOCX 追加 21 MiB 填充（ZIP 读取器忽略尾部数据）。 */
async function buildFailureOversize(): Promise<Buffer> {
  const base = await buildPlain();
  return Buffer.concat([base, Buffer.alloc(OVERSIZE_PADDING_BYTES, 0x61)]);
}

/**
 * TASK-008 WP0 只读夹具：普通文档 + settings.xml 注入明确启用的
 * `w:documentProtection w:edit="readOnly" w:enforcement="1"`，经检查器应判为
 * `encrypted-protected` 特性 → `read-only` 兼容性等级。
 */
async function buildReadOnly(): Promise<Buffer> {
  const base = await buildPlain();
  const zip = await JSZip.loadAsync(base);
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`;
  zip.file('word/settings.xml', settings);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * TASK-008 WP0 组合字符/代理对夹具：组合变音符号、astral emoji、CJK 扩展区字符与
 * run 内原生换行。用于验证投影与 ProseMirror 位置都按 UTF-16 code unit 计数，
 * 且不因归一化/代理对拆分改变偏移。
 */
async function buildCombiningEmoji(): Promise<Buffer> {
  return pack(
    makeDocument([
      new Paragraph({
        children: [
          new TextRun({ text: '组合字符 e\u0301 与 a\u0300 保持原码位' }),
          new TextRun({ text: '  astral emoji 🎉🚀\n行内换行后继续' }),
          new TextRun({ text: '  CJK 扩展区 𠮷野家' }),
        ],
      }),
    ]),
  );
}

/**
 * TASK-008 WP0 投影混合夹具：标题 + 跨 run marks 段落 + 空段落 + 嵌套项目符号/
 * 编号列表 + 中文/英文/emoji 段落。用于冻结"普通段落、标题、空段落、marks 跨 run、
 * 项目符号列表、编号列表和嵌套列表稳定映射"的投影规则。
 */
async function buildProjectionMixed(): Promise<Buffer> {
  return pack(
    new Document({
      creator: 'wenshu-fixture',
      title: 'wenshu-fixture',
      description: 'wenshu-fixture',
      numbering: NUMBERING,
      sections: [
        {
          children: [
            new Paragraph({ text: '投影标题', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({
              children: [
                new TextRun({ text: '粗体', bold: true }),
                new TextRun({ text: '与' }),
                new TextRun({ text: '斜体', italics: true }),
                new TextRun({ text: ' 跨 run 可匹配 English text.' }),
              ],
            }),
            new Paragraph(''),
            new Paragraph({ text: '项目甲', bullet: { level: 0 } }),
            new Paragraph({ text: '项目乙', bullet: { level: 0 } }),
            new Paragraph({ text: '嵌套项目', bullet: { level: 1 } }),
            new Paragraph({ text: '编号一', numbering: { reference: 'ordered-list', level: 0 } }),
            new Paragraph({ text: '编号二', numbering: { reference: 'ordered-list', level: 0 } }),
            new Paragraph({
              text: '嵌套编号',
              numbering: { reference: 'ordered-list', level: 1 },
            }),
            new Paragraph({ text: '普通段落 emoji 🎉 结尾' }),
          ],
        },
      ],
    }),
  );
}

/** TASK-008 WP0 大文件夹具：合法 DOCX 填充到恰好 20 MiB（读取耗时/取消窗口验证用）。 */
async function buildLarge(): Promise<Buffer> {
  const base = await buildPlain();
  return Buffer.concat([base, Buffer.alloc(DOCX_MAX_FILE_BYTES - base.byteLength, 0x61)]);
}

export interface DocxFixtureSet {
  /** fixture id（不含 .docx 后缀）→ 文件字节。 */
  readonly files: Readonly<Record<string, Buffer>>;
}

/**
 * 生成全部 DOCX 夹具。
 * 每个 fixture 都在内存中构造；测试自行决定是否写入临时目录。
 */
export async function buildDocxFixtures(): Promise<DocxFixtureSet> {
  const [
    plain,
    empty,
    headings,
    marks,
    fontSizeColor,
    lists,
    alignment,
    image,
    table,
    headerFooter,
    comment,
    revision,
    link,
    corrupt,
    fake,
    missingParts,
    encryptedSim,
    oversize,
    readOnly,
    combiningEmoji,
    projectionMixed,
    large,
  ] = await Promise.all([
    buildPlain(),
    buildEmpty(),
    buildHeadings(),
    buildMarks(),
    buildFontSizeColor(),
    buildLists(),
    buildAlignment(),
    buildComplexImage(),
    buildComplexTable(),
    buildComplexHeaderFooter(),
    buildComplexComment(),
    buildComplexRevision(),
    buildComplexLink(),
    buildFailureCorrupt(),
    buildFailureFake(),
    buildFailureMissingParts(),
    buildFailureEncryptedSim(),
    buildFailureOversize(),
    buildReadOnly(),
    buildCombiningEmoji(),
    buildProjectionMixed(),
    buildLarge(),
  ]);
  return {
    files: {
      'ok-plain': plain,
      'ok-empty': empty,
      'ok-headings': headings,
      'ok-marks': marks,
      'ok-font-size-color': fontSizeColor,
      'ok-lists': lists,
      'ok-alignment': alignment,
      'ok-read-only': readOnly,
      'ok-combining-emoji': combiningEmoji,
      'ok-projection-mixed': projectionMixed,
      'ok-large': large,
      'complex-image': image,
      'complex-table': table,
      'complex-header-footer': headerFooter,
      'complex-comment': comment,
      'complex-revision': revision,
      'complex-link': link,
      'fail-corrupt': corrupt,
      'fail-fake-docx': fake,
      'fail-missing-parts': missingParts,
      'fail-encrypted-sim': encryptedSim,
      'fail-oversize': oversize,
    },
  };
}
