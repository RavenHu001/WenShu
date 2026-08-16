/**
 * 文件管理共享契约 —— 纯 TypeScript 类型、常量、稳定错误与运行时校验（TASK-009 §5.1 / §6.1）。
 *
 * 设计约束（与项目其他共享契约一致）：
 * 1. 不依赖 Electron、Node.js、React 或浏览器 API；可被主进程与 renderer 双向使用；
 * 2. 所有字段 readonly、值可 structured clone；不包含 Error/Stats/句柄/函数/类实例；
 * 3. 请求形状精确：运行时校验拒绝多余字段、错误类型与未知判别值（§4.2）；
 * 4. `parentRelativePath` 根目录为 `''`，非根父目录为 `/` 分隔的规范相对路径；
 *    `name` 只允许单个 Windows 叶名称（§4.3 / WP0 冻结）；
 * 5. 本模块只做词法与形状校验，文件系统权威判断（lstat/realpath/存在性/大小写）在
 *    主进程解析器（resolve-workspace-entry.ts）完成。
 */

import type { DocxDocumentModel, DocxDocumentSnapshot } from './docx';
import { validateDocxDocumentModel } from './docx';
import type { TextDocumentSnapshot } from './document';

/* ======================= 条目与目标 ======================= */

/** 文件管理条目类型（§5.1；'text'/'docx' 为可编辑文档，'directory' 为普通目录，'file' 为其他普通文件）。 */
export type ManagedEntryKind = 'text' | 'docx' | 'directory' | 'file';

/** 工作区内目标：根父目录为 `''`，`name` 为单个叶名称（§4.3）。 */
export interface WorkspaceTargetName {
  readonly parentRelativePath: string;
  readonly name: string;
}

/* ======================= 固定请求形状（§4.2 / §7.1） ======================= */

/** 新建 TXT / DOCX / 文件夹请求。 */
export interface CreateWorkspaceEntryRequest extends WorkspaceTargetName {
  readonly mutationId: number;
  readonly kind: 'text' | 'docx' | 'directory';
}

/**
 * 不含 kind 的创建目标：preload 的 createText/createDocx/createDirectory 各自固定注入
 * kind，renderer 不能通过方法名选择其他类型（§4.2 固定能力集合）。
 */
export type CreateWorkspaceEntryTarget = Omit<CreateWorkspaceEntryRequest, 'kind'>;

/** 重命名/移动请求（统一 relocate 语义，§4.8）。 */
export interface RelocateWorkspaceEntryRequest extends WorkspaceTargetName {
  readonly mutationId: number;
  /** 源规范相对路径（不能是工作区根、link、other 或内部文件）。 */
  readonly sourceRelativePath: string;
}

/** 删除到回收站请求（§4.9）。 */
export interface TrashWorkspaceEntryRequest {
  readonly mutationId: number;
  /** 源规范相对路径（不能是工作区根、link、other 或内部文件）。 */
  readonly relativePath: string;
}

/** 在资源管理器中显示请求（§4.10）：根目录用显式判别值，条目用规范相对路径。 */
export type RevealWorkspaceEntryRequest =
  { readonly revealRoot: true } | { readonly revealRoot: false; readonly relativePath: string };

/** TXT 另存为请求（WP4 使用；两阶段覆盖确认携带 expectedTargetRevision）。 */
export interface SaveTextDocumentAsRequest {
  readonly mutationId: number;
  /** 目标标签的稳定 tabId（WP1；仅作 renderer 身份，主进程不信任）。 */
  readonly tabId: string;
  /** 源规范相对路径（源文件保持不变，只读校验 revision 与 BOM/换行策略）。 */
  readonly sourceRelativePath: string;
  readonly target: WorkspaceTargetName;
  /** 编辑器当前最新正文（复用 TXT 保存的 BOM/换行语义）。 */
  readonly content: string;
  /** 源文档基线 revision（源文件冲突检测）。 */
  readonly expectedSourceRevision: string;
  /** 覆盖确认第二阶段：目标 revision CAS（§4.7）。 */
  readonly expectedTargetRevision?: string;
  readonly confirmMixedLineEndingNormalization?: true;
}

/** DOCX 另存为请求（WP4 使用）。 */
export interface SaveDocxDocumentAsRequest {
  readonly mutationId: number;
  readonly tabId: string;
  /** 源规范相对路径（源文件保持不变，只读校验 revision 与兼容性）。 */
  readonly sourceRelativePath: string;
  readonly target: WorkspaceTargetName;
  readonly model: DocxDocumentModel;
  readonly expectedSourceRevision: string;
  readonly expectedTargetRevision?: string;
  /** degraded 确认绑定源基线 revision；另存为不能绕过（§4.7）。 */
  readonly compatibilityConfirmationRevision?: string;
}

/* ======================= 稳定错误（§5.2 / WP0 冻结） ======================= */

export const FILE_MANAGEMENT_ERROR_CODES = [
  'NO_WORKSPACE',
  'INVALID_REQUEST',
  'INVALID_PATH',
  'INVALID_NAME',
  'OUTSIDE_WORKSPACE',
  'NOT_FOUND',
  'NOT_FILE',
  'NOT_DIRECTORY',
  'LINK_NOT_ALLOWED',
  'ROOT_OPERATION_NOT_ALLOWED',
  'TARGET_EXISTS',
  'TARGET_CHANGED',
  'CONFLICT',
  'TARGET_OPEN',
  'DIRECTORY_INTO_DESCENDANT',
  'TYPE_CHANGE_NOT_ALLOWED',
  'COMPATIBILITY_CONFIRMATION_REQUIRED',
  'BACKUP_FAILED',
  'VERIFICATION_FAILED',
  'ACCESS_DENIED',
  'WRITE_FAILED',
  'TRASH_FAILED',
  'REVEAL_FAILED',
  'PARTIAL_FAILURE',
  'INTERNAL_NAME_NOT_ALLOWED',
  'EXPORT_FAILED',
  'FS_FAILED',
  'MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED',
  'TOO_LARGE',
  'READ_ONLY_DOCUMENT',
  'CROSS_DEVICE_NOT_ALLOWED',
] as const;

export type FileManagementErrorCode = (typeof FILE_MANAGEMENT_ERROR_CODES)[number];

/** 可序列化的稳定错误：不含原始异常、绝对路径、临时名或调用栈。 */
export interface FileManagementError {
  readonly code: FileManagementErrorCode;
  readonly message: string;
}

/** 稳定产品文案：相同原因在 create/save-as/relocate/trash/reveal 中复用同一 code/message。 */
export const FILE_MANAGEMENT_ERROR_MESSAGES: Record<FileManagementErrorCode, string> = {
  NO_WORKSPACE: '尚未打开工作区',
  INVALID_REQUEST: '无效的请求',
  INVALID_PATH: '无效的相对路径',
  INVALID_NAME: '文件名无效',
  OUTSIDE_WORKSPACE: '目标不在工作区内',
  NOT_FOUND: '条目不存在或已被移除',
  NOT_FILE: '目标不是普通文件',
  NOT_DIRECTORY: '目标不是目录',
  LINK_NOT_ALLOWED: '路径包含符号链接或 junction',
  ROOT_OPERATION_NOT_ALLOWED: '不允许对工作区根执行该操作',
  TARGET_EXISTS: '目标已存在，不覆盖',
  TARGET_CHANGED: '目标已变化，请重新确认',
  CONFLICT: '文件已被外部修改',
  TARGET_OPEN: '目标已被另一个标签打开',
  DIRECTORY_INTO_DESCENDANT: '目录不能移动到自身或后代',
  TYPE_CHANGE_NOT_ALLOWED: '不允许改变文件类型',
  COMPATIBILITY_CONFIRMATION_REQUIRED: '文档包含不受支持的内容，需要确认后保存',
  BACKUP_FAILED: '备份失败，目标未修改',
  VERIFICATION_FAILED: '产物验证失败',
  ACCESS_DENIED: '没有访问权限',
  WRITE_FAILED: '写入失败',
  TRASH_FAILED: '删除到回收站失败',
  REVEAL_FAILED: '无法在资源管理器中显示',
  PARTIAL_FAILURE: '操作部分完成，请刷新后重试',
  INTERNAL_NAME_NOT_ALLOWED: '内部恢复/临时文件不允许作为管理目标',
  EXPORT_FAILED: '文档生成失败',
  FS_FAILED: '文件系统操作失败',
  MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED: '文件包含混合换行，需要确认规范化规则',
  TOO_LARGE: '文件超过大小上限',
  READ_ONLY_DOCUMENT: '文档为只读，不允许另存为',
  CROSS_DEVICE_NOT_ALLOWED: '不支持跨卷移动',
};

/** 构造稳定错误（仅纯数据，可 structured clone）。 */
export function fileManagementError(code: FileManagementErrorCode): FileManagementError {
  return { code, message: FILE_MANAGEMENT_ERROR_MESSAGES[code] };
}

/* ======================= Windows 叶名称校验（§4.3 / WP0 冻结） ======================= */

/** Windows 非法字符（不含控制字符，控制字符单独按码位检查以通过 no-control-regex）。 */
const WINDOWS_ILLEGAL_LEAF_NAME_CHARS = /[<>:"/\\|?*]/;

/** 是否包含控制字符（码位 < 0x20，含 NUL、tab、换行等）。 */
function containsControlCharacter(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    if (name.charCodeAt(index) < 0x20) {
      return true;
    }
  }
  return false;
}

/** Windows 保留设备名（大小写不敏感，含带扩展名形式，§4.3 / WP0 实测）。 */
const WINDOWS_RESERVED_DEVICE_NAMES = new Set<string>([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** Windows 单路径段长度上限（UTF-16 code unit）。 */
export const WINDOWS_MAX_LEAF_NAME_LENGTH = 255;

/**
 * Windows 叶名称校验（WP0 冻结）：
 * - 非空、不是 `.`/`..`、无 `/`/`\\`/NUL/控制字符/非法字符 `< > : " | ? *`；
 * - 拒绝尾随点/空格（Win32 互操作歧义，即使 Node \\\\?\ 可创建）；
 * - 拒绝不区分大小写的保留设备名 `CON/PRN/AUX/NUL/COM1-9/LPT1-9`（含扩展名形式）；
 * - 拒绝超过 255 个 code unit 的名称；
 * - 不静默裁剪、替换或 Unicode 归一化。
 */
export function validateWindowsLeafName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0) {
    return false;
  }
  if (name === '.' || name === '..') {
    return false;
  }
  if (name.length > WINDOWS_MAX_LEAF_NAME_LENGTH) {
    return false;
  }
  if (WINDOWS_ILLEGAL_LEAF_NAME_CHARS.test(name) || containsControlCharacter(name)) {
    return false;
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return false;
  }
  const baseName = name.split('.')[0]!.toUpperCase();
  if (WINDOWS_RESERVED_DEVICE_NAMES.has(baseName)) {
    return false;
  }
  return true;
}

/* ======================= 相对路径词法校验（'/'-分隔，根父目录为 ''） ======================= */

/**
 * 校验 `/` 分隔的规范工作区相对路径（不含叶）：非空、不以 `/` 开头、
 * 无反斜杠/NUL/冒号（盘符/ADS/UNC）、无空段/`.`/`..`。
 * 与主进程 path-validation.validateRelativePath 语义一致（纯实现，无 node:path 依赖）。
 */
export function validateWorkspaceRelativePath(relativePath: unknown): relativePath is string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return false;
  }
  if (
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.includes(':')
  ) {
    return false;
  }
  const segments = relativePath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** 工作区内目标校验（§4.3）：根父目录 `''` 或规范相对路径 + 单个合法叶名称。 */
export function validateWorkspaceTargetName(value: unknown): value is WorkspaceTargetName {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.parentRelativePath !== 'string' || typeof record.name !== 'string') {
    return false;
  }
  if (
    record.parentRelativePath !== '' &&
    !validateWorkspaceRelativePath(record.parentRelativePath)
  ) {
    return false;
  }
  return validateWindowsLeafName(record.name);
}

/* ======================= 精确形状运行时校验（拒绝多余字段，§4.2 / §5.1） ======================= */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 精确形状检查：只允许 `allowed` 中的字段（多余字段一律拒绝）；可选字段允许缺席，
 * 必填字段的在场由各校验器显式检查。
 */
function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateCreateWorkspaceEntryRequest(
  value: unknown,
): value is CreateWorkspaceEntryRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['mutationId', 'kind', 'name', 'parentRelativePath'])
  ) {
    return false;
  }
  return (
    isPositiveInteger(value.mutationId) &&
    (value.kind === 'text' || value.kind === 'docx' || value.kind === 'directory') &&
    validateWorkspaceTargetName(value)
  );
}

export function validateRelocateWorkspaceEntryRequest(
  value: unknown,
): value is RelocateWorkspaceEntryRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['mutationId', 'name', 'parentRelativePath', 'sourceRelativePath'])
  ) {
    return false;
  }
  return (
    isPositiveInteger(value.mutationId) &&
    validateWorkspaceTargetName(value) &&
    validateWorkspaceRelativePath(value.sourceRelativePath)
  );
}

export function validateTrashWorkspaceEntryRequest(
  value: unknown,
): value is TrashWorkspaceEntryRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['mutationId', 'relativePath'])) {
    return false;
  }
  return isPositiveInteger(value.mutationId) && validateWorkspaceRelativePath(value.relativePath);
}

export function validateRevealWorkspaceEntryRequest(
  value: unknown,
): value is RevealWorkspaceEntryRequest {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (value.revealRoot === true) {
    return hasExactKeys(value, ['revealRoot']);
  }
  if (value.revealRoot === false && hasExactKeys(value, ['relativePath', 'revealRoot'])) {
    return validateWorkspaceRelativePath(value.relativePath);
  }
  return false;
}

export function validateSaveTextDocumentAsRequest(
  value: unknown,
): value is SaveTextDocumentAsRequest {
  if (!isPlainRecord(value)) {
    return false;
  }
  const allowed = [
    'confirmMixedLineEndingNormalization',
    'content',
    'expectedSourceRevision',
    'expectedTargetRevision',
    'mutationId',
    'sourceRelativePath',
    'tabId',
    'target',
  ];
  if (!hasExactKeys(value, allowed)) {
    return false;
  }
  if (!isPositiveInteger(value.mutationId) || !isNonEmptyString(value.tabId)) {
    return false;
  }
  if (typeof value.content !== 'string' || !isNonEmptyString(value.expectedSourceRevision)) {
    return false;
  }
  if (!validateWorkspaceRelativePath(value.sourceRelativePath)) {
    return false;
  }
  if (!validateWorkspaceTargetName(value.target)) {
    return false;
  }
  if (
    value.expectedTargetRevision !== undefined &&
    !isNonEmptyString(value.expectedTargetRevision)
  ) {
    return false;
  }
  if (
    value.confirmMixedLineEndingNormalization !== undefined &&
    value.confirmMixedLineEndingNormalization !== true
  ) {
    return false;
  }
  return true;
}

export function validateSaveDocxDocumentAsRequest(
  value: unknown,
): value is SaveDocxDocumentAsRequest {
  if (!isPlainRecord(value)) {
    return false;
  }
  const allowed = [
    'compatibilityConfirmationRevision',
    'expectedSourceRevision',
    'expectedTargetRevision',
    'model',
    'mutationId',
    'sourceRelativePath',
    'tabId',
    'target',
  ];
  if (!hasExactKeys(value, allowed)) {
    return false;
  }
  if (!isPositiveInteger(value.mutationId) || !isNonEmptyString(value.tabId)) {
    return false;
  }
  if (!isNonEmptyString(value.expectedSourceRevision)) {
    return false;
  }
  if (!validateWorkspaceRelativePath(value.sourceRelativePath)) {
    return false;
  }
  if (!validateWorkspaceTargetName(value.target)) {
    return false;
  }
  if (validateDocxDocumentModel(value.model).length > 0) {
    return false;
  }
  if (
    value.expectedTargetRevision !== undefined &&
    !isNonEmptyString(value.expectedTargetRevision)
  ) {
    return false;
  }
  if (
    value.compatibilityConfirmationRevision !== undefined &&
    !isNonEmptyString(value.compatibilityConfirmationRevision)
  ) {
    return false;
  }
  return true;
}

/* ======================= 结果模型（§5.1，可 structured clone） ======================= */

/** 新建/重命名/移动/删除的通用结果（删除成功后由 renderer 按相对路径关闭受影响标签）。 */
export type WorkspaceMutationResult =
  | {
      readonly status: 'succeeded';
      readonly mutationId: number;
      /** 成功路径只返回规范相对路径，不返回绝对路径。 */
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
    }
  | {
      readonly status: 'succeeded-refresh-failed';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
      readonly error: FileManagementError;
    }
  | {
      readonly status: 'error';
      readonly mutationId: number;
      readonly error: FileManagementError;
    };

/** 在资源管理器中显示的结果。 */
export type RevealResult =
  | { readonly status: 'revealed' }
  | { readonly status: 'error'; readonly error: FileManagementError };

/** 另存为结果：两阶段覆盖确认（TARGET_EXISTS → expectedTargetRevision CAS → saved）。 */
export type SaveAsResult =
  | {
      readonly status: 'saved';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: 'text' | 'docx';
      /** 保存产物快照（含新 revision），供标签原地迁移（WP1 completeSaveAs）。 */
      readonly document: TextDocumentSnapshot | DocxDocumentSnapshot;
      readonly backupRelativePath?: string;
    }
  | {
      readonly status: 'target-exists';
      readonly mutationId: number;
      /** 受控目标 revision：renderer 确认覆盖后必须在第二阶段回传。 */
      readonly targetRevision: string;
    }
  | {
      readonly status: 'error';
      readonly mutationId: number;
      readonly error: FileManagementError;
    };

/* ======================= 路径纯函数（§4.8 / §6.2，文件系统仍为最终权威） ======================= */

/**
 * 段边界前缀判断：`ancestor === descendant` 或 `descendant` 以 `ancestor + '/'` 开头。
 * 用于"目录不能移动到自身或后代"（`a/b` 不误命中 `a/b2`）。
 */
export function isSameOrDescendantPath(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) {
    return true;
  }
  return descendant.startsWith(`${ancestor}/`);
}

/** Windows 大小写不敏感路径比较（仅用于同路径 no-op 与 case-only 检测；发布前仍以文件系统为准）。 */
export function pathsEqualInsensitive(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** 只改大小写 rename 检测：字符串不同但大小写折叠后相同。 */
export function isCaseOnlyRename(from: string, to: string): boolean {
  return from !== to && pathsEqualInsensitive(from, to);
}

/** 内部恢复/临时名称：`.wenshu.bak` 后缀或 `.wenshu-` 前缀（大小写不敏感，§4.1）。 */
export function isInternalWorkspaceName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.wenshu.bak') || lower.startsWith('.wenshu-');
}
