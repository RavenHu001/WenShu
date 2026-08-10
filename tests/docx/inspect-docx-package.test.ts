/**
 * TASK-007 WP2：DOCX ZIP/OOXML 结构与资源预算检查、有限属性补充读取测试（任务第 8.3 节）。
 * 覆盖：夹具结构、颜色逐段提取（含表格内排除）、页眉页脚/修订/保护/嵌入对象特性、
 * 损坏 ZIP / 缺失关键部件 / 加密模拟拒绝、条目数/总解压/关键 XML 预算。
 */

import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import {
  DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES,
  DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES,
  DOCX_MAX_ZIP_ENTRIES,
} from '../../src/shared/docx';
import {
  inspectDocxPackage,
  scanDocumentXml,
  type DocxPackageInspection,
} from '../../src/main/docx/inspect-docx-package';
import { buildDocxFixtures } from './docx-fixture-builder';

async function okInspection(bytes: Buffer): Promise<DocxPackageInspection> {
  const result = await inspectDocxPackage(bytes);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('unreachable');
  }
  return result.inspection;
}

async function expectInspectError(bytes: Buffer, code: string): Promise<void> {
  const result = await inspectDocxPackage(bytes);
  expect(result.status).toBe('error');
  if (result.status === 'error') {
    expect(result.error.code).toBe(code);
  }
}

/** 手写最小 DOCX：给定 document.xml，用 JSZip 组装标准部件。 */
async function minimalDocx(
  documentXml: string,
  extra: Record<string, string | Buffer> = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file('word/document.xml', documentXml);
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
  );
  for (const [name, content] of Object.entries(extra)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('inspectDocxPackage：结构与预算（第 8.3 节）', () => {
  it('普通夹具检查通过，关键部件存在', async () => {
    const fixtures = await buildDocxFixtures();
    for (const id of [
      'ok-plain',
      'ok-headings',
      'ok-marks',
      'ok-font-size-color',
      'ok-lists',
      'ok-alignment',
      'ok-empty',
      'complex-image',
      'complex-table',
      'complex-comment',
      'complex-link',
    ]) {
      const inspection = await okInspection(fixtures.files[id]!);
      expect(inspection.documentFeatures).toEqual([]);
    }
  });

  it('损坏 ZIP / 伪装扩展名 / 缺失关键部件 / 加密模拟 → INVALID_DOCX', async () => {
    const fixtures = await buildDocxFixtures();
    for (const id of [
      'fail-corrupt',
      'fail-fake-docx',
      'fail-missing-parts',
      'fail-encrypted-sim',
    ]) {
      await expectInspectError(fixtures.files[id]!, 'INVALID_DOCX');
    }
  });

  it('缺少 [Content_Types].xml 或 word/document.xml → INVALID_DOCX', async () => {
    const zipNoContentTypes = new JSZip();
    zipNoContentTypes.file('word/document.xml', '<w:document/>');
    await expectInspectError(
      await zipNoContentTypes.generateAsync({ type: 'nodebuffer' }),
      'INVALID_DOCX',
    );
  });

  it('条目数超过上限 → RESOURCE_LIMIT_EXCEEDED', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    zip.file('word/document.xml', '<w:document/>');
    for (let i = 0; i < DOCX_MAX_ZIP_ENTRIES + 1; i += 1) {
      zip.file(`word/part${i}.xml`, '<x/>');
    }
    await expectInspectError(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'RESOURCE_LIMIT_EXCEEDED',
    );
  });

  it('总解压大小超过上限 → RESOURCE_LIMIT_EXCEEDED', async () => {
    // 64 MiB + 1 的重复内容（DEFLATE 后体积很小，但解压大小按条目统计）
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    zip.file('word/document.xml', '<w:document/>');
    zip.file('word/big.xml', Buffer.alloc(DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES + 1, 0x61));
    await expectInspectError(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'RESOURCE_LIMIT_EXCEEDED',
    );
  });

  it('关键 XML（document.xml）解压大小超过上限 → RESOURCE_LIMIT_EXCEEDED', async () => {
    const bigDoc = `<w:document>${'<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(
      Math.ceil(DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES / 34) + 1,
    )}</w:document>`;
    await expectInspectError(await minimalDocx(bigDoc), 'RESOURCE_LIMIT_EXCEEDED');
  });
});

describe('inspectDocxPackage：文档级特性', () => {
  it('页眉页脚部件 → header-footer 特性', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['complex-header-footer']!);
    expect(inspection.documentFeatures).toContain('header-footer');
    const plain = await okInspection(fixtures.files['ok-plain']!);
    expect(plain.documentFeatures).not.toContain('header-footer');
  });

  it('w:ins / w:del → revision 特性', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['complex-revision']!);
    expect(inspection.documentFeatures).toContain('revision');
  });

  it('settings.xml 的 w:documentProtection → encrypted-protected 特性', async () => {
    const settings =
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>';
    const bytes = await minimalDocx('<w:document><w:body><w:p/></w:body></w:document>', {
      'word/settings.xml': settings,
    });
    const inspection = await okInspection(bytes);
    expect(inspection.documentFeatures).toContain('encrypted-protected');
  });

  it('word/embeddings/ 部件或 vbaProject → embedded-object 特性', async () => {
    const bytes = await minimalDocx('<w:document/>', {
      'word/embeddings/oleObject1.bin': Buffer.from([1, 2, 3]),
    });
    const inspection = await okInspection(bytes);
    expect(inspection.documentFeatures).toContain('embedded-object');
  });

  it('特性去重且顺序确定', async () => {
    const settings =
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly"/></w:settings>';
    const bytes = await minimalDocx(
      '<w:document><w:body><w:p><w:ins w:id="1"><w:r><w:t>x</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>y</w:delText></w:r></w:del></w:p></w:body></w:document>',
      {
        'word/settings.xml': settings,
        'word/header1.xml': '<w:hdr/>',
        'word/embeddings/o.bin': Buffer.from([9]),
      },
    );
    const inspection = await okInspection(bytes);
    const features = inspection.documentFeatures;
    for (const feature of [
      'header-footer',
      'revision',
      'encrypted-protected',
      'embedded-object',
    ] as const) {
      expect(features.filter((f) => f === feature)).toHaveLength(1);
    }
  });
});

describe('scanDocumentXml：颜色补充读取', () => {
  it('按 run 顺序提取 w:color，无颜色为 null', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['ok-font-size-color']!);
    expect(inspection.colorsByTopLevelParagraph).toEqual([
      [null, null, null, '#FF0000', '#336699'],
    ]);
  });

  it('ok-marks 无颜色 → 全部 null', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['ok-marks']!);
    expect(inspection.colorsByTopLevelParagraph).toEqual([[null, null, null, null, null]]);
  });

  it('每个顶层段落独立成组，与段落顺序一致', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['ok-plain']!);
    expect(inspection.colorsByTopLevelParagraph).toHaveLength(5);
    for (const group of inspection.colorsByTopLevelParagraph) {
      expect(group).toEqual([null]);
    }
  });

  it('表格内段落不进入顶层颜色序列', async () => {
    const fixtures = await buildDocxFixtures();
    const inspection = await okInspection(fixtures.files['complex-table']!);
    // complex-table：1 个顶层段落（表格后的正文）+ 4 个表格内段落（被排除）
    expect(inspection.colorsByTopLevelParagraph).toHaveLength(1);
  });

  it('颜色值大小写归一化为大写 #RRGGBB', async () => {
    const bytes = await minimalDocx(
      '<w:document><w:body><w:p><w:r><w:rPr><w:color w:val="ff00aa"/></w:rPr><w:t>a</w:t></w:r></w:p></w:body></w:document>',
    );
    const inspection = await okInspection(bytes);
    expect(inspection.colorsByTopLevelParagraph).toEqual([['#FF00AA']]);
  });

  it('非法颜色值与空 run / 空段落处理', async () => {
    const bytes = await minimalDocx(
      '<w:document><w:body><w:p><w:r><w:rPr><w:color w:val="XYZ123"/></w:rPr><w:t>a</w:t></w:r><w:r/></w:p><w:p/></w:body></w:document>',
    );
    const inspection = await okInspection(bytes);
    expect(inspection.colorsByTopLevelParagraph).toEqual([[null, null], []]);
  });

  it('scanDocumentXml：w:ins/w:del 检测与颜色提取独立', () => {
    const scan = scanDocumentXml(
      '<w:document><w:body><w:p><w:del w:id="1"><w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:delText>x</w:delText></w:r></w:del></w:p></w:body></w:document>',
    );
    expect(scan.hasTrackedChanges).toBe(true);
    expect(scan.colorsByTopLevelParagraph).toEqual([['#00FF00']]);
  });
});
