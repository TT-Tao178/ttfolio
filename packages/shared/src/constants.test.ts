/** 回归锚点：syntax_scheme 设置键（FR-13.4 / T-098）——值域校验与默认值兜底。 */
import { describe, expect, it } from 'vitest';
import { SETTING_KEYS, SYNTAX_SCHEMES, DEFAULT_SYNTAX_SCHEME, isSyntaxScheme } from './constants.js';

describe('syntax_scheme（代码配色方案键）', () => {
  it('键名注册且值域三案', () => {
    expect(SETTING_KEYS.syntaxScheme).toBe('syntax_scheme');
    expect([...SYNTAX_SCHEMES]).toEqual(['classic', 'warm', 'neon']);
    expect(DEFAULT_SYNTAX_SCHEME).toBe('classic');
  });

  it('isSyntaxScheme：合法值放行，未知/非字符串回落（服务端 PATCH 与 GET 投影共用）', () => {
    expect(isSyntaxScheme('warm')).toBe(true);
    expect(isSyntaxScheme('neon')).toBe(true);
    expect(isSyntaxScheme('classic')).toBe(true);
    expect(isSyntaxScheme('solarized')).toBe(false);
    expect(isSyntaxScheme(42)).toBe(false);
    expect(isSyntaxScheme(undefined)).toBe(false);
  });
});
