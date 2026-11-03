/** projectBadgeColor 单测（2026-11-03）——「按项目稳定着色」的回归锚点：
 *  同一项目永远同一颜色（侧栏 18px 与卡片 24px 同组件同色），改名不跳色（按 id 哈希）。 */
import { describe, expect, it } from 'vitest';
import { PROJECT_BADGE_COLORS, projectBadgeColor } from './tokens';

describe('projectBadgeColor', () => {
  it('同一 id 恒同色；结果恒在色板内', () => {
    const ids = ['01ABCDEF', 'b', 'zzz-长id-项目', 'x'];
    for (const id of ids) {
      expect(projectBadgeColor(id)).toBe(projectBadgeColor(id));
      expect(PROJECT_BADGE_COLORS).toContain(projectBadgeColor(id));
    }
  });
  it('色板 10 色互不相同（同色项目多时仍有区分度）', () => {
    expect(PROJECT_BADGE_COLORS).toHaveLength(10);
    expect(new Set(PROJECT_BADGE_COLORS).size).toBe(10);
  });
});
