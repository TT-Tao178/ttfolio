/** 产品常量（前后端共用）。 */
export const APP_NAME = 'ttFolio';
export const APP_NAME_CN = 'tt项目仓库';
export const APP_SUBTITLE = 'a local project workbench';
export const APP_VERSION = '0.1.0';

export const DEFAULT_PORT = 7717;
export const PORT_RANGE_MAX = 20;
export const USER_CONTENT_PORT_OFFSET = 100;

/** 文件大小阈值 */
export const MAX_TEXT_EDIT_BYTES = 5 * 1024 * 1024; // >5MB 文本只读
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // >50MB 不预览
export const MAX_MANIFEST_BYTES = 512 * 1024; // 分析期清单文件解析上限
export const MAX_INDEX_FILE_BYTES = 1024 * 1024; // 内容索引单文件上限
export const MAX_TREE_CHILDREN = 2000;
export const MAX_DIFF_LINES = 2000;
export const MAX_GIT_STATUS_ITEMS = 5000;

/** 编辑器 */
export const DRAFT_DEBOUNCE_MS = 1000;

/** 回收站默认保留天数 */
export const TRASH_RETENTION_DAYS = 30;

/** SSE */
export const SSE_HEARTBEAT_MS = 25000;

/** 会话标签上限 */
export const MAX_SESSION_TABS = 30;

export const DEFAULT_ARCH_DIR_NAME = '架构图';

/** 检查更新用：本产品的 GitHub 仓库（Releases 元数据走 api.github.com，不经被加速器拦截的下载域） */
export const GITHUB_REPO = 'TT-Tao178/ttfolio';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

/** settings 表的键（type_safe 常量） */
export const SETTING_KEYS = {
  theme: 'theme', // light | dark | oled（电红色发光） | cyberpunk（赛博朋克） | sketch（极简手绘） | system
  density: 'density', // small | middle | large
  watchEnabled: 'watch_enabled',
  watchStabilityMs: 'watch_stability_ms',
  autoSave: 'auto_save',
  trashRetentionDays: 'trash_retention_days',
  defaultArchDirName: 'default_arch_dir_name',
  cardSort: 'card_sort', // last_opened | last_commit | name | size
  cardColumns: 'card_columns', // auto | 2..6
  showIgnored: 'show_ignored',
  docRootBlacklist: 'doc_root_blacklist_json',
  scanRootDirs: 'scan_root_dirs_json', // FR-12.6 预留
  keybindings: 'keybindings_json', // FR-11.4
  // 代码语法配色方案（FR-13.4 / T-098）：classic | warm | neon，独立于应用主题
  syntaxScheme: 'syntax_scheme',
  lastBackupAt: 'last_backup_at',
  defaultProjectTab: 'default_project_tab', // files | overview
  // 可拖拽面板尺寸（纯 UI 偏好，但按 C-29 统一落服务端，不用 localStorage）：
  // { sidebarWidth, detailWidth, treeWidth, gitListWidth, docsListWidth }
  uiLayout: 'ui_layout_json',
  // GitHub 访问令牌（仓库当前为私有，查 Releases 需要能读该仓库的 Token；只写不读回显）
  githubToken: 'github_token',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** 敏感文件：不进内容索引与全文搜索，但不在文件树隐藏（C-12） */
export const SENSITIVE_FILE_PATTERNS = [
  /\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /^id_rsa/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^credentials/i,
  /^secrets/i,
  /^\.aws[\\/]/i,
  /^\.ssh[\\/]/i,
];

/** 内容索引的文本扩展名白名单 */
export const INDEXABLE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'vue',
  'svelte',
  'astro',
  'py',
  'pyi',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'cs',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'hh',
  'php',
  'rb',
  'swift',
  'dart',
  'scala',
  'groovy',
  'lua',
  'pl',
  'pm',
  'r',
  'm',
  'mm',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'md',
  'mdx',
  'txt',
  'rst',
  'adoc',
  'json',
  'jsonc',
  'json5',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'xml',
  'svg',
  'xhtml',
  'vue',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'gitignore',
  'gitattributes',
  'editorconfig',
  'npmrc',
  'dockerfile',
  'graphql',
  'gql',
  'proto',
  'tf',
  'hcl',
  'env.example',
]);

/** 代码语法配色方案值域（FR-13.4）：classic 经典 / warm 暖纸 / neon 高对比霓虹。 */
export const SYNTAX_SCHEMES = ['classic', 'warm', 'neon'] as const;
export type SyntaxScheme = (typeof SYNTAX_SCHEMES)[number];
export const DEFAULT_SYNTAX_SCHEME: SyntaxScheme = 'classic';

export function isSyntaxScheme(v: unknown): v is SyntaxScheme {
  return typeof v === 'string' && (SYNTAX_SCHEMES as readonly string[]).includes(v);
}
