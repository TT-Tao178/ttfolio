/** 预览分发器（FR-13.9 / T-106a）：按扩展名决定文件右栏用哪个查看器。 */

export type ViewerKind = 'office' | 'image' | 'editor';

/**
 * Office 预览白名单：与文档中心 OfficePreview 同源（GET /api/docs/raw，
 * 50MB 服务端上限）。csv 刻意不在内——它在文件工作台一直是可编辑文本，
 * 走表格预览会丢编辑能力（行为回归）。
 */
export const OFFICE_PREVIEW_EXTS = ['docx', 'pdf', 'xlsx', 'xls'] as const;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

export function extOfPath(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m?.[1] ?? '').toLowerCase();
}

export function resolveViewer(path: string): ViewerKind {
  const ext = extOfPath(path);
  if ((OFFICE_PREVIEW_EXTS as readonly string[]).includes(ext)) return 'office';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return 'editor';
}
