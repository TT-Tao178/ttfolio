/**
 * GitHub Release 页创建/更新工具（对外发布流程的正规通道，取代 .tmp-test 里的
 * 一次性脚本——后者曾因 sed 复制时转义文本匹配不到而串版：v0.4.5~v0.4.7 正文
 * 长期挂着 0.4.4 的内容，第 73 轮修复并立此为唯一通道）。
 *
 * 用法（在 push main 与 tag 之后执行；网络受限环境下走本地代理）：
 *   https_proxy=http://127.0.0.1:7897 node scripts/create-release.mjs 0.4.7 "文件树多选 / 图片右栏预览"
 *
 * 行为：
 * - 正文取仓库 CHANGELOG.md 中对应版本小节，做三件重排：
 *   ① 去掉「## 版本（日期）」头行（Release 标题已含版本）；② `### 小节` 升为
 *   `## 小节`（对齐 0.4.2 之前的页面样式）；③ CHANGELOG 的 110 字符硬换行按
 *   中文直连/英文补空格合并成整行。
 * - 标题 = `v<版本> · <要点>`（对齐既有页面样式）。
 * - 幂等：该 tag 已有 Release 则 PATCH 更新，没有则 POST 创建。
 * - 认证 token 取自凭据管理器（git credential fill），请求走系统 curl.exe
 *   （Schannel 证书库，规避 Node fetch 在受限网络的 TLS 中间人问题）；
 *   设置 https_proxy 环境变量时 curl 一并走代理。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [version, title] = process.argv.slice(2);
if (version === undefined || title === undefined || version === '' || title === '') {
  console.error(
    '用法：node scripts/create-release.mjs <版本如 0.4.7> "<标题要点如 文件树多选 / 图片右栏预览>"',
  );
  process.exit(1);
}

// ---- 从 CHANGELOG.md 抽取并重排正文 ----
const changelog = fs.readFileSync(path.resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');
const sectionRe = new RegExp(`## ${version.replace(/\./g, '\\.')}（[^）]*）\\n([\\s\\S]*?)(?=\\n## |\\n*$)`);
const m = changelog.match(sectionRe);
if (m === null) {
  console.error(`CHANGELOG.md 中未找到 ${version} 小节`);
  process.exit(1);
}

function unwrap(text) {
  let inCode = false;
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .reduce((acc, line) => {
      if (line.startsWith('```')) inCode = !inCode;
      // 代码块内保持原样（缩进是语义）；普通文本的列表续行缩进在合并时去掉
      const normalized = inCode ? line : line.trim();
      if (
        normalized === '' ||
        (!inCode &&
          (normalized.startsWith('#') || normalized.startsWith('- ') || normalized.startsWith('  - ')))
      ) {
        acc.push(normalized);
        return acc;
      }
      const prev = acc[acc.length - 1];
      if (prev === undefined || prev === '' || prev.startsWith('#')) {
        acc.push(normalized);
        return acc;
      }
      // 续行：中文直连；前尾与行首都是 ASCII 字母数字时补一个空格
      const joiner = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(normalized) ? ' ' : '';
      acc[acc.length - 1] = prev + joiner + normalized;
      return acc;
    }, [])
    .join('\n');
}

const body = unwrap(m[1]).replace(/^### /gm, '## ').trim();

// ---- token 与请求 ----
const cred = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const tokenLine = (cred.stdout ?? '').split('\n').find((l) => l.startsWith('password='));
if (tokenLine === undefined) {
  console.error('git credential fill 未取得 token');
  process.exit(1);
}
const token = tokenLine.slice('password='.length).trim();

const proxy = process.env['https_proxy'] ?? process.env['HTTPS_PROXY'] ?? '';
const proxyArgs = proxy !== '' ? ['-x', proxy] : [];

function api(method, url, payload) {
  const args = [
    '-s',
    '-w',
    '\n%{http_code}',
    '-X',
    method,
    '-H',
    `Authorization: Bearer ${token}`,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'Content-Type: application/json',
    ...proxyArgs,
  ];
  if (payload !== undefined) {
    const file = path.join(process.cwd(), '.tmp-test', `release-${version}-payload.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    args.push('--data-binary', `@${file}`);
  }
  args.push(url);
  const res = spawnSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const out = (res.stdout ?? '').split('\n');
  const code = Number.parseInt(out[out.length - 1] ?? '0', 10);
  let json = {};
  try {
    json = JSON.parse(out.slice(0, -1).join('\n'));
  } catch {
    json = {};
  }
  return { code, json };
}

const name = `v${version} · ${title}`;
const payload = { tag_name: `v${version}`, target_commitish: 'main', name, body };

// 幂等：先查该 tag 是否已有 Release
const found = api('GET', `https://api.github.com/repos/TT-Tao178/ttfolio/releases/tags/v${version}`);
if (found.code === 200 && typeof found.json.id === 'number') {
  const r = api('PATCH', `https://api.github.com/repos/TT-Tao178/ttfolio/releases/${found.json.id}`, payload);
  console.log('http', r.code, 'PATCH', r.json.html_url ?? JSON.stringify(r.json).slice(0, 200));
  process.exit(r.code === 200 ? 0 : 1);
}
const r = api('POST', 'https://api.github.com/repos/TT-Tao178/ttfolio/releases', payload);
console.log('http', r.code, 'POST', r.json.html_url ?? JSON.stringify(r.json).slice(0, 200));
process.exit(r.code === 201 ? 0 : 1);
