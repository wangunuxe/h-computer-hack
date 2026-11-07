import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/ws/session/:id', (c) => c.text('WebSocket upgrade required', 426));

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (!/^\/ws\/session\/[^/]+$/.test(pathname)) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.on('error', console.error);
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
  });
});
