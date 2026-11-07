import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { WebSocket, WebSocketServer } from 'ws';
import { WebEventSchema, type ServerEvent } from '@voila/shared';
import { z } from 'zod';
import { VoilaSession, type SessionPorts } from './session.js';
import { SessionRegistry, secureEqual } from './session-registry.js';
import { createGladiaSession } from './adapters/gladia.js';

const paymentSchema = z.object({ order_id: z.string().min(1), ref: z.string().min(1), status: z.literal('paid') });

export function createApp({ registry = new SessionRegistry(), token = process.env.INTERNAL_CALLBACK_TOKEN, gladia = createGladiaSession }: {
  registry?: SessionRegistry; token?: string; gladia?: typeof createGladiaSession;
} = {}) {
  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.post('/gladia/session', async (c) => {
    c.header('Cache-Control', 'no-store');
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const parsed = z.object({ id: z.string(), resume_token: z.string() }).safeParse(body);
    if (!parsed.success || !registry.authenticate(parsed.data.id, parsed.data.resume_token)) return c.json({ error: 'Unauthorized' }, 401);
    try { return c.json(await gladia(registry.sessions.get(parsed.data.id)?.language ?? 'fr')); }
    catch { return c.json({ error: 'Speech recognition unavailable' }, 502); }
  });
  app.post('/session', (c) => {
    c.header('Cache-Control', 'no-store');
    let clientIp = process.env.TRUST_PROXY === '1' ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    if (!clientIp) {
      try { clientIp = getConnInfo(c).remote.address; } catch { clientIp = 'unknown'; }
    }
    const issued = registry.issue(clientIp);
    if ('error' in issued) return issued.error === 'client-limit'
      ? c.json({ error: 'Too many unclaimed sessions for this client' }, 429)
      : c.json({ error: 'Session capacity reached' }, 503);
    return c.json(issued, 201);
  });
  app.get('/ws/session/:id', (c) => c.text('WebSocket upgrade required', 426));
  app.post('/internal/payment-completed', async (c) => {
    const provided = c.req.header('authorization') ?? '';
    if (!token || !secureEqual(provided, `Bearer ${token}`)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid payment notification' }, 400);
    let matched = false;
    for (const session of registry.sessions.values()) if (session.markPaid(parsed.data.ref)) matched = true;
    if (!matched) return c.json({ error: 'Booking not awaiting payment' }, 404);
    return c.json({ received: true });
  });
  return app;
}

export function createSessionServer({ port = Number(process.env.PORT ?? 3000), hostname = '0.0.0.0', ports, token }: {
  port?: number; hostname?: string; ports?: Partial<SessionPorts>; token?: string;
} = {}) {
  const clients = new Map<string, WebSocket>();
  const registry = new SessionRegistry(new Map(), ports?.timers);
  const sessions = registry.sessions;
  const app = createApp({ registry, token });
  const server = serve({ fetch: app.fetch, port, hostname });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const match = /^\/ws\/session\/([^/]+)$/.exec(pathname);
    if (!match) { socket.destroy(); return; }
    const id = match[1]!;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', () => (ports?.logger ?? console).error('Session WebSocket error.'));
      const existing = sessions.get(id);
      if (!registry.connect(id, url.searchParams.get('token') ?? '')) {
        ws.close(4401, 'Invalid resume token');
        return;
      }
      clients.get(id)?.close(1000, 'Session reattached');
      clients.set(id, ws);
      const emit = (event: ServerEvent) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      };
      const session = existing ?? new VoilaSession(emit, ports);
      sessions.set(id, session);
      const detach = session.attach(emit);
      ws.on('close', () => {
        detach();
        if (clients.get(id) === ws) { clients.delete(id); registry.disconnect(id); }
      });
      ws.on('message', (data, binary) => {
        if (clients.get(id) !== ws) return;
        let value: unknown;
        try { value = binary ? null : JSON.parse(data.toString()); } catch { value = null; }
        const parsed = WebEventSchema.safeParse(value);
        session.handle(parsed.success ? parsed.data : null);
      });
    });
  });
  const close = async () => {
    registry.dispose();
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return { app, server, sockets, sessions, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createSessionServer();
