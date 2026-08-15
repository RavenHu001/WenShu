import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api';
import type { SaveTextDocumentRequest } from '../shared/document';
import type { SaveDocxDocumentRequest } from '../shared/docx';
import type {
  WorkspaceTextSearchCancelRequest,
  WorkspaceTextSearchRequest,
} from '../shared/search';

const desktopApi: DesktopApi = Object.freeze({
  runtime: Object.freeze({
    platform: process.platform,
    electronVersion: process.versions.electron,
  }),
  // preload 只开放固定的 IPC 调用，不暴露 ipcRenderer、通用 invoke 或可指定通道的接口。
  // 渲染进程无法向主进程传入路径参数 —— open 使用原生目录选择器，refresh 只操作已有工作区。
  workspace: Object.freeze({
    open: () => ipcRenderer.invoke('workspace:open'),
    refresh: () => ipcRenderer.invoke('workspace:refresh'),
  }),
  // document.readText 只映射固定的 document:read-text 通道，且只接受一个相对路径参数；
  // document.saveText 只映射固定的 document:save-text 通道，且只接受一个结构化保存请求；
  // document.readDocx / document.saveDocx 同理只映射 document:read-docx / document:save-docx；
  // 调用方无法指定通道、根路径、绝对目标、临时路径、编码、大小上限或写入策略。
  document: Object.freeze({
    readText: (relativePath: string) => ipcRenderer.invoke('document:read-text', relativePath),
    saveText: (request: SaveTextDocumentRequest) =>
      ipcRenderer.invoke('document:save-text', request),
    readDocx: (relativePath: string) => ipcRenderer.invoke('document:read-docx', relativePath),
    saveDocx: (request: SaveDocxDocumentRequest) =>
      ipcRenderer.invoke('document:save-docx', request),
  }),
  // search 命名空间只映射固定的两个搜索通道，不接受根路径、绝对路径或任意通道：
  // 请求与取消都经过主进程运行时校验，取消只能引用当前窗口已知的 requestId；
  // 搜索覆盖磁盘上已保存的 TXT 与 DOCX 规范正文（主进程按 kind 分派受控读取）。
  search: Object.freeze({
    textWorkspace: (request: WorkspaceTextSearchRequest) =>
      ipcRenderer.invoke('search:text-workspace', request),
    cancelTextWorkspace: (request: WorkspaceTextSearchCancelRequest) =>
      ipcRenderer.invoke('search:cancel-text-workspace', request),
  }),
  // window 命名空间只提供窗口关闭协调的最小窄协议：
  // 固定通道 + 固定参数形状，不暴露 ipcRenderer、通用事件总线或任意 send/on。
  window: Object.freeze({
    setDirtyState: (dirty: boolean) => ipcRenderer.invoke('window:dirty-changed', dirty),
    requestClose: () => ipcRenderer.invoke('window:close-allowed'),
    cancelClose: () => ipcRenderer.invoke('window:close-cancelled'),
    onCloseRequested: (callback: () => void) => {
      const listener = (): void => callback();
      ipcRenderer.on('window:close-requested', listener);
      return () => {
        ipcRenderer.removeListener('window:close-requested', listener);
      };
    },
  }),
});

// 只暴露可序列化的只读数据，不传递 ipcRenderer、Node 对象或通用调用器。
contextBridge.exposeInMainWorld('desktop', desktopApi);
