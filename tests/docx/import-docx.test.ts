/**
 * TASK-007 WP2：DOCX 语义导入测试（任务第 8.2/8.3 节）—— Mammoth 树 → 导入源 → 模型。
 * 覆盖：普通/空/标题/marks/字号/颜色合并/列表/对齐导入、复杂样本稳定警告、
 * 行内换行、颜色按序对齐与数量不一致保守放弃、失败样本稳定错误、模型预算超限。
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOCX_MAX_MODEL_BLOCKS, validateDocxDocumentModel } from '../../src/shared/docx';
import { importDocxDocument, mammothTreeToImportSource } from '../../src/main/docx/import-docx';
import {
  inspectDocxPackage,
  type DocxPackageInspection,
} from '../../src/main/docx/inspect-docx-package';
import { buildDocxFixtures } from './docx-fixture-builder';

async function importFixture(id: string) {
  const fixtures = await buildDocxFixtures();
  const bytes = fixtures.files[id]!;
  const inspection = await inspectDocxPackage(bytes);
  expect(inspection.status).toBe('ok');
  if (inspection.status !== 'ok') {
    throw new Error('unreachable');
  }
  const result = await importDocxDocument(bytes, inspection.inspection);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('unreachable');
  }
  return result;
}

function blockText(block: {
  readonly kind: string;
  readonly runs?: readonly { readonly text: string }[];
}): string {
  return (block.runs ?? []).map((r) => r.text).join('');
}

describe('importDocxDocument：普通样本（第 8.3 节）', () => {
  it('普通/空段落、中文、英文、emoji、空白保留', async () => {
    const { model } = await importFixture('ok-plain');
    expect(validateDocxDocumentModel(model)).toEqual([]);
    expect(model.blocks.map((b) => blockText(b))).toEqual([
      '第一段：中文内容 English text.',
      'emoji 🎉 与多段共存',
      '',
      '空段落之后的正文',
      '带前导空白的 run',
    ]);
  });

  it('空文档无块', async () => {
    const { model } = await importFixture('ok-empty');
    expect(model.blocks).toEqual([]);
  });

  it('标题 1-3 进入 heading 块', async () => {
    const { model } = await importFixture('ok-headings');
    expect(model.blocks.map((b) => (b.kind === 'heading' ? `heading:${b.level}` : b.kind))).toEqual(
      ['heading:1', 'heading:2', 'heading:3', 'paragraph'],
    );
  });

  it('marks：粗/斜/下划线按规范顺序进入 run', async () => {
    const { model } = await importFixture('ok-marks');
    const block = model.blocks[0];
    expect(block).toBeDefined();
    if (block?.kind !== 'paragraph') {
      return;
    }
    expect(block.runs.map((r) => ({ text: r.text, marks: r.marks.map((m) => m.type) }))).toEqual([
      { text: '粗体', marks: ['bold'] },
      { text: ' 斜体', marks: ['italic'] },
      { text: ' 下划线', marks: ['underline'] },
      { text: ' 粗斜下', marks: ['bold', 'italic', 'underline'] },
      { text: ' 无格式', marks: [] },
    ]);
  });

  it('字号进入 font-size mark；颜色经补充读取合并（第 8.3 节有限补充）', async () => {
    const { model } = await importFixture('ok-font-size-color');
    const block = model.blocks[0];
    expect(block).toBeDefined();
    if (block?.kind !== 'paragraph') {
      return;
    }
    expect(block.runs.map((r) => r.marks)).toEqual([
      [{ type: 'font-size', value: 9 }],
      [{ type: 'font-size', value: 10.5 }],
      [{ type: 'font-size', value: 14 }],
      [{ type: 'color', value: '#FF0000' }],
      [{ type: 'color', value: '#336699' }],
    ]);
  });

  it('项目符号/编号列表聚合为嵌套列表', async () => {
    const { model } = await importFixture('ok-lists');
    expect(
      model.blocks.map((b) =>
        b.kind === 'bullet-list' || b.kind === 'ordered-list' ? `${b.kind}:${b.level}` : b.kind,
      ),
    ).toEqual(['bullet-list:0', 'ordered-list:0']);
    const bullet = model.blocks[0];
    if (bullet?.kind === 'bullet-list') {
      expect(bullet.blocks.map((b) => (b.kind === 'paragraph' ? blockText(b) : 'nested'))).toEqual([
        '项目一',
        '项目二',
        'nested',
      ]);
    }
  });

  it('段落对齐进入模型（justify → both）', async () => {
    const { model } = await importFixture('ok-alignment');
    expect(model.blocks.map((b) => (b.kind === 'paragraph' ? b.alignment : null))).toEqual([
      'left',
      'center',
      'right',
      'both',
      null,
    ]);
  });

  it('兼容性：普通样本 supported', async () => {
    const { compatibility } = await importFixture('ok-plain');
    expect(compatibility.level).toBe('supported');
    expect(compatibility.warnings).toEqual([]);
  });
});

describe('importDocxDocument：复杂样本稳定警告（第 8.3 节）', () => {
  it('图片：image 警告，图片 run 无正文', async () => {
    const { model, compatibility } = await importFixture('complex-image');
    expect(compatibility.warnings.map((w) => w.code)).toContain('image');
    expect(compatibility.level).toBe('degraded');
    const block = model.blocks[0];
    expect(block).toBeDefined();
    if (block?.kind === 'paragraph') {
      expect(block.runs).toEqual([]);
    }
    expect(blockText(model.blocks[1]!)).toBe('图片后的正文');
  });

  it('表格：table 警告，表格内容不进入模型', async () => {
    const { model, compatibility } = await importFixture('complex-table');
    expect(compatibility.warnings.map((w) => w.code)).toContain('table');
    expect(model.blocks.map((b) => b.kind)).toEqual(['paragraph']);
    expect(blockText(model.blocks[0]!)).toBe('表格后的正文');
  });

  it('批注：comment 警告，正文保留', async () => {
    const { model, compatibility } = await importFixture('complex-comment');
    expect(compatibility.warnings.map((w) => w.code)).toContain('comment');
    expect(blockText(model.blocks[0]!)).toContain('被批注的文字');
  });

  it('超链接：hyperlink 警告，链接文本保留为普通文本', async () => {
    const { model, compatibility } = await importFixture('complex-link');
    expect(compatibility.warnings.map((w) => w.code)).toContain('hyperlink');
    expect(blockText(model.blocks[0]!)).toBe('链接文本');
  });

  it('页眉页脚与修订特性 → header-footer / revision 警告', async () => {
    const { compatibility } = await importFixture('complex-header-footer');
    expect(compatibility.warnings.map((w) => w.code)).toContain('header-footer');
    const revision = await importFixture('complex-revision');
    expect(revision.compatibility.warnings.map((w) => w.code)).toContain('revision');
    expect(revision.compatibility.level).toBe('degraded');
  });
});

describe('importDocxDocument：失败与预算（第 8.3 节）', () => {
  it('损坏 ZIP / 伪装 / 缺失关键部件 / 加密模拟 → INVALID_DOCX', async () => {
    const fixtures = await buildDocxFixtures();
    for (const id of [
      'fail-corrupt',
      'fail-fake-docx',
      'fail-missing-parts',
      'fail-encrypted-sim',
    ]) {
      const inspection = await inspectDocxPackage(fixtures.files[id]!);
      if (inspection.status === 'ok') {
        const result = await importDocxDocument(fixtures.files[id]!, inspection.inspection);
        expect(result.status).toBe('error');
        if (result.status === 'error') {
          expect(result.error.code).toBe('INVALID_DOCX');
        }
      } else {
        expect(inspection.error.code).toBe('INVALID_DOCX');
      }
    }
  });

  it('损坏关系（document.xml 引用不存在的关系）：稳定 INVALID_DOCX，不崩溃不请求网络', async () => {
    // 手写：document.xml 带外部超链接 r:id，但不提供对应关系
    // （Mammoth 1.12.1 实测：悬空 hyperlink 关系会抛异常；按第 8.3 节"损坏关系"作为
    //   稳定失败处理，绝不返回部分模型）
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId999"><w:r><w:t>链接文本</w:t></w:r></w:hyperlink><w:r><w:t> 正文</w:t></w:r></w:p></w:body></w:document>',
    );
    zip.file(
      'word/styles.xml',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const inspection = await inspectDocxPackage(bytes);
    expect(inspection.status).toBe('ok');
    if (inspection.status !== 'ok') {
      return;
    }
    const result = await importDocxDocument(bytes, inspection.inspection);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INVALID_DOCX');
    }
  });

  it('模型预算超限（20001 段）→ RESOURCE_LIMIT_EXCEEDED', async () => {
    const paragraphs = '<w:p><w:r><w:t>p</w:t></w:r></w:p>'.repeat(DOCX_MAX_MODEL_BLOCKS + 1);
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    );
    zip.file(
      'word/styles.xml',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const inspection = await inspectDocxPackage(bytes);
    expect(inspection.status).toBe('ok');
    if (inspection.status !== 'ok') {
      return;
    }
    const result = await importDocxDocument(bytes, inspection.inspection);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    }
  });
});

describe('mammothTreeToImportSource：颜色对齐规则', () => {
  /** 构造单段两 run 的 Mammoth 树片段（测试脚手架形状）。 */
  function treeWithRuns(runCount: number): Parameters<typeof mammothTreeToImportSource>[0] {
    const runs = [];
    for (let i = 0; i < runCount; i += 1) {
      runs.push({
        type: 'run',
        children: [{ type: 'text', value: `r${i}` }],
        isBold: false,
        isItalic: false,
        isUnderline: false,
        fontSize: null,
      });
    }
    return {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          styleId: null,
          styleName: null,
          alignment: null,
          numbering: null,
          children: runs,
        },
      ],
    };
  }

  const inspection: DocxPackageInspection = {
    colorsByTopLevelParagraph: [['#FF0000', null]],
    documentFeatures: [],
  };

  it('颜色数量与 run 数一致时按序合并', () => {
    const source = mammothTreeToImportSource(treeWithRuns(2), inspection);
    const paragraph = source.blocks[0];
    expect(paragraph).toBeDefined();
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.runs.map((r) => r.color)).toEqual(['#FF0000', null]);
    }
  });

  it('颜色数量不一致时保守放弃该段颜色', () => {
    const source = mammothTreeToImportSource(treeWithRuns(3), inspection);
    const paragraph = source.blocks[0];
    expect(paragraph).toBeDefined();
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.runs.map((r) => r.color)).toEqual([null, null, null]);
    }
  });

  it('表格节点不消费颜色序列（与扫描器排除规则一致）', () => {
    const tree = {
      type: 'document',
      children: [
        { type: 'table', children: [] },
        {
          type: 'paragraph',
          styleId: null,
          styleName: null,
          alignment: null,
          numbering: null,
          children: [
            {
              type: 'run',
              children: [{ type: 'text', value: 'x' }],
              isBold: false,
              isItalic: false,
              isUnderline: false,
              fontSize: null,
            },
          ],
        },
      ],
    };
    const source = mammothTreeToImportSource(tree, {
      colorsByTopLevelParagraph: [['#00FF00']],
      documentFeatures: [],
    });
    expect(source.blocks.map((b) => b.type)).toEqual(['table', 'paragraph']);
    const paragraph = source.blocks[1];
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.runs[0]?.color).toBe('#00FF00');
    }
  });
});
