/**
 * 文档 IPC 处理器 —— 注册唯一的固定通道 `document:read-text` 与 `document:save-text`。
 *
 * ## 安全约束
 *
 * - `document:read-text` 只接受一个字符串相对路径参数；
 * - `document:save-text` 只接受一个结构化保存请求，入口验证参数数量、对象形状、
 *   必需字段类型，并拒绝任何多余字段（工作区根、绝对目标、临时路径、编码、
 *   写入策略等危险参数）；
 * - 不接受工作区根路径、绝对路径、临时文件名、编码、大小限制或任意选项参数；
 * - 处理器开始时从工作区会话捕获当前工作区根路径，本次操作只使用该快照；
 * - 渲染进程传入的数据被视为不可信输入，由读取器 / 保存器完成全部校验；
 * - 不注册 `file:read`、`file:write`、`fs:*`、通用命令分发或动态通道代理；
 * - 所有预期与意外失败都转换为稳定结果，不抛出异常；
 * - 保持注册幂等，避免重复注册处理器。
 */

import { ipcMain } from 'electron';
import { readTextDocument } from './read-text-document';
import { saveTextDocument } from './save-text-document';
import { getCurrentWorkspaceRoot } from '../workspace/workspace-session';
import type {
  ReadTextDocumentResult,
  SaveTextDocumentRequest,
  SaveTextDocumentResult,
} from '../../shared/document';

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

/** 保存请求允许出现的全部字段；出现任何其他字段都视为危险参数并拒绝。 */
const ALLOWED_SAVE_REQUEST_KEYS = new Set<string>([
  'relativePath',
  'content',
  'expectedRevision',
  'confirmMixedLineEndingNormalization',
]);

/**
 * 运行时校验保存请求形状：
 * - 必须是普通对象（非 null、非数组）；
 * - 只允许 `ALLOWED_SAVE_REQUEST_KEYS` 中的字段（拒绝 workspaceRoot、
 *   absolutePath、tempPath、encoding、strategy 等多余危险参数）；
 * - 必需字段 `relativePath` / `content` / `expectedRevision` 必须存在且类型正确；
 * - 可选字段 `confirmMixedLineEndingNormalization` 只允许为 `true`。
 */
function validateSaveTextRequest(value: unknown): value is SaveTextDocumentRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_SAVE_REQUEST_KEYS.has(key)) {
      return false;
    }
  }
  if (
    typeof record.relativePath !== 'string' ||
    typeof record.content !== 'string' ||
    typeof record.expectedRevision !== 'string' ||
    record.expectedRevision.length === 0
  ) {
    return false;
  }
  if (
    record.confirmMixedLineEndingNormalization !== undefined &&
    record.confirmMixedLineEndingNormalization !== true
  ) {
    return false;
  }
  return true;
}

function invalidRequest(): SaveTextDocumentResult {
  return { status: 'error', error: { code: 'INVALID_REQUEST', message: '无效的保存请求' } };
}

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

  ipcMain.handle(
    'document:save-text',
    async (_event, ...args: unknown[]): Promise<SaveTextDocumentResult> => {
      // 入口验证：只接受恰好一个结构化保存请求，拒绝多余危险字段
      if (args.length !== 1 || !validateSaveTextRequest(args[0])) {
        return invalidRequest();
      }

      // 保存开始时捕获当前工作区根路径，本次保存只使用该快照
      const workspaceRoot = getCurrentWorkspaceRoot();
      if (workspaceRoot === null) {
        return {
          status: 'error',
          error: { code: 'NO_WORKSPACE', message: '尚未打开工作区' },
        };
      }

      try {
        return await saveTextDocument(workspaceRoot, args[0]);
      } catch {
        // 保存器不抛出预期错误；这里兜底把意外失败转换为稳定错误
        return {
          status: 'error',
          error: { code: 'WRITE_FAILED', message: '写入文件失败' },
        };
      }
    },
  );
}
