/** 媒体灯箱（FR-13.5 / T-099）：缩放平移 / 前后翻页 / 键盘操作 / 幻灯片
 * （间隔、全屏、循环）；音频内嵌播放并在条目间连播；视频内嵌播放
 * （Range 拖进度）。Esc 关闭。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  FullscreenOutlined,
  PauseOutlined,
  CaretRightOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { rawUrl } from '@/lib/api';
import { KIND_LABEL } from './mediaHelpers';
import type { MediaItem } from '@ttfolio/shared';

export function Lightbox({
  projectId,
  items,
  index,
  onIndexChange,
  onClose,
  loop,
}: {
  projectId: string;
  items: MediaItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  loop: boolean;
}): React.JSX.Element | null {
  const item = items[index];
  const dark = false; // 灯箱固定深底，与主题无关
  void dark;
  const [scale, setScale] = useState<number | null>(null); // null=适应窗口
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [playing, setPlaying] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      let next = index + delta;
      if (next < 0) next = loop ? items.length - 1 : 0;
      if (next >= items.length) next = loop ? 0 : items.length - 1;
      onIndexChange(next);
    },
    [index, items.length, loop, onIndexChange],
  );

  // 换条目重置视图
  useEffect(() => {
    setScale(null);
    setOffset({ x: 0, y: 0 });
  }, [index]);

  // 键盘：←/→ 翻页、Esc 关闭、空格播放暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === ' ' && item?.kind !== 'audio') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, item?.kind]);

  // 幻灯片：仅图片翻页（音视频交给播放器自身）
  useEffect(() => {
    if (!playing) return undefined;
    if (item?.kind !== 'image') return undefined;
    const timer = setInterval(() => go(1), 3000);
    return () => clearInterval(timer);
  }, [playing, item?.kind, go]);

  if (item === undefined) return null;
  const url = rawUrl(projectId, item.path);
  const name = item.path.slice(item.path.lastIndexOf('/') + 1);
  const zoomBy = (factor: number): void => {
    setScale((s) => {
      const cur = s ?? 1;
      return Math.min(8, Math.max(0.1, cur * factor));
    });
  };

  return (
    <div
      ref={shellRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,.88)',
        display: 'flex',
        flexDirection: 'column',
      }}
      data-testid="media-lightbox"
    >
      {/* 顶栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          color: 'rgba(255,255,255,.85)',
        }}
      >
        <span
          className="tt-mono"
          style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={item.path}
        >
          {item.path}
        </span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {index + 1}/{items.length} · {KIND_LABEL[item.kind]}
        </span>
        <span style={{ flex: 1 }} />
        {item.kind === 'image' && (
          <>
            <Button
              size="small"
              ghost
              onClick={() => setPlaying((p) => !p)}
              icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
            >
              {playing ? '暂停放映' : '幻灯片'}
            </Button>
            <Button
              size="small"
              ghost
              icon={<ReloadOutlined />}
              onClick={() => setScale(null)}
              title="适应窗口"
            />
            <Button size="small" ghost onClick={() => zoomBy(1.25)}>
              +
            </Button>
            <Button size="small" ghost onClick={() => zoomBy(0.8)}>
              −
            </Button>
            <Button
              size="small"
              ghost
              icon={<FullscreenOutlined />}
              onClick={() => {
                if (document.fullscreenElement !== null) void document.exitFullscreen();
                else void shellRef.current?.requestFullscreen();
              }}
            />
          </>
        )}
        <Button size="small" ghost icon={<CloseOutlined />} onClick={onClose} data-testid="lightbox-close" />
      </div>

      {/* 内容区 */}
      <div
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', textAlign: 'center' }}
        onMouseDown={(e) => {
          if (item.kind !== 'image') return;
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onMouseMove={(e) => {
          const d = dragRef.current;
          if (d === null) return;
          setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
        }}
        onMouseUp={() => {
          dragRef.current = null;
        }}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
        onWheel={(e) => {
          if (item.kind !== 'image') return;
          if (e.ctrlKey || Math.abs(e.deltaY) > 0) zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
        }}
      >
        {item.kind === 'image' && (
          <img
            src={url}
            alt={name}
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              margin: 'auto',
              maxWidth: '100%',
              maxHeight: '100%',
              userSelect: 'none',
              cursor: scale === null ? 'zoom-in' : 'grab',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale ?? 1})`,
              transition: dragRef.current === null ? 'transform .12s' : 'none',
            }}
          />
        )}
        {item.kind === 'video' && (
          <video
            key={item.path}
            src={url}
            controls
            autoPlay
            style={{ position: 'absolute', inset: 0, margin: 'auto', maxWidth: '100%', maxHeight: '100%' }}
            data-testid="lightbox-video"
          />
        )}
        {item.kind === 'audio' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              color: 'rgba(255,255,255,.85)',
            }}
          >
            <div style={{ fontSize: 40 }}>♪</div>
            <div className="tt-mono" style={{ fontSize: 13 }}>
              {name}
            </div>
            {/* 连播：本条播完自动下一条（loop 关闭时到最后一条即停） */}
            <audio
              key={item.path}
              src={url}
              controls
              autoPlay
              onEnded={() => {
                if (loop || index < items.length - 1) go(1);
              }}
              style={{ width: 420, maxWidth: '80%' }}
              data-testid="lightbox-audio"
            />
          </div>
        )}

        {/* 翻页热区 */}
        {items.length > 1 && (
          <>
            <Tooltip title="上一个（←）">
              <Button
                shape="circle"
                ghost
                icon={<ArrowLeftOutlined />}
                onClick={() => go(-1)}
                disabled={!loop && index === 0}
                style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }}
              />
            </Tooltip>
            <Tooltip title="下一个（→）">
              <Button
                shape="circle"
                ghost
                icon={<ArrowRightOutlined />}
                onClick={() => go(1)}
                disabled={!loop && index === items.length - 1}
                style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)' }}
              />
            </Tooltip>
          </>
        )}
      </div>
      <div
        style={{ padding: '4px 12px 8px', color: 'rgba(255,255,255,.45)', fontSize: 12, textAlign: 'center' }}
      >
        ←/→ 翻页 · Esc 关闭 · 图片 Ctrl+滚轮缩放拖动平移 · 空格放映{loop ? ' · 循环开' : ''}
      </div>
    </div>
  );
}
