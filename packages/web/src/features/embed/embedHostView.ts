/**
 * 寄宿面板的纯逻辑（T-131 / FR-14.3 T1）：浮层遮挡判定与可见性推导。
 *
 * 为什么单独抽一个文件：空域（airspace）判定是这套功能最容易散写的地方——原生子窗口不参与
 * CSS 层叠，任何盖在面板矩形上的 ttFolio 浮层都会被它压住。口径只能有一份，且要能在 node
 * 环境单测（不依赖 DOM）。真正的 ShowWindow 由主进程的推导函数执行，这里只产出"该不该显示"。
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 可见浮层的选择器（AntD 默认把浮层挂到 body 下）。tooltip/popover 也计入：它们
 * 若压在寄宿区上同样会被原生窗口盖掉；是否真的"挡住"由矩形相交判定，面板头部按钮的
 * 提示自然不相交，不会让画面无谓闪烁。
 */
export const OVERLAY_SELECTOR = [
  '.ant-modal-root',
  '.ant-drawer',
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-picker-dropdown',
  '.ant-image-preview-root',
  '.ant-message',
  '.ant-notification',
  '.ant-popover',
  '.ant-tooltip',
].join(',');

/** AntD 用这些 class 表示"已关闭但节点还在 DOM 里"，计数时必须排除。 */
export const HIDDEN_OVERLAY_CLASSES = [
  'ant-dropdown-hidden',
  'ant-select-dropdown-hidden',
  'ant-picker-dropdown-hidden',
  'ant-popover-hidden',
  'ant-tooltip-hidden',
  'ant-modal-hidden',
  'ant-zoom-leave',
  'ant-fade-leave',
];

export interface OverlayProbe {
  /** 元素视口矩形；null 表示尺寸为 0（display:none / 未布局） */
  box: Box | null;
  hidden: boolean;
}

export function toBox(rect: { left: number; top: number; width: number; height: number }): Box | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
}

/** 严格相交：仅边贴边不算遮挡（否则面板紧邻的浮层会触发无意义隐藏）。 */
export function rectsOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 统计真正压住寄宿区（未隐藏、有尺寸、与宿主矩形相交）的浮层数量。 */
export function countBlockingOverlays(probes: OverlayProbe[], host: Box): number {
  let n = 0;
  for (const p of probes) {
    if (p.hidden || p.box === null) continue;
    if (rectsOverlap(p.box, host)) n += 1;
  }
  return n;
}

/**
 * 可见性推导（设计 §3.5）：渲染层只负责把"该不该显示"这一个布尔值交给主进程，
 * 主进程再与 attached / 最小化合并成唯一的 ShowWindow 依据。绝不允许在这里直接开关窗口。
 */
export function deriveHostVisible(input: {
  attached: boolean;
  overlayCount: number;
  panelOpen: boolean;
}): boolean {
  return input.attached && input.panelOpen && input.overlayCount <= 0;
}
