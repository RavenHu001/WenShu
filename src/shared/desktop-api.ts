/**
 * 允许从 preload 复制到渲染进程的只读运行环境快照。
 * 此文件只包含数据契约，不依赖 Electron 或 Node.js 运行时。
 */
export interface DesktopRuntimeInfo {
  readonly platform: string;
  readonly electronVersion: string;
}

import type { OpenWorkspaceResult, RefreshWorkspaceResult } from './workspace';
import type {
  ReadTextDocumentResult,
  SaveTextDocumentRequest,
  SaveTextDocumentResult,
} from './document';
import type {
  ReadDocxDocumentResult,
  SaveDocxDocumentRequest,
  SaveDocxDocumentResult,
} from './docx';
import type {
  WorkspaceTextSearchCancelRequest,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from './search';
import type {
  CreateWorkspaceEntryTarget,
  RelocateWorkspaceEntryRequest,
  RevealWorkspaceEntryRequest,
  RevealResult,
  SaveAsResult,
  SaveDocxDocumentAsRequest,
  SaveTextDocumentAsRequest,
  TrashWorkspaceEntryRequest,
  WorkspaceMutationResult,
} from './file-management';

/** 窗口关闭协调命名空间：固定窄协议，不暴露 ipcRenderer 或通用事件总线。 */
export interface DesktopWindowApi {
  /** 上报当前文档是否存在未保存修改；只接受布尔值，映射固定通道。 */
  readonly setDirtyState: (dirty: boolean) => Promise<void>;
  /** 用户确认放弃未保存修改后调用：只允许本次窗口关闭继续。 */
  readonly requestClose: () => Promise<void>;
  /** 用户取消关闭后调用：复位主进程确认状态，后续关闭可再次询问。 */
  readonly cancelClose: () => Promise<void>;
  /** 订阅主进程的关闭询问；返回取消订阅函数。 */
  readonly onCloseRequested: (callback: () => void) => () => void;
}

/** 渲染进程能够使用的完整桌面 API；后续能力应按具体用例逐项添加。 */
export interface DesktopApi {
  readonly runtime: DesktopRuntimeInfo;
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
    /**
     * 排他新建空 UTF-8 TXT（TASK-009 WP3）：请求只含 mutationId、父目录与叶名称；
     * kind 由 preload 固定注入，renderer 不能选择其他类型。
     */
    readonly createText: (request: CreateWorkspaceEntryTarget) => Promise<WorkspaceMutationResult>;
    /** 排他新建基础 DOCX（空模型导出 + 验证后发布）。 */
    readonly createDocx: (request: CreateWorkspaceEntryTarget) => Promise<WorkspaceMutationResult>;
    /** 排他新建单级文件夹。 */
    readonly createDirectory: (
      request: CreateWorkspaceEntryTarget,
    ) => Promise<WorkspaceMutationResult>;
    /** 在资源管理器中显示工作区根或工作区内条目（固定 shell 能力）。 */
    readonly reveal: (request: RevealWorkspaceEntryRequest) => Promise<RevealResult>;
    /** 工作区内重命名/移动（含 case-only 两步与 DOCX 伴随备份迁移）。 */
    readonly relocate: (request: RelocateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    /** 删除到 Windows 回收站（含 DOCX 伴随备份；无永久删除降级）。 */
    readonly trash: (request: TrashWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
  };
  readonly document: {
    /** 只接受文件树快照中的规范工作区相对路径，主进程会重新完成全部校验。 */
    readonly readText: (relativePath: string) => Promise<ReadTextDocumentResult>;
    /**
     * 只接受一个结构化保存请求：相对路径、正文、预期版本与可选的换行规范化确认。
     * 主进程会拒绝多余字段（根路径、绝对目标、临时路径、编码、替换策略等）。
     */
    readonly saveText: (request: SaveTextDocumentRequest) => Promise<SaveTextDocumentResult>;
    /** 只接受文件树快照中的规范工作区相对路径，主进程会重新完成全部校验。 */
    readonly readDocx: (relativePath: string) => Promise<ReadDocxDocumentResult>;
    /**
     * 只接受一个结构化 DOCX 保存请求：相对路径、预期版本、模型与可选的兼容性确认
     * revision。主进程会拒绝多余字段（根路径、绝对目标、临时/备份路径、原始
     * HTML/XML、跳过备份、强制覆盖等危险参数）。
     */
    readonly saveDocx: (request: SaveDocxDocumentRequest) => Promise<SaveDocxDocumentResult>;
    /**
     * TXT 另存为（TASK-009 WP4）：两阶段覆盖确认（target-exists → expectedTargetRevision），
     * 源文件不变、目标安全发布；无 force/overwrite 布尔捷径。
     */
    readonly saveTextAs: (request: SaveTextDocumentAsRequest) => Promise<SaveAsResult>;
    /** DOCX 另存为：read-only 拒绝、degraded 确认绑定源 revision、覆盖前目标备份。 */
    readonly saveDocxAs: (request: SaveDocxDocumentAsRequest) => Promise<SaveAsResult>;
  };
  /**
   * 工作区搜索窄接口：固定开始与取消方法，不暴露 ipcRenderer、通用通道或事件总线。
   * 请求不得携带工作区根或绝对路径；取消只引用当前窗口已知的 requestId。
   * "Text" 表示各受支持文档的规范可搜索文本（TXT 剥离 BOM 后的 UTF-8 正文；
   * DOCX 为 `DocxDocumentModel` 的规范正文投影），不是只表示 `.txt` 扩展名。
   */
  readonly search: {
    /**
     * 对当前工作区磁盘上已保存的 TXT 与 DOCX 规范正文执行一次有界、可取消的搜索。
     * 结果文件分组携带 `kind`（`txt` / `docx`）；搜索只读，不写工作区、不建索引。
     */
    readonly textWorkspace: (
      request: WorkspaceTextSearchRequest,
    ) => Promise<WorkspaceTextSearchResult>;
    /** 取消指定 requestId 的活动搜索；未知或过期请求安全无操作。 */
    readonly cancelTextWorkspace: (request: WorkspaceTextSearchCancelRequest) => Promise<void>;
  };
  readonly window: DesktopWindowApi;
}
