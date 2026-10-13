/**
 * dist:win 全链路包装（第 36 轮 A3）：固化本机网络环境的出包前提，消除「手动补
 * 环境变量重跑」的必踩步骤（0.3.0/0.3.1 之前每次出包都撞）。
 *
 * 固化三件事（外部显式设置时以外部为准，不覆盖）：
 *  1. NODE_USE_SYSTEM_CA=1     —— 网络受限环境 TLS 中间人，Node 内置 CA 验证必败
 *  2. ELECTRON_MIRROR          —— electron zip 走 npmmirror
 *  3. ELECTRON_BUILDER_BINARIES_MIRROR —— 打包二进制走 npmmirror
 *
 * 链路与旧 dist:win 完全一致：audit:prod → build → build:server →
 * electron-rebuild → electron-builder --win nsis → verify-dist-electron。
 * 任何一步非零退出立即终止（真实退出码判定，禁管道吞码）。
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

process.env['NODE_USE_SYSTEM_CA'] ||= '1';
process.env['ELECTRON_MIRROR'] ||= 'https://npmmirror.com/mirrors/electron/';
process.env['ELECTRON_BUILDER_BINARIES_MIRROR'] ||=
  'https://npmmirror.com/mirrors/electron-builder-binaries/';

const steps = [
  ['audit:prod', 'npm', ['run', 'audit:prod']],
  ['build', 'npm', ['run', 'build']],
  ['build:server', 'npm', ['run', 'build:server']],
  ['electron-rebuild', 'npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3']],
  ['electron-builder', 'npx', ['electron-builder', '--win', 'nsis']],
  ['verify-dist-electron', 'node', ['scripts/verify-dist-electron.mjs']],
];

for (const [label, cmd, args] of steps) {
  process.stdout.write(`\n[dist:win] === ${label} ===\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(`[dist:win] ${label} FAILED (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}
process.stdout.write('\n[dist:win] all steps passed\n');
