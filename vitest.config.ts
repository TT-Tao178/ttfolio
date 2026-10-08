import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    testTimeout: 30000
  },
  resolve: {
    // web 源码以 @/ 别名引用（第 33 轮起 web 包也有单测，需在 node 环境解析该别名）
    alias: {
      '@': fileURLToPath(new URL('./packages/web/src', import.meta.url))
    }
  }
});
