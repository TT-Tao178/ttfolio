/** T-146：鉴权失效判定的单测（哪些状态该弹"服务已重启"，哪些不该）。 */
import { describe, expect, it } from 'vitest';
import { isAuthFailure } from './api';

describe('isAuthFailure', () => {
  it('401 一律算鉴权失效（token 轮换后服务端就是这么回的）', () => {
    expect(isAuthFailure(401, 'PERMISSION_DENIED')).toBe(true);
    expect(isAuthFailure(401, undefined)).toBe(true);
    expect(isAuthFailure(401, 'HTTP_401')).toBe(true);
  });

  it('PERMISSION_DENIED 即使状态码不是 401 也算（Host 校验等场景）', () => {
    expect(isAuthFailure(400, 'PERMISSION_DENIED')).toBe(true);
  });

  it('403 / 404 / 500 不算，避免把业务错误误报成"要刷新"', () => {
    expect(isAuthFailure(403, 'FORBIDDEN')).toBe(false);
    expect(isAuthFailure(404, 'NOT_FOUND')).toBe(false);
    expect(isAuthFailure(500, 'INTERNAL')).toBe(false);
  });
});
