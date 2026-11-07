import { serve } from '@hono/node-server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { WebSocket, WebSocketServer } from 'ws';
import { WebEventSchema, type ServerEvent } from '@voila/shared';
import { z } from 'zod';
import { VoilaSession, type SessionPorts } from './session.js';

const paymentSchema = z.object({ order_id: z.string().min(1), ref: z.string().min(1), status: z.literal('paid') });

export function createApp({ sessions = new Map<string, VoilaSession>(), token = process.env.INTERNAL_CALLBACK_TOKEN }: {
  sessions?: Map<string, VoilaSession>; token?: string;
} = {}) {
  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/ws/session/:id', (c) => c.text('WebSocket upgrade required', 426));
  app.post('/internal/payment-completed', async (c) => {
    const provided = c.req.header('authorization') ?? '';
    if (!token || !timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(`Bearer ${token}`).digest())) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid payment notification' }, 400);
    let matched = false;
    for (const session of sessions.values()) if (session.markPaid(parsed.data.ref)) matched = true;
    if (!matched) return c.json({ error: 'Booking not awaiting payment' }, 404);
    return c.json({ received: true });
  });
  return app;
}

export function createSessionServer({ port = Number(process.env.PORT ?? 3000), hostname = '0.0.0.0', ports, token }: {
  port?: number; hostname?: string; ports?: Partial<SessionPorts>; token?: string;
} = {}) {
  const sessions = new Map<string, VoilaSession>();
  const clients = new Map<string, WebSocket>();
  const app = createApp({ sessions, token });
  const server = serve({ fetch: app.fetch, port, hostname });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = /^\/ws\/session\/([^/]+)$/.exec(pathname);
    if (!match) { socket.destroy(); return; }
    const id = match[1]!;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      clients.get(id)?.close(1000, 'Session reattached');
      clients.set(id, ws);
      const emit = (event: ServerEvent) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      };
      const session = sessions.get(id) ?? new VoilaSession(emit, ports);
      sessions.set(id, session);
      const detach = session.attach(emit);
      ws.on('error', () => (ports?.logger ?? console).error('Session WebSocket error.'));
      ws.on('close', () => { detach(); if (clients.get(id) === ws) clients.delete(id); });
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
    for (const session of sessions.values()) session.dispose();
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return { app, server, sockets, sessions, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createSessionServer();
