#!/usr/bin/env node
// 手动执行数据库迁移（服务启动时也会自动执行）。
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const isWin = process.platform === 'win32';
const r = spawnSync('npx', ['tsx', 'packages/server/src/cli/migrate-cli.ts'], {
  stdio: 'inherit',
  shell: isWin
});
process.exitCode = r.status ?? 1;
