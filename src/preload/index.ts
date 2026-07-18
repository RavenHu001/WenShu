import { contextBridge } from 'electron';
import type { DesktopApi } from '../shared/desktop-api';

const desktopApi: DesktopApi = Object.freeze({
  runtime: Object.freeze({
    platform: process.platform,
    electronVersion: process.versions.electron,
  }),
});

// 只暴露可序列化的只读数据，不传递 ipcRenderer、Node 对象或通用调用器。
contextBridge.exposeInMainWorld('desktop', desktopApi);
