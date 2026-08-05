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
  };
  readonly document: {
    /** 只接受文件树快照中的规范工作区相对路径，主进程会重新完成全部校验。 */
    readonly readText: (relativePath: string) => Promise<ReadTextDocumentResult>;
    /**
     * 只接受一个结构化保存请求：相对路径、正文、预期版本与可选的换行规范化确认。
     * 主进程会拒绝多余字段（根路径、绝对目标、临时路径、编码、替换策略等）。
     */
    readonly saveText: (request: SaveTextDocumentRequest) => Promise<SaveTextDocumentResult>;
  };
  readonly window: DesktopWindowApi;
}
