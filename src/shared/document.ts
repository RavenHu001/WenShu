/**
 * 文档数据契约 —— 纯 TypeScript 类型和常量，不依赖 Electron、Node.js、React 或浏览器运行时。
 *
 * 设计约束：
 * 1. 所有接口字段均为 `readonly`，保证跨进程通过 Electron structured clone 安全传递。
 * 2. 不包含 `Error`、`Buffer`、`Uint8Array`、文件句柄、`Stats`、函数或类实例。
 * 3. `name` 由主进程从最终文件路径取得，不信任渲染进程提供的名称。
 * 4. `relativePath` 是经过主进程验证的规范工作区相对路径，使用 `/` 分隔。
 * 5. `byteLength` 表示原始文件字节数，不表示 JavaScript 字符串长度。
 * 6. 错误消息不含文件正文、调用栈或不必要的系统内部信息；
 *    错误码供界面稳定分支，消息供用户理解，不应依赖字符串匹配控制逻辑。
 */

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
}

/** 稳定错误码，供界面分支处理；消息仅供用户理解。 */
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

/**
 * 单文件最大允许读取字节数：5 MiB。
 * 超过上限返回明确错误，不截断读取，也不把部分正文传给渲染进程。
 * 该上限用于保护主进程、IPC 和渲染进程内存。
 */
export const MAX_TXT_FILE_BYTES = 5 * 1024 * 1024;
