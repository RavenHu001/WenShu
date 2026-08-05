/**
 * 文档数据契约 —— 纯 TypeScript 类型和常量，不依赖 Electron、Node.js、React 或浏览器运行时。
 *
 * 设计约束：
 * 1. 所有接口字段均为 `readonly`，保证跨进程通过 Electron structured clone 安全传递。
 * 2. 不包含 `Error`、`Buffer`、`Uint8Array`、文件句柄、`Stats`、函数或类实例。
 * 3. `name` 由主进程从最终文件路径取得，不信任渲染进程提供的名称。
 * 4. `relativePath` 是经过主进程验证的规范工作区相对路径，使用 `/` 分隔。
 * 5. `byteLength` 表示原始文件字节数，不表示 JavaScript 字符串长度。
 * 6. `revision` 是主进程对原始完整字节（含 BOM 与原始换行）计算的 SHA-256 十六进制值，
 *    作为外部修改冲突检测令牌，不是安全授权，也不能替代路径重新校验。
 * 7. `hasUtf8Bom` 与 `lineEnding` 由主进程从原始字节 / 正文检测，渲染进程不可指定。
 * 8. 错误消息不含文件正文、调用栈或不必要的系统内部信息；
 *    错误码供界面稳定分支，消息供用户理解，不应依赖字符串匹配控制逻辑。
 */

/** 换行类型：仅 LF、仅 CRLF、混合（或含独立 CR）、无换行。 */
export type LineEnding = 'lf' | 'crlf' | 'mixed' | 'none';

/** 单个 UTF-8 TXT 文件的只读文档快照。 */
export interface TextDocumentSnapshot {
  /** 文件名（不含路径），由主进程从最终文件路径取得。 */
  readonly name: string;
  /** 经过验证的规范工作区相对路径，使用 `/` 分隔。 */
  readonly relativePath: string;
  /** 去除 UTF-8 BOM 后的正文内容，保留原始换行和空白。 */
  readonly content: string;
  /** 原始文件字节数（不含任何截断），不表示 JavaScript 字符串长度。 */
  readonly byteLength: number;
  /**
   * 原始完整字节的 SHA-256 十六进制值（64 个小写十六进制字符）。
   * 保存时必须原样回传作为 `expectedRevision`；不一致表示磁盘内容已被外部修改。
   */
  readonly revision: string;
  /** 原始字节是否以 UTF-8 BOM（EF BB BF）开头；保存时按该策略保留 BOM。 */
  readonly hasUtf8Bom: boolean;
  /** 正文换行类型；mixed 在保存前需要用户确认规范化规则。 */
  readonly lineEnding: LineEnding;
}

/** 稳定读取错误码，供界面分支处理；消息仅供用户理解。 */
export type TextDocumentErrorCode =
  | 'NO_WORKSPACE'
  | 'INVALID_PATH'
  | 'OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_TYPE'
  | 'NOT_FILE'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'TOO_LARGE'
  | 'INVALID_UTF8'
  | 'READ_FAILED';

/** 可序列化的文档读取错误，已剥离原始异常、调用栈和正文。 */
export interface TextDocumentError {
  readonly code: TextDocumentErrorCode;
  readonly message: string;
}

/** 读取文档的结果 —— discriminated union。 */
export type ReadTextDocumentResult =
  | { readonly status: 'loaded'; readonly document: TextDocumentSnapshot }
  | { readonly status: 'error'; readonly error: TextDocumentError };

/** 保存 TXT 的请求 —— 渲染进程只能提供相对路径、正文、预期版本和换行规范化确认。 */
export interface SaveTextDocumentRequest {
  /** 经过验证的规范工作区相对路径，使用 `/` 分隔；主进程仍会重新完成全部校验。 */
  readonly relativePath: string;
  /** 编辑器当前完整正文；主进程按文件原 BOM 与换行规则编码为 UTF-8 字节。 */
  readonly content: string;
  /** 上次成功读取或保存返回的 `revision`；与当前磁盘版本不一致返回 `CONFLICT`。 */
  readonly expectedRevision: string;
  /** 仅当正文为混合换行且用户明确确认规范化时传 true，否则返回确认错误。 */
  readonly confirmMixedLineEndingNormalization?: true;
}

/** 稳定保存错误码，供界面分支处理；消息仅供用户理解。 */
export type SaveTextDocumentErrorCode =
  | 'NO_WORKSPACE'
  | 'INVALID_REQUEST'
  | 'INVALID_PATH'
  | 'OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_TYPE'
  | 'NOT_FILE'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'TOO_LARGE'
  | 'CONFLICT'
  | 'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED'
  | 'WRITE_FAILED';

/** 可序列化的文档保存错误，已剥离原始异常、调用栈、正文与临时文件名。 */
export interface SaveTextDocumentError {
  readonly code: SaveTextDocumentErrorCode;
  readonly message: string;
}

/** 保存 TXT 的结果 —— discriminated union。 */
export type SaveTextDocumentResult =
  | { readonly status: 'saved'; readonly document: TextDocumentSnapshot }
  | { readonly status: 'error'; readonly error: SaveTextDocumentError };

/**
 * 单文件最大允许读取字节数：5 MiB。
 * 超过上限返回明确错误，不截断读取，也不把部分正文传给渲染进程。
 * 该上限用于保护主进程、IPC 和渲染进程内存。
 */
export const MAX_TXT_FILE_BYTES = 5 * 1024 * 1024;
