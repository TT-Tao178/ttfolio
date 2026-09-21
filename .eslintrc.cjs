module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { es2022: true, node: true },
  ignorePatterns: ['dist', 'node_modules', '.tmp-test', 'playwright-report', 'test-results', '*.cjs', '*.mjs'],
  rules: {
    'no-console': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      files: ['packages/server/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.property.name='startsWith']",
            message: '禁止 startsWith：路径包含判断一律用 path.relative（约束 C-02）'
          }
        ]
      }
    },
    {
      files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
      env: { browser: true },
      parserOptions: { ecmaFeatures: { jsx: true } },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn'
      }
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
      rules: { 'no-console': 'off' }
    }
  ]
};
