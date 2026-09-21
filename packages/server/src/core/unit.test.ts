/** 忽略规则 / 语言统计 / git status 解析 / 文档匹配 / 编码换行 单测。 */
import { describe, expect, it } from 'vitest';
import { compileIgnore, globToRegex } from './ignore.js';
import type { IgnoreRule } from '@ttfolio/shared';
import { languageForFile, topLanguages, type LangAccum } from './analyzer/languages.js';
import { detectProjectType } from './analyzer/typeDetect.js';
import { extractFromManifest, mergeTechStack } from './analyzer/techStack.js';
import { parseStatusV2 } from './git.js';
import { detectAndDecode, detectEol, encodeByDetected, looksBinary } from './fsx.js';
import { matchScore, normalizeName } from '../routes/docs.js';

function rule(pattern: string, mode: 'hide' | 'analyze_only' = 'hide'): IgnoreRule {
  return { id: pattern, scope: 'global', projectId: null, pattern, mode, isBuiltin: true, enabled: true };
}

describe('忽略规则', () => {
  const compiled = compileIgnore([rule('node_modules'), rule('*.log'), rule('dist'), rule('.env*', 'analyze_only')]);
  it('目录级命中（任意层级）', () => {
    expect(compiled.isHidden('a/node_modules/x/index.js')).toBe(true);
    expect(compiled.isHidden('node_modules')).toBe(true);
    expect(compiled.isHidden('src/index.ts')).toBe(false);
  });
  it('glob 命中', () => {
    expect(compiled.isHidden('logs/app.log')).toBe(true);
    expect(compiled.isHidden('a/b/dist/c.js')).toBe(true);
  });
  it('analyze_only 与 hide 分离', () => {
    expect(compiled.isAnalyzeOnly('.env')).toBe(true);
    expect(compiled.isHidden('.env')).toBe(false);
  });
  it('敏感文件判定（不隐藏但排除索引）', () => {
    expect(compiled.isSensitive('.env')).toBe(true);
    expect(compiled.isSensitive('config/id_rsa_backup')).toBe(true);
    expect(compiled.isSensitive('src/index.ts')).toBe(false);
  });
  it('globToRegex 基础', () => {
    expect(globToRegex('*.log').test('a.log')).toBe(true);
    expect(globToRegex('*.log').test('a.log2')).toBe(false);
  });
});

describe('语言统计（按字节，GitHub 口径）', () => {
  it('扩展名映射与排除', () => {
    expect(languageForFile('a.ts')).toBe('TypeScript');
    expect(languageForFile('b.vue')).toBe('Vue');
    expect(languageForFile('package-lock.json')).toBeNull();
    expect(languageForFile('app.min.js')).toBeNull();
    expect(languageForFile('logo.png')).toBeNull();
  });
  it('top8 + Other + 百分比校正 100', () => {
    const acc: LangAccum = {};
    for (let i = 0; i < 12; i++) {
      const lang = `L${i}`;
      acc[lang] = { bytes: 1000 - i * 10, files: 1 };
    }
    const rows = topLanguages(acc);
    expect(rows.length).toBe(9); // top8 + Other
    const sum = rows.reduce((s, r) => s + r.percent, 0);
    expect(sum).toBe(100);
    expect(rows[rows.length - 1]?.language).toBe('Other');
  });
});

describe('类型识别优先级', () => {
  it('微服务：≥2 清单子目录 + compose 多服务', () => {
    expect(detectProjectType({
      manifestSubDirs: ['svc1', 'svc2'], composeServices: 2, hasGatewayDir: false,
      frontendDepDirs: [], backendDepDirs: [], hasBackendFramework: false, hasServerTemplates: false,
      frontendFramework: false, hasIndexHtmlWithPackageJson: false, scriptBytes: 0, totalBytes: 100, assetBytes: 0
    })).toBe('microservice');
  });
  it('前后端分离：前端子目录 + 后端子目录', () => {
    expect(detectProjectType({
      manifestSubDirs: ['web', 'server'], composeServices: 0, hasGatewayDir: false,
      frontendDepDirs: ['web'], backendDepDirs: ['server'], hasBackendFramework: true, hasServerTemplates: false,
      frontendFramework: true, hasIndexHtmlWithPackageJson: false, scriptBytes: 0, totalBytes: 100, assetBytes: 0
    })).toBe('split');
  });
  it('前端：前端框架且无后端', () => {
    expect(detectProjectType({
      manifestSubDirs: [], composeServices: 0, hasGatewayDir: false,
      frontendDepDirs: [], backendDepDirs: [], hasBackendFramework: false, hasServerTemplates: false,
      frontendFramework: true, hasIndexHtmlWithPackageJson: false, scriptBytes: 0, totalBytes: 100, assetBytes: 0
    })).toBe('frontend');
  });
  it('脚本工具：脚本字节占比 ≥ 40%', () => {
    expect(detectProjectType({
      manifestSubDirs: [], composeServices: 0, hasGatewayDir: false,
      frontendDepDirs: [], backendDepDirs: [], hasBackendFramework: false, hasServerTemplates: false,
      frontendFramework: false, hasIndexHtmlWithPackageJson: false, scriptBytes: 50, totalBytes: 100, assetBytes: 0
    })).toBe('script');
  });
});

describe('技术栈提取', () => {
  it('package.json 依赖映射', () => {
    const tags = extractFromManifest('package.json', JSON.stringify({
      dependencies: { react: '^18', 'better-sqlite3': '*' },
      devDependencies: { vite: '^5', vitest: '*' }
    }), 100);
    expect(tags).toContain('React');
    expect(tags).toContain('Vite');
    expect(tags).toContain('Vitest');
    expect(tags).toContain('SQLite');
  });
  it('数量限制与去重', () => {
    const merged = mergeTechStack([], ['A', 'B', 'A']);
    expect(merged).toEqual(['A', 'B']);
  });
});

describe('git status porcelain=v2 -z 解析', () => {
  it('解析 # 头、1/2/? 行与中文重命名', () => {
    const z = '\0';
    const raw = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '1 .M N... 100644 100644 100644 abc123 def456 修改 的文件.txt',
      `2 R. N... 100644 100644 100644 abc123 def456 R100 新 名.txt${z}旧 名.txt`,
      '? untracked.txt'
    ].join(z);
    const parsed = parseStatusV2(raw);
    expect(parsed.header['branch.head']).toBe('main');
    expect(parsed.entries.length).toBe(3);
    expect(parsed.entries[0]?.path).toBe('修改 的文件.txt');
    expect(parsed.entries[0]?.state).toBe('unstaged');
    expect(parsed.entries[1]?.state).toBe('staged');
    expect(parsed.entries[1]?.origPath).toBe('旧 名.txt');
    expect(parsed.entries[2]?.state).toBe('untracked');
  });
});

describe('编码与换行（C-08）', () => {
  it('GBK 往返字节级一致', () => {
    const iconv = require('iconv-lite') as typeof import('iconv-lite');
    const original = '中文内容 Hello';
    const buf = iconv.encode(original, 'gbk');
    const { content, encoding } = detectAndDecode(buf);
    expect(encoding).toBe('gbk');
    expect(content).toBe(original);
    expect(encodeByDetected(content, 'gbk').equals(buf)).toBe(true);
  });
  it('UTF-8 BOM 保持', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x', 'utf8')]);
    const { encoding } = detectAndDecode(buf);
    expect(encoding).toBe('utf8-bom');
    expect(encodeByDetected('x', 'utf8-bom').equals(buf)).toBe(true);
  });
  it('EOL 检测与保持', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('CRLF');
    expect(detectEol('a\nb\nc')).toBe('LF');
    expect(detectEol('a\r\nb\nc')).toBe('MIXED');
  });
  it('二进制检测：NUL 字节', () => {
    expect(looksBinary(Buffer.from([0x01, 0x00, 0x02]))).toBe(true);
    expect(looksBinary(Buffer.from('plain text', 'utf8'))).toBe(false);
  });
});

describe('文档根自动匹配打分（FR-6.2）', () => {
  it('归一化：去空格/全角/后缀', () => {
    expect(normalizeName('ttPictureview 设计文档')).toBe('ttpictureview');
    expect(normalizeName('ＴＴ－Ａｐｐ Docs')).toBe('tt－app'.replace('－', '-'));
  });
  it('精确=100 / 包含=70 / token=40 / 无=0', () => {
    expect(matchScore('ttapp', 'ttapp')).toBe(100);
    expect(matchScore('ttapp', 'ttapp设计文档')).toBeGreaterThanOrEqual(70);
    expect(matchScore('web-server-app', 'web server app')).toBeGreaterThanOrEqual(40);
    expect(matchScore('alpha', 'omega')).toBe(0);
  });
});
