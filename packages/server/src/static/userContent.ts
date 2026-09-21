/** 用户内容静态代理（C-13 / 9.3）：独立端口、只读、防穿越、正确 Content-Type。 */
import Fastify from 'fastify';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { AppContext } from '../context.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { getArchive } from '../db/repo/docsRepo.js';
import { guardPath } from '../core/pathGuard.js';
import { AppError } from '../core/errors.js';

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
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
};

export function startUserContentServer(ctx: AppContext): Promise<number> {
  const server = Fastify({ logger: false, disableRequestLogging: true });

  // token + Host 校验（与主服务一致）
  server.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    const hostOk = host.startsWith(`127.0.0.1:`) || host === `127.0.0.1` || host.startsWith(`localhost:`);
    if (!hostOk) {
      void reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Host' } });
      return;
    }
    const token = (req.headers['x-ttfolio-token'] as string | undefined) ?? (req.query as Record<string, string> | undefined)?.['token'];
    if (token !== ctx.token) {
      void reply.code(401).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
    }
  });

  // 只读：非 GET 一律 405（C-13）
  server.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      void reply.code(405).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '用户内容服务只读' } });
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
        { mustExist: true }
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

  // GET /raw/:projectId/*（图片/PDF 原始内容）
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
        { mustExist: true }
      );
      const st = await fsp.stat(guarded.real);
      if (st.isDirectory()) {
        void reply.code(404).send('not a file');
        return reply;
      }
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

  return new Promise((resolve, reject) => {
    server
      .listen({ port: ctx.userContentPort, host: '127.0.0.1' })
      .then(() => resolve(ctx.userContentPort))
      .catch((err: Error) => reject(err));
  });
}
