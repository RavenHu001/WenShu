/**
 * DOCX 共享契约 —— 结构化中间模型、固定预算、运行时校验、兼容性报告、读写请求/结果与稳定错误。
 * 纯 TypeScript 类型、常量与函数，不依赖 Electron、Node.js、Mammoth、JSZip、Tiptap/ProseMirror
 * 或 `docx` 库（TASK-007 第 4.3 / 4.5 节与 WP0 冻结记录）。
 *
 * ## 设计约束
 *
 * 1. 所有接口字段均为 `readonly`，保证跨进程通过 Electron structured clone 安全传递；
 * 2. 不包含 `Error`、`Buffer`、`Uint8Array`、文件句柄、函数、类实例、原型对象、循环引用
 *    或可执行内容；运行时校验强制普通对象形状；
 * 3. 模型有版本（`DOCX_MODEL_SCHEMA_VERSION`）：未知 schemaVersion 必须拒绝，不猜测迁移；
 * 4. 文本、节点数、列表深度、marks 数量和序列化大小有固定上限（第 4.5 节，WP0 冻结数值）；
 * 5. 兼容性警告码稳定可测试，不使用笼统的"可能不兼容"文案（第 4.2 节）；
 * 6. 读写请求不接受工作区根、绝对路径、临时/备份路径或替换策略字段；
 * 7. 错误消息不含正文、绝对路径、XML、Buffer、文件句柄或调用栈。
 */

/* ======================= 结构化中间模型（第 4.3 节） ======================= */

/** 模型 schema 版本：未知版本必须拒绝，不猜测迁移。 */
export const DOCX_MODEL_SCHEMA_VERSION = 1 as const;

/** 段落对齐（对齐模型值；与 OOXML w:jc 的 just 语义对应，Tiptap 侧为 justify）。 */
export const DOCX_ALIGNMENTS = ['left', 'center', 'right', 'both'] as const;
export type DocxAlignment = (typeof DOCX_ALIGNMENTS)[number];

/** marks 类型集合与规范顺序：转换与校验都按该顺序输出/检查（确定性）。 */
export const DOCX_TEXT_MARK_TYPES = ['bold', 'italic', 'underline', 'font-size', 'color'] as const;
export type DocxTextMarkType = (typeof DOCX_TEXT_MARK_TYPES)[number];

/** 单个文本标记。颜色为规范大写 `#RRGGBB`；字号为磅值（点数）。 */
export type DocxTextMark =
  | { readonly type: 'bold' }
  | { readonly type: 'italic' }
  | { readonly type: 'underline' }
  | { readonly type: 'font-size'; readonly value: number }
  | { readonly type: 'color'; readonly value: string };

/** 单个文本 run：正文 + 标记列表（每类至多一个，按规范顺序排列）。 */
export interface DocxTextRun {
  readonly text: string;
  readonly marks: readonly DocxTextMark[];
}

/** 普通段落块。 */
export interface DocxParagraphBlock {
  readonly kind: 'paragraph';
  readonly alignment: DocxAlignment | null;
  readonly runs: readonly DocxTextRun[];
}

/** 标题块（仅支持 1-3 级）。 */
export interface DocxHeadingBlock {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3;
  readonly runs: readonly DocxTextRun[];
}

/**
 * 列表块的条目序列：`blocks` 中的段落/标题是条目，嵌套列表块跟在它所属的条目之后。
 * 结构为嵌套树（列表深度 ≤ `DOCX_MAX_LIST_DEPTH`），`level` 保留导入来源的层级
 * （0..`DOCX_MAX_LIST_LEVEL`），导出时直接映射 numPr ilvl。
 */
export interface DocxBulletListBlock {
  readonly kind: 'bullet-list';
  readonly level: number;
  readonly blocks: readonly DocxBlock[];
}

/** 编号列表块（结构同项目符号列表）。 */
export interface DocxOrderedListBlock {
  readonly kind: 'ordered-list';
  readonly level: number;
  readonly blocks: readonly DocxBlock[];
}

export type DocxBlock =
  DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock;

export const DOCX_BLOCK_KINDS = ['paragraph', 'heading', 'bullet-list', 'ordered-list'] as const;
export type DocxBlockKind = (typeof DOCX_BLOCK_KINDS)[number];

/** 有版本、有上限的 DOCX 结构化中间模型。 */
export interface DocxDocumentModel {
  readonly schemaVersion: 1;
  readonly blocks: readonly DocxBlock[];
}

/* ======================= 固定资源上限（第 4.5 节，WP0 冻结数值） ======================= */

/** 普通 DOCX 文件压缩后最大字节数（20 MiB）。 */
export const DOCX_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** ZIP 条目数上限。 */
export const DOCX_MAX_ZIP_ENTRIES = 128;
/** 单个关键 XML（document.xml 等）解压大小上限。 */
export const DOCX_MAX_KEY_XML_UNCOMPRESSED_BYTES = 1024 * 1024;
/** ZIP 总解压大小上限。 */
export const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
/** 模型块总数上限（含嵌套列表条目块）。 */
export const DOCX_MAX_MODEL_BLOCKS = 20_000;
/** 单个块 run 数上限。 */
export const DOCX_MAX_RUNS_PER_BLOCK = 512;
/** 单个 run 文本最大 UTF-16 code unit 数；超出在导入时无损拆分。 */
export const DOCX_MAX_RUN_TEXT_UTF16 = 4096;
/** 列表最大嵌套深度。 */
export const DOCX_MAX_LIST_DEPTH = 5;
/** 列表最大层级（0 起始，与 Mammoth 支持上限一致）。 */
export const DOCX_MAX_LIST_LEVEL = 4;
/** 单个 run 最大 marks 数。 */
export const DOCX_MAX_MARKS_PER_RUN = 8;
/** 模型 JSON 序列化（UTF-8 字节）上限。 */
export const DOCX_MAX_MODEL_SERIALIZED_BYTES = 8 * 1024 * 1024;
/** 字号最大磅值（OOXML w:sz 最大 32767 半磅 = 1638.35 pt，取整 1638）。 */
export const DOCX_MAX_FONT_SIZE_PT = 1638;

/** 规范颜色：大写 `#RRGGBB`。 */
export const DOCX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

/* ======================= 模型运行时校验 ======================= */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownKeysOf(record: Record<string, unknown>): readonly string[] {
  return Object.keys(record);
}

/** 校验 block 内部结构，返回违反描述；同时累计预算计数（总数/深度）。 */
function validateBlock(
  value: unknown,
  depth: number,
  budget: { blocks: number },
  violations: string[],
): void {
  budget.blocks += 1;
  if (budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
    return;
  }
  if (!isPlainObject(value)) {
    violations.push('块必须是普通对象');
    return;
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !(DOCX_BLOCK_KINDS as readonly string[]).includes(kind)) {
    violations.push(`未知块类型 ${String(kind)}`);
    return;
  }
  if (kind === 'paragraph') {
    validateParagraphBlock(value, violations);
  } else if (kind === 'heading') {
    validateHeadingBlock(value, violations);
  } else {
    validateListBlock(value, depth, budget, violations);
  }
}

function validateParagraphBlock(value: Record<string, unknown>, violations: string[]): void {
  const alignment = value.alignment;
  if (alignment !== null && !(DOCX_ALIGNMENTS as readonly string[]).includes(String(alignment))) {
    violations.push(`未知段落对齐 ${String(alignment)}`);
  }
  validateRuns(value.runs, violations);
}

function validateHeadingBlock(value: Record<string, unknown>, violations: string[]): void {
  const level = value.level;
  if (level !== 1 && level !== 2 && level !== 3) {
    violations.push(`不支持的标题级别 ${String(level)}`);
  }
  validateRuns(value.runs, violations);
}

function validateListBlock(
  value: Record<string, unknown>,
  depth: number,
  budget: { blocks: number },
  violations: string[],
): void {
  const level = value.level;
  if (
    typeof level !== 'number' ||
    !Number.isInteger(level) ||
    level < 0 ||
    level > DOCX_MAX_LIST_LEVEL
  ) {
    violations.push(`列表层级越界 ${String(level)}`);
  }
  if (depth > DOCX_MAX_LIST_DEPTH) {
    violations.push('列表嵌套深度超过上限');
    return;
  }
  if (!Array.isArray(value.blocks)) {
    violations.push('列表块缺少 blocks 数组');
    return;
  }
  if (value.blocks.length === 0) {
    violations.push('列表块必须至少包含一个条目');
    return;
  }
  const first = value.blocks[0];
  if (isPlainObject(first) && (first.kind === 'bullet-list' || first.kind === 'ordered-list')) {
    violations.push('列表块的第一个条目必须是段落或标题');
  }
  for (const block of value.blocks) {
    validateBlock(block, depth + 1, budget, violations);
  }
}

function validateRuns(value: unknown, violations: string[]): void {
  if (!Array.isArray(value)) {
    violations.push('块缺少 runs 数组');
    return;
  }
  if (value.length > DOCX_MAX_RUNS_PER_BLOCK) {
    violations.push(`块内 run 数超过上限（${DOCX_MAX_RUNS_PER_BLOCK}）`);
    return;
  }
  for (const run of value) {
    validateRun(run, violations);
  }
}

function validateRun(value: unknown, violations: string[]): void {
  if (!isPlainObject(value)) {
    violations.push('run 必须是普通对象');
    return;
  }
  const text = value.text;
  if (typeof text !== 'string') {
    violations.push('run 缺少文本');
    return;
  }
  if (text.length > DOCX_MAX_RUN_TEXT_UTF16) {
    violations.push(`run 文本超过上限（${DOCX_MAX_RUN_TEXT_UTF16} UTF-16 单元）`);
    return;
  }
  const marks = value.marks;
  if (!Array.isArray(marks)) {
    violations.push('run 缺少 marks 数组');
    return;
  }
  if (marks.length > DOCX_MAX_MARKS_PER_RUN) {
    violations.push(`run marks 数超过上限（${DOCX_MAX_MARKS_PER_RUN}）`);
    return;
  }
  let lastTypeIndex = -1;
  for (const mark of marks) {
    const typeIndex = validateMark(mark, violations);
    if (typeIndex === null) {
      return;
    }
    if (typeIndex <= lastTypeIndex) {
      violations.push('marks 必须按规范顺序且不重复');
      return;
    }
    lastTypeIndex = typeIndex;
  }
}

/** 校验单个 mark；返回其在规范顺序中的下标，非法返回 null。 */
function validateMark(value: unknown, violations: string[]): number | null {
  if (!isPlainObject(value)) {
    violations.push('mark 必须是普通对象');
    return null;
  }
  const type = value.type;
  const typeIndex = (DOCX_TEXT_MARK_TYPES as readonly string[]).indexOf(String(type));
  if (typeIndex === -1) {
    violations.push(`未知 mark 类型 ${String(type)}`);
    return null;
  }
  if (type === 'bold' || type === 'italic' || type === 'underline') {
    if (ownKeysOf(value).length !== 1) {
      violations.push(`${type} mark 不允许额外字段`);
      return null;
    }
    return typeIndex;
  }
  if (type === 'font-size') {
    if (ownKeysOf(value).length !== 2) {
      violations.push('font-size mark 不允许额外字段');
      return null;
    }
    const size = value.value;
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > DOCX_MAX_FONT_SIZE_PT
    ) {
      violations.push(`字号越界 ${String(size)}`);
      return null;
    }
    return typeIndex;
  }
  // color
  if (ownKeysOf(value).length !== 2) {
    violations.push('color mark 不允许额外字段');
    return null;
  }
  const color = value.value;
  if (typeof color !== 'string' || !DOCX_COLOR_PATTERN.test(color)) {
    violations.push(`颜色必须是规范 #RRGGBB：${String(color)}`);
    return null;
  }
  return typeIndex;
}

/**
 * 校验模型结构、预算与规范化要求。
 * 返回违反描述列表；空数组表示合法。未知 schemaVersion 直接拒绝（不猜测迁移）。
 */
export function validateDocxDocumentModel(value: unknown): readonly string[] {
  const violations: string[] = [];
  if (!isPlainObject(value)) {
    return ['模型必须是普通对象'];
  }
  if (value.schemaVersion !== DOCX_MODEL_SCHEMA_VERSION) {
    return [`未知 schemaVersion ${String(value.schemaVersion)}，不能猜测迁移`];
  }
  if (!Array.isArray(value.blocks)) {
    return ['模型缺少 blocks 数组'];
  }
  if (value.blocks.length > DOCX_MAX_MODEL_BLOCKS) {
    return [`模型块数超过上限（${DOCX_MAX_MODEL_BLOCKS}）`];
  }
  const budget = { blocks: 0 };
  for (const block of value.blocks) {
    validateBlock(block, 1, budget, violations);
  }
  if (budget.blocks > DOCX_MAX_MODEL_BLOCKS) {
    violations.push(`模型块数超过上限（${DOCX_MAX_MODEL_BLOCKS}）`);
  }
  if (violations.length === 0) {
    try {
      const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (serializedBytes > DOCX_MAX_MODEL_SERIALIZED_BYTES) {
        violations.push(`模型序列化大小超过上限（${DOCX_MAX_MODEL_SERIALIZED_BYTES} 字节）`);
      }
    } catch {
      violations.push('模型不可序列化（存在循环引用）');
    }
  }
  return violations;
}

/** 便捷判定：模型是否合法（结构与预算全部通过）。 */
export function isValidDocxDocumentModel(value: unknown): value is DocxDocumentModel {
  return validateDocxDocumentModel(value).length === 0;
}

/* ======================= 兼容性报告（第 4.2 节） ======================= */

export const DOCX_COMPATIBILITY_LEVELS = ['supported', 'degraded', 'read-only'] as const;
export type DocxCompatibilityLevel = (typeof DOCX_COMPATIBILITY_LEVELS)[number];

/** 稳定兼容性警告码：不使用笼统"可能不兼容"，每个码可测试。 */
export type DocxCompatibilityWarningCode =
  | 'image'
  | 'table'
  | 'header-footer'
  | 'comment'
  | 'revision'
  | 'field'
  | 'formula'
  | 'embedded-object'
  | 'hyperlink'
  | 'unknown-style'
  | 'heading-level-unsupported'
  | 'encrypted-protected'
  | 'other-unrecognized';

/** 警告码规范顺序：报告按该顺序输出（确定性）。 */
export const DOCX_COMPATIBILITY_WARNING_ORDER: readonly DocxCompatibilityWarningCode[] = [
  'image',
  'table',
  'header-footer',
  'comment',
  'revision',
  'field',
  'formula',
  'embedded-object',
  'hyperlink',
  'unknown-style',
  'heading-level-unsupported',
  'encrypted-protected',
  'other-unrecognized',
];

/** 稳定警告文案（不含正文、路径或内部信息）。 */
export const DOCX_COMPATIBILITY_WARNING_MESSAGES: Readonly<
  Record<DocxCompatibilityWarningCode, string>
> = {
  image: '文档包含图片，保存后可能丢失',
  table: '文档包含表格，保存后可能丢失',
  'header-footer': '文档包含页眉页脚，保存后可能丢失',
  comment: '文档包含批注，保存后可能丢失',
  revision: '文档包含修订标记，保存后可能丢失',
  field: '文档包含字段，保存后可能丢失',
  formula: '文档包含公式，保存后可能丢失',
  'embedded-object': '文档包含嵌入对象或宏，保存后可能丢失',
  hyperlink: '超链接将保存为普通文本',
  'unknown-style': '文档包含未识别样式，格式可能丢失',
  'heading-level-unsupported': '文档包含 4 级及以上标题，将按普通段落处理',
  'encrypted-protected': '文档启用了编辑保护，只能只读显示',
  'other-unrecognized': '文档包含未识别内容，保存后可能丢失',
};

/** 命中即整体降级为只读的警告码（高风险内容）。 */
export const DOCX_READ_ONLY_WARNING_CODES: ReadonlySet<DocxCompatibilityWarningCode> = new Set([
  'encrypted-protected',
  'embedded-object',
]);

export interface DocxCompatibilityWarning {
  readonly code: DocxCompatibilityWarningCode;
  /** 稳定可展示文案。 */
  readonly message: string;
}

export interface DocxCompatibilityReport {
  /** supported：无警告；degraded：有可降级警告；read-only：含高风险警告。 */
  readonly level: DocxCompatibilityLevel;
  /** 去重后按规范顺序排列的警告。 */
  readonly warnings: readonly DocxCompatibilityWarning[];
}

/** 构造稳定警告对象。 */
export function docxCompatibilityWarning(
  code: DocxCompatibilityWarningCode,
): DocxCompatibilityWarning {
  return { code, message: DOCX_COMPATIBILITY_WARNING_MESSAGES[code] };
}

/**
 * 把多组警告合并为兼容性报告：按码去重、按规范顺序排序并计算等级。
 * 任一只读码 → `read-only`；否则有警告 → `degraded`；无警告 → `supported`。
 */
export function docxCompatibilityReport(
  warningGroups: readonly (readonly DocxCompatibilityWarning[])[],
): DocxCompatibilityReport {
  const byCode = new Map<DocxCompatibilityWarningCode, DocxCompatibilityWarning>();
  for (const group of warningGroups) {
    for (const warning of group) {
      if (!byCode.has(warning.code)) {
        byCode.set(warning.code, warning);
      }
    }
  }
  const warnings: DocxCompatibilityWarning[] = [];
  for (const code of DOCX_COMPATIBILITY_WARNING_ORDER) {
    const warning = byCode.get(code);
    if (warning !== undefined) {
      warnings.push(warning);
    }
  }
  const level: DocxCompatibilityLevel = warnings.some((warning) =>
    DOCX_READ_ONLY_WARNING_CODES.has(warning.code),
  )
    ? 'read-only'
    : warnings.length === 0
      ? 'supported'
      : 'degraded';
  return { level, warnings };
}

/* ======================= 导入源（Mammoth/JSZip 检查结果 → 模型转换的输入） ======================= */

/** run 内检测到的不支持特性（用于稳定警告）。 */
export type DocxImportRunFeature =
  'image' | 'hyperlink' | 'comment-reference' | 'field' | 'formula' | 'embedded-object' | 'other';

/** 文档级结构特性（由 WP2 的 ZIP/OOXML 检查填充）。 */
export type DocxImportDocumentFeature =
  'header-footer' | 'revision' | 'encrypted-protected' | 'embedded-object';

/** 导入用 run：文本与 mark 标志（颜色为规范 `#RRGGBB` 或 null；字号为磅值或 null）。 */
export interface DocxImportRun {
  readonly text: string;
  readonly isBold: boolean;
  readonly isItalic: boolean;
  readonly isUnderline: boolean;
  readonly fontSize: number | null;
  readonly color: string | null;
  readonly features: readonly DocxImportRunFeature[];
}

/** 导入用段落条目：样式、对齐、编号与 run 序列。 */
export interface DocxImportParagraphBlock {
  readonly type: 'paragraph';
  readonly styleId: string | null;
  readonly styleName: string | null;
  readonly alignment: DocxAlignment | null;
  readonly numbering: { readonly ordered: boolean; readonly level: number } | null;
  readonly runs: readonly DocxImportRun[];
}

/** 导入用块：段落条目或整块降级内容（表格/未识别节点）。 */
export type DocxImportBlock =
  DocxImportParagraphBlock | { readonly type: 'table' } | { readonly type: 'other' };

/** 导入源：文档级特性 + 块序列（库无关的结构化输入）。 */
export interface DocxImportSource {
  readonly documentFeatures: readonly DocxImportDocumentFeature[];
  readonly blocks: readonly DocxImportBlock[];
}

/* ======================= 读写请求/结果与稳定错误（第 5.1 节） ======================= */

/** 稳定 DOCX 错误码：跨进程只传 code + 可展示消息。 */
export type DocxDocumentErrorCode =
  | 'NO_WORKSPACE'
  | 'INVALID_REQUEST'
  | 'INVALID_PATH'
  | 'OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_TYPE'
  | 'NOT_FILE'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'TOO_LARGE'
  | 'INVALID_DOCX'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'CONFLICT'
  | 'COMPATIBILITY_CONFIRMATION_REQUIRED'
  | 'READ_ONLY_DOCUMENT'
  | 'BACKUP_FAILED'
  | 'EXPORT_FAILED'
  | 'VERIFICATION_FAILED'
  | 'WRITE_FAILED'
  | 'READ_FAILED';

/** 稳定错误消息（不含正文、绝对路径、临时名称或调用栈）。 */
export const DOCX_ERROR_MESSAGES: Readonly<Record<DocxDocumentErrorCode, string>> = {
  NO_WORKSPACE: '尚未打开工作区',
  INVALID_REQUEST: '无效的请求',
  INVALID_PATH: '无效的文件相对路径',
  OUTSIDE_WORKSPACE: '文件不在工作区内',
  UNSUPPORTED_TYPE: '仅支持打开 .docx 文件',
  NOT_FILE: '目标不是普通文件',
  NOT_FOUND: '文件不存在或已被移除',
  ACCESS_DENIED: '没有访问权限',
  TOO_LARGE: '文件超过 20 MiB 上限',
  INVALID_DOCX: '不是有效的 DOCX 文件',
  RESOURCE_LIMIT_EXCEEDED: '文件超出资源预算',
  CONFLICT: '文件已被外部修改，保存被拒绝',
  COMPATIBILITY_CONFIRMATION_REQUIRED: '文档包含不受支持的内容，需要确认后保存',
  READ_ONLY_DOCUMENT: '文档为只读状态，无法保存',
  BACKUP_FAILED: '备份创建失败',
  EXPORT_FAILED: '生成 DOCX 产物失败',
  VERIFICATION_FAILED: 'DOCX 产物验证失败',
  WRITE_FAILED: '写入文件失败',
  READ_FAILED: '读取文件失败',
};

export interface DocxDocumentError {
  readonly code: DocxDocumentErrorCode;
  readonly message: string;
}

/** 构造稳定错误对象。 */
export function docxDocumentError(code: DocxDocumentErrorCode): DocxDocumentError {
  return { code, message: DOCX_ERROR_MESSAGES[code] };
}

/** 单个 DOCX 文件的只读文档快照（主进程读取/保存成功后的产物）。 */
export interface DocxDocumentSnapshot {
  readonly kind: 'docx';
  /** 文件名（不含路径），由主进程从最终文件路径取得。 */
  readonly name: string;
  /** 经过验证的规范工作区相对路径，使用 `/` 分隔。 */
  readonly relativePath: string;
  /** 原始完整字节的 SHA-256 十六进制；保存时作为 `expectedRevision` 回传。 */
  readonly revision: string;
  /** 原始文件字节数。 */
  readonly size: number;
  /** 有版本、有上限的结构化中间模型。 */
  readonly model: DocxDocumentModel;
  /** 兼容性等级与稳定警告。 */
  readonly compatibility: DocxCompatibilityReport;
}

/** 读取 DOCX 的结果 —— discriminated union。 */
export type ReadDocxDocumentResult =
  | { readonly status: 'loaded'; readonly document: DocxDocumentSnapshot }
  | { readonly status: 'error'; readonly error: DocxDocumentError };

/**
 * 保存 DOCX 的请求 —— 渲染进程只能提供相对路径、预期版本、模型与兼容性确认。
 * 请求不得包含工作区根、绝对路径、临时/备份路径、任意 XML/HTML、替换策略或文件系统选项。
 */
export interface SaveDocxDocumentRequest {
  readonly relativePath: string;
  /** 上次成功读取或保存返回的 `revision`；与当前磁盘版本不一致返回 `CONFLICT`。 */
  readonly expectedRevision: string;
  /** 通过运行时校验且有预算上限的结构化模型。 */
  readonly model: DocxDocumentModel;
  /** `degraded` 文档的兼容性确认绑定的 revision（第 4.2 节）；未确认时保存被拒绝。 */
  readonly compatibilityConfirmationRevision?: string;
}

/** 保存 DOCX 的结果 —— discriminated union。 */
export type SaveDocxDocumentResult =
  | {
      readonly status: 'saved';
      readonly document: DocxDocumentSnapshot;
      /** 本次保存前原文件的滚动备份相对路径（`<文件名>.wenshu.bak`）。 */
      readonly backupRelativePath: string;
    }
  | { readonly status: 'error'; readonly error: DocxDocumentError };
