/** 媒体扩展名识别（FR-13.5 / T-099）：分析器扫描与前端分流共用同一份映射。 */
export type MediaKind = 'image' | 'video' | 'audio';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];

const KINDS = new Map<string, MediaKind>([
  ...IMAGE_EXTS.map((e) => [e, 'image'] as const),
  ...VIDEO_EXTS.map((e) => [e, 'video'] as const),
  ...AUDIO_EXTS.map((e) => [e, 'audio'] as const),
]);

/** 按文件名（或任意含扩展名的字符串）判媒体类型；非媒体返回 null。 */
export function mediaKindOf(name: string): MediaKind | null {
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf(String.fromCharCode(92)));
  const base = name.slice(lastSlash + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  return KINDS.get(base.slice(dot + 1).toLowerCase()) ?? null;
}
