import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // 默认使用 node 环境：文件系统/契约测试不需要 DOM，避免每个 worker 都加载 jsdom，
    // 降低受限环境下的 worker 通信与初始化压力（TASK-004 WP0）。
    // 需要 DOM 的 React 组件测试（tests/**/components.test.tsx）在文件头部使用
    // `// @vitest-environment jsdom` 单独声明，见 vitest 官方文档的 environment 说明。
    environment: 'node',
    // 使用 fork 池并限制并发 worker 数量：在资源受限环境（如受控开发机）下，
    // 大量并行 fork + jsdom 会引发 worker 通信超时；这里通过受控并发缓解，
    // 不通过延长超时掩盖问题。
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 4,
      },
    },
  },
});
