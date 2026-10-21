/** 用户内容静态代理（C-13 / 9.3）：独立端口、只读、防穿越、正确 Content-Type。
 * 媒体伺服（FR-13.5 / T-099）：/raw 支持 HTTP Range（音视频拖进度），补音视频
 * MIME；/thumbs 供媒体页签读数据目录缩略图（文件名白名单 sha1.png）。 */
import Fastify from 'fastify';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { AppContext } from '../context.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { getArchive } from '../db/repo/docsRepo.js';
import { guardPath } from '../core/pathGuard.js';
import { AppError } from '../core/errors.js';
import { parseRange } from './range.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  // 音视频（媒体页签/内嵌播放，Range 生效的前提是 MIME 正确）
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

/** 缩略图文件名白名单：sha1 hex + .png（写入方 routes/media.ts 保证）。 */
const THUMB_NAME = /^[0-9a-f]{40}\.png$/;

export function startUserContentServer(ctx: AppContext): Promise<number> {
  const server = Fastify({ logger: false, disableRequestLogging: true });

  // token + Host 校验（与主服务一致）
  server.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    const hostOk =
      host.indexOf('127.0.0.1:') === 0 || host === '127.0.0.1' || host.indexOf('localhost:') === 0;
    if (!hostOk) {
      void reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Host' } });
      return;
    }
    const token =
      (req.headers['x-ttfolio-token'] as string | undefined) ??
      (req.query as Record<string, string> | undefined)?.['token'];
    if (token !== ctx.token) {
      void reply.code(401).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
    }
  });

  // 只读：非 GET 一律 405（C-13）
  server.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      void reply
        .code(405)
        .send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '用户内容服务只读' } });
    }
  });

  // GET /arch/:projectId/:archiveId/*
  server.get('/arch/:projectId/:archiveId/*', async (req, reply) => {
    const { projectId, archiveId } = req.params as { projectId: string; archiveId: string };
    const relPath = (req.params as { '*': string })['*'] ?? '';
    const db = ctx.db();
    const archive = getArchive(db, archiveId);
    if (archive === undefined || archive.project_id !== projectId) {
      void reply.code(404).send('not found');
      return reply;
    }
    const project = getProjectRow(db, projectId);
    if (project === undefined) {
      void reply.code(404).send('not found');
      return reply;
    }
    try {
      const requested = relPath === '' ? (archive.entry_rel ?? '') : relPath;
      if (requested === '') {
        void reply.code(404).send('no entry');
        return reply;
      }
      const guarded = await guardPath(
        { userPath: path.join(archive.dir_path, requested), allowedRoots: [archive.dir_path] },
        { mustExist: true },
      );
      const buf = await fsp.readFile(guarded.real);
      const ext = path.extname(guarded.real).toLowerCase();
      reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      void reply.send(buf);
    } catch (err) {
      const status = err instanceof AppError && err.code === 'PATH_OUT_OF_SCOPE' ? 403 : 404;
      void reply.code(status).send('not found');
    }
    return reply;
  });

  // GET /raw/:projectId/*（图片/PDF/音视频原始内容；音视频走 206 Range）
  server.get('/raw/:projectId/*', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const relPath = (req.params as { '*': string })['*'] ?? '';
    const db = ctx.db();
    const project = getProjectRow(db, projectId);
    if (project === undefined) {
      void reply.code(404).send('not found');
      return reply;
    }
    try {
      const guarded = await guardPath(
        { userPath: path.join(project.dir_path, relPath), allowedRoots: [project.dir_path] },
        { mustExist: true },
      );
      const st = await fsp.stat(guarded.real);
      if (st.isDirectory()) {
        void reply.code(404).send('not a file');
        return reply;
      }
      const ext = path.extname(guarded.real).toLowerCase();
      const baseHeaders: Record<string, string> = {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
      };
      const rangeHeader = req.headers.range;
      if (typeof rangeHeader !== 'string' || rangeHeader === '') {
        reply.headers(baseHeaders);
        void reply.send(await fsp.readFile(guarded.real));
        return reply;
      }
      const range = parseRange(rangeHeader, st.size);
      if (range === 'invalid') {
        void reply.code(416).header('Content-Range', `bytes */${st.size}`).send('range not satisfiable');
        return reply;
      }
      if (range === null) {
        reply.headers(baseHeaders);
        void reply.send(await fsp.readFile(guarded.real));
        return reply;
      }
      // 206 部分内容：打开句柄按区间读（音视频拖进度走这里）
      const handle = await fsp.open(guarded.real, 'r');
      try {
        const length = range.end - range.start + 1;
        const buf = Buffer.allocUnsafe(length);
        await handle.read(buf, 0, length, range.start);
        reply.code(206).headers({
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
          'Content-Length': String(length),
        });
        void reply.send(buf);
      } finally {
        await handle.close();
      }
    } catch (err) {
      const status = err instanceof AppError && err.code === 'PATH_OUT_OF_SCOPE' ? 403 : 404;
      void reply.code(status).send('not found');
    }
    return reply;
  });

  // GET /avatar（个人头像，FR-13.7）：数据目录 avatar.png，只读、no-store
  server.get('/avatar', async (_req, reply) => {
    const full = path.join(ctx.layout.dataDir, 'avatar.png');
    try {
      const buf = await fsp.readFile(full);
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      void reply.send(buf);
    } catch {
      void reply.code(404).send('not found');
    }
    return reply;
  });

  // GET /thumbs/:projectId/:name（数据目录缩略图；文件名白名单，防穿越）
  server.get('/thumbs/:projectId/:name', async (req, reply) => {
    const { projectId, name } = req.params as { projectId: string; name: string };
    // projectId 是 ULID（Crockford base32，含大写字母）；只允许安全字符集，防路径注入
    if (THUMB_NAME.test(name) === false || /^[A-Za-z0-9_-]{1,64}$/.test(projectId) === false) {
      void reply.code(404).send('not found');
      return reply;
    }
    const full = path.join(ctx.layout.thumbsDir, projectId, name);
    try {
      const buf = await fsp.readFile(full);
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      void reply.send(buf);
    } catch {
      void reply.code(404).send('not found');
    }
    return reply;
  });

  return new Promise((resolve, reject) => {
    server
      .listen({ port: ctx.userContentPort, host: '127.0.0.1' })
      .then(() => resolve(ctx.userContentPort))
      .catch((err: Error) => reject(err));
  });
}
