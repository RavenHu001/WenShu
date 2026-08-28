import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { appMetadataDefines } from './app-metadata.config';

export default defineConfig({
  main: {
    define: appMetadataDefines,
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    define: appMetadataDefines,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          // Electron 的 sandbox preload 使用受限 CommonJS 加载器，需显式保持 CJS 输出。
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    define: appMetadataDefines,
    root: resolve('src/renderer'),
    plugins: [react()],
  },
});
