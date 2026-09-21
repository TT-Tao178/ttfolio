#!/usr/bin/env node
// 本地开发：并行启动 server(tsx watch) 与 web(vite)，等待 runtime.json 出现后把 token 传给 vite 代理。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import process from 'node:process';

const ROOT = process.cwd();
const isWin = process.platform === 'win32';
const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runtimeCandidates() {
  const list = [];
  if (process.env.TTFOLIO_DATA_DIR) list.push(join(process.env.TTFOLIO_DATA_DIR, 'runtime.json'));
  if (isWin && process.env.APPDATA) list.push(join(process.env.APPDATA, 'ttFolio', 'runtime.json'));
  list.push(join(os.homedir(), '.local', 'share', 'ttfolio', 'runtime.json'));
  list.push(join(os.homedir(), '.ttfolio', 'runtime.json'));
  return list;
}

function spawnChild(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`[${name}] ${line}\n`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && !shuttingDown) {
      process.stdout.write(`[${name}] exited with code ${code}\n`);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* 进程可能已退出 */
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 1) 先起 server（tsx watch）
spawnChild('server', 'npx', ['tsx', 'watch', 'packages/server/src/index.ts']);

// 2) 轮询等待 runtime.json（最多 30 秒），拿到端口与 token
let token = process.env.TTFOLIO_TOKEN ?? '';
let port = '';
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  for (const p of runtimeCandidates()) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        if (parsed.token && parsed.port) {
          token = parsed.token;
          port = String(parsed.port);
        }
      } catch {
        /* runtime 尚未写完整，继续等待 */
      }
    }
    if (token && port) break;
  }
  if (token && port) break;
  await sleep(500);
}

// 3) 起 vite，代理 /api 与 /raw 到实际端口并注入 token
spawnChild('web', 'npx', ['vite', '--config', 'packages/web/vite.config.ts'], {
  env: { TTFOLIO_PROXY_TARGET: `http://127.0.0.1:${port || '7717'}`, TTFOLIO_TOKEN: token }
});
process.stdout.write(`\nttFolio dev: web http://localhost:5173  api http://127.0.0.1:${port || '7717'}\n`);
