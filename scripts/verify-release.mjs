/**
 * Release 产物体检（T-151）：确认"页建好了"之外，**资产真的能下**。
 *
 * 为什么需要它：2026-11-19 出 0.6.8 时，后台上传实际已完成，但任务包装器报
 * "failed with exit code 0"，中途查 API 又看到 assets=[]（GitHub 要整段传完才登记），
 * 结果白等十几分钟还准备重传 147MB。真正的判据只有三条：
 *   ① 资产 state=uploaded；② 远端 size 与本地逐字节一致；③ Range 拉一段能拿到 PE 头。
 *
 * 用法：
 *   node scripts/verify-release.mjs 0.6.8
 *   node scripts/verify-release.mjs 0.6.8 --asset dist-electron/ttFolio-Setup-0.6.8.exe
 *   node scripts/verify-release.mjs 0.6.8 --wait 600        # 上传还没完时轮询等它出现
 * 环境变量：https_proxy（受限网络走本地代理，与 create-release.mjs 一致）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const version = argv.find((a) => !a.startsWith('--'));
if (version === undefined) {
  console.error('用法：node scripts/verify-release.mjs <版本如 0.6.8> [--asset <本地文件>] [--wait <秒>]');
  process.exit(1);
}
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const localAsset = argOf('--asset') ?? `dist-electron/ttFolio-Setup-${version}.exe`;
const waitSec = Number.parseInt(argOf('--wait') ?? '0', 10) || 0;
const assetName = path.basename(localAsset);
const tag = `v${version}`;

const cred = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const tokenLine = (cred.stdout ?? '').split('\n').find((l) => l.startsWith('password='));
if (tokenLine === undefined) {
  console.error('✗ git credential fill 未取得 token（先确认这台机器登录过 GitHub）');
  process.exit(1);
}
const token = tokenLine.slice('password='.length).trim();
const proxy = process.env['https_proxy'] ?? process.env['HTTPS_PROXY'] ?? '';
const proxyArgs = proxy !== '' ? ['-x', proxy] : [];
/** 同步 sleep（不空转 CPU）：CLI 场景下比 await 更省事。 */
const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function apiGet(url) {
  const res = spawnSync(
    'curl.exe',
    [
      '-s',
      '-m',
      '30',
      '-w',
      '\n%{http_code}',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Accept: application/vnd.github+json',
      ...proxyArgs,
      url,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const lines = (res.stdout ?? '').split('\n');
  const code = Number.parseInt(lines[lines.length - 1] ?? '0', 10);
  let json = {};
  try {
    json = JSON.parse(lines.slice(0, -1).join('\n'));
  } catch {
    json = {};
  }
  return { code, json };
}

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

// ---- 1. Release 页存在 ----
const rel = apiGet(`https://api.github.com/repos/TT-Tao178/ttfolio/releases/tags/${tag}`);
if (rel.code !== 200) fail(`Release ${tag} 取不到（http ${rel.code}）——先跑 create-release.mjs`);
if (rel.json.draft === true) fail(`Release ${tag} 还是草稿状态，别人看不到`);
ok(`Release ${tag} 存在：${rel.json.html_url}（draft=false）`);

// ---- 2. 资产在且传完（--wait 时轮询）----
const deadline = Date.now() + waitSec * 1000;
let asset;
for (;;) {
  const list = apiGet(`https://api.github.com/repos/TT-Tao178/ttfolio/releases/tags/${tag}`);
  asset = (list.json.assets ?? []).find((a) => a.name === assetName);
  if (asset !== undefined && asset.state === 'uploaded') break;
  if (Date.now() >= deadline) {
    const names = (list.json.assets ?? []).map((a) => `${a.name}(${a.state})`).join(', ') || '(空)';
    fail(
      asset === undefined
        ? `Release 里没有 ${assetName}（现有：${names}）。上传用：\n` +
            `  curl.exe -x ${proxy || 'http://127.0.0.1:7897'} -X POST -H "Authorization: Bearer <token>" \\\n` +
            `    -H "Content-Type: application/octet-stream" --data-binary @${localAsset} \\\n` +
            `    "https://uploads.github.com/repos/TT-Tao178/ttfolio/releases/${rel.json.id}/assets?name=${assetName}"`
        : `${assetName} 状态是 ${asset.state}（没传完）——等一会再跑，或加 --wait`,
    );
  }
  console.log(`… 等待资产出现（${Math.round((deadline - Date.now()) / 1000)}s 后放弃）`);
  sleep(5000);
}

// ---- 3. 大小逐字节比对 ----
if (fs.existsSync(localAsset)) {
  const local = fs.statSync(localAsset).size;
  if (asset.size !== local) fail(`${assetName} 大小不一致：远端 ${asset.size} ≠ 本地 ${local}（重传）`);
  ok(`${assetName}：state=uploaded，size=${local}（与本地一致）`);
} else {
  ok(`${assetName}：state=uploaded，size=${asset.size}（本地文件不在，跳过比对）`);
}

// ---- 4. 真能下载：Range 拉 1KB 看 PE 头 ----
const tmp = path.join(os.tmpdir(), `ttfolio-release-probe-${version}.bin`);
const probe = spawnSync(
  'curl.exe',
  [
    '-sS',
    '-m',
    '60',
    '-L',
    '-r',
    '0-1023',
    '-o',
    tmp,
    '-w',
    '%{http_code} %{size_download}',
    ...proxyArgs,
    asset.browser_download_url,
  ],
  { encoding: 'utf8' },
);
const [code, bytes] = (probe.stdout ?? '').trim().split(' ');
if (code !== '206' && code !== '200') fail(`下载探测失败：http ${code}`);
const head = fs.existsSync(tmp) ? fs.readFileSync(tmp).subarray(0, 2).toString('latin1') : '';
if (assetName.toLowerCase().endsWith('.exe') && head !== 'MZ') {
  fail(`下载到的不是 PE 文件（头部 "${head}"，期望 "MZ"）`);
}
ok(`下载探测：http ${code}，取到 ${bytes}B，头部 ${head === 'MZ' ? 'MZ（PE 可执行）' : `"${head}"`}`);
try {
  fs.rmSync(tmp, { force: true });
} catch {
  /* 清理失败不影响结论 */
}

console.log(`\n产物可用：${asset.browser_download_url}`);
