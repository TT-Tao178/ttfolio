#!/usr/bin/env node
// 数据自检：库完整性、路径失效、失效挂载、孤儿数据（C-42）。
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const isWin = process.platform === 'win32';
const r = spawnSync('npx', ['tsx', 'packages/server/src/cli/doctor.ts'], {
  stdio: 'inherit',
  shell: isWin,
});
process.exitCode = r.status ?? 1;
