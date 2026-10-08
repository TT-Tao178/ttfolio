/** SSE 路由（GET /api/events）。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { SSE_HEARTBEAT_MS } from '@ttfolio/shared';

export const eventsRoute: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventIdRaw = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
    const lastEventId = lastEventIdRaw !== undefined ? Number.parseInt(lastEventIdRaw, 10) : undefined;
    const q = req.query as { lastEventId?: string };
    const lastFromQuery = q.lastEventId !== undefined ? Number.parseInt(q.lastEventId, 10) : undefined;

    const { id, replay } = ctx.sse.subscribe(
      (chunk) => reply.raw.write(chunk),
      () => reply.raw.end(),
      Number.isFinite(lastEventId) ? lastEventId : Number.isFinite(lastFromQuery) ? lastFromQuery : undefined,
    );
    for (const evt of replay) {
      reply.raw.write(`id: ${evt.id}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    }
    ctx.sse.publish('hello', { serverVersion: ctx.version, port: ctx.port, replayed: replay.length });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, SSE_HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      ctx.sse.unsubscribe(id);
    });
    await new Promise<void>(() => {
      /* 保持连接直到客户端断开 */
    });
  });
};
