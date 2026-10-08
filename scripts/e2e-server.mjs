// e2e 受管服务：启动前清空测试数据目录，保证用例幂等。
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import process from 'node:process';

const dataDir = process.env['TTFOLIO_E2E_DATA'] ?? '.tmp-test/e2e-data';
try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* 首次运行目录不存在 */
}

const isWin = process.platform === 'win32';
const child = spawn('npx', ['tsx', 'packages/server/src/index.ts'], {
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, TTFOLIO_DATA_DIR: dataDir, TTFOLIO_PORT: process.env['TTFOLIO_PORT'] ?? '7733' },
});
child.on('exit', (code) => process.exit(code ?? 0));
