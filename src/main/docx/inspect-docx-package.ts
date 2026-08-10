/**
 * DOCX 不可信 ZIP/OOXML 基础结构与资源预算检查（TASK-007 WP2）。
 *
 * ## 职责（第 4.5 节 + WP0 冻结结论）
 *
 * - ZIP 条目数、总解压大小、关键 XML 大小预算检查；
 * - 关键部件存在性：[Content_Types].xml 与 word/document.xml（缺失 → INVALID_DOCX）；
 * - 文档级特性检测（有限属性读取）：
 *   - 页眉页脚：`word/header*.xml` / `word/footer*.xml` 部件存在性；
 *   - 嵌入对象/宏：`word/embeddings/*` 或 `word/vbaProject.bin`；
 *   - 保护：settings.xml 中的 `w:documentProtection`；
 *   - 修订：document.xml 中的 `w:ins` / `w:del`；
 * - 文字颜色补充读取：按 w:p（顶层，表格内除外）→ w:r 顺序提取 `w:color w:val`，
 *   与 Mammoth run 顺序对齐，供导入器合并（数量不一致时导入器保守放弃该段颜色）；
 * - 不读取网络外部关系、不执行文档内容；全部检查在内存中进行。
 */

import JSZip from 'jszip';
import {
  DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES,
  DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES,
  DOCX_MAX_ZIP_ENTRIES,
  docxDocumentError,
  type DocxDocumentError,
  type DocxImportDocumentFeature,
} from '../../shared/docx';

/** 单个顶层段落内按 run 顺序的 run 颜色（规范大写 `#RRGGBB`；无颜色为 null）。 */
export type DocxParagraphRunColors = readonly (string | null)[];

export interface DocxPackageInspection {
  /** 按文档顺序排列的顶层段落颜色序列（表格内段落不进入该序列）。 */
  readonly colorsByTopLevelParagraph: readonly DocxParagraphRunColors[];
  /** 文档级特性（页眉页脚/修订/保护/嵌入对象）。 */
  readonly documentFeatures: readonly DocxImportDocumentFeature[];
  /** document.xml 是否包含 w:body 元素；缺失时按空白文档处理（Mammoth 无法解析无 body 文档）。 */
  readonly hasBodyElement: boolean;
}

export type InspectDocxPackageResult =
  | { readonly status: 'ok'; readonly inspection: DocxPackageInspection }
  | { readonly status: 'error'; readonly error: DocxDocumentError };

/** 属性串中的 w:val 提取（规范 `#RRGGBB`，非法值返回 null）。 */
function colorValueFromAttrText(attrText: string): string | null {
  const match = /w:val\s*=\s*"([^"]*)"/.exec(attrText);
  if (match === null) {
    return null;
  }
  const raw = match[1]!;
  return /^[0-9A-Fa-f]{6}$/.test(raw) ? `#${raw.toUpperCase()}` : null;
}

/**
 * 极简 XML 元素扫描器：按顺序遍历 document.xml 的标签，
 * 收集顶层段落（不在 w:tbl 内）的 run 颜色序列，并检测 w:ins / w:del。
 * 只依赖"标签内属性值不含未转义 `>`"这一良构 XML 保证；扫描本身不做任何解析执行。
 */
export function scanDocumentXml(xml: string): {
  readonly colorsByTopLevelParagraph: readonly DocxParagraphRunColors[];
  readonly hasTrackedChanges: boolean;
  /** document.xml 是否包含 w:body 元素（Mammoth 要求存在；缺失按空白文档处理）。 */
  readonly hasBodyElement: boolean;
} {
  const colorsByTopLevelParagraph: DocxParagraphRunColors[] = [];
  // 属性串不消费尾部自闭合斜杠；属性值内的 "/" 只出现在引号中
  const tagPattern = /<(\/?)([A-Za-z0-9_:-]+)((?:[^"'/>]|"[^"]*"|'[^']*')*)(\/?)>/g;
  let insideTable = false;
  let currentParagraphColors: (string | null)[] | null = null;
  let currentRunColor: string | null = null;
  let inRunProperties = false;
  let hasTrackedChanges = false;
  let hasBodyElement = false;

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const closing = match[1] === '/';
    const name = match[2]!;
    const attrText = match[3] ?? '';
    const selfClosing = match[4] === '/';

    if (name === 'w:tbl') {
      insideTable = !closing && !selfClosing;
      continue;
    }
    if (name === 'w:ins' || name === 'w:del') {
      hasTrackedChanges = true;
      continue;
    }
    if (name === 'w:body') {
      hasBodyElement = true;
      continue;
    }
    if (name === 'w:p') {
      if (closing) {
        if (currentParagraphColors !== null) {
          colorsByTopLevelParagraph.push(currentParagraphColors);
        }
        currentParagraphColors = null;
      } else if (!insideTable && currentParagraphColors === null) {
        currentParagraphColors = [];
        if (selfClosing) {
          colorsByTopLevelParagraph.push(currentParagraphColors);
          currentParagraphColors = null;
        }
      }
      continue;
    }
    if (name === 'w:r') {
      if (closing) {
        if (currentRunColor !== null && currentParagraphColors !== null) {
          currentParagraphColors.push(currentRunColor);
        } else if (currentParagraphColors !== null && currentRunColor === null) {
          currentParagraphColors.push(null);
        }
        currentRunColor = null;
        inRunProperties = false;
      } else if (!insideTable && currentParagraphColors !== null) {
        currentRunColor = null;
        inRunProperties = false;
        if (selfClosing) {
          currentParagraphColors.push(null);
          currentRunColor = null;
        }
      }
      continue;
    }
    if (name === 'w:rPr') {
      inRunProperties = !closing && !selfClosing;
      continue;
    }
    if (name === 'w:color' && !closing && inRunProperties) {
      // `<w:color w:val="RRGGBB"/>` 是常规形态（自闭合也生效）
      currentRunColor = colorValueFromAttrText(attrText);
    }
  }
  // 文档以未闭合 w:p 结束的畸形输入：丢弃该段（保守）
  return { colorsByTopLevelParagraph, hasTrackedChanges, hasBodyElement };
}

/**
 * 检查 DOCX 不可信 ZIP 的结构与资源预算，并做有限补充读取。
 * 任何预算超限或关键部件缺失都返回稳定错误，不继续部分解析。
 */
export async function inspectDocxPackage(bytes: Uint8Array): Promise<InspectDocxPackageResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    return { status: 'error', error: docxDocumentError('INVALID_DOCX') };
  }

  const entries = Object.keys(zip.files);
  if (entries.length > DOCX_MAX_ZIP_ENTRIES) {
    return { status: 'error', error: docxDocumentError('RESOURCE_LIMIT_EXCEEDED') };
  }

  let totalUncompressed = 0;
  for (const name of entries) {
    const entry = zip.files[name]!;
    if (!entry.dir) {
      totalUncompressed += (entry as unknown as { _data: { uncompressedSize: number } })._data
        .uncompressedSize;
    }
  }
  if (totalUncompressed > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
    return { status: 'error', error: docxDocumentError('RESOURCE_LIMIT_EXCEEDED') };
  }

  const documentEntry = zip.files['word/document.xml'];
  if (zip.files['[Content_Types].xml'] === undefined || documentEntry === undefined) {
    return { status: 'error', error: docxDocumentError('INVALID_DOCX') };
  }
  const documentXmlBytes = (documentEntry as unknown as { _data: { uncompressedSize: number } })
    ._data.uncompressedSize;
  if (documentXmlBytes > DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES) {
    return { status: 'error', error: docxDocumentError('RESOURCE_LIMIT_EXCEEDED') };
  }

  let documentXml: string;
  try {
    documentXml = await documentEntry.async('string');
  } catch {
    return { status: 'error', error: docxDocumentError('INVALID_DOCX') };
  }

  // 文档级特性（有限检查）
  const features: DocxImportDocumentFeature[] = [];
  const hasHeaderFooter = entries.some(
    (name) => /^word\/header\d*\.xml$/.test(name) || /^word\/footer\d*\.xml$/.test(name),
  );
  if (hasHeaderFooter) {
    features.push('header-footer');
  }
  const hasEmbedded = entries.some(
    (name) => /^word\/embeddings\//.test(name) || name === 'word/vbaProject.bin',
  );
  if (hasEmbedded) {
    features.push('embedded-object');
  }
  const settingsEntry = zip.files['word/settings.xml'];
  if (settingsEntry !== undefined) {
    try {
      const settingsXml = await settingsEntry.async('string');
      if (settingsXml.includes('<w:documentProtection')) {
        features.push('encrypted-protected');
      }
    } catch {
      // settings.xml 损坏不阻断导入（不影响正文）
    }
  }

  const scan = scanDocumentXml(documentXml);
  if (scan.hasTrackedChanges) {
    features.push('revision');
  }

  return {
    status: 'ok',
    inspection: {
      colorsByTopLevelParagraph: scan.colorsByTopLevelParagraph,
      documentFeatures: features,
      hasBodyElement: scan.hasBodyElement,
    },
  };
}
