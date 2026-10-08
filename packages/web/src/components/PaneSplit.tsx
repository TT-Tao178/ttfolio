/**
 * 可拖拽分栏（AntD Splitter 封装，antd ≥5.21）。
 *
 * 四条踩坑记录（均由实测得出，勿删）：
 * 1) 受控 `size` 必须配 `onResize`，否则 antd 告警且面板几何错乱；
 * 2) 拖拽条只改变「条左侧那个面板」的尺寸 → 受控面板必须是条左侧的面板；
 *    想控制右侧面板（如右栏详情）须用 measure="last"，以「容器宽 − 目标宽」反算左宽；
 * 3) 容器必须有确定宽度（width:100% / flex:1 + minWidth:0），否则 antd 量不到容器宽，面板会塌成 0；
 * 4) `collapsed` 必须作用在「尺寸归属的面板」上：measure=first 时把左面板归零，
 *    measure=last 时要把左面板撑满（等价于右面板归零）——搞反会让内容区消失、且两条分栏条重叠导致谁都拖不动。
 */
import { Splitter } from 'antd';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { usePaneSize, type UiLayout } from '@/hooks/usePaneSize';

/** antd Splitter 分栏条默认宽度（px），用于反算右侧面板宽度 */
const BAR_W = 6;

interface Props {
  sizeKey: keyof UiLayout;
  defaultSize: number;
  min: number;
  max: number;
  left: React.ReactNode;
  right: React.ReactNode;
  /** 尺寸归属于哪个面板：first=左面板（默认，如侧栏/文件树）；last=右面板（如右栏详情） */
  measure?: 'first' | 'last';
  /** 允许拖到最小时折叠（默认允许） */
  collapsible?: boolean;
  /** 尺寸归属的面板收起（宽度 0）：用于「隐藏右栏」，拖动分栏条即可重新展开 */
  collapsed?: boolean;
  /** 从收起状态被拖动展开时回调（同步「显示右栏」开关） */
  onExpand?: () => void;
  testId?: string;
}

export function PaneSplit({
  sizeKey,
  defaultSize,
  min,
  max,
  left,
  right,
  measure = 'first',
  collapsible = true,
  collapsed = false,
  onExpand,
  testId,
}: Props): React.JSX.Element {
  const { size, setSize, commit } = usePaneSize(sizeKey, defaultSize);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [dragging, setDragging] = useState(false);

  // 用 layout effect：首帧就拿到容器宽，避免 measure=last 时先按 0 计算导致内容塌陷
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const update = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setTotal(Math.round(w) - BAR_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hidden = collapsed && !dragging;
  const leftSize =
    measure === 'first'
      ? hidden
        ? 0
        : size
      : total > 0
        ? hidden
          ? total // 右面板归零 = 左面板占满
          : Math.max(0, total - size)
        : undefined;

  const readTarget = (sizes: number[]): number | null => {
    const v = measure === 'first' ? sizes[0] : sizes[1];
    return typeof v === 'number' ? v : null;
  };

  return (
    <div
      ref={wrapRef}
      style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0 }}
      data-testid={testId}
    >
      <Splitter
        style={{ height: '100%', width: '100%' }}
        onResizeStart={() => setDragging(true)}
        onResize={(sizes) => {
          const v = readTarget(sizes);
          if (v !== null) setSize(v);
        }}
        onResizeEnd={(sizes) => {
          setDragging(false);
          const v = readTarget(sizes);
          const next = v ?? defaultSize;
          if (next >= min) commit(next);
          if (collapsed && next >= min) onExpand?.();
        }}
      >
        <Splitter.Panel
          size={leftSize}
          min={measure === 'first' && !hidden ? min : 0}
          max={measure === 'first' ? max : undefined}
          collapsible={collapsible && !hidden ? { start: true } : false}
        >
          {left}
        </Splitter.Panel>
        <Splitter.Panel>{right}</Splitter.Panel>
      </Splitter>
    </div>
  );
}
