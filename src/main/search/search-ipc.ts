/**
 * 搜索 IPC 处理器 —— 注册固定的 `search:text-workspace` 与 `search:cancel-text-workspace` 两个通道。
 *
 * ## 安全约束（第 4.6 / 4.7 / 7.2 节与 WP0 冻结项 7-8）
 *
 * - 搜索请求只接受冻结形状（requestId / query / caseSensitive），拒绝任何多余字段
 *   （工作区根、绝对路径、glob、扩展名、编码、上限、并发数、通道等危险参数）；
 * - 搜索根路径只来自主进程 `workspace-session`，处理器开始时捕获根快照，
 *   本次搜索只使用该快照；搜索期间工作区变化由 `shouldStop` 检测并停止；
 * - 取消只能作用于同一发送窗口已知的 requestId，未知或他窗请求为安全无操作；
 * - 同一窗口同一时刻最多一个活动搜索：新搜索先取消旧搜索；
 * - 窗口销毁时清理该窗口的任务引用；
 * - 所有预期与意外失败都转换为稳定、可序列化结果，不抛出异常；
 * - 不记录查询正文、命中正文、绝对路径或原始异常。
 *
 * ## 任务生命周期
 *
 * - `SearchTask` 以 `(webContentsId, requestId)` 为身份；`cancelled` 标志为协作式取消，
 *   与搜索器的 `shouldStop` 回调组合工作区变化检查；
 * - 搜索器（WP2）已开始的受控单文件读取可以完成，但其结果按 requestId 作废；
 * - 任务完成后释放引用；被新搜索替换或被取消的任务由对应结果携带的 requestId 与
 *   renderer 侧"工作区 epoch + requestId"双重校验安全忽略（WP3 控制器 / WP4 UI）。
 */

import { ipcMain, type WebContents } from 'electron';
import { searchTextWorkspace } from './search-text-workspace';
import { getCurrentWorkspaceRoot } from '../workspace/workspace-session';
import {
  isValidSearchRequestId,
  validateWorkspaceTextSearchCancelRequest,
  validateWorkspaceTextSearchRequest,
  type WorkspaceTextSearchResult,
} from '../../shared/search';

/** 单一发送窗口的活动搜索任务。 */
interface SearchTask {
  readonly requestId: number;
  /** 协作式取消标志：新搜索、主动取消或窗口销毁时置位。 */
  cancelled: boolean;
}

/** 按发送窗口 webContents id 索引的活动任务。 */
const tasks = new Map<number, SearchTask>();

/** 已挂接销毁清理监听的窗口，避免重复挂接。 */
const cleanedWebContents = new Set<number>();

/** IPC 是否已注册，防止重复注册。 */
let registered = false;

function invalidRequestResult(requestId: number): WorkspaceTextSearchResult {
  return {
    status: 'error',
    requestId,
    error: { code: 'INVALID_REQUEST', message: '无效的搜索请求' },
  };
}

/** 窗口销毁时清理该窗口的任务引用，不保留过期请求。 */
function ensureCleanupOnDestroy(webContents: WebContents): void {
  const senderId = webContents.id;
  if (cleanedWebContents.has(senderId)) {
    return;
  }
  cleanedWebContents.add(senderId);
  webContents.once('destroyed', () => {
    cleanedWebContents.delete(senderId);
    const task = tasks.get(senderId);
    if (task !== undefined) {
      task.cancelled = true;
    }
    tasks.delete(senderId);
  });
}

/** 取消指定窗口的指定请求；未知请求或他窗请求安全无操作。 */
function cancelTaskFor(senderId: number, requestId: number): void {
  const task = tasks.get(senderId);
  if (task !== undefined && task.requestId === requestId) {
    task.cancelled = true;
  }
}

/**
 * 注册搜索相关的 IPC 通道。应在 app.whenReady 回调中调用。
 * `search:text-workspace` 返回稳定的 `WorkspaceTextSearchResult`；
 * `search:cancel-text-workspace` 只作废活动任务，返回 void。
 */
export function registerSearchIpc(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle(
    'search:text-workspace',
    async (event, ...args: unknown[]): Promise<WorkspaceTextSearchResult> => {
      // 入口验证：只接受恰好一个冻结形状的搜索请求
      if (args.length !== 1) {
        return invalidRequestResult(0);
      }
      const validation = validateWorkspaceTextSearchRequest(args[0]);
      if (!validation.ok) {
        const rawId = (args[0] as { readonly requestId?: unknown } | null)?.requestId;
        return invalidRequestResult(isValidSearchRequestId(rawId) ? rawId : 0);
      }
      const request = validation.request;
      const senderId = event.sender.id;

      // 工作区根只来自主进程会话；请求不得携带根或绝对路径
      const workspaceRoot = getCurrentWorkspaceRoot();
      if (workspaceRoot === null) {
        return {
          status: 'error',
          requestId: request.requestId,
          error: { code: 'NO_WORKSPACE', message: '尚未打开工作区' },
        };
      }

      // 同一窗口同一时刻最多一个活动搜索：新搜索先取消旧搜索
      const previous = tasks.get(senderId);
      if (previous !== undefined) {
        previous.cancelled = true;
      }
      const task: SearchTask = { requestId: request.requestId, cancelled: false };
      tasks.set(senderId, task);
      ensureCleanupOnDestroy(event.sender);

      try {
        // 协作式停止：取消标志或工作区根变化（工作区成功切换后旧搜索立即作废）
        return await searchTextWorkspace(workspaceRoot, request, {
          shouldStop: () => task.cancelled || getCurrentWorkspaceRoot() !== workspaceRoot,
        });
      } catch {
        // 搜索器不抛出预期错误；兜底转换为稳定结果，不泄漏内部信息
        return {
          status: 'error',
          requestId: request.requestId,
          error: { code: 'SEARCH_FAILED', message: '搜索失败' },
        };
      } finally {
        // 任务完成释放引用；已被新搜索替换时不得删除新任务
        if (tasks.get(senderId) === task) {
          tasks.delete(senderId);
        }
      }
    },
  );

  ipcMain.handle(
    'search:cancel-text-workspace',
    async (event, ...args: unknown[]): Promise<void> => {
      if (args.length !== 1) {
        return;
      }
      const validation = validateWorkspaceTextSearchCancelRequest(args[0]);
      if (!validation.ok) {
        return;
      }
      cancelTaskFor(event.sender.id, validation.request.requestId);
    },
  );
}
