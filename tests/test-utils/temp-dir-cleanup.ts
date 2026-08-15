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
 *
 * ## 2026-08-15 后续调整（TASK-008 WP3 期间的并行负载实测）
 *
 * 4 个含 junction 探测的测试文件在多 fork（maxForks 4）并行加载时，系统索引/杀毒组件
 * 对同时新建的多个 junction 的锁定窗口可超过 1 秒（串行运行与单文件运行均不出现，
 * 连续两次并行全量/多文件运行复现）。默认重试预算由 5×200ms 调整为 10×250ms（约 2.5s），
 * 仍为固定有界重试：只对瞬时错误码生效，重试耗尽仍抛出原始错误，不掩盖真实失败。
 */

import { rm } from 'node:fs/promises';

export interface RemoveDirWithRetryOptions {
  /** 最大尝试次数（含首次），默认 10。 */
  readonly attempts?: number;
  /** 失败重试间隔毫秒，默认 250。 */
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
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 250;
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
