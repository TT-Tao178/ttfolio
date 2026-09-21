/**
 * PathGuard（C-01/C-02/FS-1..3）：所有用户文件操作的第一道关，无旁路。
 * 校验链：resolve → 拒绝保留名/ADS/UNC/尾随点空格 → realpath → path.relative 判断白名单。
 * 禁止 startsWith（机械检查 M2）；白名单 = 项目目录 + 该项目文档挂载 + 该项目架构图目录。
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { AppError } from './errors.js';

/** Windows 保留名（含带扩展名形式）：CON/PRN/AUX/NUL/COM1-9/LPT1-9 */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ILLEGAL_CHARS = /[\\/:*?"<>|]/;

/** 校验"新建/重命名"的名字（不涉及路径分隔符）。 */
export function assertSafeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new AppError('INVALID_NAME', '名字不能为空或只有点号');
  }
  if (ILLEGAL_CHARS.test(trimmed)) {
    throw new AppError('INVALID_NAME', '名字包含非法字符 \\ / : * ? " < > |');
  }
  if (RESERVED_NAME.test(trimmed)) {
    throw new AppError('INVALID_NAME', `名字是 Windows 保留名：${trimmed}`);
  }
  if (trimmed.endsWith('.') || name.endsWith('.') || name.endsWith(' ')) {
    throw new AppError('INVALID_NAME', '名字不能以点或空格结尾');
  }
  return trimmed;
}

/** 校验一个已拼接的绝对路径段：拒绝 UNC、ADS、尾随点/空格、保留名段。 */
export function assertNoWindowsPathHazards(absPath: string): void {
  if (absPath.includes('//') || /\\\\/.test(absPath.slice(2))) {
    throw new AppError('PATH_OUT_OF_SCOPE', '路径包含异常分隔符');
  }
  if (absStartsWithDoubleSlash(absPath)) {
    throw new AppError('PATH_OUT_OF_SCOPE', '不允许 UNC 路径');
  }
  const colonCount = (absPath.match(/:/g) ?? []).length;
  const driveColon = /^[a-zA-Z]:(\\|\/|$)/.test(absPath) ? 1 : 0;
  if (colonCount > driveColon) {
    throw new AppError('PATH_OUT_OF_SCOPE', '不允许 ADS（备用数据流）路径');
  }
  for (const seg of absPath.split(/[\\/]/)) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    if (RESERVED_NAME.test(seg)) {
      throw new AppError('PATH_OUT_OF_SCOPE', `路径包含 Windows 保留名：${seg}`);
    }
    if (seg.endsWith('.') || seg.endsWith(' ')) {
      throw new AppError('PATH_OUT_OF_SCOPE', `路径段以点或空格结尾：${seg}`);
    }
  }
}

function absStartsWithDoubleSlash(p: string): boolean {
  return p.indexOf('\\\\') === 0 || p.indexOf('//') === 0;
}

/** path.relative 判定 child 是否在 parent 内（含相等）。绝不使用 startsWith。 */
export function isInsideOrEqual(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).includes('..');
}

export interface PathGuardRequest {
  /** 用户给出的路径：项目根的相对路径或绝对路径 */
  userPath: string;
  /** 该请求允许活动的白名单根（已 realpath 的真实路径） */
  allowedRoots: string[];
  /** 白名单根的原始登记路径（用于把用户绝对路径先映射进白名单再 realpath） */
  registeredRoots?: string[];
}

export interface GuardedPath {
  /** realpath 之后的绝对路径 */
  real: string;
  /** 相对第一个命中的白名单根的路径（/ 分隔） */
  relToRoot: string;
  root: string;
}

/**
 * 唯一入口：解析 → 危险段检查 → realpath → 包含判定。
 * anyOf：realpath 失败（目标不存在）时，退化为词法解析校验（新建场景），父目录必须真实存在于白名单内。
 */
export async function guardPath(req: PathGuardRequest, opts: { mustExist: boolean }): Promise<GuardedPath> {
  const abs = path.resolve(req.userPath);
  assertNoWindowsPathHazards(abs);

  let real: string;
  try {
    real = await fsp.realpath(abs);
  } catch {
    if (opts.mustExist) {
      throw new AppError('NOT_FOUND', `路径不存在：${req.userPath}`);
    }
    // 新建场景：逐级向上找最近的真实存在祖先，它必须在白名单内
    let ancestor = path.dirname(abs);
    let ancestorReal: string | null = null;
    for (let i = 0; i < 64; i++) {
      try {
        ancestorReal = await fsp.realpath(ancestor);
        break;
      } catch {
        ancestor = path.dirname(ancestor);
      }
    }
    if (ancestorReal === null) {
      throw new AppError('NOT_FOUND', `路径不存在且无法定位祖先：${req.userPath}`);
    }
    assertNoWindowsPathHazards(ancestorReal);
    const hit = inRoots(req.allowedRoots, ancestorReal);
    if (!hit) throw new AppError('PATH_OUT_OF_SCOPE', '目标路径不在任何已登记目录内');
    const rel = path.relative(ancestorReal, abs).split(path.sep).join('/');
    if (rel.split('/').includes('..')) {
      throw new AppError('PATH_OUT_OF_SCOPE', '目标路径越界');
    }
    return { real: abs, relToRoot: rel, root: hit.root };
  }

  assertNoWindowsPathHazards(real);
  const hit = inRoots(req.allowedRoots, real);
  if (!hit) throw new AppError('PATH_OUT_OF_SCOPE', '目标路径不在任何已登记目录内');
  const relToRoot = path.relative(hit.root, real).split(path.sep).join('/');
  return { real, relToRoot, root: hit.root };
}

function inRoots(
  allowedRoots: string[],
  real: string
): { root: string } | null {
  for (const root of allowedRoots) {
    if (isInsideOrEqual(root, real)) return { root };
  }
  return null;
}

/** 词法解析相对路径（不做 IO）：用于先检查再 realpath 的两段式调用。 */
export function resolveWithin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  assertNoWindowsPathHazards(abs);
  if (!isInsideOrEqual(path.resolve(root), abs)) {
    throw new AppError('PATH_OUT_OF_SCOPE', '相对路径越界');
  }
  return abs;
}
