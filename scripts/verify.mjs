#!/usr/bin/env node
// ttFolio 一键自检脚本（质量门禁）：
// 1) typecheck  2) lint  3) vitest  4) build  5) e2e  6) 机械检查  7) 汇总
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const results = [];
const isWin = process.platform === 'win32';
const NPM = isWin ? 'npm.cmd' : 'npx';
const NPX = isWin ? 'npx.cmd' : 'npx';

function run(name, cmd, args, opts = {}) {
  const label = opts.label ?? name;
  process.stdout.write(`\n=== [${name}] ${cmd} ${args.join(' ')}\n`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    // Windows 下 npm/npx 是 .cmd 批处理，Node≥18.20 必须 shell 才能启动（仅脚本使用，packages 内仍禁 shell）
    shell: isWin,
    env: process.env,
    encoding: 'utf8',
  });
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) {
    results.push({ name: label, status: 'PASS', ms, note: opts.note ?? '' });
    process.stdout.write(`--- [${name}] PASS (${ms}s)\n`);
    return true;
  }
  if (r.status === 'SKIP') {
    results.push({ name: label, status: 'SKIP', ms, note: opts.skipNote ?? '' });
    return true;
  }
  let tail = '';
  if (r.stdout) tail += r.stdout.slice(-4000);
  if (r.stderr) tail += r.stderr.slice(-4000);
  process.stdout.write(tail + `\n--- [${name}] FAIL (${ms}s)\n`);
  results.push({ name: label, status: 'FAIL', ms, note: tail.slice(-500) });
  return false;
}

function walk(
  dir,
  fn,
  skip = new Set([
    'node_modules',
    'dist',
    '.git',
    '.tmp-test',
    'coverage',
    'test-results',
    'playwright-report',
  ]),
) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn, skip);
    else fn(p);
  }
}

function relUnix(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function mechanicalChecks() {
  const rules = [
    {
      id: 'M1',
      desc: 'fs.(read|write|unlink|rename|copy|rm) 只允许出现在 server/src/core/ 之外不出现（C-01）',
      test: (rel, code) =>
        rel.startsWith('packages/server/src/') &&
        !rel.startsWith('packages/server/src/core/') &&
        /fs\.(readFile|writeFile|unlink|rename|copyFile|rm)\(/.test(code),
    },
    {
      id: 'M2',
      desc: 'server 源码禁止 .startsWith(（C-02）',
      test: (rel, code) => rel.startsWith('packages/server/src/') && /\.startsWith\(/.test(code),
    },
    {
      id: 'M3',
      desc: 'server 源码禁止 shell: true（C-21）',
      test: (rel, code) => rel.startsWith('packages/server/src/') && /shell:\s*true/.test(code),
    },
    {
      id: 'M4',
      desc: 'web 源码禁止 CDN/在线字体（C-10）',
      test: (rel, code) =>
        rel.startsWith('packages/web/src/') && /cdn\.|unpkg|jsdelivr|googleapis|gstatic/.test(code),
    },
    {
      id: 'M5',
      desc: '全仓库禁止 monaco（C-28）',
      test: (rel, code) => /monaco/i.test(code),
    },
    {
      id: 'M6',
      desc: 'web 源码禁止 localStorage/indexedDB（主题缓存例外，需带 TT-THEME-CACHE 注释）（C-29）',
      test: (rel, code) => {
        if (!rel.startsWith('packages/web/src/')) return false;
        if (!/localStorage|indexedDB/.test(code)) return false;
        // 主题缓存例外：同文件内必须有显式注释标记
        return !code.includes('TT-THEME-CACHE');
      },
    },
    {
      id: 'M7',
      desc: '全仓库禁止 any / @ts-ignore',
      test: (rel, code) => /: any\b|as any|@ts-ignore/.test(code),
    },
    {
      id: 'M8',
      desc: '测试禁止 .skip/.only/xdescribe/xit（C-45）',
      test: (rel, code) =>
        /\.(test|spec)\.(ts|tsx)$/.test(rel) && /\.skip\(|\.only\(|xdescribe\(|xit\(/.test(code),
    },
    {
      id: 'M9',
      desc: 'packages/*/src 禁止 console.log/error/warn（统一 pino / toast）',
      test: (rel, code) =>
        /^packages\/(shared|server|web)\/src\//.test(rel) &&
        !/\.test\.(ts|tsx)$/.test(rel) &&
        /console\.(log|error|warn)\(/.test(code),
    },
    {
      id: 'M10',
      desc: 'web 源码 hex 色值只允许出现在 theme 目录（C-50）',
      test: (rel, code) =>
        rel.startsWith('packages/web/src/') && !rel.includes('/theme/') && /#[0-9a-fA-F]{6}\b/.test(code),
    },
    {
      id: 'M11',
      desc: 'core/git.ts 禁止 push(/pull(/fetch(（C-56）',
      test: (rel, code) => rel === 'packages/server/src/core/git.ts' && /push\(|pull\(|fetch\(/.test(code),
    },
  ];
  const hits = [];
  walk(join(ROOT, 'packages'), (p) => {
    if (!/\.(ts|tsx|js|jsx|mjs|css|html)$/.test(p)) return;
    const rel = relUnix(p);
    const code = readFileSync(p, 'utf8');
    for (const rule of rules) {
      if (rule.test(rel, code)) {
        const lines = code.split(/\r?\n/);
        lines.forEach((line, i) => {
          try {
            if (rule.test(rel, line)) hits.push(`[${rule.id}] ${rel}:${i + 1} ${line.trim().slice(0, 120)}`);
          } catch {
            /* 单行不完整正则可能误报，整文件命中已记录 */
          }
        });
      }
    }
  });
  return { rules, hits };
}

// ---------- 主流程 ----------
let e2eSkipNote = '';
const e2eBrowserDir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
let e2eReady = false;
if (e2eBrowserDir && existsSync(e2eBrowserDir)) {
  const hasChromium = readdirSync(e2eBrowserDir).some((d) => d.includes('chromium'));
  e2eReady = hasChromium;
}
if (!e2eReady) {
  process.stdout.write('\n=== 尝试安装 Playwright Chromium（失败则 e2e 记 SKIP）\n');
  const inst = spawnSync(NPX, ['playwright', 'install', 'chromium'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
  });
  e2eReady = inst.status === 0;
}

run('typecheck', NPM, ['run', 'typecheck']);
run('lint', NPM, ['run', 'lint']);
run('test(vitest)', NPM, ['run', 'test']);
run('build', NPM, ['run', 'build']);

if (e2eReady) {
  run('e2e(playwright)', NPM, ['run', 'test:e2e'], { label: 'e2e(playwright)' });
} else {
  e2eSkipNote = 'Playwright Chromium 浏览器不可用（下载失败），e2e 用例保留但本次记 SKIP（默认决策 8）';
  results.push({ name: 'e2e(playwright)', status: 'SKIP', ms: '0', note: e2eSkipNote });
  process.stdout.write(`\n--- e2e SKIP：${e2eSkipNote}\n`);
}

process.stdout.write('\n=== 机械检查（grep 级）\n');
const { hits } = mechanicalChecks();
if (hits.length === 0) {
  results.push({ name: '机械检查(11 条)', status: 'PASS', ms: '-', note: '全部 0 命中' });
  process.stdout.write('PASS：11 条机械检查全部 0 命中\n');
} else {
  results.push({ name: '机械检查(11 条)', status: 'FAIL', ms: '-', note: `${hits.length} 处命中` });
  for (const h of hits) process.stdout.write(h + '\n');
}

// ---------- 汇总 ----------
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const skip = results.filter((r) => r.status === 'SKIP').length;
process.stdout.write('\n════════ verify 汇总 ════════\n');
for (const r of results) {
  process.stdout.write(
    `${r.status.padEnd(5)} ${r.name} (${r.ms}s) ${r.note ? '— ' + r.note.split('\n')[0] : ''}\n`,
  );
}
process.stdout.write(`\n通过 ${pass} / 失败 ${fail} / 跳过 ${skip}\n`);
process.exitCode = fail === 0 ? 0 : 1;
