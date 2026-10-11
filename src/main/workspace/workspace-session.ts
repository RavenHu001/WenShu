/**
 * 工作区会话状态 —— 主进程内共享的单一状态来源。
 *
 * ## 职责
 *
 * - 获取当前工作区根路径；
 * - 在工作区成功打开并扫描后更新根路径；
 * - 保持失败或取消时不修改根路径。
 *
 * ## 边界
 *
 * - 只允许主进程代码访问（preload / 渲染进程无法导入本模块）。
 * - 不引入通用状态容器、持久化、最近工作区、多窗口会话或可由渲染进程
 *   直接修改的状态接口。
 * - 根来自原生目录选择器或主进程校验后的恢复记录，不接受 renderer 路径。
 */

/** 当前工作区根路径；null 表示尚未打开任何工作区。 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceIdentity } from '../../shared/app-state';
let currentWorkspaceRoot: string | null = null;
let identity: WorkspaceIdentity | null = null;
let openGeneration = 0;
export function getWorkspaceIdentity(): WorkspaceIdentity | null {
  return identity;
}
export function beginWorkspaceOpen(): number {
  return ++openGeneration;
}
export function isCurrentWorkspaceOpen(generation: number): boolean {
  return generation === openGeneration;
}

/** 获取当前工作区根路径；未打开工作区时返回 null。 */
export function getCurrentWorkspaceRoot(): string | null {
  return currentWorkspaceRoot;
}

/**
 * 更新当前工作区根路径。
 * 仅允许在工作区成功打开并扫描后调用；失败或取消时必须保持原值。
 */
export function setCurrentWorkspaceRoot(root: string): WorkspaceIdentity {
  currentWorkspaceRoot = root;
  identity = Object.freeze({ id: randomUUID(), rootPath: root });
  return identity;
}
