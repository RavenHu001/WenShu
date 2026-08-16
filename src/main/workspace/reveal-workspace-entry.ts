/**
 * 工作区"在资源管理器中显示"服务（TASK-009 WP3，§4.10）。
 *
 * - 只接受共享契约的 RevealWorkspaceEntryRequest（根判别值或规范相对路径）；
 * - 条目路径重新执行词法/逐段 lstat/realpath 边界校验（不跟随 symlink/junction），
 *   不存在/链接/越界返回稳定错误，不猜测最近路径；
 * - 校验通过后只调用固定的 shell.showItemInFolder（适配器注入，测试可 mock）；
 * - 不暴露 openPath/openExternal/任意 shell 参数；reveal 不写文件、不递增 mutationEpoch。
 */

import { isAbsolute } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { shell } from 'electron';
import {
  fileManagementError,
  type FileManagementError,
  type RevealResult,
  type RevealWorkspaceEntryRequest,
} from '../../shared/file-management';
import { validateRelativePath } from '../document/path-validation';
import {
  preflight,
  realpathBoundaryCheck,
  walkSegments,
  type WorkspaceEntryAdapters,
} from './resolve-workspace-entry';

/** reveal 适配器：路径校验（复用） + 固定 shell 显示调用。 */
export interface RevealWorkspaceEntryAdapters extends WorkspaceEntryAdapters {
  /** 固定资源管理器显示调用（生产为 shell.showItemInFolder，测试可注入 spy）。 */
  readonly showItemInFolder: (path: string) => void;
}

/** 生产默认适配器。 */
export const defaultRevealWorkspaceEntryAdapters: RevealWorkspaceEntryAdapters = Object.freeze({
  lstat: (path: string) => lstat(path),
  realpath: (path: string) => realpath(path),
  showItemInFolder: (path: string) => shell.showItemInFolder(path),
});

/** 请求形状校验（精确形状，拒绝多余字段）。 */
function validateRequest(
  request: unknown,
): { ok: true; request: RevealWorkspaceEntryRequest } | { ok: false; error: FileManagementError } {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  const record = request as Record<string, unknown>;
  if (record.revealRoot === true) {
    return Object.keys(record).every((key) => key === 'revealRoot')
      ? { ok: true, request: { revealRoot: true } }
      : { ok: false, error: fileManagementError('INVALID_REQUEST') };
  }
  if (record.revealRoot === false) {
    const allowed = ['relativePath', 'revealRoot'];
    if (Object.keys(record).every((key) => allowed.includes(key))) {
      if (typeof record.relativePath === 'string') {
        return { ok: true, request: { revealRoot: false, relativePath: record.relativePath } };
      }
    }
  }
  return { ok: false, error: fileManagementError('INVALID_REQUEST') };
}

/**
 * 在工作区边界内校验后调用固定 showItemInFolder。
 * 工作区根使用显式判别值（不经过逐段校验，根来自 workspace-session）；
 * 条目路径重新逐段校验（链接拒绝、类型不限普通文件/目录，缺失 → NOT_FOUND）。
 */
export async function revealWorkspaceEntry(
  workspaceRoot: string,
  request: unknown,
  adapters: RevealWorkspaceEntryAdapters = defaultRevealWorkspaceEntryAdapters,
): Promise<RevealResult> {
  const validated = validateRequest(request);
  if (!validated.ok) {
    return { status: 'error', error: validated.error };
  }
  const req = validated.request;
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return { status: 'error', error: fileManagementError('NO_WORKSPACE') };
  }
  if (req.revealRoot) {
    try {
      adapters.showItemInFolder(workspaceRoot);
      return { status: 'revealed' };
    } catch {
      return { status: 'error', error: fileManagementError('REVEAL_FAILED') };
    }
  }

  const segments = validateRelativePath(req.relativePath);
  if (segments === null) {
    return { status: 'error', error: fileManagementError('INVALID_PATH') };
  }
  const preflightError = preflight(workspaceRoot, segments);
  if (preflightError !== null) {
    return { status: 'error', error: preflightError };
  }
  const walked = await walkSegments(workspaceRoot, segments, 'any', adapters);
  if (walked.status === 'error') {
    return { status: 'error', error: walked.error };
  }
  const boundaryError = await realpathBoundaryCheck(workspaceRoot, walked.candidate, adapters);
  if (boundaryError !== null) {
    return { status: 'error', error: boundaryError };
  }
  try {
    adapters.showItemInFolder(walked.candidate);
  } catch {
    return { status: 'error', error: fileManagementError('REVEAL_FAILED') };
  }
  return { status: 'revealed' };
}
