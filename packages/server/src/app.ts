/** Fastify 应用装配：鉴权（token+Host+Origin）、路由注册、静态托管、统一错误映射。 */
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { AppContext } from './context.js';
import { toApiError } from './routes/helpers.js';
import { defaultHttpStatus, AppError } from './core/errors.js';
import type { ErrorCode } from '@ttfolio/shared';
import { normalizeActorHeader, enterActor } from './core/actor.js';
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
import { agentRoutes } from './routes/agent.js';

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
    bodyLimit: 64 * 1024 * 1024,
  });
  app.ttfolio = ctx;

  // 允许"带 Content-Type: application/json 但没有 body"的请求（DELETE 常如此）。
  // Fastify 默认 JSON 解析器遇到空体会抛 FST_ERR_CTP_EMPTY_JSON_BODY，被错误映射成 IO_ERROR/500，
  // 对调用方是误导（这是协议层问题，不是 IO 故障）。这里显式把空体当 undefined，非法 JSON 给 400。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError('BAD_REQUEST', '请求体不是合法 JSON'), undefined);
    }
  });

  // 鉴权与防 DNS rebinding（C-09）：/api/health 免 token（仅回环 + Host 校验）
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url ?? '';
    if (!hostAllowed(req.headers.host, ctx.port)) {
      void reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Host 头' } });
      return;
    }
    if (url === '/api/health') return;
    const isApiScope =
      url.indexOf('/api/') === 0 || url.indexOf('/arch/') === 0 || url.indexOf('/raw/') === 0;
    if (isApiScope) {
      const isSse = url.indexOf('/api/events') === 0;
      const headerToken = req.headers['x-ttfolio-token'];
      const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
      const queryToken = (req.query as Record<string, string | undefined> | undefined)?.['token'];
      if (isSse) {
        if (queryToken !== ctx.token) {
          void reply
            .code(401)
            .send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
        }
        return;
      }
      if (token !== ctx.token) {
        void reply.code(401).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'token 无效' } });
        return;
      }
      // agent 身份声明（FR-13.1）：持有效 token 才允许携带 x-ttfolio-actor；
      // 声明不合法直接拒绝（不静默回落 local，防审计身份被伪装成用户）。
      const actorHeaderRaw = req.headers['x-ttfolio-actor'];
      const actorHeader = Array.isArray(actorHeaderRaw) ? actorHeaderRaw[0] : actorHeaderRaw;
      if (actorHeader !== undefined) {
        const actor = normalizeActorHeader(actorHeader);
        if (actor === null) {
          void reply.code(400).send({
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'x-ttfolio-actor 头不合法（1~64 字符，且不得为 local）' },
          });
          return;
        }
        enterActor(actor);
      }
      // 非 GET：Origin 必须是本机
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== '') {
          const o = origin.toLowerCase();
          if (!HOST_OK.some((h) => o.includes(`//${h}`))) {
            void reply
              .code(403)
              .send({ ok: false, error: { code: 'PERMISSION_DENIED', message: '非法 Origin' } });
          }
        }
      }
    }
  });

  // 统一错误响应契约（API-2 / ERR-1，修复 P1-6）：
  // 路由用 fail(code, msg, status) 表达状态，这里把它落到真正的 HTTP 状态码，
  // 并把仅供内部使用的 __status 从响应体里剔除。
  // 否则所有业务错误都以 HTTP 200 + ok:false 返回——外部监控、日志告警与 e2e 断言
  // 只要按 status >= 400 判断就会全部漏报（实测第一版探针正因此误判为"全部正常"）。
  app.addHook('preSerialization', async (_req, reply, payload) => {
    if (typeof payload !== 'object' || payload === null || !('__status' in payload)) return payload;
    const { __status, ...rest } = payload as { __status?: unknown } & Record<string, unknown>;
    const code = (rest['error'] as { code?: ErrorCode } | undefined)?.code;
    const status =
      typeof __status === 'number' ? __status : code !== undefined ? defaultHttpStatus(code) : undefined;
    if (status !== undefined) reply.code(status);
    return rest;
  });

  // 统一响应体与错误映射
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const mapped = toApiError(err);
    if (mapped.code === 'INTERNAL') {
      ctx.logger.error({ mod: 'http', msg: `${_req.method} ${_req.url}: ${err.message}` });
    }
    void reply
      .code(mapped.status)
      .send({ ok: false, error: { code: mapped.code, message: mapped.message, detail: mapped.detail } });
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
  app.register(agentRoutes);

  // 静态托管 web/dist（token 注入 index.html）
  app.get('/', async (_req, reply) => {
    if (ctx.webDist === null || !existsSync(path.join(ctx.webDist, 'index.html'))) {
      void reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ttFolio</title><p>前端尚未构建：请先运行 <code>npm run build -w @ttfolio/web</code>，或在开发模式使用 vite (npm run dev)。</p>',
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
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      };
      void reply.type(types[ext] ?? 'application/octet-stream').send(readFileSync(full));
      return reply;
    });
  }

  return app;
}
