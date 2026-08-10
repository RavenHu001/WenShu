/**
 * DOCX 语义导入（TASK-007 WP2）—— Mammoth 文档模型 + 有限 OOXML 补充读取 → 项目中间模型。
 *
 * ## 流程（WP0 冻结结论）
 *
 * 1. `mammoth.convertToHtml({buffer}, {transformDocument})` 取得语义文档树
 *    （选项是第二参数；Mammoth 1.12.1 实测确认）；
 * 2. 把文档树映射为库无关的 `DocxImportSource`：
 *    - 段落样式（Heading N / 标题 N / styleId HeadingN）与对齐归一化；
 *    - run 文本与 marks（粗/斜/下划线/字号）提取，行内换行映射为 `\n`；
 *    - 图片/超链接/批注引用/未知内容 → 稳定特性（由导入转换生成兼容性警告）；
 *    - 表格与未知顶层节点 → 降级块；
 * 3. 把 `inspectDocxPackage` 的颜色补充读取按 run 顺序合并（数量不一致时保守放弃）；
 * 4. 文档级特性（页眉页脚/修订/保护/嵌入对象）并入导入源；
 * 5. 调用 `importSourceToDocxModel` 生成模型与兼容性报告。
 *
 * 安全边界：不访问外部关系、不执行文档内容、不向模型写入未经清洗的 HTML/XML；
 * 任何解析失败都转换为稳定 `INVALID_DOCX`，资源超限转换为 `RESOURCE_LIMIT_EXCEEDED`。
 */

import mammoth from 'mammoth';
import { importSourceToDocxModel } from '../../shared/docx-convert';
import {
  docxDocumentError,
  type DocxAlignment,
  type DocxCompatibilityReport,
  type DocxDocumentError,
  type DocxDocumentModel,
  type DocxImportBlock,
  type DocxImportRun,
  type DocxImportRunFeature,
  type DocxImportSource,
} from '../../shared/docx';
import type { DocxPackageInspection } from './inspect-docx-package';

/* ======================= Mammoth 文档树结构接口 ======================= */

interface MammothTreeLike {
  readonly type?: string;
  readonly children?: readonly MammothNodeLike[];
}

interface MammothNodeLike {
  readonly type?: string;
  readonly styleId?: unknown;
  readonly styleName?: unknown;
  readonly alignment?: unknown;
  readonly numbering?: { readonly isOrdered?: boolean; readonly level?: unknown } | null;
  readonly children?: readonly MammothChildLike[];
}

interface MammothChildLike {
  readonly type?: string;
  readonly children?: readonly MammothPartLike[];
  readonly isBold?: boolean;
  readonly isItalic?: boolean;
  readonly isUnderline?: boolean;
  readonly fontSize?: number | null;
  readonly href?: string;
  readonly breakType?: string;
}

interface MammothPartLike {
  readonly type?: string;
  readonly value?: unknown;
}

/* ======================= 树 → 导入源映射 ======================= */

/** Mammoth 缺失样式/对齐以字符串 "null" 表示，归一化为 null。 */
function normStyleValue(value: unknown): string | null {
  return typeof value === 'string' && value !== 'null' && value.length > 0 ? value : null;
}

function normAlignment(value: unknown): DocxAlignment | null {
  return value === 'left' || value === 'center' || value === 'right' || value === 'both'
    ? value
    : null;
}

/** run 内容映射：文本拼接、行内换行 → `\n`、图片/未知内容 → 特性。 */
function mapRunParts(
  parts: readonly MammothPartLike[],
  extraFeatures: readonly DocxImportRunFeature[],
): { readonly text: string; readonly features: readonly DocxImportRunFeature[] } {
  let text = '';
  const features: DocxImportRunFeature[] = [...extraFeatures];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.value === 'string') {
      text += part.value;
    } else if (part.type === 'break' && (part as MammothChildLike).breakType === 'line') {
      text += '\n';
    } else if (part.type === 'break') {
      features.push('other');
    } else if (part.type === 'image') {
      features.push('image');
    } else if (part.type !== 'text') {
      features.push('other');
    }
  }
  return { text, features };
}

function mapMammothRun(
  child: MammothChildLike,
  extraFeatures: readonly DocxImportRunFeature[],
): DocxImportRun {
  const mapped = mapRunParts(child.children ?? [], extraFeatures);
  return {
    text: mapped.text,
    isBold: child.isBold === true,
    isItalic: child.isItalic === true,
    isUnderline: child.isUnderline === true,
    fontSize: child.fontSize ?? null,
    color: null,
    features: mapped.features,
  };
}

function featureOnlyRun(feature: DocxImportRunFeature): DocxImportRun {
  return {
    text: '',
    isBold: false,
    isItalic: false,
    isUnderline: false,
    fontSize: null,
    color: null,
    features: [feature],
  };
}

/**
 * 把 Mammoth 文档树映射为导入源。
 * `paragraphColorIndex` 与 inspection.colorsByTopLevelParagraph 按文档顺序对齐
 * （扫描器只统计顶层段落，与 Mammoth 顶层段落一一对应）；颜色数量与 run 数
 * 不一致时保守放弃该段颜色（不产生错误颜色归属）。
 */
export function mammothTreeToImportSource(
  tree: MammothTreeLike,
  inspection: DocxPackageInspection,
): DocxImportSource {
  const blocks: DocxImportBlock[] = [];
  const colors = inspection.colorsByTopLevelParagraph;
  let paragraphColorIndex = 0;

  for (const node of tree.children ?? []) {
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
        runs.push(featureOnlyRun('comment-reference'));
      } else if (child.type === 'image') {
        runs.push(featureOnlyRun('image'));
      } else {
        runs.push(featureOnlyRun('other'));
      }
    }

    // 颜色补充读取合并（按序对齐；数量不一致 → 放弃该段颜色）
    const paragraphColors = colors[paragraphColorIndex] ?? null;
    paragraphColorIndex += 1;
    if (paragraphColors !== null && paragraphColors.length === runs.length) {
      for (let i = 0; i < runs.length; i += 1) {
        runs[i] = { ...runs[i]!, color: paragraphColors[i] ?? null };
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

  return { documentFeatures: inspection.documentFeatures, blocks };
}

/* ======================= 导入入口 ======================= */

export type ImportDocxResult =
  | {
      readonly status: 'ok';
      readonly model: DocxDocumentModel;
      readonly compatibility: DocxCompatibilityReport;
    }
  | { readonly status: 'error'; readonly error: DocxDocumentError };

/**
 * 把 DOCX 原始字节导入为结构化模型与兼容性报告。
 * 解析失败 → INVALID_DOCX；模型预算超限 → RESOURCE_LIMIT_EXCEEDED；其余不抛出。
 */
export async function importDocxDocument(
  bytes: Uint8Array,
  inspection: DocxPackageInspection,
): Promise<ImportDocxResult> {
  let tree: MammothTreeLike | null = null;
  try {
    // mammoth 的 BufferInput 类型只声明 Buffer；运行时接受 Uint8Array（jszip 直接消费），
    // 此处按运行时语义转换类型，不复制字节。
    await mammoth.convertToHtml(
      { buffer: bytes as unknown as Buffer },
      {
        transformDocument: (document: MammothTreeLike) => {
          tree = document;
          return document;
        },
      },
    );
  } catch {
    return { status: 'error', error: docxDocumentError('INVALID_DOCX') };
  }
  if (tree === null) {
    return { status: 'error', error: docxDocumentError('INVALID_DOCX') };
  }

  const source = mammothTreeToImportSource(tree, inspection);
  const converted = importSourceToDocxModel(source);
  if (converted.status === 'limit-exceeded') {
    return { status: 'error', error: docxDocumentError('RESOURCE_LIMIT_EXCEEDED') };
  }
  return { status: 'ok', model: converted.model, compatibility: converted.compatibility };
}
