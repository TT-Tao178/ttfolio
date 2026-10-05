import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    baseURL: process.env['TTFOLIO_E2E_URL'] ?? 'http://127.0.0.1:7733'
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: process.env['TTFOLIO_E2E_URL'] ?? 'http://127.0.0.1:7733',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      TTFOLIO_PORT: '7733',
      // 相对仓库根解析（开源合规：默认值不得带开发者本机绝对路径）
      TTFOLIO_DATA_DIR: process.env['TTFOLIO_E2E_DATA'] ?? new URL('./.tmp-test/e2e-data', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')
    }
  }
});
