/**
 * fsx：文件系统工具箱（C-01/FS 系列约束）。
 * packages/server 内所有对文件系统的直接访问都必须经过本文件（pathGuard 同属 core）。
 * 原子写 = 同目录临时文件 + fsync + rename；编码与换行原样保持。
 */
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import iconv from 'iconv-lite';
import { AppError, isErrnoException } from './errors.js';
import { ulid } from './ulid.js';
import type { FileContent } from '@ttfolio/shared';

export type DetectedEncoding = FileContent['encoding'];
export type DetectedEol = FileContent['eol'];

export interface ReadTextResult {
  content: string;
  encoding: DetectedEncoding;
  eol: DetectedEol;
  size: number;
  mtimeMs: number;
  hash: string;
}

export function exists(p: string): boolean {
  return existsSync(p);
}

export function statSafe(
  p: string,
): { size: number; mtimeMs: number; isDir: boolean; mtimeIso: string } | null {
  try {
    const st = statSync(p);
    return {
      size: Number(st.size),
      mtimeMs: st.mtimeMs,
      isDir: st.isDirectory(),
      mtimeIso: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export interface FsEntry {
  name: string;
  isDir: boolean;
  isFile: boolean;
  /** 是否为符号链接 / junction（Windows 上 readdir 对二者 isDirectory/isFile 均为 false，必须单独判定） */
  isSymlink: boolean;
  /** 链接目标类型：dir/file/unknown（unknown = 断裂链接或目标不可访问） */
  linkTarget?: 'dir' | 'file' | 'unknown';
}

export function listEntries(p: string): FsEntry[] {
  const items = readdirSync(p, { withFileTypes: true });
  return items.map((d) => {
    if (!d.isSymbolicLink()) {
      return { name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: false };
    }
    // 链接：跟随一次 stat 判定目标类型。失败时保持 "未知链接"，
    // 绝不能当成文件——那会让前端标成叶子节点、不可展开，且点了才报错（实测用户体感为"点不开"）。
    let linkTarget: 'dir' | 'file' | 'unknown' = 'unknown';
    try {
      const st = statSync(path.join(p, d.name));
      linkTarget = st.isDirectory() ? 'dir' : 'file';
    } catch {
      linkTarget = 'unknown';
    }
    return {
      name: d.name,
      isDir: linkTarget === 'dir',
      isFile: linkTarget === 'file',
      isSymlink: true,
      linkTarget,
    };
  });
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/** 只检查可写性，绝不修改权限（FS-14）。 */
export function accessSyncForWrite(p: string): void {
  accessSync(p, constants.W_OK);
}

/** 本系统自身的写入标记（C-32/FS-11）：Watcher 依据它抑制"外部修改"误报。 */
const selfWrites = new Map<string, number>();

export function markSelfWrite(absPath: string): void {
  selfWrites.set(absPath.toLowerCase(), Date.now());
  selfWrites.set(path.dirname(absPath).toLowerCase(), Date.now());
}

export function isSelfWrite(absPath: string): boolean {
  const t = selfWrites.get(absPath.toLowerCase());
  if (t !== undefined && Date.now() - t < 4000) return true;
  const tp = selfWrites.get(path.dirname(absPath).toLowerCase());
  return tp !== undefined && Date.now() - tp < 4000;
}

export function sha256OfBuffer(buf: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

/** 分块哈希，避免大文件整体进内存。 */
export function hashFile(absPath: string): string {
  const h = crypto.createHash('sha256');
  const fd = openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return `sha256:${h.digest('hex')}`;
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  if (n === 0) return false;
  const suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
  }
  return suspicious / n > 0.3;
}

/** BOM/UTF-16/GBK 探测 + 解码；无法识别抛 ENCODING_UNSUPPORTED（C-08）。 */
export function detectAndDecode(buf: Buffer): { content: string; encoding: DetectedEncoding } {
  const b0 = buf[0];
  const b1 = buf[1];
  const b2 = buf[2];
  if (buf.length >= 3 && b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { content: buf.subarray(3).toString('utf8'), encoding: 'utf8-bom' };
  }
  if (buf.length >= 2 && b0 === 0xff && b1 === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf16le' };
  }
  if (buf.length >= 2 && b0 === 0xfe && b1 === 0xff) {
    return { content: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf16be' };
  }
  const utf8 = buf.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buf)) {
    return { content: utf8, encoding: 'utf8' };
  }
  if (iconv.encodingExists('gbk')) {
    return { content: iconv.decode(buf, 'gbk'), encoding: 'gbk' };
  }
  throw new AppError('ENCODING_UNSUPPORTED', '无法识别文件编码，已按只读处理');
}

export function encodeByDetected(content: string, encoding: DetectedEncoding): Buffer {
  switch (encoding) {
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]);
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(content, 'utf16le')]);
    case 'utf16be':
      return Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(content, 'utf16be')]);
    case 'gbk':
      return iconv.encode(content, 'gbk');
    case 'utf8':
    default:
      return Buffer.from(content, 'utf8');
  }
}

export function detectEol(content: string): DetectedEol {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lfAll = (content.match(/\n/g) ?? []).length;
  const bareLf = lfAll - crlf;
  if (crlf === 0 && bareLf === 0) return 'LF';
  if (crlf > 0 && bareLf === 0) return 'CRLF';
  if (bareLf > 0 && crlf === 0) return 'LF';
  return 'MIXED';
}

/** 读文本文件（≤maxBytes），返回内容 + 编码 + 换行 + 基线哈希。 */
export function readTextFile(absPath: string, maxBytes: number): ReadTextResult {
  const st = statSync(absPath);
  if (st.size > maxBytes) {
    throw new AppError('TOO_LARGE', `文件超过 ${Math.floor(maxBytes / 1024 / 1024)}MB，不支持编辑器打开`, {
      size: st.size,
    });
  }
  const buf = readFileSync(absPath);
  const { content, encoding } = detectAndDecode(buf);
  return {
    content,
    encoding,
    eol: detectEol(content),
    size: st.size,
    mtimeMs: st.mtimeMs,
    hash: sha256OfBuffer(buf),
  };
}

/**
 * 原子写（C-05）：同目录临时文件 + fsync + rename。
 * eol='CRLF' 时把内容行尾规整为 CRLF；LF/MIXED 保存为 \n。
 */
export function atomicWriteText(
  absPath: string,
  content: string,
  encoding: DetectedEncoding,
  eol: DetectedEol,
): void {
  const dir = path.dirname(absPath);
  const out = eol === 'CRLF' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r?\n/g, '\n');
  const buf = encodeByDetected(out, encoding);
  const tmp = path.join(dir, `.ttfolio-tmp-${ulid()}`);
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(tmp, buf);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, absPath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 清理失败忽略 */
    }
    throw err;
  }
  markSelfWrite(absPath);
}

export {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
};

/** 移动：同盘 rename；跨盘 复制+校验+删源。复制失败绝不删源（ERR-6）。 */
export function movePath(src: string, dest: string): void {
  try {
    renameSync(src, dest);
    markSelfWrite(dest);
    return;
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'EXDEV') throw err;
  }
  copyRecursive(src, dest);
  verifyRecursive(src, dest);
  rmSync(src, { recursive: true, force: false });
  markSelfWrite(dest);
}

export function copyRecursive(src: string, dest: string): void {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of listEntries(src)) {
      // 目录符号链接不递归（体检 P1：指向祖先的 junction 会让复制无限进行）；
      // 文件链接照常跟随复制（文件不存在环）
      if (entry.isDir && entry.isSymlink) continue;
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else if (st.isFile()) {
    copyFileSync(src, dest);
  }
}

export function verifyRecursive(src: string, dest: string): void {
  const s = statSync(src);
  const d = statSync(dest);
  if (s.isDirectory() !== d.isDirectory()) throw new AppError('IO_ERROR', '复制校验失败：类型不一致');
  if (s.isFile()) {
    if (s.size !== d.size) throw new AppError('IO_ERROR', '复制校验失败：体积不一致');
    if (hashFile(src) !== hashFile(dest)) throw new AppError('IO_ERROR', '复制校验失败：哈希不一致');
    return;
  }
  for (const entry of listEntries(src)) {
    if (entry.isDir && entry.isSymlink) continue;
    verifyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
  }
}

/** 目录树规模统计（删除前提示"将影响 N 个文件 / M 字节"）。 */
export function measureTree(p: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const st = statSync(p);
  if (st.isFile()) return { files: 1, bytes: st.size };
  const stack: string[] = [p];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: FsEntry[];
    try {
      entries = listEntries(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // 目录符号链接不入栈（体检 P1：junction 成环时统计永不终止）
      if (e.isDir && e.isSymlink) continue;
      if (e.isDir) stack.push(full);
      else if (e.isFile) {
        files++;
        try {
          bytes += statSync(full).size;
        } catch {
          /* 权限问题跳过 */
        }
      }
    }
  }
  return { files, bytes };
}
