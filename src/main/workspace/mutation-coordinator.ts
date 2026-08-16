/**
 * 最小 mutation coordinator（TASK-009 WP3，§4.4）—— 按窗口（webContents id）串行
 * 文件管理写操作：同一窗口同一时刻最多一个写操作在途；不同窗口互不阻塞；
 * 前一个操作失败不阻塞队列中的后续操作（失败只反映在对应结果上）。
 *
 * 只负责调度，不持有工作区/窗口对象，不记录正文或路径；reveal 等非写操作不经过本队列。
 */

export interface MutationCoordinator {
  /** 在指定窗口的串行队列尾部追加任务；返回该任务的结果（错误原样抛出给调用方）。 */
  run<T>(windowId: number, task: () => Promise<T>): Promise<T>;
}

/**
 * 进程级共享队列单例：create / save-as 等全部文件管理写操作共用同一按窗口串行队列，
 * 保证同一窗口同一时刻最多一个文件管理写操作在途（§4.4）。
 */
export const sharedMutationQueue: MutationCoordinator = createMutationCoordinator();

/** 创建按窗口串行的 mutation coordinator。 */
export function createMutationCoordinator(): MutationCoordinator {
  const tails = new Map<number, Promise<unknown>>();
  return {
    run<T>(windowId: number, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(windowId) ?? Promise.resolve();
      // 前一个任务无论成功/失败，下一个任务都继续执行（不吞掉本任务错误）
      const next = previous.then(
        () => task(),
        () => task(),
      );
      tails.set(
        windowId,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      return next;
    },
  };
}
