/** Fastify 应用装配：鉴权（token+Host+Origin）、路由注册、静态托管、统一错误映射。 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { AppContext } from './context.js';
import { toApiError } from './routes/helpers.js';
import { systemRoutes } from './routes/system.js';
import { eventsRoute } from './routes/events.js';
import { projectsRoutes } from './routes/projects.js';
import { fsRoutes } from './routes/fs.js';
import { gitRoutes } from './routes/git.js';
import { docsRoutes } from './routes/docs.js';
import { archivesRoutes } from './routes/archives.js';
import { searchRoutes } from './routes/search.js';
import { miscRoutes } from './routes/misc.js';
import { contractRoutes } from './routes/contract.js';

declare module 'fastify' {
  interface FastifyInstance {
    ttfolio: AppContext;
  }
}

const HOST_OK = ['127.0.0.1', 'localhost', '[::1]'];

function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const h = host.toLowerCase();
  return (
    h === `127.0.0.1:${port}` ||
    h === `localhost:${port}` ||
    h === `[::1]:${port}` ||
    h === '127.0.0.1' ||
    h === 'localhost'
  );
}

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024 * 1024
  });
  app.ttfolio = ctx;

  // 鉴权与防 DNS rebinding（C-09）：/api/health 免 token（仅回环 + Host 校验）
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url ?? '';
    if (!hostAllowed(req.headers.host, ctx.port)) {
      void reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Host 头' } });
      return;
    }
    if (url === '/api/health') return;
    const isApiScope = url.indexOf('/api/') === 0 || url.indexOf('/arch/') === 0 || url.indexOf('/raw/') === 0;
    if (isApiScope) {
      const isSse = url.indexOf('/api/events') === 0;
      const headerToken = req.headers['x-ttfolio-token'];
      const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
      const queryToken = (req.query as Record<string, string | undefined> | undefined)?.['token'];
      if (isSse) {
        if (queryToken !== ctx.token) {
          void reply.code(401).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
        }
        return;
      }
      if (token !== ctx.token) {
        void reply.code(401).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
        return;
      }
      // 非 GET：Origin 必须是本机
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== '') {
          const o = origin.toLowerCase();
          if (!HOST_OK.some((h) => o.includes(`//${h}`))) {
            void reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Origin' } });
          }
        }
      }
    }
  });

  // 统一响应体与错误映射
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const mapped = toApiError(err);
    if (mapped.code === 'INTERNAL') {
      ctx.logger.error({ mod: 'http', msg: `${_req.method} ${_req.url}: ${err.message}` });
    }
    void reply.code(mapped.status).send({ ok: false, error: { code: mapped.code, message: mapped.message, detail: mapped.detail } });
  });

  app.register(systemRoutes);
  app.register(eventsRoute);
  app.register(projectsRoutes);
  app.register(fsRoutes);
  app.register(gitRoutes);
  app.register(docsRoutes);
  app.register(archivesRoutes);
  app.register(searchRoutes);
  app.register(miscRoutes);
  app.register(contractRoutes);

  // 静态托管 web/dist（token 注入 index.html）
  app.get('/', async (_req, reply) => {
    if (ctx.webDist === null || !existsSync(path.join(ctx.webDist, 'index.html'))) {
      void reply.code(200).type('text/html; charset=utf-8').send(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ttFolio</title><p>前端尚未构建：请先运行 <code>npm run build -w @ttfolio/web</code>，或在开发模式使用 vite (npm run dev)。</p>'
      );
      return reply;
    }
    const html = readFileSync(path.join(ctx.webDist, 'index.html'), 'utf8')
      .replace('%%TTFOLIO_TOKEN%%', ctx.token)
      .replace('%%TTFOLIO_PORT%%', String(ctx.port))
      // 生产为同源：API 基址留空；用户内容基址留空（前端按「后端端口 + 100」推导，保持独立端口隔离）
      .replace('%%TTFOLIO_API_BASE%%', '')
      .replace('%%TTFOLIO_CONTENT_BASE%%', '');
    void reply.type('text/html; charset=utf-8').send(html);
    return reply;
  });

  const assetRoot = ctx.webDist !== null ? path.join(ctx.webDist, 'assets') : null;
  if (assetRoot !== null && existsSync(assetRoot)) {
    app.get('/assets/:file', async (req, reply) => {
      const { file } = req.params as { file: string };
      const full = path.join(assetRoot, path.basename(file));
      if (!existsSync(full)) {
        void reply.code(404).send('not found');
        return reply;
      }
      const ext = path.extname(full).toLowerCase();
      const types: Record<string, string> = {
        '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
      };
      void reply.type(types[ext] ?? 'application/octet-stream').send(readFileSync(full));
      return reply;
    });
  }

  return app;
}
