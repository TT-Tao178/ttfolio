/** 媒体网格自动滚动控件（FR-13.5）：箭头启动/停止、数字调速度（px/s）；
 * 到底自动停止；触摸/点按媒体即停止（滚轮不打断，可边滚边续）。速度记 localStorage。 */
import { useEffect, useRef, useState } from 'react';
import { Button, InputNumber, Tooltip } from 'antd';
import { PauseOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';

const SPEED_KEY = 'ttfolio.media.scrollSpeed';
const MIN_SPEED = 20;
const MAX_SPEED = 600;
const DEFAULT_SPEED = 160;

function readSpeed(): number {
  try {
    const v = Number(window.localStorage.getItem(SPEED_KEY));
    return Number.isFinite(v) && v >= MIN_SPEED && v <= MAX_SPEED ? v : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

export function AutoScrollControl({
  targetRef,
}: {
  targetRef: { readonly current: HTMLDivElement | null };
}): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(readSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // 自动滚动：rAF 按 px/s 推进；速度读 ref，所以改数字即时生效、无需重启
  useEffect(() => {
    if (!playing) return undefined;
    const el = targetRef.current;
    if (el === null) return undefined;
    let raf = 0;
    let last = 0;
    let cancelled = false;
    const tick = (ts: number): void => {
      if (cancelled) return;
      const dt = last === 0 ? 0 : Math.min(64, ts - last);
      last = ts;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 1 || el.scrollTop >= max - 0.5) {
        setPlaying(false);
        return;
      }
      el.scrollTop = Math.min(max, el.scrollTop + (speedRef.current * dt) / 1000);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [playing, targetRef]);

  // 触摸/点按媒体：停止并交还控制权（滚轮不打断，按用户口径保留自动滚动）
  useEffect(() => {
    const el = targetRef.current;
    if (el === null) return undefined;
    const stop = (): void => setPlaying(false);
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('pointerdown', stop);
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('pointerdown', stop);
    };
  }, [targetRef]);

  const toggle = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const el = targetRef.current;
    if (el === null) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 1) return; // 没有可滚内容：静默（按钮无副作用）
    if (el.scrollTop >= max - 1) el.scrollTop = 0; // 到底再点：从头开始
    setPlaying(true);
  };

  const change = (v: number | null): void => {
    if (v === null || !Number.isFinite(v)) return;
    const next = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(v)));
    setSpeed(next);
    try {
      window.localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      /* 隐私模式等写入失败：仅本次生效 */
    }
  };

  return (
    <div
      data-testid="media-autoscroll"
      className="tt-autoscroll"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 28,
        padding: '0 4px',
        border: '1px solid var(--tt-border)',
        borderRadius: 6,
      }}
    >
      <Tooltip title={playing ? '停止自动滚动' : '自动向下滚动'}>
        <Button
          size="small"
          type="text"
          aria-label={playing ? '停止自动滚动' : '自动向下滚动'}
          icon={playing ? <PauseOutlined /> : <VerticalAlignBottomOutlined />}
          onClick={toggle}
          style={{ width: 24, height: 24, minWidth: 24, padding: 0 }}
        />
      </Tooltip>
      <InputNumber
        size="small"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={20}
        value={speed}
        onChange={change}
        aria-label="自动滚动速度"
        style={{ width: 62 }}
      />
      <span style={{ fontSize: 12, opacity: 0.6 }}>px/s</span>
    </div>
  );
}
