/**
 * 字面量文本匹配器 —— TASK-006 WP1（任务第 6.2 节）。
 *
 * 纯逻辑模块：不读取文件系统、不持有取消控制器、不依赖 Electron / Node.js / React 运行时。
 * 负责 literal 匹配、UTF-16 范围、1-based 行列、单行预览、单文件与总结果预算、结果分组与排序。
 *
 * ## 冻结语义（TASK-006 第 4.4 / 4.5 节与 WP0 冻结记录项 2-5）
 *
 * - 只做 literal 匹配 + 大小写敏感开关，无正则 / whole-word；
 * - 匹配不重叠，同一文件内按 `from` 升序；
 * - 匹配范围以完整文件正文（BOM 已剥离）的 UTF-16 索引为基准；
 * - 行号 / 列号从 1 开始；`\r\n`、`\n`、独立 `\r` 均视为一个换行边界（CRLF 只计一次）；
 * - 大小写不敏感只折叠 ASCII 字母（A-Z ↔ a-z），折叠不改变 UTF-16 长度，
 *   返回原正文中的实际范围与文本，不因大小写折叠改变偏移；
 * - 单行预览最长 `MAX_PREVIEW_LENGTH` 个 UTF-16 code unit，不含换行符；
 *   行超长时窗口起点 `clamp(matchStart - 80, lineStart, lineEnd - 160)`；
 *   `previewMatchFrom/To` 以 preview 自身为基准，可能因窗口截断而小于实际匹配长度，
 *   权威范围始终是 `from` / `to`；
 * - 单文件匹配数与总匹配数到达上限返回截断标志与具体原因，不静默丢弃。
 */

import {
  MAX_MATCHES_PER_FILE,
  MAX_PREVIEW_LENGTH,
  MAX_TOTAL_MATCHES,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchMatch,
  type WorkspaceTextSearchTruncatedReason,
} from '../../shared/search';

/** 匹配器选项；上限缺省使用共享冻结常量。 */
export interface TextMatchOptions {
  /** 大小写敏感开关；false 时只折叠 ASCII 字母。 */
  readonly caseSensitive: boolean;
  /** 单文件匹配数上限，默认 `MAX_MATCHES_PER_FILE`（200）。 */
  readonly maxMatchesPerFile?: number;
  /** 单条预览长度上限，默认 `MAX_PREVIEW_LENGTH`（160）。 */
  readonly maxPreviewLength?: number;
}

/** 单文件匹配结果：匹配列表（升序、不重叠）与是否被单文件上限截断。 */
export interface TextMatchOutcome {
  readonly matches: readonly WorkspaceTextSearchMatch[];
  /** 单文件匹配数达到上限且正文中仍可能存在更多匹配。 */
  readonly truncated: boolean;
}

/** 行范围：行内容在正文中的 [start, end)，不包含换行符本身。 */
interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** 将正文切分为行范围；`\r\n`、`\n`、独立 `\r` 均为一个边界（CRLF 只计一次）。 */
function lineRanges(content: string): readonly LineRange[] {
  const lines: LineRange[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code === 0x0d) {
      const isCrlf = i + 1 < content.length && content.charCodeAt(i + 1) === 0x0a;
      lines.push({ start, end: i });
      i += isCrlf ? 1 : 0;
      start = i + 1;
    } else if (code === 0x0a) {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  lines.push({ start, end: content.length });
  return lines;
}

/** 二分查找包含 `offset` 的行下标（offset 必然落在某一行内，因为查询不含换行）。 */
function lineIndexAt(lines: readonly LineRange[], offset: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.start <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** 仅折叠 ASCII 大写字母为小写；其他 code unit 保持不变（折叠不改变 UTF-16 长度）。 */
function foldAsciiToLower(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/** 对查询串做 ASCII-only 小写折叠；折叠后与原文 UTF-16 长度完全一致。 */
function foldedAsciiLower(query: string): string {
  let folded = '';
  for (let i = 0; i < query.length; i += 1) {
    folded += String.fromCharCode(foldAsciiToLower(query.charCodeAt(i)));
  }
  return folded;
}

/** 生成单行上下文预览；匹配不跨越换行，因此始终落在同一行内。 */
function buildPreview(
  content: string,
  line: LineRange,
  from: number,
  to: number,
  maxPreviewLength: number,
): Pick<WorkspaceTextSearchMatch, 'preview' | 'previewMatchFrom' | 'previewMatchTo'> {
  const lineLength = line.end - line.start;
  if (lineLength <= maxPreviewLength) {
    return {
      preview: content.slice(line.start, line.end),
      previewMatchFrom: from - line.start,
      previewMatchTo: Math.min(to - line.start, maxPreviewLength),
    };
  }
  // 行超长：窗口起点尽量让匹配居中，且不越过行首与行尾窗口边界
  const matchInLineStart = from - line.start;
  const windowStart = Math.max(
    0,
    Math.min(matchInLineStart - Math.floor(maxPreviewLength / 2), lineLength - maxPreviewLength),
  );
  const absStart = line.start + windowStart;
  return {
    preview: content.slice(absStart, absStart + maxPreviewLength),
    previewMatchFrom: Math.min(from - absStart, maxPreviewLength),
    previewMatchTo: Math.min(to - absStart, maxPreviewLength),
  };
}

/**
 * 在正文中查找字面量查询。
 *
 * @param content 完整文件正文（BOM 已剥离），匹配范围以该字符串的 UTF-16 索引为基准
 * @param query 经过契约校验的查询（1-256 code unit 单行字符串；空串防御性返回空结果）
 * @param options 大小写开关与可选上限
 */
export function matchText(
  content: string,
  query: string,
  options: TextMatchOptions,
): TextMatchOutcome {
  const maxMatchesPerFile = options.maxMatchesPerFile ?? MAX_MATCHES_PER_FILE;
  const maxPreviewLength = options.maxPreviewLength ?? MAX_PREVIEW_LENGTH;
  if (query.length === 0 || maxMatchesPerFile <= 0 || content.length < query.length) {
    return { matches: [], truncated: false };
  }

  const needle = options.caseSensitive ? query : foldedAsciiLower(query);
  const lines = lineRanges(content);
  const matches: WorkspaceTextSearchMatch[] = [];
  let truncated = false;
  let pos = 0;

  while (pos + needle.length <= content.length) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      const contentCode = content.charCodeAt(pos + j);
      const needleCode = needle.charCodeAt(j);
      const foldedContentCode = options.caseSensitive ? contentCode : foldAsciiToLower(contentCode);
      if (foldedContentCode !== needleCode) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      pos += 1;
      continue;
    }

    const from = pos;
    const to = pos + needle.length;
    const lineIndex = lineIndexAt(lines, from);
    const line = lines[lineIndex]!;
    const preview = buildPreview(content, line, from, to, maxPreviewLength);
    matches.push({
      from,
      to,
      line: lineIndex + 1,
      column: from - line.start + 1,
      matchedText: content.slice(from, to),
      ...preview,
    });
    if (matches.length >= maxMatchesPerFile) {
      // 达到上限后停止；仅当正文中仍可能存在匹配时报告截断
      truncated = to + needle.length <= content.length;
      break;
    }
    pos = to; // 不重叠：下一次匹配从本匹配结束位置开始
  }

  return { matches, truncated };
}

/** 分组预算选项；总匹配上限缺省使用共享冻结常量。 */
export interface GroupMatchedFileOptions {
  /** 单次返回匹配总数上限，默认 `MAX_TOTAL_MATCHES`（2000）。 */
  readonly maxTotalMatches?: number;
}

/** 分组结果：应用总预算后的文件分组与聚合统计。 */
export interface GroupedMatchedFiles {
  /** 应用总预算后的文件分组（输入顺序，调用方应预先按相对路径排序）；只含非空分组。 */
  readonly files: readonly WorkspaceTextSearchFileResult[];
  /** 返回匹配总数，与实际结果一致。 */
  readonly totalMatches: number;
  /** 命中文件数，与返回分组数一致。 */
  readonly matchedFiles: number;
  /** 是否存在截断（单文件上限或总预算）。 */
  readonly truncated: boolean;
  /** 截断原因；`truncated` 为 true 时非 null。 */
  readonly truncatedReason: WorkspaceTextSearchTruncatedReason | null;
}

/**
 * 在按相对路径排序的文件结果流上应用总匹配预算：
 * - 空匹配分组剔除，不进入结果；
 * - 累计达到 `maxTotalMatches` 后，当前文件按剩余预算截断并标记截断，后续文件整体丢弃；
 * - 单文件截断（`matches-per-file-limit`）被保留标记，但总预算截断优先报告；
 * - 文件与匹配顺序由输入顺序决定（与并发完成顺序无关）。
 */
export function groupMatchedFileResults(
  fileResults: readonly WorkspaceTextSearchFileResult[],
  options: GroupMatchedFileOptions = {},
): GroupedMatchedFiles {
  const maxTotalMatches = options.maxTotalMatches ?? MAX_TOTAL_MATCHES;
  const files: WorkspaceTextSearchFileResult[] = [];
  let totalMatches = 0;
  let perFileTruncated = false;
  let totalTruncated = false;

  for (const file of fileResults) {
    if (file.matches.length === 0) {
      continue;
    }
    const remaining = maxTotalMatches - totalMatches;
    if (remaining <= 0) {
      totalTruncated = true;
      break;
    }
    if (file.matches.length > remaining) {
      files.push({ ...file, matches: file.matches.slice(0, remaining), truncated: true });
      totalMatches = maxTotalMatches;
      totalTruncated = true;
      break;
    }
    files.push(file);
    totalMatches += file.matches.length;
    if (file.truncated) {
      perFileTruncated = true;
    }
  }

  return {
    files,
    totalMatches,
    matchedFiles: files.length,
    truncated: totalTruncated || perFileTruncated,
    truncatedReason: totalTruncated
      ? 'total-matches-limit'
      : perFileTruncated
        ? 'matches-per-file-limit'
        : null,
  };
}

/** 与 `scan-workspace.ts` 一致的自然排序器：数字感知、大小写不敏感。 */
const relativePathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 规范相对路径自然排序比较器（文件分组排序规则，WP0 冻结项 9）。 */
export function compareRelativePaths(a: string, b: string): number {
  return relativePathCollator.compare(a, b);
}

/** 按规范相对路径自然排序文件分组，返回新数组；排序结果与输入顺序无关（稳定）。 */
export function sortMatchedFileResults(
  fileResults: readonly WorkspaceTextSearchFileResult[],
): WorkspaceTextSearchFileResult[] {
  return [...fileResults].sort((a, b) => compareRelativePaths(a.relativePath, b.relativePath));
}
