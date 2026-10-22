/**
 * ESLint flat config（第 64 轮自 eslint 8 eslintrc 迁移；eslint 10 起仅支持 flat）。
 * 规则 1:1 迁移自 .eslintrc.cjs：no-console / no-explicit-any / no-non-null-assertion /
 * no-unused-vars(^_) / C-02 禁 startsWith（server+shared）/ react-hooks 两规则（web）/
 * 测试文件免 no-console。eslint-plugin-react 在旧配置里无任何启用规则，迁移时移除。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      '.tmp-test/**',
      'playwright-report/**',
      'test-results/**',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // TS 编译器已负责未定义标识符检查（no-undef 对 TS 误报浏览器/Node 全局）
      'no-undef': 'off',
      // eslint 10 新增规则：本仓库「let x = 初值; try { x = 真值 } catch { 跳过 }」的
      // 防御式写法里初值是压 TS2454 的必要存在，成片误报（23 处）——关闭保持旧门禁等价
      'no-useless-assignment': 'off',
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/server/src/**/*.ts', 'packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='startsWith']",
          message: '禁止 startsWith：路径包含判断一律用 path.relative（约束 C-02）',
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
