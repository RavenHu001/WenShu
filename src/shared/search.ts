/**
 * 工作区文本搜索共享契约 —— 纯 TypeScript 类型、常量与运行时校验，不依赖 Electron、Node.js、React 或浏览器运行时。
 *
 * ## 设计约束（TASK-006 第 4.8 节、TASK-008 第 4.6 节与 WP0 冻结记录）
 *
 * 1. 所有接口字段均为 `readonly`，保证跨进程通过 Electron structured clone 安全传递；
 * 2. 不包含 `Error`、`Buffer`、`Uint8Array`、文件句柄、函数或类实例；
 * 3. 请求不携带工作区根、绝对路径、glob、扩展名、编码、上限、并发数或文件内容；
 * 4. 结果文件身份只使用规范工作区相对路径（`/` 分隔）；
 * 5. 匹配范围 `from` / `to` 以完整文件正文的 UTF-16 索引为基准：TXT 为剥离 BOM 后的
 *    原正文，DOCX 为规范正文投影（TASK-008 第 4.3 / 4.4 节）；
 * 6. 预览范围 `previewMatchFrom` / `previewMatchTo` 以 `preview` 自身为基准；
 * 7. 查询、命中正文、绝对路径与原始异常不得进入日志或跨进程错误；
 * 8. 结果文件分组携带必填 `kind` 判别字段（`txt` / `docx`），由主进程受控候选分类
 *    产生，renderer 不从展示文案猜测（TASK-008 第 4.6 节）。
 *
 * ## 固定资源上限（第 4.5 节，WP0 冻结项 5）
 *
 * 全部可审计常量集中于此，主进程搜索器与测试共同引用。TASK-008 起 1000 是 TXT 与
 * DOCX 合计候选预算，DOCX 另有 200 的独立上限。
 */

/** 查询最大 UTF-16 code unit 数。 */
export const MAX_QUERY_LENGTH = 256;
/** 单次搜索候选文件总数上限（TASK-008 起为 TXT + DOCX 合计预算）。 */
export const MAX_CANDIDATE_FILES = 1000;
/** 单次搜索 DOCX 候选文件数上限（TASK-008 第 4.5 节：控制 ZIP 检查/导入/模型内存压力）。 */
export const MAX_DOCX_CANDIDATE_FILES = 200;
/** 单个文件返回匹配数上限。 */
export const MAX_MATCHES_PER_FILE = 200;
/** 单次返回匹配总数上限。 */
export const MAX_TOTAL_MATCHES = 2000;
/** 单条预览最大 UTF-16 code unit 数。 */
export const MAX_PREVIEW_LENGTH = 160;
/** 候选文件读取并发上限（全部文件池）。 */
export const MAX_FILE_READ_CONCURRENCY = 4;
/** DOCX 同时读取/导入上限（TASK-008 第 4.5 节：总并发 4 内 DOCX 在途不超过 2）。 */
export const MAX_DOCX_READ_CONCURRENCY = 2;

/**
 * 工作区文本搜索请求（第 4.8 节固定形状）。
 * `requestId` 由 renderer 单调递增分配，不得使用查询字符串作为身份；
 * 请求不得携带工作区根或绝对路径，根路径只来自主进程工作区会话。
 */
export interface WorkspaceTextSearchRequest {
  /** renderer 分配的单调递增请求编号（非负安全整数）。 */
  readonly requestId: number;
  /** 1-256 个 UTF-16 code unit 的单行字符串；拒绝空串、换行与 `\0`。 */
  readonly query: string;
  /** 大小写敏感开关；首版不敏感匹配只折叠 ASCII 字母。 */
  readonly caseSensitive: boolean;
}

/** 工作区文本搜索取消请求：只引用当前窗口已知的 requestId，不是通用任务控制接口。 */
export interface WorkspaceTextSearchCancelRequest {
  readonly requestId: number;
}

/** 单个匹配（第 4.8 节固定形状）。 */
export interface WorkspaceTextSearchMatch {
  /** 匹配在完整文件正文中的 UTF-16 起始索引。 */
  readonly from: number;
  /** 匹配在完整文件正文中的 UTF-16 结束索引（不包含）。 */
  readonly to: number;
  /** 匹配所在行号，从 1 开始。 */
  readonly line: number;
  /** 匹配在行内的列号（UTF-16 单元数），从 1 开始。 */
  readonly column: number;
  /** 原正文中的实际匹配文本（大小写不敏感时保留原文，不做大小写折叠）。 */
  readonly matchedText: string;
  /** 单行上下文片段，最长 `MAX_PREVIEW_LENGTH` 个 UTF-16 code unit，不含换行符。 */
  readonly preview: string;
  /** 匹配在 `preview` 内的 UTF-16 起始索引；可能因窗口截断小于实际匹配长度。 */
  readonly previewMatchFrom: number;
  /** 匹配在 `preview` 内的 UTF-16 结束索引（不包含）；权威范围始终是 `from` / `to`。 */
  readonly previewMatchTo: number;
}

/**
 * 单个文件的搜索结果分组（第 4.8 节固定形状；TASK-008 第 4.6 节新增必填 `kind`）。
 * 文件身份只使用规范工作区相对路径；`revision` 为读取时原始字节的 SHA-256。
 * TXT 的 `from` / `to` 指向剥离 BOM 后的原正文；DOCX 的 `from` / `to` 指向规范正文投影。
 */

/** 搜索结果文件类型（TASK-008 第 4.6 节）：由主进程受控候选分类产生，不从展示文案猜测。 */
export type WorkspaceSearchDocumentKind = 'txt' | 'docx';

/** 运行时判定搜索文件 kind：只接受 `txt` / `docx`，其余值一律拒绝。 */
export function isWorkspaceSearchDocumentKind(
  value: unknown,
): value is WorkspaceSearchDocumentKind {
  return value === 'txt' || value === 'docx';
}

export interface WorkspaceTextSearchFileResult {
  /** 文件类型判别字段：TXT 或 DOCX（主进程受控候选分类产生，renderer 不猜测）。 */
  readonly kind: WorkspaceSearchDocumentKind;
  /** 规范工作区相对路径，`/` 分隔；同一结果集合内唯一。 */
  readonly relativePath: string;
  /** 读取时磁盘内容的 revision；结果生命周期内不可变，用于过期定位校验。 */
  readonly revision: string;
  /** 匹配列表，按 `from` 升序；可能为空文件分组的预留（调用方应剔除空分组）。 */
  readonly matches: readonly WorkspaceTextSearchMatch[];
  /** 该文件的返回匹配是否被截断（单文件上限或总预算截断）。 */
  readonly truncated: boolean;
}

/**
 * 截断原因（第 4.5 节固定枚举）：到达上限返回 `truncated: true` 与具体原因，不静默丢弃。
 * - `file-limit`：候选文件总数达到 1000（TXT + DOCX 合计）；
 * - `docx-file-limit`：DOCX 候选数达到 200（TASK-008 第 4.5 节新增）；
 * - `matches-per-file-limit`：单文件匹配数达到 200；
 * - `total-matches-limit`：总匹配数达到 2000。
 *
 * 截断原因优先级固定为：`file-limit` > `docx-file-limit` > `total-matches-limit` >
 * `matches-per-file-limit`（TASK-008 第 4.5 节；见 `WORKSPACE_SEARCH_TRUNCATION_PRIORITY`）。
 */
export type WorkspaceTextSearchTruncatedReason =
  'file-limit' | 'docx-file-limit' | 'matches-per-file-limit' | 'total-matches-limit';

/** 截断原因优先级（从高到低）：同时命中多个上限时报告优先级最高的原因。 */
export const WORKSPACE_SEARCH_TRUNCATION_PRIORITY: readonly WorkspaceTextSearchTruncatedReason[] = [
  'file-limit',
  'docx-file-limit',
  'total-matches-limit',
  'matches-per-file-limit',
];

/** 搜索统计（第 4.5 / 4.8 节）。 */
export interface WorkspaceTextSearchStatistics {
  /** 实际尝试读取的候选文件数（TXT + DOCX）。 */
  readonly scannedFiles: number;
  /** 命中文件数（返回结果中的文件分组数，与实际结果一致）。 */
  readonly matchedFiles: number;
  /** 返回的匹配总数（与实际结果一致）。 */
  readonly totalMatches: number;
  /** 跳过数量：不可读子目录与读取失败候选文件计数（错误隔离后仅计数）。 */
  readonly skippedFiles: number;
}

/** 稳定搜索错误码（第 4.7 / 4.8 节与 WP0 冻结项 6）。 */
export type WorkspaceTextSearchErrorCode = 'NO_WORKSPACE' | 'INVALID_REQUEST' | 'SEARCH_FAILED';

/** 可序列化搜索错误：不含绝对路径、原始异常、调用栈或正文。 */
export interface WorkspaceTextSearchError {
  readonly code: WorkspaceTextSearchErrorCode;
  readonly message: string;
}

/**
 * 搜索结果 —— discriminated union。
 * - `completed`：正常结束（可能携带 `truncated` 部分结果）；
 * - `cancelled`：取消不是错误；取消后不得把部分结果标记为 completed；
 * - `error`：本次搜索整体失败（如无工作区、根目录不可读、非法请求），不携带部分结果。
 */
export type WorkspaceTextSearchResult =
  | {
      readonly status: 'completed';
      readonly requestId: number;
      readonly files: readonly WorkspaceTextSearchFileResult[];
      readonly statistics: WorkspaceTextSearchStatistics;
      readonly truncated: boolean;
      readonly truncatedReason: WorkspaceTextSearchTruncatedReason | null;
    }
  | { readonly status: 'cancelled'; readonly requestId: number }
  | {
      readonly status: 'error';
      readonly requestId: number;
      readonly error: WorkspaceTextSearchError;
    };

/** 搜索请求校验失败的稳定原因；供测试断言与 IPC 映射稳定错误码（WP3）。 */
export type WorkspaceTextSearchInvalidReason =
  | 'NOT_OBJECT'
  | 'EXTRA_FIELDS'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_QUERY_TYPE'
  | 'EMPTY_QUERY'
  | 'QUERY_TOO_LONG'
  | 'QUERY_HAS_LINE_BREAK'
  | 'QUERY_HAS_NUL'
  | 'INVALID_CASE_SENSITIVE';

/** 取消请求校验失败的稳定原因。 */
export type WorkspaceTextSearchCancelInvalidReason =
  'NOT_OBJECT' | 'EXTRA_FIELDS' | 'INVALID_REQUEST_ID';

/** 搜索请求校验结果：通过返回冻结形状的请求，失败返回稳定原因（不猜测、不修补危险字段）。 */
export type WorkspaceTextSearchRequestValidation =
  | { readonly ok: true; readonly request: WorkspaceTextSearchRequest }
  | { readonly ok: false; readonly reason: WorkspaceTextSearchInvalidReason };

/** 取消请求校验结果。 */
export type WorkspaceTextSearchCancelValidation =
  | { readonly ok: true; readonly request: WorkspaceTextSearchCancelRequest }
  | { readonly ok: false; readonly reason: WorkspaceTextSearchCancelInvalidReason };

/** requestId 必须是可安全表示的整数且非负。 */
export function isValidSearchRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 运行时校验搜索请求（第 4.6 / 4.7 节与 WP0 冻结项 1）：
 * - 必须是普通对象（非 null、非数组），只允许 `requestId` / `query` / `caseSensitive` 三个键；
 * - `requestId` 为非负安全整数；`caseSensitive` 为布尔；
 * - `query` 为 1-256 个 UTF-16 code unit 的单行字符串，拒绝空串、`\r` / `\n` 与 `\0`；
 * - 出现任何多余字段或类型错误都返回稳定原因，不猜测、截断或修补。
 */
export function validateWorkspaceTextSearchRequest(
  value: unknown,
): WorkspaceTextSearchRequestValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'NOT_OBJECT' };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'requestId' && key !== 'query' && key !== 'caseSensitive') {
      return { ok: false, reason: 'EXTRA_FIELDS' };
    }
  }
  if (!isValidSearchRequestId(record.requestId)) {
    return { ok: false, reason: 'INVALID_REQUEST_ID' };
  }
  if (typeof record.query !== 'string') {
    return { ok: false, reason: 'INVALID_QUERY_TYPE' };
  }
  const query = record.query;
  if (query.length === 0) {
    return { ok: false, reason: 'EMPTY_QUERY' };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { ok: false, reason: 'QUERY_TOO_LONG' };
  }
  if (query.includes('\r') || query.includes('\n')) {
    return { ok: false, reason: 'QUERY_HAS_LINE_BREAK' };
  }
  if (query.includes('\0')) {
    return { ok: false, reason: 'QUERY_HAS_NUL' };
  }
  if (typeof record.caseSensitive !== 'boolean') {
    return { ok: false, reason: 'INVALID_CASE_SENSITIVE' };
  }
  return {
    ok: true,
    request: {
      requestId: record.requestId,
      query,
      caseSensitive: record.caseSensitive,
    },
  };
}

/**
 * 运行时校验取消请求：只接受恰好一个 `requestId` 字段；多余字段直接拒绝。
 */
export function validateWorkspaceTextSearchCancelRequest(
  value: unknown,
): WorkspaceTextSearchCancelValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'NOT_OBJECT' };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'requestId') {
      return { ok: false, reason: 'EXTRA_FIELDS' };
    }
  }
  if (!isValidSearchRequestId(record.requestId)) {
    return { ok: false, reason: 'INVALID_REQUEST_ID' };
  }
  return { ok: true, request: { requestId: record.requestId } };
}
