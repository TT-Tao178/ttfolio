/** 语言映射（14.3）与排除规则：按字节统计（GitHub 口径）。 */
export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  py: 'Python', pyi: 'Python',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', go: 'Go', rs: 'Rust', cs: 'C#',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cc: 'C++', hh: 'C++', mm: 'Objective-C++', m: 'Objective-C',
  php: 'PHP', rb: 'Ruby', swift: 'Swift', dart: 'Dart', scala: 'Scala', groovy: 'Groovy',
  lua: 'Lua', pl: 'Perl', pm: 'Perl', r: 'R',
  html: 'HTML', htm: 'HTML', xhtml: 'HTML',
  css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less', styl: 'Stylus',
  md: 'Markdown', mdx: 'MDX', rst: 'reStructuredText',
  json: 'JSON', jsonc: 'JSON', json5: 'JSON',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', cfg: 'INI', conf: 'INI', properties: 'INI',
  xml: 'XML', svg: 'SVG', sql: 'SQL',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  ps1: 'PowerShell', psm1: 'PowerShell', bat: 'Batch', cmd: 'Batch',
  ipynb: 'Jupyter', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protocol Buffers',
  tf: 'HCL', hcl: 'HCL'
};

/** 明确不计入语言统计的文件名/后缀（锁文件、生成物、图片、音视频、字体、压缩包、可执行）。 */
const EXCLUDED_NAMES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'cargo.lock',
  'composer.lock', 'gemfile.lock', 'pipfile.lock', 'packages.lock.resolved'
]);

const EXCLUDED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tif', 'tiff',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'bz2', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'apk', 'jar', 'class',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'min.js', 'map', 'lock', 'sum', 'bak', 'psd', 'ai', 'fig', 'sketch', 'blend',
  'pyc', 'pyo', 'o', 'obj', 'a', 'lib', 'wasm', 'node', 'pdb'
]);

export function languageForFile(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (EXCLUDED_NAMES.has(lower)) return null;
  const parts = lower.split('.');
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1] ?? '';
  if (ext === '') return null;
  if (EXCLUDED_EXTS.has(ext)) return null;
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return null;
  if (parts.length > 2 && EXCLUDED_EXTS.has(parts.slice(parts.length - 2).join('.'))) return null;
  const lang = EXT_TO_LANGUAGE[ext];
  return lang ?? null;
}

export interface LangAccum {
  [language: string]: { bytes: number; files: number };
}

/** 计算 top 8 + Other，百分比校正总和为 100（8.2）。 */
export function topLanguages(
  acc: LangAccum
): Array<{ language: string; bytes: number; files: number; percent: number }> {
  const all = Object.entries(acc).map(([language, v]) => ({ language, ...v }));
  all.sort((a, b) => b.bytes - a.bytes);
  const total = all.reduce((s, x) => s + x.bytes, 0);
  if (total === 0) return [];
  const top = all.slice(0, 8);
  const otherBytes = all.slice(8).reduce((s, x) => s + x.bytes, 0);
  const otherFiles = all.slice(8).reduce((s, x) => s + x.files, 0);
  const rows = [...top];
  if (otherBytes > 0) {
    rows[rows.length] = { language: 'Other', bytes: otherBytes, files: otherFiles };
  }
  // 四舍五入后校正总和为 100
  let sum = 0;
  const withPct = rows.map((r) => {
    const pct = Math.round((r.bytes / total) * 100);
    sum += pct;
    return { ...r, percent: pct };
  });
  const last = withPct[withPct.length - 1];
  if (last !== undefined && sum !== 100) {
    last.percent = Math.max(0, last.percent + (100 - sum));
  }
  return withPct.filter((r) => r.percent > 0 || r.bytes > 0);
}
