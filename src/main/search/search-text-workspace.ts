/**
 * 工作区混合文档安全搜索器 —— TASK-006 WP2（TXT）+ TASK-008 WP2（DOCX）。
 *
 * 在主进程内异步遍历当前工作区，对磁盘已保存的普通 UTF-8 TXT 与基础 DOCX 执行受控读取
 * 与字面量匹配。不注册 IPC、不写文件、不建立索引，本模块可直接由固定搜索 IPC 调用。
 *
 * ## 数据来源（TASK-008 第 4.2 / 4.7 节）
 *
 * - TXT 搜索文本为剥离 BOM 后的严格 UTF-8 正文（复用 `readTextDocument`）；
 * - DOCX 搜索文本只来自成功导入的 `DocxDocumentModel` 规范正文投影
 *   （`projectDocxModelSearchText`），不把 DOCX 当作 UTF-8 TXT，也不直接搜索 OOXML、
 *   Mammoth HTML 或编辑器 DOM；supported / degraded / read-only 均可搜索已进入模型的正文；
 * - 损坏、加密、伪装、超限、无法读取或无法导入的 DOCX 按单文件错误隔离计入跳过统计；
 * - 0 字节 DOCX 占位文件视为空白文档，无匹配且不报错；
 * - 搜索只针对磁盘已保存快照，不触发保存、兼容性确认、自动保存、重新读取或备份创建。
 *
 * ## 安全边界（第 4.3 / 4.6 / 4.7 节与 WP0 冻结项 6-9）
 *
 * - 搜索根路径由调用方（主进程工作区会话）提供；请求对象不携带根或绝对路径；
 * - 遍历不跟随符号链接 / junction / 其他重解析点（`isSymbolicLink` 先于 `isDirectory` 判断）；
 * - 候选只取大小写不敏感的普通 `.txt` 与 `.docx`；每个候选在读取时仍复用对应受控读取器
 *   （`readTextDocument` / `readDocxDocument`）重新执行相对路径、逐段 lstat、真实路径边界、
 *   普通文件、大小与 revision 校验，不得因目录扫描已看到文件而跳过；
 * - 全程只读：不调用任何写入、创建、重命名、删除 API；
 * - 根目录不可读使本次搜索整体失败（稳定 `SEARCH_FAILED`，消息不含路径）；
 *   子目录与单文件错误隔离并计入 `skippedFiles`；预算排除项不计为读取失败；
 * - 跨进程结果只包含稳定 code / 数量与可展示消息；不记录查询正文、命中正文、绝对路径或原始异常。
 *
 * ## 预算与确定性（第 4.5 节与 WP0 冻结项 5/9）
 *
 * - 总候选（TXT + DOCX 合计）上限 1000，其中 DOCX 上限 200；遍历中总候选达到 1000 即截断；
 *   DOCX 超出 200 的候选在排序后被预算排除（不读取、不计跳过），返回 `docx-file-limit`；
 * - 截断原因优先级固定：`file-limit` > `docx-file-limit` > `total-matches-limit` >
 *   `matches-per-file-limit`（`WORKSPACE_SEARCH_TRUNCATION_PRIORITY`）；
 * - 每个目录内按名称自然排序遍历，保证预算截断可确定复现；候选按规范相对路径自然排序后
 *   应用 DOCX 预算并读取，读取完成顺序不影响最终排序；
 * - 单文件 200 与总匹配 2000 由 `match-text.ts` 的预算逻辑执行。
 *
 * ## 双层并发（第 4.5 / 4.7 节与 WP0 冻结假设）
 *
 * - 全部文件池并发不超过 `MAX_FILE_READ_CONCURRENCY`（4），同时处于 DOCX 读取/导入阶段
 *   的不超过 `MAX_DOCX_READ_CONCURRENCY`（2）；采用两个信号量（总 / DOCX）的有界池，
 *   顺序取候选（预先自然排序），排序在池外完成；
 * - 已开始的 TXT/DOCX 单文件受控读取可以完成，但取消后其结果不得提交；未开始的读取跳过；
 * - 取消检查点：目录批次、每个条目、每次读取前后、DOCX 正文投影前后与匹配循环内
 *   （`matchText` 的 `shouldYield`）。
 *
 * ## 可测试性：轻量适配器注入
 *
 * 与 `scan-workspace.ts` / `read-text-document.ts` / `read-docx-document.ts` 一致的函数参数
 * 注入：`readDir`（目录读取）、`readText`（TXT 候选读取）、`readDocx`（DOCX 候选读取）可注入
 * mock，确定性测试并发、取消与错误隔离；生产环境默认使用 `node:fs/promises` 与两类受控
 * 读取器，不引入 DI 容器。
 */

import { extname, isAbsolute, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  MAX_CANDIDATE_FILES,
  MAX_DOCX_CANDIDATE_FILES,
  MAX_DOCX_READ_CONCURRENCY,
  MAX_FILE_READ_CONCURRENCY,
  isValidSearchRequestId,
  validateWorkspaceTextSearchRequest,
  type WorkspaceSearchDocumentKind,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchRequest,
  type WorkspaceTextSearchResult,
  type WorkspaceTextSearchStatistics,
  type WorkspaceTextSearchTruncatedReason,
} from '../../shared/search';
import { readTextDocument } from '../document/read-text-document';
import type { ReadTextDocumentResult } from '../../shared/document';
import { readDocxDocument } from '../docx/read-docx-document';
import type { ReadDocxDocumentResult } from '../../shared/docx';
import { projectDocxModelSearchText } from '../../shared/docx-search-text';
import type { DirEntry, ReadDirFn } from '../workspace/scan-workspace';
import {
  compareRelativePaths,
  groupMatchedFileResults,
  matchText,
  sortMatchedFileResults,
} from './match-text';

/** 混合候选：文件类型由主进程受控候选分类产生，renderer 不从展示文案猜测。 */
interface MixedCandidate {
  readonly kind: WorkspaceSearchDocumentKind;
  readonly relativePath: string;
}

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
  /** 候选 DOCX 读取适配器，默认复用受控 `readDocxDocument`（ZIP/模型预算 + revision）。 */
  readonly readDocx?: (
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<ReadDocxDocumentResult>;
  /** 全部文件读取并发上限，默认 `MAX_FILE_READ_CONCURRENCY`（4）。 */
  readonly readConcurrency?: number;
  /** 其中 DOCX 同时读取/导入上限，默认 `MAX_DOCX_READ_CONCURRENCY`（2）。 */
  readonly docxReadConcurrency?: number;
}

const defaultReadDir: ReadDirFn = (path) =>
  readdir(path, { withFileTypes: true }) as Promise<readonly DirEntry[]>;

/** 与 `scan-workspace.ts` 一致的自然排序器：目录内条目按名称排序，预算截断可确定复现。 */
const entryNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 遍历结果：混合候选、跳过统计与候选预算截断标志。 */
interface TraversalOutcome {
  readonly candidates: readonly MixedCandidate[];
  readonly skippedDirectories: number;
  /** 总候选达到 1000（TXT + DOCX 合计）后遍历提前停止。 */
  readonly fileLimitHit: boolean;
  /** 收集到的 DOCX 候选数（排序后由读取列表应用 200 上限）。 */
  readonly docxCount: number;
}

/**
 * 异步遍历工作区收集 TXT 与 DOCX 候选相对路径（第 4.5 / 4.7 节）：
 * - 不跟随符号链接 / junction / 其他重解析点；
 * - 只把大小写不敏感的普通 `.txt` / `.docx` 文件作为候选；
 * - 子目录读取失败隔离并计入跳过；根目录读取失败抛出（调用方映射为整体失败）；
 * - 总候选达到 1000 上限后立即停止遍历并标记截断（DOCX 不单独提前停止，以便在 1000
 *   总预算内继续收集 TXT；DOCX 的 200 上限在排序后应用）；
 * - 在目录批次与每个条目处检查 `shouldStop`。
 */
async function collectCandidates(
  workspaceRoot: string,
  readDirFn: ReadDirFn,
  shouldStop: () => boolean,
): Promise<TraversalOutcome> {
  const candidates: MixedCandidate[] = [];
  let skippedDirectories = 0;
  let fileLimitHit = false;
  let docxCount = 0;

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
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.txt' || ext === '.docx') {
          candidates.push({
            kind: ext === '.docx' ? 'docx' : 'txt',
            relativePath,
          });
          if (ext === '.docx') {
            docxCount += 1;
          }
          if (candidates.length >= MAX_CANDIDATE_FILES) {
            fileLimitHit = true;
            return;
          }
        }
      }
      // 其他文件类型与叶节点：政策性跳过，不计入 skippedFiles
    }
  };

  await walk(workspaceRoot, '');
  return { candidates, skippedDirectories, fileLimitHit, docxCount };
}

/**
 * 二值信号量：`limit` 个并发许可。等待者按 FIFO 排队，release 先唤醒等待者再归还许可。
 * 只用于本文件的有界并发池，不暴露给外部。
 */
class SearchSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.available += 1;
    }
  }
}

/** 双层并发池结果：是否在读取后检测到取消（取消时不得提交部分结果）。 */
interface PoolOutcome {
  readonly cancelled: boolean;
}

/**
 * 以双层并发上限处理候选（WP0 冻结设计，第 4.5 / 4.7 节）：
 * - 总在途不超过 `totalLimit`，其中 DOCX 同时读取/导入不超过 `docxLimit`（DOCX 先取
 *   DOCX 信号量、再取总信号量，保证两个上限同时成立）；
 * - 顺序取候选（调用方预先按规范相对路径自然排序），读取完成顺序不影响最终排序；
 * - 协作式取消：读取开始前检查（未开始的读取跳过），读取完成后检查（已开始的受控读取
 *   可以完成，但结果不提交）；
 * - 任一 worker 检测到取消后，其余 worker 停止拉取新候选；信号量在 finally 中释放。
 */
async function runWithTwoLevelConcurrency(
  candidates: readonly MixedCandidate[],
  options: {
    readonly totalLimit: number;
    readonly docxLimit: number;
    readonly shouldStop: () => boolean;
    readonly process: (candidate: MixedCandidate) => Promise<void>;
  },
): Promise<PoolOutcome> {
  // 防御性守卫：非法并发配置（≤0）或空候选直接无操作，避免信号量永久等待（死锁）。
  if (options.totalLimit <= 0 || options.docxLimit <= 0 || candidates.length === 0) {
    return { cancelled: false };
  }
  const totalSem = new SearchSemaphore(options.totalLimit);
  const docxSem = new SearchSemaphore(options.docxLimit);
  let nextIndex = 0;
  let cancelled = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) {
        return;
      }
      const candidate = candidates[index]!;
      const isDocx = candidate.kind === 'docx';
      if (isDocx) {
        await docxSem.acquire();
      }
      await totalSem.acquire();
      try {
        if (cancelled || options.shouldStop()) {
          // 未开始的读取跳过；已获取的信号量在 finally 释放
          cancelled = true;
          break;
        }
        await options.process(candidate);
        if (options.shouldStop()) {
          cancelled = true;
        }
      } finally {
        totalSem.release();
        if (isDocx) {
          docxSem.release();
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(options.totalLimit, candidates.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return { cancelled };
}

/**
 * 对当前工作区磁盘上已保存的普通 UTF-8 TXT 与基础 DOCX 执行一次有界、可取消的搜索。
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
  const readDocx =
    options.readDocx ??
    ((root: string, relativePath: string) => readDocxDocument(root, relativePath));
  const readConcurrency = options.readConcurrency ?? MAX_FILE_READ_CONCURRENCY;
  const docxReadConcurrency = options.docxReadConcurrency ?? MAX_DOCX_READ_CONCURRENCY;

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

  // 候选按规范相对路径自然排序后应用确定性预算（第 4.7 节）：
  // - 总候选已在遍历中按 1000 截断；
  // - DOCX 只保留排序后的前 200 个，超出部分为预算排除（不读取、不计跳过），
  //   命中即报告 `docx-file-limit`。
  const sortedCandidates = [...traversal.candidates].sort((a, b) =>
    compareRelativePaths(a.relativePath, b.relativePath),
  );
  const readList: MixedCandidate[] = [];
  let docxIncluded = 0;
  let docxLimitHit = false;
  for (const candidate of sortedCandidates) {
    if (candidate.kind === 'docx') {
      if (docxIncluded >= MAX_DOCX_CANDIDATE_FILES) {
        docxLimitHit = true;
        continue;
      }
      docxIncluded += 1;
    }
    readList.push(candidate);
  }

  const fileResults: WorkspaceTextSearchFileResult[] = [];
  let skippedFiles = traversal.skippedDirectories;

  const pool = await runWithTwoLevelConcurrency(readList, {
    totalLimit: readConcurrency,
    docxLimit: docxReadConcurrency,
    shouldStop,
    process: async (candidate) => {
      const relativePath = candidate.relativePath;
      if (candidate.kind === 'txt') {
        // TXT 分支：复用受控 TXT 读取器（路径/链接/真实路径/5 MiB/严格 UTF-8/revision）
        const result = await readText(workspaceRoot, relativePath);
        if (shouldStop()) {
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
          return;
        }
        if (outcome.matches.length > 0) {
          fileResults.push({
            kind: 'txt',
            relativePath,
            revision: result.document.revision,
            matches: outcome.matches,
            truncated: outcome.truncated,
          });
        }
        return;
      }

      // DOCX 分支：复用受控 DOCX 读取器（20 MiB / ZIP/OOXML / 模型预算 / revision）
      const result = await readDocx(workspaceRoot, relativePath);
      if (shouldStop()) {
        return;
      }
      if (result.status === 'error') {
        // 单文件错误隔离：损坏、加密、伪装、超限、资源预算超限、消失等一律计入跳过
        skippedFiles += 1;
        return;
      }
      // DOCX 搜索正文只来自规范正文投影（任务第 4.3 节）；投影前后检查取消
      if (shouldStop()) {
        return;
      }
      const projection = projectDocxModelSearchText(result.document.model);
      if (shouldStop()) {
        return;
      }
      const outcome = matchText(projection.text, request.query, {
        caseSensitive: request.caseSensitive,
        shouldYield: shouldStop,
      });
      if (outcome.yielded) {
        return;
      }
      if (outcome.matches.length > 0) {
        fileResults.push({
          kind: 'docx',
          relativePath,
          revision: result.document.revision,
          matches: outcome.matches,
          truncated: outcome.truncated,
        });
      }
    },
  });

  if (pool.cancelled || shouldStop()) {
    // 取消不是错误；不得把部分结果标记为 completed
    return { status: 'cancelled', requestId: request.requestId };
  }

  const grouped = groupMatchedFileResults(sortMatchedFileResults(fileResults));
  const statistics: WorkspaceTextSearchStatistics = {
    scannedFiles: readList.length,
    matchedFiles: grouped.matchedFiles,
    totalMatches: grouped.totalMatches,
    skippedFiles,
  };
  // 截断原因优先级固定：file-limit > docx-file-limit > 匹配级原因
  let truncatedReason: WorkspaceTextSearchTruncatedReason | null = null;
  if (traversal.fileLimitHit) {
    truncatedReason = 'file-limit';
  } else if (docxLimitHit) {
    truncatedReason = 'docx-file-limit';
  } else if (grouped.truncated) {
    truncatedReason = grouped.truncatedReason;
  }
  return {
    status: 'completed',
    requestId: request.requestId,
    files: grouped.files,
    statistics,
    truncated: traversal.fileLimitHit || docxLimitHit || grouped.truncated,
    truncatedReason,
  };
}
