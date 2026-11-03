/** 媒体派生数据计算（FR-15.4 / T-145）：aHash 64bit + 主色 12 色桶占比。
 *  解码链复用 thumbGen 同款（Electron nativeImage dataURL 优先 / Web rawUrl 兜底；
 *  视频取中点帧）——两者都同源可读，canvas getImageData 不受跨端口污染。
 *  色桶：hue/30 取整 0..11（低饱和像素跳过——灰阶主导的图各桶占比自然偏低，
 *  主色筛选按占比阈值命中，语义仍成立）。 */
import { rawUrl } from '@/lib/api';
import type { MediaItem } from '@ttfolio/shared';

export interface MediaDerivative {
  phash: string;
  colors: Record<string, number>;
}

/** 12 色桶中文名与色样（工具条筛选按钮用） */
export const COLOR_BUCKETS: Array<{ id: string; name: string; css: string }> = (
  ['红', '橙', '黄', '黄绿', '绿', '青', '天蓝', '蓝', '靛', '紫', '品红', '玫红'] as const
).map((name, i) => ({ id: String(i), name, css: `hsl(${i * 30}, 72%, 55%)` }));

async function loadImageDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
  return img;
}

/** 与 thumbGen 同款取源：图片走 nativeImage dataURL 优先 / rawUrl 兜底；视频取中点帧。 */
async function loadSource(
  item: MediaItem,
  projectId: string,
  dirPath: string,
): Promise<HTMLImageElement | HTMLVideoElement> {
  if (item.kind === 'video') {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = rawUrl(projectId, item.path);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('video load timeout')), 3000);
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min((video.duration || 1) / 2, (video.duration || 1) - 0.1);
        } catch {
          // seek 失败用首帧兜底
        }
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('video decode failed'));
      };
    });
    return video;
  }
  const native = window.ttfolioNative?.thumbDecode;
  if (typeof native === 'function' && dirPath !== '') {
    const abs = `${dirPath}\\${item.path.replaceAll('/', '\\')}`;
    const dataUrl = await native(abs, 64);
    if (dataUrl !== null) return await loadImageDataUrl(dataUrl);
  }
  return await loadImageDataUrl(rawUrl(projectId, item.path));
}

function rgbToHueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = d / max;
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, sat };
}

/** 计算 aHash（8×8 均值二值化）+ 主色 12 桶占比（低饱和像素不计入色桶）。 */
export async function computeDerivative(
  item: MediaItem,
  projectId: string,
  dirPath: string,
): Promise<MediaDerivative | null> {
  const source = await loadSource(item, projectId, dirPath);
  const isVideo = 'videoWidth' in source;
  const sw = isVideo ? source.videoWidth : source.naturalWidth;
  const sh = isVideo ? source.videoHeight : source.naturalHeight;
  if (!sw || !sh) return null;
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(source, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;

  // 8×8 灰度均值 → aHash
  const gray = new Float64Array(64);
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let sum = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = ((by * 4 + y) * N + (bx * 4 + x)) * 4;
          const r = data[px] ?? 0;
          const g = data[px + 1] ?? 0;
          const b = data[px + 2] ?? 0;
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
        }
      }
      gray[by * 8 + bx] = sum / 16;
    }
  }
  const mean = gray.reduce((s, v) => s + v, 0) / 64;
  let bits = '';
  for (let i = 0; i < 64; i++) {
    const g0 = gray[i] ?? 0;
    bits += g0 >= mean ? '1' : '0';
  }
  let phash = '';
  for (let i = 0; i < 64; i += 4) phash += parseInt(bits.slice(i, i + 4), 2).toString(16);

  // 主色 12 桶（低饱和像素跳过；占比按有彩像素归一）
  const counts = new Array<number>(12).fill(0);
  let colored = 0;
  const bump = (i: number): void => {
    const cur = counts[i];
    if (cur !== undefined) counts[i] = cur + 1;
  };
  for (let i = 0; i < N * N; i++) {
    const px = i * 4;
    const { hue, sat } = rgbToHueSat(data[px] ?? 0, data[px + 1] ?? 0, data[px + 2] ?? 0);
    if (sat < 0.1) continue;
    bump(Math.floor(hue / 30) % 12);
    colored += 1;
  }
  const colors: Record<string, number> = {};
  if (colored > 0) {
    for (let i = 0; i < 12; i++) {
      const share = (counts[i] ?? 0) / colored;
      if (share >= 0.04) colors[String(i)] = Math.round(share * 1000) / 1000;
    }
  }
  return { phash, colors };
}

/** aHash 汉明距离（两串 16 hex = 64bit）。 */
export function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = parseInt(a[i] ?? '0', 16) ^ parseInt(b[i] ?? '0', 16);
    d +=
      ((x & 1) !== 0 ? 1 : 0) + ((x & 2) !== 0 ? 1 : 0) + ((x & 4) !== 0 ? 1 : 0) + ((x & 8) !== 0 ? 1 : 0);
  }
  return d + Math.abs(a.length - b.length) * 4;
}

/** 主色筛选阈值：该桶占比 ≥25% 视为命中（一张图通常 2~3 个主色桶）。 */
export const COLOR_FILTER_THRESHOLD = 0.25;
