import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ServerEventSchema, type ServerEvent } from '@voila/shared';
import { createApp, createSessionServer } from './index.js';
import { VoilaSession, type SessionPorts } from './session.js';

const hello = { type: 'hello', profile: { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'fr', guide_dog: true }, gps: null };
const booking = { ref: 'PAS-123', pickup_time: '2027-01-15T11:00:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33123456789', guide_dog_status: 'accepted' as const, payment_url: 'https://checkout.stripe.com/test' };
const ports: Partial<SessionPorts> = {
  clock: () => new Date('2027-01-15T10:00:00+01:00'),
  understand: async () => ({ trip: { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T16:00:00+01:00', passengers: 1, luggage: 0, guide_dog: true }, missing: [] }),
  prim: async () => ({ summary: 'Signal failure', cause: 'Incident.', source: 'https://example.com/traffic', recorded: true }),
  linkup: async () => ({ corroboration: [], extraOptions: [] }),
  runBooking: async (input) => {
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: 'Shuttle' });
    return { booking, metrics: { steps: 1, durationMs: 10, costUsd: 0 }, agentViewUrl: undefined };
  },
  shuttlePublicUrl: () => 'https://shuttle.example',
};
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('payment callback', () => {
  it('matches the clone bearer token and {order_id, ref, status} payload, then marks paid idempotently', async () => {
    const events: ServerEvent[] = [];
    const session = new VoilaSession((event) => events.push(event), ports);
    cleanup.push(() => session.dispose());
    const app = createApp({ sessions: new Map([['demo', session]]), token: 'test-token' });
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
  it('validates JSON, streams events, and reattaches an existing session with its stage replayed', async () => {
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports, token: 'test' });
    cleanup.push(running.close);
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port');
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/demo`);
      const messages: ServerEvent[] = [];
      ws.on('message', (data) => messages.push(ServerEventSchema.parse(JSON.parse(data.toString()))));
      await once(ws, 'open');
      const until = async (check: () => boolean) => {
        while (!check()) await once(ws, 'message');
      };
      return { ws, messages, until };
    };
    const first = await connect();
    await first.until(() => first.messages.length > 0);
    expect(first.messages[0]).toEqual({ type: 'stage', stage: 'LISTEN' });
    first.ws.send('{bad json');
    await first.until(() => first.messages.some((e) => e.type === 'error'));
    first.ws.send(JSON.stringify(hello));
    first.ws.send(JSON.stringify({ type: 'final_transcript', text: 'CDG' }));
    await first.until(() => first.messages.some((e) => e.type === 'stage' && e.stage === 'CHOOSE'));
    const session = running.sessions.get('demo');
    const second = await connect();
    await second.until(() => second.messages.length > 0);
    expect(running.sessions.get('demo')).toBe(session);
    expect(second.messages[0]).toEqual({ type: 'stage', stage: 'CHOOSE' });
    second.ws.send(JSON.stringify({ type: 'user_reply', text: 'G7' }));
    await second.until(() => second.messages.some((e) => e.type === 'stage' && e.stage === 'DONE'));
    expect(second.messages).toContainEqual({ type: 'say', text: expect.stringContaining('Appelez G7') });
    expect(running.sessions.size).toBe(1);
  });
});
