/**
 * 文件管理固定 IPC（TASK-009 WP3，§6.5）—— 注册 `workspace:create-entry` 与
 * `workspace:reveal` 两个固定通道。
 *
 * ## 安全约束
 *
 * - 请求先做共享契约精确形状校验（拒绝根/绝对路径、多余字段、危险开关）→ INVALID_REQUEST；
 * - 工作区根只来自主进程 `workspace-session`（renderer 不能提交根/绝对路径）；
 * - 处理器绑定发送窗口（`event.sender.id`）：同一窗口写操作经 mutation coordinator
 *   串行，同一时刻最多一个在途写操作；
 * - create 统一通道 + kind 判别；preload 的 createText/createDocx/createDirectory 各自
 *   固定注入 kind，renderer 不能选择类型；
 * - reveal 只调用固定 showItemInFolder（服务层），不暴露任意 shell；
 * - 跨进程结果只含稳定 code/message 与规范相对路径，不含绝对路径/临时名/句柄。
 */

import { BrowserWindow, ipcMain } from 'electron';
import { fileManagementError, type FileManagementError } from '../../shared/file-management';
import { getCurrentWorkspaceRoot } from './workspace-session';
import { createWorkspaceEntry } from './create-workspace-entry';
import { revealWorkspaceEntry } from './reveal-workspace-entry';
import { createMutationCoordinator } from './mutation-coordinator';

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

/** 按窗口串行文件管理写操作（同一窗口同一时刻最多一个写操作，§4.4）。 */
const mutationQueue = createMutationCoordinator();

const CREATE_ALLOWED_KEYS = ['kind', 'mutationId', 'name', 'parentRelativePath'];

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * 请求形状校验（IPC 层只校验形状/类型/危险字段 → INVALID_REQUEST；
 * 名称与父路径语义错误由服务层细分返回 INVALID_NAME/INVALID_PATH）。
 */
function validateCreateRequest(
  request: unknown,
): { ok: true; request: unknown } | { ok: false; error: FileManagementError } {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = request as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CREATE_ALLOWED_KEYS.includes(key))) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    !isPositiveInteger(record.mutationId) ||
    (record.kind !== 'text' && record.kind !== 'docx' && record.kind !== 'directory')
  ) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  return { ok: true, request };
}

function validateRevealRequest(
  request: unknown,
): { ok: true; request: unknown } | { ok: false; error: FileManagementError } {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = request as Record<string, unknown>;
  if (record.revealRoot === true) {
    return Object.keys(record).every((key) => key === 'revealRoot')
      ? { ok: true, request }
      : { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (
    record.revealRoot === false &&
    typeof record.relativePath === 'string' &&
    Object.keys(record).every((key) => key === 'revealRoot' || key === 'relativePath')
  ) {
    return { ok: true, request };
  }
  return { ok: false, error: fileManagementError('INVALID_REQUEST') };
}

/** 注册文件管理 IPC。应在 app.whenReady 回调中调用。 */
export function registerFileManagementIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle('workspace:create-entry', async (event, request: unknown) => {
    const validated = validateCreateRequest(request);
    if (!validated.ok) {
      return { status: 'error', mutationId: 0, error: validated.error };
    }
    const req = validated.request as {
      readonly mutationId: number;
      readonly kind: 'text' | 'docx' | 'directory';
      readonly parentRelativePath: string;
      readonly name: string;
    };
    const root = getCurrentWorkspaceRoot();
    if (root === null) {
      return {
        status: 'error',
        mutationId: req.mutationId,
        error: fileManagementError('NO_WORKSPACE'),
      };
    }
    const windowId = BrowserWindow.fromWebContents(event.sender)?.webContents.id ?? event.sender.id;
    // 同一窗口串行：同一时刻最多一个文件管理写操作
    return mutationQueue.run(windowId, () => createWorkspaceEntry(root, req));
  });

  ipcMain.handle('workspace:reveal', async (_event, request: unknown) => {
    const validated = validateRevealRequest(request);
    if (!validated.ok) {
      return { status: 'error', error: validated.error };
    }
    const root = getCurrentWorkspaceRoot();
    if (root === null) {
      return { status: 'error', error: fileManagementError('NO_WORKSPACE') };
    }
    // reveal 不写盘：不进入 mutation 队列，不递增 mutationEpoch
    return revealWorkspaceEntry(root, validated.request);
  });
}
