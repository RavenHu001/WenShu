/**
 * 文档 IPC 处理器 —— 注册唯一的固定通道 `document:read-text`。
 *
 * ## 安全约束
 *
 * - 只接受一个字符串相对路径参数；处理器入口验证参数数量与类型。
 * - 不接受工作区根路径、绝对路径、编码、大小限制或任意选项参数。
 * - 处理器开始时从工作区会话捕获当前工作区根路径，本次读取只使用该快照。
 * - 渲染进程传入的相对路径被视为不可信数据，由读取器完成全部校验。
 * - 不注册 `file:read`、`fs:*`、通用命令分发或动态通道代理。
 * - 所有预期与意外失败都转换为 `ReadTextDocumentResult`，不抛出异常。
 * - 保持注册幂等，避免重复注册处理器。
 */

import { ipcMain } from 'electron';
import { readTextDocument } from './read-text-document';
import { getCurrentWorkspaceRoot } from '../workspace/workspace-session';
import type { ReadTextDocumentResult } from '../../shared/document';

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

/** 注册文档相关的 IPC 通道。应在 app.whenReady 回调中调用。 */
export function registerDocumentIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle(
    'document:read-text',
    async (_event, ...args: unknown[]): Promise<ReadTextDocumentResult> => {
      // 入口验证：只接受恰好一个字符串参数
      if (args.length !== 1 || typeof args[0] !== 'string') {
        return {
          status: 'error',
          error: { code: 'INVALID_PATH', message: '无效的文件相对路径' },
        };
      }

      // 读取开始时捕获当前工作区根路径，本次读取只使用该快照
      const workspaceRoot = getCurrentWorkspaceRoot();
      if (workspaceRoot === null) {
        return {
          status: 'error',
          error: { code: 'NO_WORKSPACE', message: '尚未打开工作区' },
        };
      }

      return readTextDocument(workspaceRoot, args[0]);
    },
  );
}
