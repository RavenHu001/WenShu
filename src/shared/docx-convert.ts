/**
 * DOCX 纯转换 —— 导入源 → 模型、模型 ↔ Tiptap JSON、模型 → 导出描述。
 * 不依赖 Mammoth、Tiptap/ProseMirror 或 `docx` 库的运行时（只产生/消费普通对象），
 * 可在 node 环境确定性测试（TASK-007 WP1）。
 *
 * ## 转换规则（WP1 冻结）
 *
 * - 导入：样式名优先识别标题（`Heading N` / `标题 N` / styleId `HeadingN`，大小写不敏感），
 *   1-3 级为标题块，4-6 级降级为段落并给出 `heading-level-unsupported` 警告；
 *   未识别且非 Normal/正文的样式给出 `unknown-style` 警告；编号段落按 (ordered, level)
 *   用栈式算法聚合成嵌套列表（level 0..4，超出钳制）；空文本 run 丢弃，相邻相同
 *   marks 的 run 合并，超长 run 无损拆分；越界字号/颜色 mark 丢弃；
 *   表格/未识别块与 run 特性/文档特性映射为稳定警告；
 * - 模型 → Tiptap JSON：`both` 对齐映射为 `justify`；color/fontSize 合并进单个
 *   `textStyle` mark；列表条目序列分组为 `listItem`（段落/标题开新条目，嵌套列表
 *   追加到当前条目）；
 * - Tiptap JSON → 模型：只接受受支持节点/标记/属性，未知节点、标记或危险属性一律
 *   拒绝（"未清洗 HTML、未知节点和危险属性不能进入模型"）；`justify` 映射回 `both`；
 *   颜色归一化为大写 `#RRGGBB`、字号解析 `Npx` 字符串；列表 level 由嵌套深度推导；
 *   相邻相同 marks 的 run 合并、超长 run 无损拆分；结构通过后复用
 *   `validateDocxDocumentModel` 检查预算与规范形式；
 * - 模型 → 导出描述：嵌套列表拍平为带 (ordered, level) 的段落序列，供 `docx` 库
 *   重建基础产物（WP3）。
 */

import {
  DOCX_ALIGNMENTS,
  DOCX_COLOR_PATTERN,
  DOCX_MAX_FONT_SIZE_PT,
  DOCX_MAX_LIST_DEPTH,
  DOCX_MAX_LIST_LEVEL,
  DOCX_MAX_MODEL_BLOCKS,
  DOCX_MAX_MODEL_SERIALIZED_BYTES,
  DOCX_MAX_RUNS_PER_BLOCK,
  DOCX_MAX_RUN_TEXT_UTF16,
  DOCX_TEXT_MARK_TYPES,
  docxCompatibilityReport,
  docxCompatibilityWarning,
  validateDocxDocumentModel,
  type DocxAlignment,
  type DocxBlock,
  type DocxBulletListBlock,
  type DocxCompatibilityReport,
  type DocxCompatibilityWarning,
  type DocxCompatibilityWarningCode,
  type DocxDocumentModel,
  type DocxHeadingBlock,
  type DocxImportBlock,
  type DocxImportDocumentFeature,
  type DocxImportRun,
  type DocxImportRunFeature,
  type DocxImportSource,
  type DocxOrderedListBlock,
  type DocxParagraphBlock,
  type DocxTextMark,
  type DocxTextRun,
} from './docx';

/* ======================= 通用小工具 ======================= */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 相邻相同 marks 的 run 合并（无损）：相同 mark 集相邻时合并文本。 */
function mergeRuns(runs: readonly DocxTextRun[]): readonly DocxTextRun[] {
  const merged: DocxTextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && marksKey(last.marks) === marksKey(run.marks)) {
      merged[merged.length - 1] = { text: last.text + run.text, marks: last.marks };
    } else {
      merged.push(run);
    }
  }
  return merged;
}

function marksKey(marks: readonly DocxTextMark[]): string {
  return JSON.stringify(marks);
}

/** 超长 run 无损拆分：text 超过 `DOCX_MAX_RUN_TEXT_UTF16` 时按边界切分为多个 run。 */
function splitLongRuns(runs: readonly DocxTextRun[]): readonly DocxTextRun[] {
  const out: DocxTextRun[] = [];
  for (const run of runs) {
    if (run.text.length <= DOCX_MAX_RUN_TEXT_UTF16) {
      out.push(run);
      continue;
    }
    for (let from = 0; from < run.text.length; from += DOCX_MAX_RUN_TEXT_UTF16) {
      out.push({
        text: run.text.slice(from, from + DOCX_MAX_RUN_TEXT_UTF16),
        marks: run.marks,
      });
    }
  }
  return out;
}

/** 按规范顺序排序 marks（去重前调用方先保证无重复）；同一 type 的重复标记不会出现。 */
function canonicalizeMarks(marks: readonly DocxTextMark[]): readonly DocxTextMark[] {
  return [...marks].sort(
    (a, b) => DOCX_TEXT_MARK_TYPES.indexOf(a.type) - DOCX_TEXT_MARK_TYPES.indexOf(b.type),
  );
}

/* ======================= 导入源 → 模型（含兼容性报告） ======================= */

/** 导入转换结果：超限时返回稳定原因，不返回部分模型。 */
export type DocxImportResult =
  | {
      readonly status: 'ok';
      readonly model: DocxDocumentModel;
      readonly compatibility: DocxCompatibilityReport;
    }
  | { readonly status: 'limit-exceeded'; readonly reason: 'blocks' | 'runs' | 'depth' | 'size' };

const HEADING_STYLE_NAME_RE = /^Heading\s*([1-6])$/i;
const HEADING_CN_STYLE_NAME_RE = /^标题\s*([1-6])$/;
const HEADING_STYLE_ID_RE = /^Heading([1-6])$/i;

/** 从样式名/样式 ID 识别标题级别；识别失败返回 null。样式名优先。 */
function headingLevelOf(styleId: string | null, styleName: string | null): number | null {
  const name = styleName?.trim();
  if (name !== undefined && name.length > 0) {
    const match = HEADING_STYLE_NAME_RE.exec(name) ?? HEADING_CN_STYLE_NAME_RE.exec(name);
    if (match !== null) {
      return Number(match[1]);
    }
  }
  const id = styleId?.trim();
  if (id !== undefined && id.length > 0) {
    const match = HEADING_STYLE_ID_RE.exec(id);
    if (match !== null) {
      return Number(match[1]);
    }
  }
  return null;
}

/** 是否为已识别的基础段落样式（Normal/正文/两者都缺省）。 */
function isNormalStyle(styleId: string | null, styleName: string | null): boolean {
  const name = styleName?.trim().toLowerCase() ?? '';
  const id = styleId?.trim().toLowerCase() ?? '';
  return (
    (name.length === 0 && id.length === 0) ||
    name === 'normal' ||
    name === '正文' ||
    id === 'normal'
  );
}

/** run 特性 → 兼容性警告码。 */
function featureWarningCode(feature: DocxImportRunFeature): DocxCompatibilityWarningCode {
  switch (feature) {
    case 'image':
      return 'image';
    case 'hyperlink':
      return 'hyperlink';
    case 'comment-reference':
      return 'comment';
    case 'field':
      return 'field';
    case 'formula':
      return 'formula';
    case 'embedded-object':
      return 'embedded-object';
    default:
      return 'other-unrecognized';
  }
}

/** 文档级特性 → 兼容性警告码。 */
function documentFeatureWarningCode(
  feature: DocxImportDocumentFeature,
): DocxCompatibilityWarningCode {
  switch (feature) {
    case 'header-footer':
      return 'header-footer';
    case 'revision':
      return 'revision';
    case 'encrypted-protected':
      return 'encrypted-protected';
    default:
      return 'embedded-object';
  }
}

function importRuns(
  runs: readonly DocxImportRun[],
  warnings: Set<DocxCompatibilityWarningCode>,
): DocxTextRun[] {
  const imported: DocxTextRun[] = [];
  for (const sourceRun of runs) {
    for (const feature of sourceRun.features) {
      warnings.add(featureWarningCode(feature));
    }
    if (sourceRun.text.length === 0) {
      continue;
    }
    const marks: DocxTextMark[] = [];
    if (sourceRun.isBold) {
      marks.push({ type: 'bold' });
    }
    if (sourceRun.isItalic) {
      marks.push({ type: 'italic' });
    }
    if (sourceRun.isUnderline) {
      marks.push({ type: 'underline' });
    }
    const fontSize = sourceRun.fontSize;
    if (
      fontSize !== null &&
      typeof fontSize === 'number' &&
      Number.isFinite(fontSize) &&
      fontSize > 0 &&
      fontSize <= DOCX_MAX_FONT_SIZE_PT
    ) {
      marks.push({ type: 'font-size', value: fontSize });
    }
    const color = sourceRun.color;
    if (color !== null && DOCX_COLOR_PATTERN.test(color)) {
      marks.push({ type: 'color', value: color });
    }
    imported.push({ text: sourceRun.text, marks });
  }
  return [...splitLongRuns(mergeRuns(imported))];
}

function importParagraphBlock(
  entry: Extract<DocxImportBlock, { readonly type: 'paragraph' }>,
  warnings: Set<DocxCompatibilityWarningCode>,
): DocxParagraphBlock {
  const runs = importRuns(entry.runs, warnings);
  return { kind: 'paragraph', alignment: entry.alignment, runs };
}

/**
 * 从导入源块序列收集条目并聚合成模型块。
 * 命中预算上限时返回失败原因（此时整个导入应判 limit-exceeded）。
 */
function collectBlocks(
  blocks: readonly DocxImportBlock[],
  warnings: Set<DocxCompatibilityWarningCode>,
  budget: { blocks: number },
):
  | { readonly ok: true; readonly blocks: DocxBlock[] }
  | { readonly ok: false; readonly reason: 'blocks' | 'depth' } {
  const top: DocxBlock[] = [];
  // 栈元素：当前列表帧。frames 的 blocks 与 top 中的列表块共享引用以支持追加。
  interface ListFrame {
    readonly ordered: boolean;
    readonly level: number;
    readonly blocks: (
      DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock
    )[];
  }
  const stack: ListFrame[] = [];

  const pushBlock = (block: DocxBlock): boolean => {
    budget.blocks += 1;
    if (budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
      return false;
    }
    top.push(block);
    return true;
  };

  for (const sourceBlock of blocks) {
    if (sourceBlock.type !== 'paragraph') {
      stack.length = 0;
      warnings.add(sourceBlock.type === 'table' ? 'table' : 'other-unrecognized');
      continue;
    }
    const entry = sourceBlock;
    if (entry.numbering !== null) {
      const ordered = entry.numbering.ordered;
      const level = Math.min(Math.max(Math.trunc(entry.numbering.level), 0), DOCX_MAX_LIST_LEVEL);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.level > level || (frame.level === level && frame.ordered !== ordered)) {
          stack.pop();
        } else {
          break;
        }
      }
      const paragraph = importParagraphBlock(entry, warnings);
      const listBlocks: (
        DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock
      )[] = [paragraph];
      let list: DocxBulletListBlock | DocxOrderedListBlock;
      if (stack.length === 0) {
        list = ordered
          ? { kind: 'ordered-list', level, blocks: listBlocks }
          : { kind: 'bullet-list', level, blocks: listBlocks };
        if (!pushBlock(list)) {
          return { ok: false, reason: 'blocks' };
        }
      } else if (stack[stack.length - 1]!.level < level) {
        const parent = stack[stack.length - 1]!;
        if (stack.length + 1 > DOCX_MAX_LIST_DEPTH) {
          return { ok: false, reason: 'depth' };
        }
        list = ordered
          ? { kind: 'ordered-list', level, blocks: listBlocks }
          : { kind: 'bullet-list', level, blocks: listBlocks };
        parent.blocks.push(list);
        budget.blocks += 1;
        if (budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
          return { ok: false, reason: 'blocks' };
        }
      } else {
        const frame = stack[stack.length - 1]!;
        frame.blocks.push(paragraph);
        continue;
      }
      stack.push({ ordered, level, blocks: listBlocks });
    } else {
      stack.length = 0;
      const level = headingLevelOf(entry.styleId, entry.styleName);
      if (level !== null && level <= 3) {
        const runs = importRuns(entry.runs, warnings);
        const heading: DocxHeadingBlock = { kind: 'heading', level: level as 1 | 2 | 3, runs };
        if (!pushBlock(heading)) {
          return { ok: false, reason: 'blocks' };
        }
      } else {
        if (level !== null) {
          warnings.add('heading-level-unsupported');
        } else if (!isNormalStyle(entry.styleId, entry.styleName)) {
          warnings.add('unknown-style');
        }
        const paragraph = importParagraphBlock(entry, warnings);
        if (!pushBlock(paragraph)) {
          return { ok: false, reason: 'blocks' };
        }
      }
    }
  }
  return { ok: true, blocks: top };
}

/**
 * 把导入源转换为结构化模型与兼容性报告。
 * 结构保证合法（样式/对齐/编号归一化、超限返回 limit-exceeded）；
 * 预算上限：块总数、单块 run 数、列表深度、序列化大小。
 */
export function importSourceToDocxModel(source: DocxImportSource): DocxImportResult {
  const warnings: Set<DocxCompatibilityWarningCode> = new Set();
  for (const feature of source.documentFeatures) {
    warnings.add(documentFeatureWarningCode(feature));
  }
  const budget = { blocks: 0 };
  const collected = collectBlocks(source.blocks, warnings, budget);
  if (!collected.ok) {
    return { status: 'limit-exceeded', reason: collected.reason };
  }
  const model: DocxDocumentModel = { schemaVersion: 1, blocks: collected.blocks };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(model)).byteLength;
  if (serializedBytes > DOCX_MAX_MODEL_SERIALIZED_BYTES) {
    return { status: 'limit-exceeded', reason: 'size' };
  }
  const violations = validateDocxDocumentModel(model);
  if (violations.length > 0) {
    // 结构由本转换保证合法；任何剩余违反都来自预算（深度/run 数等）
    return {
      status: 'limit-exceeded',
      reason: violations.some((v) => v.includes('列表嵌套深度'))
        ? 'depth'
        : violations.some((v) => v.includes('run 数'))
          ? 'runs'
          : 'blocks',
    };
  }
  const warningList: DocxCompatibilityWarning[] = [];
  for (const code of warnings) {
    warningList.push(docxCompatibilityWarning(code));
  }
  return { status: 'ok', model, compatibility: docxCompatibilityReport([warningList]) };
}

/* ======================= 模型 → Tiptap JSON ======================= */

export interface DocxTiptapJsonMark {
  readonly type: 'bold' | 'italic' | 'underline' | 'textStyle';
  readonly attrs?: { readonly color?: string | null; readonly fontSize?: string | null };
}

export type DocxTiptapJsonNode =
  | { readonly type: 'doc'; readonly content?: readonly DocxTiptapJsonNode[] }
  | {
      readonly type: 'paragraph';
      readonly attrs?: { readonly textAlign?: string | null };
      readonly content?: readonly DocxTiptapJsonNode[];
    }
  | {
      readonly type: 'heading';
      readonly attrs: { readonly level: number };
      readonly content?: readonly DocxTiptapJsonNode[];
    }
  | {
      readonly type: 'bulletList' | 'orderedList';
      readonly content?: readonly DocxTiptapJsonNode[];
    }
  | { readonly type: 'listItem'; readonly content?: readonly DocxTiptapJsonNode[] }
  | {
      readonly type: 'text';
      readonly text: string;
      readonly marks?: readonly DocxTiptapJsonMark[];
    };

export interface DocxTiptapDocJson {
  readonly type: 'doc';
  readonly content?: readonly DocxTiptapJsonNode[];
}

function alignmentToTiptap(alignment: DocxAlignment | null): string | undefined {
  if (alignment === null) {
    return undefined;
  }
  return alignment === 'both' ? 'justify' : alignment;
}

function runToTiptapText(run: DocxTextRun): DocxTiptapJsonNode {
  let color: string | undefined;
  let fontSize: string | undefined;
  const marks: DocxTiptapJsonMark[] = [];
  for (const mark of run.marks) {
    if (mark.type === 'bold') {
      marks.push({ type: 'bold' });
    } else if (mark.type === 'italic') {
      marks.push({ type: 'italic' });
    } else if (mark.type === 'underline') {
      marks.push({ type: 'underline' });
    } else if (mark.type === 'font-size') {
      fontSize = `${mark.value}px`;
    } else {
      color = mark.value;
    }
  }
  if (color !== undefined || fontSize !== undefined) {
    marks.push({
      type: 'textStyle',
      ...(color !== undefined || fontSize !== undefined
        ? {
            attrs: {
              ...(color !== undefined ? { color } : {}),
              ...(fontSize !== undefined ? { fontSize } : {}),
            },
          }
        : {}),
    });
  }
  return {
    type: 'text',
    text: run.text,
    ...(marks.length > 0 ? { marks } : {}),
  };
}

function blockToTiptap(block: DocxBlock): DocxTiptapJsonNode {
  if (block.kind === 'paragraph') {
    const textAlign = alignmentToTiptap(block.alignment);
    const content = block.runs.map(runToTiptapText);
    return {
      type: 'paragraph',
      ...(textAlign === undefined ? {} : { attrs: { textAlign } }),
      ...(content.length > 0 ? { content } : {}),
    };
  }
  if (block.kind === 'heading') {
    const content = block.runs.map(runToTiptapText);
    return {
      type: 'heading',
      attrs: { level: block.level },
      ...(content.length > 0 ? { content } : {}),
    };
  }
  return listToTiptap(block);
}

function listToTiptap(block: DocxBulletListBlock | DocxOrderedListBlock): DocxTiptapJsonNode {
  const type = block.kind === 'bullet-list' ? 'bulletList' : 'orderedList';
  const items: DocxTiptapJsonNode[] = [];
  let current: { content: DocxTiptapJsonNode[] } | null = null;
  for (const child of block.blocks) {
    if (child.kind === 'paragraph' || child.kind === 'heading') {
      current = { content: [blockToTiptap(child)] };
      items.push({ type: 'listItem', content: current.content });
    } else if (current !== null) {
      current.content.push(blockToTiptap(child));
    }
  }
  return { type, content: items };
}

/**
 * 把模型转换为 Tiptap/ProseMirror JSON（普通对象，无库依赖）。
 * 输入必须是合法模型（`validateDocxDocumentModel` 通过）；输出节点全部在受支持 schema 内。
 */
export function docxModelToTiptapJson(model: DocxDocumentModel): DocxTiptapDocJson {
  return {
    type: 'doc',
    content: model.blocks.map(blockToTiptap),
  };
}

/* ======================= Tiptap JSON → 模型 ======================= */

export type DocxTiptapToModelResult =
  | { readonly status: 'ok'; readonly model: DocxDocumentModel }
  | { readonly status: 'invalid'; readonly violations: readonly string[] };

interface ParseContext {
  readonly violations: string[];
  readonly budget: { blocks: number };
}

function fail(context: ParseContext, message: string): void {
  context.violations.push(message);
}

function parseTextNode(node: unknown, context: ParseContext): DocxTextRun | null {
  if (!isPlainObject(node) || node.type !== 'text') {
    fail(context, 'text 节点必须是普通对象且 type 为 text');
    return null;
  }
  const text = node.text;
  if (typeof text !== 'string') {
    fail(context, 'text 节点缺少文本');
    return null;
  }
  if (node.marks !== undefined && !Array.isArray(node.marks)) {
    fail(context, 'text 节点 marks 必须是数组');
    return null;
  }
  const marks: DocxTextMark[] = [];
  const seen = new Set<string>();
  let color: string | null = null;
  let fontSize: number | null = null;
  for (const mark of node.marks ?? []) {
    if (!isPlainObject(mark)) {
      fail(context, 'mark 必须是普通对象');
      return null;
    }
    const type = mark.type;
    if (type === 'bold' || type === 'italic' || type === 'underline') {
      if (seen.has(type)) {
        fail(context, `mark ${type} 重复`);
        return null;
      }
      seen.add(type);
      marks.push({ type });
    } else if (type === 'textStyle') {
      if (seen.has('textStyle')) {
        fail(context, 'textStyle mark 重复');
        return null;
      }
      seen.add('textStyle');
      const attrs = mark.attrs;
      if (attrs !== undefined) {
        if (!isPlainObject(attrs)) {
          fail(context, 'textStyle attrs 必须是普通对象');
          return null;
        }
        for (const key of Object.keys(attrs)) {
          if (key !== 'color' && key !== 'fontSize') {
            fail(context, `textStyle 不允许属性 ${key}`);
            return null;
          }
        }
        const rawColor = attrs.color;
        if (rawColor !== undefined && rawColor !== null) {
          if (typeof rawColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(rawColor)) {
            fail(context, `颜色必须是 #RRGGBB：${String(rawColor)}`);
            return null;
          }
          color = rawColor.toUpperCase();
        }
        const rawFontSize = attrs.fontSize;
        if (rawFontSize !== undefined && rawFontSize !== null) {
          if (typeof rawFontSize !== 'string') {
            fail(context, 'fontSize 必须是 "Npx" 字符串');
            return null;
          }
          const match = /^(\d+(?:\.\d+)?)px$/.exec(rawFontSize);
          if (match === null) {
            fail(context, `fontSize 格式非法：${rawFontSize}`);
            return null;
          }
          const value = Number(match[1]);
          if (!Number.isFinite(value) || value <= 0 || value > DOCX_MAX_FONT_SIZE_PT) {
            fail(context, `fontSize 越界：${rawFontSize}`);
            return null;
          }
          fontSize = value;
        }
      }
    } else {
      fail(context, `未知 mark 类型 ${String(type)}`);
      return null;
    }
  }
  if (color !== null) {
    marks.push({ type: 'color', value: color });
  }
  if (fontSize !== null) {
    marks.push({ type: 'font-size', value: fontSize });
  }
  return { text, marks: canonicalizeMarks(marks) };
}

function parseInlineContent(
  content: unknown,
  context: ParseContext,
): readonly DocxTextRun[] | null {
  if (content === undefined) {
    return [];
  }
  if (!Array.isArray(content)) {
    fail(context, '段落内容必须是数组');
    return null;
  }
  const runs: DocxTextRun[] = [];
  for (const node of content) {
    if (!isPlainObject(node) || node.type !== 'text') {
      fail(context, '段落内只允许 text 节点');
      return null;
    }
    const run = parseTextNode(node, context);
    if (run === null) {
      return null;
    }
    if (run.text.length > 0) {
      runs.push(run);
    }
  }
  return splitLongRuns(mergeRuns(runs));
}

function parseParagraphAttrs(
  node: Record<string, unknown>,
  context: ParseContext,
): DocxAlignment | null {
  if (node.attrs === undefined) {
    return null;
  }
  if (!isPlainObject(node.attrs)) {
    fail(context, 'paragraph attrs 必须是普通对象');
    return null;
  }
  for (const key of Object.keys(node.attrs)) {
    if (key !== 'textAlign') {
      fail(context, `paragraph 不允许属性 ${key}`);
      return null;
    }
  }
  const textAlign = node.attrs.textAlign;
  if (textAlign === undefined || textAlign === null) {
    return null;
  }
  if (textAlign === 'justify') {
    return 'both';
  }
  if ((DOCX_ALIGNMENTS as readonly string[]).includes(String(textAlign))) {
    return textAlign as DocxAlignment;
  }
  fail(context, `未知 textAlign ${String(textAlign)}`);
  return null;
}

function parseBlockNode(node: unknown, depth: number, context: ParseContext): DocxBlock | null {
  if (!isPlainObject(node)) {
    fail(context, '块必须是普通对象');
    return null;
  }
  const type = node.type;
  if (type === 'paragraph') {
    const violationsBefore = context.violations.length;
    const alignment = parseParagraphAttrs(node, context);
    if (context.violations.length > violationsBefore) {
      return null;
    }
    const runs = parseInlineContent(node.content, context);
    if (runs === null) {
      return null;
    }
    context.budget.blocks += 1;
    if (context.budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
      fail(context, `模型块数超过上限（${DOCX_MAX_MODEL_BLOCKS}）`);
      return null;
    }
    if (runs.length > DOCX_MAX_RUNS_PER_BLOCK) {
      fail(context, `块内 run 数超过上限（${DOCX_MAX_RUNS_PER_BLOCK}）`);
      return null;
    }
    return { kind: 'paragraph', alignment, runs };
  }
  if (type === 'heading') {
    if (!isPlainObject(node.attrs)) {
      fail(context, 'heading 缺少 attrs');
      return null;
    }
    for (const key of Object.keys(node.attrs)) {
      if (key !== 'level') {
        fail(context, `heading 不允许属性 ${key}`);
        return null;
      }
    }
    const level = node.attrs.level;
    if (level !== 1 && level !== 2 && level !== 3) {
      fail(context, `不支持的标题级别 ${String(level)}`);
      return null;
    }
    const runs = parseInlineContent(node.content, context);
    if (runs === null) {
      return null;
    }
    context.budget.blocks += 1;
    if (context.budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
      fail(context, `模型块数超过上限（${DOCX_MAX_MODEL_BLOCKS}）`);
      return null;
    }
    if (runs.length > DOCX_MAX_RUNS_PER_BLOCK) {
      fail(context, `块内 run 数超过上限（${DOCX_MAX_RUNS_PER_BLOCK}）`);
      return null;
    }
    return { kind: 'heading', level, runs };
  }
  if (type === 'bulletList' || type === 'orderedList') {
    return parseListNode(node, type, depth, context);
  }
  if (type === 'listItem') {
    fail(context, 'listItem 只能出现在列表内部');
    return null;
  }
  fail(context, `未知节点类型 ${String(type)}`);
  return null;
}

function parseListNode(
  node: Record<string, unknown>,
  type: 'bulletList' | 'orderedList',
  depth: number,
  context: ParseContext,
): DocxBlock | null {
  if (depth > DOCX_MAX_LIST_DEPTH) {
    fail(context, '列表嵌套深度超过上限');
    return null;
  }
  if (node.attrs !== undefined) {
    fail(context, `${type} 不允许 attrs`);
    return null;
  }
  if (!Array.isArray(node.content)) {
    fail(context, `${type} 缺少 content 数组`);
    return null;
  }
  const listBlocks: (
    DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock
  )[] = [];
  for (const item of node.content) {
    if (!isPlainObject(item) || item.type !== 'listItem') {
      fail(context, `${type} 内容只允许 listItem 节点`);
      return null;
    }
    if (item.attrs !== undefined) {
      fail(context, 'listItem 不允许 attrs');
      return null;
    }
    if (!Array.isArray(item.content)) {
      fail(context, 'listItem 缺少 content 数组');
      return null;
    }
    for (const inner of item.content) {
      const innerBlock = parseBlockNode(inner, depth + 1, context);
      if (innerBlock === null) {
        return null;
      }
      if (innerBlock.kind === 'bullet-list' || innerBlock.kind === 'ordered-list') {
        if (listBlocks.length === 0) {
          fail(context, 'listItem 必须以段落或标题开头');
          return null;
        }
      }
      listBlocks.push(innerBlock);
    }
  }
  if (listBlocks.length === 0) {
    fail(context, `${type} 必须至少包含一个条目`);
    return null;
  }
  context.budget.blocks += 1;
  if (context.budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
    fail(context, `模型块数超过上限（${DOCX_MAX_MODEL_BLOCKS}）`);
    return null;
  }
  const level = depth - 1;
  return type === 'bulletList'
    ? { kind: 'bullet-list', level, blocks: listBlocks }
    : { kind: 'ordered-list', level, blocks: listBlocks };
}

/**
 * 把 Tiptap/ProseMirror JSON 转换为模型。
 * 只接受受支持节点/标记/属性；未知节点、标记、危险属性、越界值与预算超限一律返回
 * `invalid` 与稳定违反描述。列表 level 由嵌套深度推导（0 起始）。
 */
export function tiptapJsonToDocxModel(json: unknown): DocxTiptapToModelResult {
  const context: ParseContext = { violations: [], budget: { blocks: 0 } };
  if (!isPlainObject(json) || json.type !== 'doc') {
    return { status: 'invalid', violations: ['根节点必须是 type 为 doc 的对象'] };
  }
  if (json.attrs !== undefined) {
    return { status: 'invalid', violations: ['doc 不允许 attrs'] };
  }
  if (!Array.isArray(json.content)) {
    return { status: 'invalid', violations: ['doc 缺少 content 数组'] };
  }
  const blocks: DocxBlock[] = [];
  for (const node of json.content) {
    const block = parseBlockNode(node, 1, context);
    if (block === null) {
      break;
    }
    blocks.push(block);
  }
  if (context.violations.length > 0) {
    return { status: 'invalid', violations: context.violations };
  }
  const model: DocxDocumentModel = { schemaVersion: 1, blocks };
  const violations = validateDocxDocumentModel(model);
  if (violations.length > 0) {
    return { status: 'invalid', violations };
  }
  return { status: 'ok', model };
}

/* ======================= 模型 → 导出描述 ======================= */

/** 导出用段落描述：扁平段落序列 + 列表上下文（供 `docx` 库重建）。 */
export interface DocxExportParagraph {
  readonly kind: 'paragraph' | 'heading';
  readonly headingLevel: 1 | 2 | 3 | null;
  readonly alignment: DocxAlignment | null;
  readonly list: { readonly ordered: boolean; readonly level: number } | null;
  readonly runs: readonly DocxTextRun[];
}

export interface DocxExportDescription {
  readonly paragraphs: readonly DocxExportParagraph[];
}

/** 把模型拍平为导出描述：嵌套列表按条目拍平并携带 (ordered, level)。 */
export function docxModelToExportDescription(model: DocxDocumentModel): DocxExportDescription {
  const paragraphs: DocxExportParagraph[] = [];
  const flatten = (
    blocks: readonly DocxBlock[],
    list: { readonly ordered: boolean; readonly level: number } | null,
  ): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        paragraphs.push({
          kind: 'paragraph',
          headingLevel: null,
          alignment: block.alignment,
          list,
          runs: block.runs,
        });
      } else if (block.kind === 'heading') {
        paragraphs.push({
          kind: 'heading',
          headingLevel: block.level,
          alignment: null,
          list,
          runs: block.runs,
        });
      } else if (block.kind === 'bullet-list') {
        flatten(block.blocks, { ordered: false, level: block.level });
      } else {
        flatten(block.blocks, { ordered: true, level: block.level });
      }
    }
  };
  flatten(model.blocks, null);
  return { paragraphs };
}
