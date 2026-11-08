import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { ServerEventSchema, type ServerEvent } from '@voila/shared';
import { createApp, createSessionServer } from './index.js';
import { VoilaSession, type SessionPorts } from './session.js';
import { SessionRegistry } from './session-registry.js';

const hello = { type: 'hello', scenario: 'live', profile: { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'fr', guide_dog: true }, gps: null };
const booking = { ref: 'PAS-123', pickup_time: '2027-01-15T11:00:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33123456789', guide_dog_status: 'accepted' as const, payment_url: 'https://checkout.stripe.com/test' };
const ports: Partial<SessionPorts> = {
  clock: () => new Date('2027-01-15T10:00:00+01:00'),
  understand: async () => ({ trip: { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T16:00:00+01:00', passengers: 1, luggage: 0, guide_dog: true }, missing: [] }),
  trafficH: async () => ({ status: 'disrupted', mode: 'live', summary: 'Signal failure', cause: 'Incident.', source: 'https://example.com/traffic', recorded: false }),
  linkup: async () => ({ corroboration: [], extraOptions: [] }),
  runBooking: async (input) => {
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: 'Shuttle' });
    return { booking, metrics: { steps: 1, durationMs: 10, costUsd: 0 }, agentViewUrl: undefined };
  },
  shuttlePublicUrl: () => 'https://shuttle.example',
};
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });

describe('web static serving', () => {
  it('serves assets and SPA fallback while preserving API and WebSocket routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voila-web-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Voilà</title>');
    await writeFile(join(root, 'app.js'), 'window.voila = true;');
    await writeFile(join(root, 'showcase.html'), '<!doctype html><title>Voilà Agent Map</title>');
    const registry = new SessionRegistry(); cleanup.push(() => registry.dispose());
    const app = createApp({ webDistDir: root, registry });
    for (const path of ['/', '/unknown/nested']) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<title>Voilà</title>');
    }
    expect(await (await app.request('/app.js')).text()).toBe('window.voila = true;');
    const showcase = await app.request('/showcase.html');
    expect(showcase.status).toBe(200);
    expect(showcase.headers.get('content-type')).toContain('text/html');
    expect(await showcase.text()).toContain('<title>Voilà Agent Map</title>');
    expect(await (await app.request('/health')).json()).toEqual({ status: 'ok' });
    expect((await app.request('/session', { method: 'POST' })).status).toBe(201);
    expect((await app.request('/ws/session/test')).status).toBe(426);
    for (const path of ['/gladia', '/session', '/internal/missing', '/ws/missing']) expect((await app.request(path)).status).toBe(404);
    expect((await app.request('/unknown', { method: 'POST' })).status).toBe(404);
  });
  it('skips missing builds and directories without an index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voila-empty-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    for (const webDistDir of [root, join(root, 'missing')]) {
      const app = createApp({ webDistDir });
      expect((await app.request('/')).status).toBe(404);
      expect((await app.request('/unknown')).status).toBe(404);
      expect((await app.request('/health')).status).toBe(200);
    }
  });
});

describe('payment callback', () => {
  it('finds registry-only sessions for authenticated callbacks and marks paid idempotently', async () => {
    const events: ServerEvent[] = [];
    const session = new VoilaSession((event) => events.push(event), ports);
    cleanup.push(() => session.dispose());
    const registry = new SessionRegistry(new Map([['demo', session]]));
    const app = createApp({ registry, token: 'test-token' });
    session.handle(hello); session.handle({ type: 'final_transcript', text: 'CDG' }); await flush();
    session.handle({ type: 'user_reply', text: 'shuttle' }); await flush();
    expect(session.stage).toBe('AWAIT_PAYMENT');
    const request = (token?: string, body: unknown = { order_id: 'order-uuid', ref: 'PAS-123', status: 'paid' }) => app.request('/internal/payment-completed', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body),
    });
    expect((await request()).status).toBe(401);
    expect((await request('wrong')).status).toBe(401);
    expect((await request('test-token', { order_id: 'order-uuid', ref: 'wrong', status: 'paid' })).status).toBe(404);
    expect((await request('test-token', { ref: 'PAS-123' })).status).toBe(400);
    expect((await request('test-token')).status).toBe(200);
    expect(session.stage).toBe('DONE');
    expect(events).toContainEqual({ type: 'booking_card', booking });
    expect((await request('test-token')).status).toBe(200);
    expect(events.filter((e) => e.type === 'booking_card')).toHaveLength(1);
  });
  it('fails closed with an unconfigured token and rejects malformed authenticated JSON', async () => {
    expect((await createApp({ token: '' }).request('/internal/payment-completed', { method: 'POST', headers: { Authorization: 'Bearer ' }, body: '{}' })).status).toBe(401);
    expect((await createApp({ token: 'test' }).request('/internal/payment-completed', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: 'not json' })).status).toBe(400);
  });
});

describe('real WebSocket round-trip', () => {
  it('mirrors the registered name to a watch paired by hello', async () => {
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports });
    cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const ticket = await (await running.app.request('/watch', { method: 'POST' })).json() as { watch_id: string; watch_token: string; code: string };
    const issued = await (await running.app.request('/session', { method: 'POST' })).json() as { id: string; resume_token: string };
    const watchEvents: unknown[] = [];
    const watch = new WebSocket(`ws://127.0.0.1:${address.port}/ws/watch/${ticket.watch_id}?token=${ticket.watch_token}`);
    watch.on('message', (data) => watchEvents.push(JSON.parse(data.toString())));
    await once(watch, 'open');
    const phone = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${issued.id}?token=${issued.resume_token}`);
    await once(phone, 'open');
    phone.send(JSON.stringify({ ...hello, profile: { ...hello.profile, name: 'Amina Benali' }, watch: ticket.code }));
    await vi.waitFor(() => expect(watchEvents).toContainEqual({ type: 'watch', event: { type: 'traveler', name: 'Amina Benali' } }));
    expect(watchEvents).toContainEqual({ type: 'paired', stage: 'LISTEN' });
    phone.close(); watch.close();
  });
  it('rejects a malformed upgrade URL without an uncaught exception', async () => {
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { request } from 'node:http';
      import { once } from 'node:events';
      import { createSessionServer } from './src/index.ts';
      const running = createSessionServer({ port: 0, hostname: '127.0.0.1' });
      if (!running.server.listening) await once(running.server, 'listening');
      const req = request({ host: '127.0.0.1', port: running.server.address().port, path: '//[', headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
      } });
      req.on('error', () => {}); req.end();
      await new Promise(resolve => setTimeout(resolve, 100));
      await running.close();
      console.log('SURVIVED');
    `], { timeout: 5000 });
    expect(result.stdout).toContain('SURVIVED');
  });
  it.each([undefined, '1'])('uses the socket address without a forwarded header with TRUST_PROXY=%s', async (trustProxy) => {
    vi.stubEnv('TRUST_PROXY', trustProxy);
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports }); cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const request = () => fetch(`http://127.0.0.1:${address.port}/session`, { method: 'POST' });
    for (let i = 0; i < 3; i++) expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(429);
  });
  it.each([undefined, '0', 'true', '1'])('trusts the first forwarded IP only with TRUST_PROXY=1, configured %s', async (trustProxy) => {
    vi.stubEnv('TRUST_PROXY', trustProxy);
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports }); cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const request = (forwarded: string) => fetch(`http://127.0.0.1:${address.port}/session`, { method: 'POST', headers: { 'x-forwarded-for': forwarded } });
    for (let i = 0; i < 3; i++) expect((await request('203.0.113.7, 10.0.0.1')).status).toBe(201);
    expect((await request('203.0.113.8, 10.0.0.1')).status).toBe(trustProxy === '1' ? 201 : 429);
    expect((await request('203.0.113.7, 10.0.0.9')).status).toBe(429);
  });
  it('replays the paid booking after the payment callback arrives while the browser is disconnected', async () => {
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports, token: 'test' }); cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const issued = await (await running.app.request('/session', { method: 'POST' })).json();
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${issued.id}?token=${issued.resume_token}`);
      const messages: ServerEvent[] = []; ws.on('message', (data) => messages.push(ServerEventSchema.parse(JSON.parse(data.toString()))));
      await once(ws, 'open');
      const until = async (check: () => boolean) => { while (!check()) await once(ws, 'message'); };
      return { ws, messages, until };
    };
    const first = await connect(); first.ws.send(JSON.stringify(hello)); first.ws.send(JSON.stringify({ type: 'final_transcript', text: 'CDG' }));
    await first.until(() => first.messages.some((event) => event.type === 'stage' && event.stage === 'CHOOSE'));
    first.ws.send(JSON.stringify({ type: 'user_reply', text: 'la navette' }));
    await first.until(() => first.messages.some((event) => event.type === 'stage' && event.stage === 'AWAIT_PAYMENT'));
    first.ws.close(); await once(first.ws, 'close');
    const response = await running.app.request('/internal/payment-completed', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ order_id: 'paid-order', ref: booking.ref, status: 'paid' }) });
    expect(response.status).toBe(200);
    const resumed = await connect(); await resumed.until(() => resumed.messages.some((event) => event.type === 'booking_card'));
    expect(resumed.messages.slice(0, 2)).toEqual([{ type: 'stage', stage: 'DONE' }, { type: 'booking_card', booking }]);
    expect(running.sessions.size).toBe(1);
  });
  it('validates JSON, streams events, and reattaches an existing session with its stage replayed', async () => {
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports, token: 'test' });
    cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port');
    const response = await fetch(`http://127.0.0.1:${address.port}/session`, { method: 'POST' });
    expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
    const issued = await response.json() as { id: string; resume_token: string };
    expect(issued.id).toMatch(/^[\w-]{32}$/); expect(issued.resume_token).toMatch(/^[\w-]{43}$/);
    const another = await (await running.app.request('/session', { method: 'POST' })).json();
    expect(another.id).not.toBe(issued.id); expect(another.resume_token).not.toBe(issued.resume_token);
    const connect = async (token?: string, id = issued.id) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      const messages: ServerEvent[] = [];
      ws.on('message', (data) => messages.push(ServerEventSchema.parse(JSON.parse(data.toString()))));
      await once(ws, 'open');
      const until = async (check: () => boolean) => {
        while (!check()) await once(ws, 'message');
      };
      return { ws, messages, until };
    };
    for (const [token, id] of [[undefined, issued.id], ['wrong', issued.id], [issued.resume_token, 'unissued-session']]) {
      const attacker = await connect(token, id);
      const [code] = await once(attacker.ws, 'close');
      expect(code).toBe(4401); expect(attacker.messages).toEqual([]);
      expect(running.sessions.size).toBe(0);
    }
    const first = await connect(issued.resume_token);
    await first.until(() => first.messages.length > 0);
    expect(first.messages[0]).toEqual({ type: 'stage', stage: 'LISTEN' });
    for (const token of [undefined, 'incorrect-token']) {
      const attacker = await connect(token);
      const [code] = await once(attacker.ws, 'close');
      expect(code).toBe(4401);
      expect(first.ws.readyState).toBe(WebSocket.OPEN);
      expect(attacker.messages).toEqual([]);
    }
    first.ws.send('{bad json');
    await first.until(() => first.messages.some((e) => e.type === 'error'));
    first.ws.send(JSON.stringify(hello));
    first.ws.send(JSON.stringify({ type: 'final_transcript', text: 'CDG' }));
    await first.until(() => first.messages.some((e) => e.type === 'stage' && e.stage === 'CHOOSE'));
    const session = running.sessions.get(issued.id);
    const evicted = once(first.ws, 'close');
    const second = await connect(issued.resume_token);
    const [code, reason] = await evicted;
    expect(code).toBe(4409); expect(reason.toString()).toBe('Session active in another connection');
    await second.until(() => second.messages.length > 0);
    expect(running.sessions.get(issued.id)).toBe(session);
    expect(second.messages[0]).toEqual({ type: 'stage', stage: 'CHOOSE' });
    second.ws.send(JSON.stringify({ type: 'user_reply', text: 'bus' }));
    await second.until(() => second.messages.some((e) => e.type === 'stage' && e.stage === 'DONE'));
    expect(second.messages).toContainEqual({ type: 'say', text: expect.stringContaining('Demandez aux agents si un bus de remplacement') });
    expect(running.sessions.size).toBe(1);
    const fresh = await connect(another.resume_token, another.id);
    await fresh.until(() => fresh.messages.length > 0);
    expect(fresh.messages[0]).toEqual({ type: 'stage', stage: 'LISTEN' });
    expect(second.ws.readyState).toBe(WebSocket.OPEN); expect(running.sessions.size).toBe(2);
  });
});
