/**
 * 寄宿面板纯逻辑单测（T-131）：空域判定与可见性推导。
 * 回归锚点：浮层"已关闭但节点还在 DOM"不能算遮挡、贴边不算相交、
 * 最小化/浮层/切模式的组合不能推出"永久隐藏"。
 */
import { describe, expect, it } from 'vitest';
import { countBlockingOverlays, deriveHostVisible, rectsOverlap, toBox, type Box } from './embedHostView';

const host: Box = { left: 1000, top: 100, right: 1400, bottom: 800 };

const probe = (box: Box | null, hidden = false): { box: Box | null; hidden: boolean } => ({ box, hidden });

describe('rectsOverlap', () => {
  it('相交为真', () => {
    expect(rectsOverlap({ left: 900, top: 0, right: 1100, bottom: 200 }, host)).toBe(true);
  });

  it('完全包含为真（全屏遮罩）', () => {
    expect(rectsOverlap({ left: 0, top: 0, right: 4000, bottom: 3000 }, host)).toBe(true);
  });

  it('仅边贴边不算遮挡（否则紧邻的浮层会让画面无谓闪烁）', () => {
    expect(rectsOverlap({ left: 600, top: 100, right: 1000, bottom: 800 }, host)).toBe(false);
    expect(rectsOverlap({ left: 1000, top: 800, right: 1400, bottom: 900 }, host)).toBe(false);
  });

  it('完全在左/上侧为假', () => {
    expect(rectsOverlap({ left: 0, top: 0, right: 200, bottom: 200 }, host)).toBe(false);
  });
});

describe('toBox', () => {
  it('零尺寸视为不存在（display:none 的残留节点）', () => {
    expect(toBox({ left: 0, top: 0, width: 0, height: 100 })).toBeNull();
    expect(toBox({ left: 0, top: 0, width: 100, height: 0 })).toBeNull();
  });

  it('正常矩形换算成四边', () => {
    expect(toBox({ left: 10, top: 20, width: 30, height: 40 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 60,
    });
  });
});

describe('countBlockingOverlays', () => {
  it('只有相交且未隐藏的浮层计入', () => {
    const probes = [
      probe({ left: 900, top: 0, right: 1100, bottom: 200 }, true), // 隐藏的下拉
      probe(null), // 零尺寸
      probe({ left: 0, top: 0, right: 200, bottom: 200 }), // 不遮面板
      probe({ left: 0, top: 0, right: 4000, bottom: 3000 }), // Modal 遮罩
    ];
    expect(countBlockingOverlays(probes, host)).toBe(1);
  });

  it('空列表为 0', () => {
    expect(countBlockingOverlays([], host)).toBe(0);
  });

  it('面板头部的 tooltip 不遮寄宿区 → 不触发隐藏', () => {
    // 头部提示在面板上方，与寄宿区不重叠
    expect(countBlockingOverlays([probe({ left: 1010, top: 60, right: 1100, bottom: 96 })], host)).toBe(0);
  });
});

describe('deriveHostVisible', () => {
  it('寄宿中且无浮层才显示', () => {
    expect(deriveHostVisible({ attached: true, overlayCount: 0, panelOpen: true })).toBe(true);
  });

  it('浮层打开 → 让位', () => {
    expect(deriveHostVisible({ attached: true, overlayCount: 1, panelOpen: true })).toBe(false);
  });

  it('未寄宿/面板关闭 → 不显示（调用方无需另行短路）', () => {
    expect(deriveHostVisible({ attached: false, overlayCount: 0, panelOpen: true })).toBe(false);
    expect(deriveHostVisible({ attached: true, overlayCount: 0, panelOpen: false })).toBe(false);
  });

  it('浮层关闭后恢复显示（不会残留在隐藏态）', () => {
    const blocked = deriveHostVisible({ attached: true, overlayCount: 2, panelOpen: true });
    const restored = deriveHostVisible({ attached: true, overlayCount: 0, panelOpen: true });
    expect(blocked).toBe(false);
    expect(restored).toBe(true);
  });
});
