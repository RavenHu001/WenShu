/**
 * TASK-010 WP1 纯模块：当前 DOCX 查找的纯函数层（任务第 4.2-4.4 节与 WP0 冻结结论）。
 *
 * ## 边界
 *
 * - 本模块只做纯函数计算：输入校验、literal 匹配、实时 textblock 投影、投影范围到
 *   ProseMirror 位置映射、当前索引初选与循环导航、内容变化后的最近匹配；
 * - 不安装 ProseMirror plugin、不创建 Decoration、不 dispatch 任何 transaction、
 *   不持有 editor/view/React 状态、不修改 IPC/preload；
 * - 正文投影唯一复用 Task 8 的「joinDocxTextBlocks」（src/shared/docx-search-text.ts），
 *   不在本模块复制第二套投影语义（WP1 门禁）。
 *
 * ## 冻结语义（WP0 报告第 6 节）
 *
 * - 输入：查询非空、<= 4096 UTF-16、单行（\\r/\\n 拒绝）；替换 <= 4096 UTF-16、单行
 *   （空替换合法）；
 * - 匹配：literal + caseSensitive；大小写不敏感只折叠 ASCII A-Z（与 Task 6
 *   matchText 一致，不做 Unicode 规范化，不改变 UTF-16 长度）；从左到右、非重叠；
 *   最多 2000 项，扫描发现第 2001 个匹配时置 truncated=true（不静默裁剪）；
 * - 含换行查询在输入层被拒绝；matcher/search 对换行查询做防御性空结果（绝不跨人工
 *   \\n 匹配，与工作区 matcher 服务磁盘全文的语义差异见测试）；
 * - 投影偏移为 UTF-16 code unit；映射公式（Task 8 WP0 冻结）：
 *   PM 位置 = textblock 内容起点（pos + 1）+ 块内 UTF-16 偏移；
 * - 当前索引：初选 = 第一个 pmFrom >= selectionAnchor 的匹配（与 CodeMirror 从选区头
 *   向后搜索一致，不存在时循环到第一个）；next/previous 循环；内容变化后优先选择
 *   pmFrom >= 旧锚点的最近有效匹配。
 */

import {
  joinDocxTextBlocks,
  type DocxSearchTextBlock,
  type DocxSearchTextProjection,
} from '../../shared/docx-search-text';

/** 查询/替换输入最大 UTF-16 code unit 数（TASK-010 第 4.3 / 4.6 节，WP0 冻结）。 */
export const CURRENT_SEARCH_MAX_INPUT_UTF16 = 4096;

/** 单标签最多保留并装饰的匹配数；扫描发现第 2001 个时标记截断（第 4.4 节，WP0 冻结）。 */
export const CURRENT_SEARCH_MAX_MATCHES = 2000;

/* ======================= 输入校验（第 4.3 / 4.6 节） ======================= */

export type CurrentSearchInputErrorCode =
  | 'EMPTY_QUERY'
  | 'QUERY_TOO_LONG'
  | 'QUERY_HAS_NEWLINE'
  | 'REPLACEMENT_TOO_LONG'
  | 'REPLACEMENT_HAS_NEWLINE';

/** 稳定错误文案（与 WP0 冻结文案一致，不含正文/路径）。 */
export const CURRENT_SEARCH_INPUT_ERROR_MESSAGES: Readonly<
  Record<CurrentSearchInputErrorCode, string>
> = {
  EMPTY_QUERY: '查询不能为空',
  QUERY_TOO_LONG: '查询超过 4096 个 UTF-16 单元',
  QUERY_HAS_NEWLINE: '查询不能包含换行',
  REPLACEMENT_TOO_LONG: '替换超过 4096 个 UTF-16 单元',
  REPLACEMENT_HAS_NEWLINE: '替换不能包含换行',
};

export type CurrentSearchInputValidation =
  { readonly ok: true } | { readonly ok: false; readonly error: CurrentSearchInputErrorCode };

/** 校验查询：非空、<= 4096 UTF-16、单行。 */
export function validateCurrentSearchQuery(query: string): CurrentSearchInputValidation {
  if (query.length === 0) {
    return { ok: false, error: 'EMPTY_QUERY' };
  }
  if (query.length > CURRENT_SEARCH_MAX_INPUT_UTF16) {
    return { ok: false, error: 'QUERY_TOO_LONG' };
  }
  if (/[\r\n]/.test(query)) {
    return { ok: false, error: 'QUERY_HAS_NEWLINE' };
  }
  return { ok: true };
}

/** 校验替换输入：<= 4096 UTF-16、单行（空字符串合法 = 删除）。 */
export function validateCurrentSearchReplacement(
  replacement: string,
): CurrentSearchInputValidation {
  if (replacement.length > CURRENT_SEARCH_MAX_INPUT_UTF16) {
    return { ok: false, error: 'REPLACEMENT_TOO_LONG' };
  }
  if (/[\r\n]/.test(replacement)) {
    return { ok: false, error: 'REPLACEMENT_HAS_NEWLINE' };
  }
  return { ok: true };
}

/* ======================= 实时 textblock 投影（复用 Task 8 规则） ======================= */

/** 单个 PM textblock 的最小描述（WP2 宿主从公开节点 API 收集）。 */
export interface PmTextBlock {
  /** textblock 节点起始位置（ProseMirror position API，公开 API 可读）。 */
  readonly pos: number;
  /** 块正文（全部 text 节点 textContent 连接；同一块内可跨 marks run）。 */
  readonly text: string;
}

/** 实时投影：Task 8 规范投影 + 与 blocks 一一对应的 PM textblock。 */
export interface PmProjection extends DocxSearchTextProjection {
  readonly pmBlocks: readonly PmTextBlock[];
}

/**
 * 把 PM textblock 序列投影为规范可搜索文本与块区间。
 * 只复用 joinDocxTextBlocks：相邻块恰一个人工 \\n、空块保留、UTF-16 偏移，
 * 与 projectDocxModelSearchText 完全同一套规则（无第二套正文语义）。
 */
export function projectPmTextblocks(textblocks: readonly PmTextBlock[]): PmProjection {
  const joined = joinDocxTextBlocks(textblocks.map((block) => block.text));
  return { ...joined, pmBlocks: textblocks };
}

/* ======================= literal 匹配（第 4.3 / 4.4 节） ======================= */

/** 单个字面量匹配（投影文本 UTF-16 范围）。 */
export interface LiteralTextMatch {
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
}

export interface LiteralMatchOutcome {
  readonly matches: readonly LiteralTextMatch[];
  /** 达到上限且正文中仍可能存在更多匹配。 */
  readonly truncated: boolean;
}

/** 仅折叠 ASCII 大写为小写；其他 code unit 不变（折叠不改变 UTF-16 长度）。 */
function foldAsciiToLower(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/** 对查询串做 ASCII-only 小写折叠；折叠后与原文 UTF-16 长度一致。 */
function foldedAsciiLower(query: string): string {
  let folded = '';
  for (let index = 0; index < query.length; index += 1) {
    folded += String.fromCharCode(foldAsciiToLower(query.charCodeAt(index)));
  }
  return folded;
}

/**
 * 在投影文本中查找字面量查询（与 Task 6 matchText 相同的折叠/非重叠/截断语义，
 * 但不计算行列与预览）。
 *
 * 约定：调用方应先通过 validateCurrentSearchQuery；换行查询属于程序错误，本函数
 * 防御性返回空结果（绝不跨人工 \\n 匹配）。
 */
export function findLiteralMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  maxMatches: number = CURRENT_SEARCH_MAX_MATCHES,
): LiteralMatchOutcome {
  if (query.length === 0 || maxMatches <= 0 || text.length < query.length || /[\r\n]/.test(query)) {
    return { matches: [], truncated: false };
  }
  const needle = caseSensitive ? query : foldedAsciiLower(query);
  const matches: LiteralTextMatch[] = [];
  let truncated = false;
  let pos = 0;
  while (pos + needle.length <= text.length) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      const contentCode = text.charCodeAt(pos + index);
      const needleCode = needle.charCodeAt(index);
      const foldedContentCode = caseSensitive ? contentCode : foldAsciiToLower(contentCode);
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
    matches.push({ from, to, matchedText: text.slice(from, to) });
    if (matches.length >= maxMatches) {
      // 与 matchText 完全一致的截断判定：已收集的最后一个匹配之后仍有空间可能再匹配
      truncated = to + needle.length <= text.length;
      break;
    }
    pos = to; // 非重叠：下一次匹配从本匹配结束位置开始
  }
  return { matches, truncated };
}

/* ======================= 投影范围 → PM 位置映射（Task 8 冻结公式） ======================= */

/** 已映射为 PM 选区范围的匹配。 */
export interface PmMatch {
  /** 投影文本范围（UTF-16）。 */
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
  /** textblock 序号（文档顺序，0 起始）。 */
  readonly blockOrdinal: number;
  /** 映射后的 PM 选区范围（内容起点 pos+1 + 块内偏移）。 */
  readonly pmFrom: number;
  readonly pmTo: number;
}

export interface PmMatchOutcome {
  readonly matches: readonly PmMatch[];
  readonly truncated: boolean;
}

/** 二分查找包含 [from, to) 的文本块（blocks 按 from 升序且区间连续）。 */
function findBlockContaining(
  blocks: readonly DocxSearchTextBlock[],
  from: number,
  to: number,
): DocxSearchTextBlock | null {
  let lo = 0;
  let hi = blocks.length - 1;
  let candidate: DocxSearchTextBlock | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid]!;
    if (block.from <= from) {
      candidate = block;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate !== null && from >= candidate.from && to <= candidate.to) {
    return candidate;
  }
  return null;
}

/**
 * 把投影范围映射为 PM 选区。范围必须非空、在投影内且完整位于单个 textblock；
 * 否则返回 null（不猜测、不按块序号强行跳转，任务第 4.2 节）。
 */
export function mapProjectionRangeToPm(
  projection: PmProjection,
  from: number,
  to: number,
): PmMatch | null {
  if (from < 0 || to > projection.text.length || to < from || to === from) {
    return null;
  }
  const block = findBlockContaining(projection.blocks, from, to);
  if (block === null) {
    return null;
  }
  const pmBlock = projection.pmBlocks[block.ordinal];
  if (pmBlock === undefined) {
    return null;
  }
  const pmFrom = pmBlock.pos + 1 + (from - block.from);
  const pmTo = pmFrom + (to - from);
  return {
    from,
    to,
    matchedText: projection.text.slice(from, to),
    blockOrdinal: block.ordinal,
    pmFrom,
    pmTo,
  };
}

/** 在实时投影上执行一次完整查找：匹配 + 映射 + 截断标记。 */
export function searchCurrentDocProjection(
  projection: PmProjection,
  query: string,
  caseSensitive: boolean,
  maxMatches: number = CURRENT_SEARCH_MAX_MATCHES,
): PmMatchOutcome {
  const literal = findLiteralMatches(projection.text, query, caseSensitive, maxMatches);
  const matches: PmMatch[] = [];
  for (const match of literal.matches) {
    const mapped = mapProjectionRangeToPm(projection, match.from, match.to);
    if (mapped !== null) {
      matches.push(mapped);
    }
  }
  return { matches, truncated: literal.truncated };
}

/* ======================= 当前索引（第 4.3 节） ======================= */

/**
 * 初选当前匹配：第一个 pmFrom >= selectionAnchor 的匹配；不存在时循环到第一个；
 * 无匹配返回 null。锚点为编辑器选区/光标的 PM 位置（由 WP2 宿主提供）。
 */
export function pickInitialCurrentIndex(
  matches: readonly PmMatch[],
  selectionAnchor: number,
): number | null {
  if (matches.length === 0) {
    return null;
  }
  const index = matches.findIndex((match) => match.pmFrom >= selectionAnchor);
  return index === -1 ? 0 : index;
}

/** 下一个（循环）；无匹配返回 null；当前索引未知时取第一个。 */
export function nextCurrentIndex(
  matches: readonly PmMatch[],
  currentIndex: number | null,
): number | null {
  if (matches.length === 0) {
    return null;
  }
  if (currentIndex === null) {
    return 0;
  }
  return (currentIndex + 1) % matches.length;
}

/** 上一个（循环）；无匹配返回 null；当前索引未知时取最后一个。 */
export function previousCurrentIndex(
  matches: readonly PmMatch[],
  currentIndex: number | null,
): number | null {
  if (matches.length === 0) {
    return null;
  }
  if (currentIndex === null) {
    return matches.length - 1;
  }
  return (currentIndex - 1 + matches.length) % matches.length;
}

/**
 * 内容变化后的最近匹配：优先选择 pmFrom >= previousAnchor 的第一个有效匹配
 * （旧当前位置之后最近），否则循环到第一个；previousAnchor 为 null（无旧位置）
 * 时取第一个；无匹配返回 null。
 */
export function pickRecentCurrentIndex(
  matches: readonly PmMatch[],
  previousAnchor: number | null,
): number | null {
  if (matches.length === 0) {
    return null;
  }
  if (previousAnchor === null) {
    return 0;
  }
  const index = matches.findIndex((match) => match.pmFrom >= previousAnchor);
  return index === -1 ? 0 : index;
}
