/**
 * 允许从 preload 复制到渲染进程的只读运行环境快照。
 * 此文件只包含数据契约，不依赖 Electron 或 Node.js 运行时。
 */
export interface DesktopRuntimeInfo {
  readonly platform: string;
  readonly electronVersion: string;
}

/** 渲染进程能够使用的完整桌面 API；后续能力应按具体用例逐项添加。 */
export interface DesktopApi {
  readonly runtime: DesktopRuntimeInfo;
}
