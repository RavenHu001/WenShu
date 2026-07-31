/**
 * 工作区数据契约 —— 纯 TypeScript 类型，不依赖 Electron、Node.js、React 或浏览器 API。
 *
 * 设计约束：
 * 1. 所有接口字段均为 `readonly`，保证跨进程通过 Electron structured clone 安全传递。
 * 2. 不包含 `Error`、`Dirent`、`Stats`、函数或类实例，避免序列化丢失信息。
 * 3. `relativePath` 仅为树节点标识符，不得用它触发新的文件系统读取。
 * 4. discriminated union 的 `status` 字段让调用方通过收窄类型安全处理取消、成功和错误分支。
 */

/**
 * 文件系统条目分类。
 * - `directory`：普通目录，扫描器会递归读取其子条目。
 * - `file`：普通文件，扫描器不读取内容。
 * - `symbolic-link`：符号链接 / Windows junction，扫描器只报告其存在，不跟随目标。
 * - `other`：无法归为以上三类的条目（如 socket、设备文件），以叶节点形式展示。
 */
export type WorkspaceEntryKind = 'directory' | 'file' | 'symbolic-link' | 'other';

/** 扫描过程中捕获的单个文件系统错误，已剥离 Node.js 原始对象引用。 */
export interface WorkspaceEntryError {
  /** POSIX 错误码，如 `'EACCES'`、`'ENOENT'`；缺失时表示错误源自非文件系统异常。 */
  readonly code?: string;
  /** 人类可读的错误描述。 */
  readonly message: string;
}

/** 工作区目录树中的一个节点。目录节点可嵌套 `children`；其他节点为叶节点。 */
export interface WorkspaceEntry {
  /** 文件 / 目录的基础名称，不含路径。 */
  readonly name: string;
  /** 相对于工作区根目录的路径，使用 `/` 分隔符，仅作为界面展示和 React key 使用。 */
  readonly relativePath: string;
  /** 条目类型，控制展开行为和图标展示。 */
  readonly kind: WorkspaceEntryKind;
  /** 仅目录节点具备此字段：子条目列表。成功读取的空目录为 `[]`。 */
  readonly children?: readonly WorkspaceEntry[];
  /** 目录节点在读取时发生错误时设置此字段，`children` 此时为 `[]`。 */
  readonly error?: WorkspaceEntryError;
}

/** 一次完整扫描产生的只读工作区快照。 */
export interface WorkspaceSnapshot {
  /** 文件夹名称，如 `"my-project"`。 */
  readonly rootName: string;
  /** 工作区在本地文件系统中的绝对路径。 */
  readonly rootPath: string;
  /** 排序后的顶层条目列表：目录在前，其他在后，同类按名称自然排序。 */
  readonly entries: readonly WorkspaceEntry[];
}

/**
 * 打开工作区操作的结果 —— discriminated union。
 *
 * - `selected`：用户选择了一个目录并且扫描成功。
 * - `cancelled`：用户在原生对话框点击了取消，不改变当前工作区状态。
 * - `error`：选择了目录但根目录扫描失败（权限不足、路径不存在等），保留原工作区。
 */
export type OpenWorkspaceResult =
  | { readonly status: 'selected'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };

/**
 * 刷新当前工作区的结果 —— discriminated union。
 *
 * - `refreshed`：重新扫描成功，返回新快照替换旧数据。
 * - `not-open`：当前无工作区（尚未打开任何文件夹），无需刷新。
 * - `error`：扫描失败，用户可重试或切换到其他工作区。
 */
export type RefreshWorkspaceResult =
  | { readonly status: 'refreshed'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'not-open' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };
