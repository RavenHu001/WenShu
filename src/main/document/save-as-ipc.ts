/**
 * TXT / DOCX 另存为固定 IPC（TASK-009 WP4，§6.5）——
 * 注册 `document:save-text-as` 与 `document:save-docx-as` 两个固定通道。
 *
 * ## 安全约束
 *
 * - 请求先做形状校验（拒绝根/绝对路径、多余字段、force/overwrite 等危险开关）→
 *   INVALID_REQUEST；名称/父路径/模型语义错误由服务层细分；
 * - 工作区根只来自主进程 `workspace-session`；
 * - 另存为属于文件管理写操作：与 create 共用同一按窗口串行 mutation 队列（§4.4）；
 * - 两阶段覆盖确认由服务层强制：第一阶段只返回 target-exists + 目标 revision；
 *   第二阶段必须携带 expectedTargetRevision（发布前再次比较），无布尔捷径。
 */

import { ipcMain } from 'electron';
import {
  fileManagementError,
  type FileManagementError,
  type SaveAsResult,
} from '../../shared/file-management';
import { getCurrentWorkspaceRoot } from '../workspace/workspace-session';
import { sharedMutationQueue } from '../workspace/mutation-coordinator';
import { saveTextDocumentAs } from './save-text-document-as';
import { saveDocxDocumentAs } from '../docx/save-docx-document-as';

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

const TEXT_AS_ALLOWED_KEYS = [
  'confirmMixedLineEndingNormalization',
  'content',
  'expectedSourceRevision',
  'expectedTargetRevision',
  'mutationId',
  'sourceRelativePath',
  'tabId',
  'target',
];

const DOCX_AS_ALLOWED_KEYS = [
  'compatibilityConfirmationRevision',
  'expectedSourceRevision',
  'expectedTargetRevision',
  'model',
  'mutationId',
  'sourceRelativePath',
  'tabId',
  'target',
];

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 形状校验：只检查类型/字段集合/危险开关；名称与父路径交给服务细分。 */
function validateShape(
  request: unknown,
  allowed: readonly string[],
  docx: boolean,
): { ok: true } | { ok: false; error: FileManagementError } {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = request as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    !isPositiveInteger(record.mutationId) ||
    typeof record.tabId !== 'string' ||
    record.tabId.length === 0 ||
    typeof record.sourceRelativePath !== 'string' ||
    typeof record.target !== 'object' ||
    record.target === null ||
    Array.isArray(record.target)
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (!docx && typeof record.content !== 'string') {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    record.expectedTargetRevision !== undefined &&
    (typeof record.expectedTargetRevision !== 'string' ||
      record.expectedTargetRevision.length === 0)
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  return { ok: true };
}

/** 注册另存为 IPC 通道。应在 app.whenReady 回调中调用。 */
export function registerSaveAsIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle(
    'document:save-text-as',
    async (event, request: unknown): Promise<SaveAsResult> => {
      const shape = validateShape(request, TEXT_AS_ALLOWED_KEYS, false);
      if (!shape.ok) {
        return { status: 'error', mutationId: 0, error: shape.error };
      }
      const req = request as { readonly mutationId: number };
      const root = getCurrentWorkspaceRoot();
      if (root === null) {
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('NO_WORKSPACE'),
        };
      }
      const windowId = event.sender.id;
      return sharedMutationQueue.run(windowId, () => saveTextDocumentAs(root, request));
    },
  );

  ipcMain.handle(
    'document:save-docx-as',
    async (event, request: unknown): Promise<SaveAsResult> => {
      const shape = validateShape(request, DOCX_AS_ALLOWED_KEYS, true);
      if (!shape.ok) {
        return { status: 'error', mutationId: 0, error: shape.error };
      }
      const req = request as { readonly mutationId: number };
      const root = getCurrentWorkspaceRoot();
      if (root === null) {
        return {
          status: 'error',
          mutationId: req.mutationId,
          error: fileManagementError('NO_WORKSPACE'),
        };
      }
      const windowId = event.sender.id;
      return sharedMutationQueue.run(windowId, () => saveDocxDocumentAs(root, request));
    },
  );
}
