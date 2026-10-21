/** 缩略图生成与上传（FR-13.5 / T-113）：
 * 图像优先走 Electron 主进程 nativeImage 解码（absPath → dataURL），Web 模式退回
 * 渲染层 Image 解码；视频封面始终浏览器取帧（3s 超时）。统一在渲染层编码 WebP，
 * 二进制直传服务端落盘（数据目录单写者不变，项目目录零写入）。 */
import { api, rawUrl } from '@/lib/api';
import { thumbNameOf } from './mediaHelpers';
import type { MediaItem } from '@ttfolio/shared';

export const TIER_PX = { g: 640, p: 1920 } as const;
export type ThumbTier = keyof typeof TIER_PX;
const QUALITY: Record<ThumbTier, number> = { g: 0.82, p: 0.85 };
/** 视频取帧超时（T-113 由 8s 收紧到 3s；失败诚实回退图标）。 */
export const VIDEO_FRAME_TIMEOUT_MS = 3000;
/** 失败结果重试间隔（T-113：5 分钟内不再重排，避免滚动反复解码坏图）。 */
export const FAILED_TTL_MS = 5 * 60_000;

function targetSize(sw: number, sh: number, maxPx: number): { w: number; h: number } {
  const scale = Math.min(1, maxPx / Math.max(sw || 1, sh || 1));
  return { w: Math.max(1, Math.round((sw || 1) * scale)), h: Math.max(1, Math.round((sh || 1) * scale)) };
}

async function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
  return img;
}

/** 视频取中点一帧（3s 超时；seek 失败时用首帧兜底）。 */
async function grabVideoFrame(item: MediaItem, projectId: string): Promise<HTMLVideoElement | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = rawUrl(projectId, item.path);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('video load timeout')), VIDEO_FRAME_TIMEOUT_MS);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('video decode failed'));
      };
    });
    const half = Number.isFinite(video.duration) ? video.duration / 2 : 0.1;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        video.currentTime = half;
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    return video;
  } catch {
    return null;
  }
}

/**
 * 生成并上传一档缩略图，返回服务端文件名；失败返回 null（调用方回退图标）。
 * 图像：Electron 桥（nativeImage）优先 → 否则浏览器解码；音频返回 null。
 */
export async function generateThumb(
  projectId: string,
  dirPath: string,
  item: MediaItem,
  tier: ThumbTier,
): Promise<string | null> {
  if (item.kind === 'audio') return null;
  const maxPx = TIER_PX[tier];
  try {
    let source: HTMLImageElement | HTMLVideoElement | null = null;
    if (item.kind === 'image') {
      const native = window.ttfolioNative?.thumbDecode;
      if (native !== undefined && dirPath !== '') {
        // 绝对路径交给主进程原生解码（大图不占渲染线程）
        const absPath = `${dirPath.replace(/[\\/]+$/, '')}/${item.path}`;
        const dataUrl = await native(absPath, maxPx);
        if (dataUrl !== null) source = await loadImageDataUrl(dataUrl);
      }
      if (source === null) source = await loadImageDataUrl(rawUrl(projectId, item.path));
    } else {
      source = await grabVideoFrame(item, projectId);
    }
    if (source === null) return null;

    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    const { w, h } = targetSize(sw, sh, maxPx);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    if (ctx2d === null) return null;
    ctx2d.drawImage(source, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', QUALITY[tier]);
    });
    if (blob === null) return null;
    const name = await thumbNameOf(item.path, tier);
    const r = await api.postBinary<{ thumb: string }>(
      `/api/media/${projectId}/thumb/${tier}?path=${encodeURIComponent(item.path)}`,
      blob,
      'image/webp',
    );
    return r.thumb ?? name;
  } catch {
    return null;
  }
}
