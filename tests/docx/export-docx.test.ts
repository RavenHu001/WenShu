/**
 * TASK-007 WP3：DOCX 基础导出与产物验证测试（任务第 8.4 节）。
 * 覆盖：模型 → 字节 → 重新导入闭环（正文/标题/marks/字号/颜色/列表/对齐/空段落）、
 * 产物 ZIP 结构、产物大小上限、verifyGeneratedDocxDocument 失败路径。
 */

import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import {
  DOCX_MAX_FILE_BYTES,
  DOCX_MODEL_SCHEMA_VERSION,
  validateDocxDocumentModel,
  type DocxDocumentModel,
} from '../../src/shared/docx';
import { exportDocxDocument, verifyGeneratedDocxDocument } from '../../src/main/docx/export-docx';
import { inspectDocxPackage } from '../../src/main/docx/inspect-docx-package';
import { importDocxDocument } from '../../src/main/docx/import-docx';
import { buildDocxFixtures } from './docx-fixture-builder';

async function importFixtureBytes(bytes: Buffer) {
  const inspection = await inspectDocxPackage(bytes);
  expect(inspection.status).toBe('ok');
  if (inspection.status !== 'ok') {
    throw new Error('unreachable');
  }
  const imported = await importDocxDocument(bytes, inspection.inspection);
  expect(imported.status).toBe('ok');
  if (imported.status !== 'ok') {
    throw new Error('unreachable');
  }
  return imported;
}

/** 导出 → 重新导入，返回新模型与兼容性。 */
async function exportAndReimport(model: DocxDocumentModel) {
  const bytes = await exportDocxDocument(model);
  const imported = await importFixtureBytes(Buffer.from(bytes));
  return { bytes, imported };
}

function blockText(block: {
  readonly kind: string;
  readonly runs?: readonly { readonly text: string }[];
}): string {
  return (block.runs ?? []).map((r) => r.text).join('');
}

describe('exportDocxDocument：导出 → 重新导入闭环（第 8.4 节）', () => {
  it('普通夹具导入后导出再导入：正文与结构语义一致', async () => {
    const fixtures = await buildDocxFixtures();
    for (const id of ['ok-plain', 'ok-headings', 'ok-marks', 'ok-alignment', 'ok-empty']) {
      const { imported, bytes } = await exportAndReimport(
        (await importFixtureBytes(fixtures.files[id]!)).model,
      );
      expect(validateDocxDocumentModel(imported.model)).toEqual([]);
      expect(imported.model.blocks).toEqual(
        (await importFixtureBytes(fixtures.files[id]!)).model.blocks,
      );
      expect(bytes.byteLength).toBeLessThanOrEqual(DOCX_MAX_FILE_BYTES);
    }
  });

  it('列表导出后重新导入：项目符号/编号与嵌套层级保持', async () => {
    const fixtures = await buildDocxFixtures();
    const source = await importFixtureBytes(fixtures.files['ok-lists']!);
    const { imported } = await exportAndReimport(source.model);
    expect(imported.model.blocks).toEqual(source.model.blocks);
  });

  it('字号与颜色导出后重新导入（颜色经 XML 补充读取回读）', async () => {
    const fixtures = await buildDocxFixtures();
    const source = await importFixtureBytes(fixtures.files['ok-font-size-color']!);
    const { imported } = await exportAndReimport(source.model);
    const a = source.model.blocks[0];
    const b = imported.model.blocks[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a?.kind === 'paragraph' && b?.kind === 'paragraph') {
      expect(a.runs.map((r) => r.marks)).toEqual(b.runs.map((r) => r.marks));
      expect(b.runs.map((r) => r.marks)).toEqual([
        [{ type: 'font-size', value: 9 }],
        [{ type: 'font-size', value: 10.5 }],
        [{ type: 'font-size', value: 14 }],
        [{ type: 'color', value: '#FF0000' }],
        [{ type: 'color', value: '#336699' }],
      ]);
    }
  });

  it('手写模型（含 marks/字号/颜色/对齐/嵌套列表/空段落）导出后重新导入语义一致', async () => {
    const model: DocxDocumentModel = {
      schemaVersion: DOCX_MODEL_SCHEMA_VERSION,
      blocks: [
        { kind: 'heading', level: 2, runs: [{ text: '小节', marks: [] }] },
        {
          kind: 'paragraph',
          alignment: 'both',
          runs: [
            { text: '粗斜', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { text: ' 下划线', marks: [{ type: 'underline' }] },
            { text: ' 红色', marks: [{ type: 'color', value: '#336699' }] },
            { text: ' 十四磅', marks: [{ type: 'font-size', value: 14 }] },
          ],
        },
        { kind: 'paragraph', alignment: null, runs: [] },
        {
          kind: 'ordered-list',
          level: 0,
          blocks: [
            { kind: 'paragraph', alignment: null, runs: [{ text: '编号一', marks: [] }] },
            {
              kind: 'paragraph',
              alignment: 'center',
              runs: [{ text: '编号二（居中）', marks: [] }],
            },
            {
              kind: 'bullet-list',
              level: 1,
              blocks: [
                { kind: 'paragraph', alignment: null, runs: [{ text: '嵌套项目', marks: [] }] },
              ],
            },
          ],
        },
      ],
    };
    const { imported } = await exportAndReimport(model);
    expect(imported.model.blocks).toEqual(model.blocks);
  });

  it('产物是合法 ZIP 且包含关键部件', async () => {
    const fixtures = await buildDocxFixtures();
    const { bytes } = await exportAndReimport(
      (await importFixtureBytes(fixtures.files['ok-plain']!)).model,
    );
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain('[Content_Types].xml');
    expect(Object.keys(zip.files)).toContain('word/document.xml');
    expect(Object.keys(zip.files)).toContain('word/styles.xml');
  });

  it('导出产物导入兼容性为 supported（只含受支持内容）', async () => {
    const fixtures = await buildDocxFixtures();
    const source = await importFixtureBytes(fixtures.files['ok-lists']!);
    const { imported } = await exportAndReimport(source.model);
    expect(imported.compatibility.level).toBe('supported');
  });

  it('多段落与 emoji/中文保留', async () => {
    const fixtures = await buildDocxFixtures();
    const { imported } = await exportAndReimport(
      (await importFixtureBytes(fixtures.files['ok-plain']!)).model,
    );
    expect(imported.model.blocks.map((b) => blockText(b))).toEqual([
      '第一段：中文内容 English text.',
      'emoji 🎉 与多段共存',
      '',
      '空段落之后的正文',
      '带前导空白的 run',
    ]);
  });
});

describe('verifyGeneratedDocxDocument（第 4.7 节步骤 5）', () => {
  it('合法产物通过验证并返回兼容性报告', async () => {
    const fixtures = await buildDocxFixtures();
    const source = await importFixtureBytes(fixtures.files['ok-headings']!);
    const bytes = await exportDocxDocument(source.model);
    const verified = await verifyGeneratedDocxDocument(bytes);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.compatibility.level).toBe('supported');
    }
  });

  it('超过 20 MiB 的产物验证失败', async () => {
    const result = await verifyGeneratedDocxDocument(new Uint8Array(DOCX_MAX_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
  });

  it('损坏字节 / 缺失关键部件验证失败', async () => {
    const fixtures = await buildDocxFixtures();
    expect((await verifyGeneratedDocxDocument(fixtures.files['fail-corrupt']!)).ok).toBe(false);
    expect((await verifyGeneratedDocxDocument(fixtures.files['fail-missing-parts']!)).ok).toBe(
      false,
    );
    expect((await verifyGeneratedDocxDocument(fixtures.files['fail-encrypted-sim']!)).ok).toBe(
      false,
    );
  });
});
