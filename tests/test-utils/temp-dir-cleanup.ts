/**
 * 测试临时目录清理 helper —— TASK-008 WP0 基线可靠性修复。
 *
 * ## 背景与归因
 *
 * 2026-08-15 在 Windows 11 全量并行测试中复现：`fs.rm(dir, { recursive: true, force: true })`
 * 递归删除**包含 junction 的临时目录**时，`rmdir` 对刚创建的 junction 抛出
 * `EBUSY: resource busy or locked`（偶发，仅在多 fork 并行加载时出现；单文件运行不出现）。
 * 该瞬时锁来自 Windows 杀毒/索引组件对新 junction 的短暂扫描，与本机权限无关
 * （junction 创建本身成功，删除阶段短暂失败）。TASK-007 第 3.2 节门禁要求
 * "Windows 临时 junction 清理不得因 EBUSY 使整个读取测试文件跳过"。
 *
 * ## 修复策略：有界重试，不掩盖真实失败
 *
 * - 只对 `EBUSY` / `EPERM` 两个瞬时错误码重试（最多 `attempts` 次，固定短延时）；
 * - 其他错误码立即抛出；重试耗尽后抛出原始错误，不吞掉真实失败；
 * - 与 `fs.rm(recursive, force)` 语义一致：目录不存在时安全无操作。
 */

import { rm } from 'node:fs/promises';

export interface RemoveDirWithRetryOptions {
  /** 最大尝试次数（含首次），默认 5。 */
  readonly attempts?: number;
  /** 失败重试间隔毫秒，默认 200。 */
  readonly delayMs?: number;
}

/** 瞬时错误码：junction 被系统组件短暂锁定时 rm/rmdir 会抛出这两类错误。 */
function isTransientCleanupError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'EBUSY' || code === 'EPERM';
}

/** 递归删除目录；遇到瞬时 EBUSY/EPERM 时做有界重试，其他错误立即抛出。 */
export async function removeDirWithRetry(
  path: string,
  options: RemoveDirWithRetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 200;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!isTransientCleanupError(err)) {
        throw err;
      }
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
