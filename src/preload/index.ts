import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api';
import type { SaveTextDocumentRequest } from '../shared/document';

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
  // 调用方无法指定通道、根路径、绝对目标、临时路径、编码、大小上限或写入策略。
  document: Object.freeze({
    readText: (relativePath: string) => ipcRenderer.invoke('document:read-text', relativePath),
    saveText: (request: SaveTextDocumentRequest) =>
      ipcRenderer.invoke('document:save-text', request),
  }),
});

// 只暴露可序列化的只读数据，不传递 ipcRenderer、Node 对象或通用调用器。
contextBridge.exposeInMainWorld('desktop', desktopApi);
