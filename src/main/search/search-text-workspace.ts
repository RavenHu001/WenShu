/**
 * 工作区 TXT 安全搜索器 —— TASK-006 WP2（任务第 6.3 节）。
 *
 * 在主进程内异步遍历当前工作区，只对磁盘已保存的普通 UTF-8 TXT 执行受控读取与字面量匹配。
 * 不注册 IPC、不写文件、不建立索引，本模块可直接由 WP3 的固定搜索 IPC 调用。
 *
 * ## 安全边界（第 4.3 / 4.6 / 4.7 节与 WP0 冻结项 6-9）
 *
 * - 搜索根路径由调用方（主进程工作区会话）提供；请求对象不携带根或绝对路径；
 * - 遍历不跟随符号链接 / junction / 其他重解析点（`isSymbolicLink` 先于 `isDirectory` 判断，
 *   与 scan-workspace 的目录优先分类刻意不同）；
 * - 候选只取普通 `.txt`（扩展名大小写不敏感）；每个候选在读取时仍复用 `readTextDocument`
 *   重新执行相对路径、逐段 lstat、真实路径边界、普通文件、5 MiB、严格 UTF-8 与 revision 校验，
 *   不得因目录扫描已看到文件而跳过；
 * - 全程只读：不调用任何写入、创建、重命名、删除 API；
 * - 根目录不可读使本次搜索整体失败（稳定 `SEARCH_FAILED`，消息不含路径）；
 *   子目录与单文件错误隔离并计入 `skippedFiles`；
 * - 跨进程结果只包含稳定 code / 数量与可展示消息；不记录查询正文、命中正文、绝对路径或原始异常。
 *
 * ## 取消与工作区变化（第 4.6 节）
 *
 * - 协作式：`shouldStop` 回调在目录批次、每个条目、每次读取前后与匹配循环内检查；
 *   已开始的受控单文件读取可以完成，但其结果不再提交；
 * - 取消不是错误：返回 `cancelled`，绝不把部分结果标记为 completed；
 * - 工作区变化由调用方组合进 `shouldStop`（WP3 的任务管理器负责"新搜索取消旧搜索、
 *   工作区切换作废、窗口销毁清理"），本模块只负责按回调停止。
 *
 * ## 预算与确定性（第 4.5 节与 WP0 冻结项 5/9）
 *
 * - 候选 TXT 上限 1000：遍历中达到即截断，`truncatedReason = 'file-limit'`；
 * - 每个目录内按名称自然排序遍历，保证预算截断可确定复现；
 * - 候选按规范相对路径自然排序后以固定并发（默认 4）读取，读取完成顺序不影响最终排序；
 * - 单文件 200 与总匹配 2000 由 `match-text.ts` 的预算逻辑执行；
 *   截断原因优先级：`file-limit` > 匹配级原因。
 *
 * ## 可测试性：轻量适配器注入
 *
 * 与 `scan-workspace.ts` / `read-text-document.ts` 一致的函数参数注入：
 * `readDir`（目录读取）与 `readText`（候选读取）可注入 mock，确定性测试并发、取消与错误隔离；
 * 生产环境默认使用 `node:fs/promises` 与受控 `readTextDocument`，不引入 DI 容器。
 */

import { extname, isAbsolute, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  MAX_CANDIDATE_FILES,
  MAX_FILE_READ_CONCURRENCY,
  isValidSearchRequestId,
  validateWorkspaceTextSearchRequest,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchRequest,
  type WorkspaceTextSearchResult,
  type WorkspaceTextSearchStatistics,
} from '../../shared/search';
import { readTextDocument } from '../document/read-text-document';
import type { ReadTextDocumentResult } from '../../shared/document';
import type { DirEntry, ReadDirFn } from '../workspace/scan-workspace';
import {
  compareRelativePaths,
  groupMatchedFileResults,
  matchText,
  sortMatchedFileResults,
} from './match-text';

/** 搜索器选项；全部可选，生产环境使用默认适配器与冻结并发。 */
export interface SearchTextWorkspaceOptions {
  /**
   * 协作式停止回调：取消或工作区变化由调用方组合；返回 true 时搜索立即以 `cancelled` 结束。
   * 缺省为永不停止。
   */
  readonly shouldStop?: () => boolean;
  /** 目录读取适配器，默认 `node:fs/promises.readdir(..., { withFileTypes: true })`。 */
  readonly readDir?: ReadDirFn;
  /** 候选 TXT 读取适配器，默认复用受控 `readTextDocument`（完整校验 + revision）。 */
  readonly readText?: (
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<ReadTextDocumentResult>;
  /** 固定读取并发上限，默认 `MAX_FILE_READ_CONCURRENCY`（4）。 */
  readonly readConcurrency?: number;
}

const defaultReadDir: ReadDirFn = (path) =>
  readdir(path, { withFileTypes: true }) as Promise<readonly DirEntry[]>;

/** 与 `scan-workspace.ts` 一致的自然排序器：目录内条目按名称排序，预算截断可确定复现。 */
const entryNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 遍历结果：候选相对路径、跳过统计与候选上限截断标志。 */
interface TraversalOutcome {
  readonly candidates: readonly string[];
  readonly skippedDirectories: number;
  readonly fileLimitHit: boolean;
}

/**
 * 异步遍历工作区收集候选 TXT 相对路径（第 4.5 / 4.7 节）：
 * - 不跟随符号链接 / junction / 其他重解析点；
 * - 只把普通 `.txt` 文件作为候选，扩展名比较大小写不敏感；
 * - 子目录读取失败隔离并计入跳过；根目录读取失败抛出（调用方映射为整体失败）；
 * - 候选达到 1000 上限后立即停止遍历并标记截断；
 * - 在目录批次与每个条目处检查 `shouldStop`。
 */
async function collectCandidates(
  workspaceRoot: string,
  readDirFn: ReadDirFn,
  shouldStop: () => boolean,
): Promise<TraversalOutcome> {
  const candidates: string[] = [];
  let skippedDirectories = 0;
  let fileLimitHit = false;

  const walk = async (dir: string, relative: string): Promise<void> => {
    if (fileLimitHit || shouldStop()) {
      return;
    }
    let entries: readonly DirEntry[];
    try {
      entries = await readDirFn(dir);
    } catch (err) {
      if (relative === '') {
        // 根目录不可读：整体失败（异常向上传播，消息不跨进程）
        throw err;
      }
      // 子目录错误隔离：计入跳过，同级其他条目不受影响
      skippedDirectories += 1;
      return;
    }
    const sorted = [...entries].sort((a, b) => entryNameCollator.compare(a.name, b.name));
    for (const entry of sorted) {
      if (fileLimitHit || shouldStop()) {
        return;
      }
      // 符号链接 / junction 先于目录判断：无论链接指向目录还是文件都不跟随、不计数
      if (entry.isSymbolicLink()) {
        continue;
      }
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relativePath);
        continue;
      }
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.txt') {
        candidates.push(relativePath);
        if (candidates.length >= MAX_CANDIDATE_FILES) {
          fileLimitHit = true;
          return;
        }
      }
      // 其他文件类型与叶节点：政策性跳过，不计入 skippedFiles
    }
  };

  await walk(workspaceRoot, '');
  return { candidates, skippedDirectories, fileLimitHit };
}

/**
 * 以固定并发上限处理条目：任一时刻在途 worker 不超过 `limit`。
 * worker 内自行完成取消检查与结果提交；空列表或非法 limit 安全无操作。
 */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (limit <= 0 || items.length === 0) {
    return;
  }
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

/**
 * 对当前工作区磁盘上已保存的普通 UTF-8 TXT 执行一次有界、可取消的搜索。
 *
 * @param workspaceRoot 主进程工作区会话提供的根路径（绝对路径）
 * @param request 已冻结形状的搜索请求（requestId / query / caseSensitive）
 * @param options 停止回调与适配器（默认生产实现）
 * @returns 稳定序列化结果；任何情况下不抛出异常、不写文件、不泄漏路径或正文
 */
export async function searchTextWorkspace(
  workspaceRoot: string,
  request: WorkspaceTextSearchRequest,
  options: SearchTextWorkspaceOptions = {},
): Promise<WorkspaceTextSearchResult> {
  const shouldStop = options.shouldStop ?? (() => false);
  const readDirFn = options.readDir ?? defaultReadDir;
  const readText =
    options.readText ??
    ((root: string, relativePath: string) => readTextDocument(root, relativePath));
  const readConcurrency = options.readConcurrency ?? MAX_FILE_READ_CONCURRENCY;

  // 防御性复验：IPC 入口（WP3）已校验；这里保证搜索器自身不处理非法请求
  const validation = validateWorkspaceTextSearchRequest(request);
  if (!validation.ok) {
    const rawRequestId = (request as unknown as { readonly requestId?: unknown } | null)?.requestId;
    return {
      status: 'error',
      requestId: isValidSearchRequestId(rawRequestId) ? rawRequestId : 0,
      error: { code: 'INVALID_REQUEST', message: '无效的搜索请求' },
    };
  }

  // 搜索根只来自主进程工作区会话，且必须是绝对路径
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    return {
      status: 'error',
      requestId: request.requestId,
      error: { code: 'NO_WORKSPACE', message: '尚未打开工作区' },
    };
  }

  let traversal: TraversalOutcome;
  try {
    traversal = await collectCandidates(workspaceRoot, readDirFn, shouldStop);
  } catch {
    // 根目录不可读：整体失败，不泄漏路径或原始异常
    return {
      status: 'error',
      requestId: request.requestId,
      error: { code: 'SEARCH_FAILED', message: '无法读取工作区根目录' },
    };
  }
  if (shouldStop()) {
    return { status: 'cancelled', requestId: request.requestId };
  }

  // 候选按规范相对路径自然排序：处理顺序与并发完成顺序无关
  const candidates = [...traversal.candidates].sort(compareRelativePaths);
  const fileResults: WorkspaceTextSearchFileResult[] = [];
  let skippedFiles = traversal.skippedDirectories;
  let cancelled = false;

  await runWithConcurrency(candidates, readConcurrency, async (relativePath) => {
    if (cancelled || shouldStop()) {
      cancelled = true;
      return;
    }
    // 读取是协作式取消的：已开始的受控读取可以完成，但其结果不再提交
    const result = await readText(workspaceRoot, relativePath);
    if (cancelled || shouldStop()) {
      cancelled = true;
      return;
    }
    if (result.status === 'error') {
      // 单文件错误隔离：文件消失、权限、过大、非法 UTF-8、非普通文件等一律计入跳过
      skippedFiles += 1;
      return;
    }
    const outcome = matchText(result.document.content, request.query, {
      caseSensitive: request.caseSensitive,
      shouldYield: shouldStop,
    });
    if (outcome.yielded) {
      cancelled = true;
      return;
    }
    if (outcome.matches.length > 0) {
      fileResults.push({
        relativePath,
        revision: result.document.revision,
        matches: outcome.matches,
        truncated: outcome.truncated,
      });
    }
  });

  if (cancelled || shouldStop()) {
    // 取消不是错误；不得把部分结果标记为 completed
    return { status: 'cancelled', requestId: request.requestId };
  }

  const grouped = groupMatchedFileResults(sortMatchedFileResults(fileResults));
  const statistics: WorkspaceTextSearchStatistics = {
    scannedFiles: candidates.length,
    matchedFiles: grouped.matchedFiles,
    totalMatches: grouped.totalMatches,
    skippedFiles,
  };
  return {
    status: 'completed',
    requestId: request.requestId,
    files: grouped.files,
    statistics,
    truncated: traversal.fileLimitHit || grouped.truncated,
    truncatedReason: traversal.fileLimitHit ? 'file-limit' : grouped.truncatedReason,
  };
}
