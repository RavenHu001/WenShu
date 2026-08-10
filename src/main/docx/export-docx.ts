/**
 * DOCX 基础导出（TASK-007 WP3）—— 中间模型 → 基础 DOCX 产物 + 产物验证。
 *
 * ## 导出映射（WP0 实测 + WP1 转换契约）
 *
 * - `docxModelToExportDescription` 把嵌套模型拍平为带 (ordered, level) 的段落序列；
 * - 段落/标题/对齐/run marks（粗/斜/下划线/字号半磅/颜色去 `#`）映射为 `docx` 库对象；
 * - 编号列表使用固定 numbering 引用（levels 0..4），项目符号使用 `bullet: {level}`；
 * - 产物通过 `Packer.toBuffer` 生成。
 *
 * ## 产物验证（第 4.7 节步骤 5）
 *
 * `verifyGeneratedDocxDocument` 对生成字节执行：大小（≤ 20 MiB）、ZIP/OOXML 基础结构
 * （`inspectDocxPackage`）与可重新导入（`importDocxDocument`）验证，并返回新产物的
 * 兼容性报告；任一验证失败 → `{ok: false}`，调用方必须中止替换。
 *
 * 已知限制（WP0 冻结）：`docx@9` 的 core.xml 时间戳固定取当前时间，产物字节非完全确定；
 * 正文与结构部件确定，revision 基于实际字节不受影响。
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { docxModelToExportDescription } from '../../shared/docx-convert';
import {
  DOCX_MAX_FILE_BYTES,
  type DocxCompatibilityReport,
  type DocxDocumentModel,
} from '../../shared/docx';
import { inspectDocxPackage } from './inspect-docx-package';
import { importDocxDocument } from './import-docx';

/** 编号列表使用的固定 numbering 引用（levels 0..4 十进制）。 */
const ORDERED_NUMBERING_REFERENCE = 'wenshu-ordered';

function runToTextRun(run: {
  readonly text: string;
  readonly marks: readonly { readonly type: string; readonly value?: unknown }[];
}): TextRun {
  const options: { text: string } & Record<string, unknown> = { text: run.text };
  for (const mark of run.marks) {
    if (mark.type === 'bold') {
      options.bold = true;
    } else if (mark.type === 'italic') {
      options.italics = true;
    } else if (mark.type === 'underline') {
      options.underline = {};
    } else if (mark.type === 'font-size') {
      options.size = Number(mark.value) * 2;
    } else if (mark.type === 'color') {
      options.color = String(mark.value).replace(/^#/, '');
    }
  }
  return new TextRun(options as ConstructorParameters<typeof TextRun>[0]);
}

function docxAlignment(alignment: string) {
  switch (alignment) {
    case 'left':
      return AlignmentType.LEFT;
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

/**
 * 把模型导出为基础 DOCX 字节。
 * 输入必须是合法模型（`validateDocxDocumentModel` 通过）；生成失败抛出异常，
 * 由调用方转换为稳定错误。
 */
export async function exportDocxDocument(model: DocxDocumentModel): Promise<Uint8Array> {
  const description = docxModelToExportDescription(model);
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
      options.alignment = docxAlignment(entry.alignment);
    }
    if (entry.list !== null) {
      if (entry.list.ordered) {
        options.numbering = { reference: ORDERED_NUMBERING_REFERENCE, level: entry.list.level };
      } else {
        options.bullet = { level: entry.list.level };
      }
    }
    return new Paragraph(options as ConstructorParameters<typeof Paragraph>[0]);
  });
  const doc = new Document({
    creator: '文枢',
    title: '文枢导出文档',
    description: '由文枢导出',
    numbering: {
      config: [
        {
          reference: ORDERED_NUMBERING_REFERENCE,
          levels: Array.from({ length: 5 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export type VerifyGeneratedDocxResult =
  { readonly ok: true; readonly compatibility: DocxCompatibilityReport } | { readonly ok: false };

/**
 * 产物验证：大小 → ZIP/OOXML 基础结构 → 可重新导入，返回新产物的兼容性报告。
 * 任何一步失败都返回 `{ok: false}`，不泄漏具体内部错误（调用方统一 VERIFICATION_FAILED）。
 */
export async function verifyGeneratedDocxDocument(
  bytes: Uint8Array,
): Promise<VerifyGeneratedDocxResult> {
  if (bytes.byteLength > DOCX_MAX_FILE_BYTES) {
    return { ok: false };
  }
  const inspection = await inspectDocxPackage(bytes);
  if (inspection.status === 'error') {
    return { ok: false };
  }
  const imported = await importDocxDocument(bytes, inspection.inspection);
  if (imported.status === 'error') {
    return { ok: false };
  }
  return { ok: true, compatibility: imported.compatibility };
}
