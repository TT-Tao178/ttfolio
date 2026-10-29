/**
 * 项目头像存储（用户需求 2026-10-29）：每个项目可上传一张方图，替换卡片左上的
 * 蓝底首字母 Avatar；不上传则按原方式显示（可选功能，零迁移——文件存在即有头像，
 * 文件名 = 项目 id + .png，落在数据目录 avatars/ 下，绝不写项目目录）。
 * 软删（unregister）保留文件以便同路径再登记时头像复活；硬删（remove_and_delete）
 * 由路由侧调用 remove 清理。所有函数都假定 id 已通过 ULID 字符集校验（路由层做）。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

/** id 字符集防路径注入（与缩略图路由同款口径） */
export function isSafeProjectId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function avatarPath(dataDir: string, projectId: string): string {
  return path.join(dataDir, 'avatars', `${projectId}.png`);
}

/** 头像是否存在；存在则返回 mtime（毫秒）供前端做缓存穿透参数。 */
export async function avatarInfo(dataDir: string, projectId: string): Promise<number | null> {
  try {
    const st = await fsp.stat(avatarPath(dataDir, projectId));
    return Math.round(st.mtimeMs);
  } catch {
    return null;
  }
}

/** 保存头像（base64 dataURL，仅接受 PNG；调用方负责尺寸/体积校验）。返回 mtime。 */
export async function saveAvatar(dataDir: string, projectId: string, dataUrl: string): Promise<number> {
  const marker = 'data:image/png;base64,';
  // C-02：本项目禁用 startsWith（含非路径场景），用 slice 前缀比较等价替代
  if (dataUrl.slice(0, marker.length) !== marker) {
    throw new Error('仅支持 PNG 图片');
  }
  const b64 = dataUrl.slice(marker.length);
  if (b64.length === 0 || b64.length > 700_000) {
    throw new Error('图片过大（上限约 512KB）');
  }
  const full = avatarPath(dataDir, projectId);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, Buffer.from(b64, 'base64'));
  const st = await fsp.stat(full);
  return Math.round(st.mtimeMs);
}

/** 清除头像（不存在时静默成功，幂等）。 */
export async function removeAvatar(dataDir: string, projectId: string): Promise<void> {
  try {
    await fsp.rm(avatarPath(dataDir, projectId), { force: true });
  } catch {
    /* 幂等 */
  }
}
