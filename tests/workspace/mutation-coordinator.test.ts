/**
 * TASK-009 WP3：按窗口串行 mutation coordinator 测试。
 */

import { describe, expect, it } from 'vitest';
import { createMutationCoordinator } from '../../src/main/workspace/mutation-coordinator';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createMutationCoordinator', () => {
  it('同一窗口：任务严格串行，前一任务完成后才开始后一任务', async () => {
    const queue = createMutationCoordinator();
    const order: string[] = [];
    const p1 = queue.run(1, async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
      return 'a';
    });
    const p2 = queue.run(1, async () => {
      order.push('b-start');
      return 'b';
    });
    expect(await Promise.all([p1, p2])).toEqual(['a', 'b']);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('不同窗口：互不阻塞', async () => {
    const queue = createMutationCoordinator();
    const order: string[] = [];
    const slow = queue.run(1, async () => {
      order.push('w1-start');
      await delay(40);
      order.push('w1-end');
    });
    const fast = queue.run(2, async () => {
      order.push('w2');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['w1-start', 'w2', 'w1-end']);
  });

  it('前一任务失败不阻塞后一任务，错误原样抛给对应调用方', async () => {
    const queue = createMutationCoordinator();
    const order: string[] = [];
    const failing = queue.run(1, async () => {
      order.push('fail');
      throw new Error('boom');
    });
    const next = queue.run(1, async () => {
      order.push('next');
      return 'ok';
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await next).toBe('ok');
    expect(order).toEqual(['fail', 'next']);
  });

  it('连续多个任务保持 FIFO', async () => {
    const queue = createMutationCoordinator();
    const results = await Promise.all([1, 2, 3].map((n) => queue.run(7, async () => n * 10)));
    expect(results).toEqual([10, 20, 30]);
  });
});
