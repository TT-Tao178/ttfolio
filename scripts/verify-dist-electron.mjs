/** 桌面版出包后自检：断言 better-sqlite3 三件套真的在 asar 内、ABI 为 Electron、
 *  app.asar.unpacked 里有原生 .node 文件。任一不满足即非零退出（防"空 node_modules"
 *  打包事故复发——2026-09-23 安装版启动即报 Cannot find module 'better-sqlite3'）。
 *  用法：node scripts/verify-dist-electron.mjs
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const unpacked = path.resolve('dist-electron/win-unpacked');
const asar = path.join(unpacked, 'resources', 'app.asar');
let failed = 0;
const fail = (msg) => { failed += 1; console.error(`✗ ${msg}`); };
const ok = (msg) => console.log(`✓ ${msg}`);

// 1) asar 里必须能看到 node_modules/better-sqlite3（列表法，不依赖 asar 头解析细节）
if (!existsSync(asar)) {
  fail(`找不到 ${asar}（先跑 npm run dist:win）`);
  process.exit(1);
}
const { execFileSync } = await import('node:child_process');
let listing = '';
try {
  listing = execFileSync('node', [
    path.join('node_modules', '@electron', 'asar', 'bin', 'asar.js'), 'list', asar
  ], { encoding: 'utf8' });
} catch {
  listing = execFileSync('npx', ['--yes', '@electron/asar', 'list', asar], { encoding: 'utf8' });
}
const entries = listing.split(/\r?\n/);
for (const need of [
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  'node_modules/bindings/bindings.js',
  'node_modules/file-uri-to-path/index.js'
]) {
  if (entries.some((e) => e.replaceAll('\\', '/').endsWith(need))) ok(`asar 内含 ${need}`);
  else fail(`asar 内缺 ${need}（node_modules 没被打进包）`);
}

// 2) unpacked 里必须有原生 .node（electron ABI 产物）
const nativeDir = path.join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
if (!existsSync(nativeDir)) {
  fail('app.asar.unpacked/node_modules/better-sqlite3 不存在（asarUnpack 未生效）');
} else {
  const findNode = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? findNode(p) : (e.name.endsWith('.node') ? [p] : []);
  });
  const nodes = findNode(nativeDir);
  if (nodes.length === 0) fail('better-sqlite3 下没有 .node 原生产物');
  else ok(`原生模块已解包：${nodes.length} 个 .node（预编译目录）`);
}

// 3) ABI 冒烟：模拟真实启动链路——把 asar 解包到临时目录，从其中的服务端 bundle 发起 require
// （直接 require unpacked 里的 index.js 会没有 asar 内 node_modules 的解析上下文，误报 bindings 找不到）
const electronExe = path.join(unpacked, 'TT项目管理工作台.exe');
if (existsSync(electronExe)) {
  const { execFileSync: ex } = await import('node:child_process');
  ex('node', [path.join('node_modules', '@electron', 'asar', 'bin', 'asar.js'), 'extract', asar, '.tmp-test/asar-extract']);
  const probe = `try{const db=require(${JSON.stringify(path.resolve('.tmp-test/asar-extract/app/server/main.cjs').replace(/\\/g, '/'))});setTimeout(()=>{console.log('ABI-OK');process.exit(0)},4000)}catch(e){console.log('ABI-FAIL:'+e.message.split(String.fromCharCode(10))[0]);process.exit(1)}`;
  const r = execFileSync(electronExe, ['-e', probe], {
    encoding: 'utf8', timeout: 60000,
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', TTFOLIO_PORT: '7949',
      TTFOLIO_MIGRATIONS_DIR: path.resolve('.tmp-test/asar-extract/packages/server/src/migrations')
    }
  });
  if (r.includes('ABI-OK')) ok('服务端 bundle 在打包版 Electron 下完成启动（better-sqlite3 ABI 与依赖解析全部正确）');
  else fail(`ABI 冒烟失败：${r.trim().slice(0, 200)}`);
} else {
  // 静默跳过：CI 或改名后仍能跑前两项
  console.log('… 未找到 win-unpacked 主程序，跳过 ABI 冒烟');
}

if (failed > 0) {
  console.error(`\n${failed} 项检查未通过——安装包不可分发。`);
  process.exit(1);
}
console.log('\n桌面版产物自检全部通过。');
