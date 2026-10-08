/**
 * 图片预览（第 27 轮增强：缩放查看器）。
 * 数据通道不变——经用户内容端口 /raw 只读代理，绝不写盘。
 * 功能：适应窗口/1:1/±缩放（含 Ctrl+滚轮）、像素尺寸信息、复制相对路径、新窗口打开原图、
 *       棋盘格背景（透明 PNG 可见）、加载失败空态。
 */
import { Button, Empty, Space, Tooltip } from 'antd';
import {
  CopyOutlined,
  DragOutlined,
  OneToOneOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import React, { useEffect, useRef, useState } from 'react';
import { rawUrl } from '@/lib/api';
import { SEMANTIC } from '@/theme/tokens';

const MIN = 0.1;
const MAX = 8;
const STEP = 1.2;

/** 棋盘格背景（透明 PNG 可见性） */
const checkerBg: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.12) 75%),' +
    'linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.12) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

export function ImagePreview({ projectId, path }: { projectId: string; path: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  /** scale=null 表示「适应窗口」（maxWidth/maxHeight 100%），数字为相对原始尺寸的倍率 */
  const [scale, setScale] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const fileName = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const url = rawUrl(projectId, path);

  // 换图重置视图
  useEffect(() => {
    setFailed(false);
    setNatural(null);
    setScale(null);
  }, [path]);

  // Ctrl+滚轮缩放（原生监听以 preventDefault——React 合成滚轮是 passive）
  useEffect(() => {
    const el = canvasRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((prev) => {
        const base = prev ?? 1;
        const next = e.deltaY < 0 ? base * STEP : base / STEP;
        return Math.min(MAX, Math.max(MIN, Number(next.toFixed(3))));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [failed]);

  const stepZoom = (dir: 1 | -1): void =>
    setScale((prev) =>
      Math.min(MAX, Math.max(MIN, Number(((prev ?? 1) * (dir === 1 ? STEP : 1 / STEP)).toFixed(3)))),
    );

  const dimText = natural !== null ? `${natural.w} × ${natural.h}` : '…';
  const percentText = scale === null ? '适应' : `${Math.round(scale * 100)}%`;

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, minHeight: 0 }}
    >
      {/* 工具栏 */}
      <Space size={4} wrap>
        <span className="tt-ellipsis" style={{ maxWidth: 260, fontSize: 12, fontWeight: 600 }} title={path}>
          {fileName}
        </span>
        <span style={{ fontSize: 12, opacity: 0.6 }} data-testid="image-dim">
          {dimText}
        </span>
        <Space.Compact>
          <Tooltip title="缩小">
            <Button
              size="small"
              icon={<ZoomOutOutlined />}
              onClick={() => stepZoom(-1)}
              data-testid="img-zoom-out"
            />
          </Tooltip>
          <Tooltip title="点击回到 100%">
            <Button
              size="small"
              style={{ minWidth: 56 }}
              onClick={() => setScale(1)}
              data-testid="img-zoom-label"
            >
              {percentText}
            </Button>
          </Tooltip>
          <Tooltip title="放大">
            <Button
              size="small"
              icon={<ZoomInOutlined />}
              onClick={() => stepZoom(1)}
              data-testid="img-zoom-in"
            />
          </Tooltip>
          <Tooltip title="适应窗口（整图可见）">
            <Button
              size="small"
              icon={<DragOutlined />}
              onClick={() => setScale(null)}
              data-testid="img-fit"
            />
          </Tooltip>
          <Tooltip title="按原始尺寸 1:1 显示">
            <Button size="small" icon={<OneToOneOutlined />} onClick={() => setScale(1)} />
          </Tooltip>
        </Space.Compact>
        <Tooltip title="复制相对路径">
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              void navigator.clipboard.writeText(path).catch(() => {});
            }}
            data-testid="img-copy-path"
          />
        </Tooltip>
        <Tooltip title="在新窗口打开原图">
          <Button size="small" onClick={() => window.open(url, '_blank')} data-testid="img-open-new">
            原图
          </Button>
        </Tooltip>
        <span style={{ fontSize: 11, opacity: 0.5 }}>Ctrl+滚轮缩放</span>
      </Space>
      {/* 画布：棋盘格底（透明可见），overflow auto 支持放大后平移查看 */}
      <div
        ref={canvasRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          borderRadius: 8,
          border: `1px solid ${SEMANTIC.split}`,
          ...checkerBg,
          display: 'flex',
        }}
        data-testid="image-canvas"
      >
        {failed ? (
          <Empty
            description={'无法加载：' + path}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: 'auto' }}
          />
        ) : (
          <img
            ref={imgRef}
            src={url}
            alt={path}
            data-testid="image-view"
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            onError={() => setFailed(true)}
            draggable={false}
            style={
              scale === null
                ? {
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    margin: 'auto',
                    borderRadius: 4,
                  }
                : {
                    width: (natural?.w ?? 0) * scale || undefined,
                    imageRendering: scale > 2 ? 'pixelated' : 'auto',
                    margin: 'auto',
                  }
            }
          />
        )}
      </div>
    </div>
  );
}
