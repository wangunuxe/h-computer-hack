import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { WatchRegistry } from './watch-registry.js';
import { sanitizeWatchEvent } from './watch-privacy.js';
import { createSessionServer } from './index.js';

afterEach(() => vi.useRealTimers());
describe('read-only desktop watches', () => {
  it.each(['Karim', '0612345678'])('omits URL origins containing known contact values: %s', (contact) => {
    const profile = { language: 'fr', name: 'Karim', phone: '0612345678' };
    const url = `https://${contact}.example.com/private`;
    const step = sanitizeWatchEvent({ type: 'agent_step', action: 'Checking booking', url }, profile);
    expect(step).toEqual({ type: 'agent_step', action: 'Checking booking' });
    const feed = sanitizeWatchEvent({ type: 'feed', kind: 'research', text: 'Checking source', source: url }, profile);
    expect(feed).toEqual({ type: 'feed', kind: 'research', text: 'Checking source' });
  });
  it('replaces close grace with normal unpaired expiry on every offline attach', () => {
    vi.useFakeTimers(); const registry = new WatchRegistry();
    try {
      for (const paired of [false, true]) {
        const ticket = registry.issue(String(paired)); if ('error' in ticket) throw Error('ticket');
        const close = registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())!;
        if (paired) { registry.pair(ticket.code, 'a'); registry.disconnected('a'); }
        close(); vi.advanceTimersByTime(29_000);
        const sink = vi.fn(); expect(registry.attach(ticket.watch_id, ticket.watch_token, sink)).toBeTypeOf('function');
        vi.advanceTimersByTime(31_000); expect(sink.mock.calls).toEqual([[{ type: 'unpaired' }]]);
        vi.advanceTimersByTime(10 * 60_000 - 31_000); expect(sink).toHaveBeenLastCalledWith({ type: 'unpaired', expired: true });
        expect(registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())).toBeUndefined();
      }
    } finally { registry.dispose(); }
  });
  it('reclaims abandoned paired tickets while allowing a 30-second reconnect grace', () => {
    vi.useFakeTimers(); const registry = new WatchRegistry(() => 'CHOOSE', globalThis, 1);
    try {
      const ticket = registry.issue('one'); if ('error' in ticket) throw Error('ticket');
      const detach = registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())!; registry.pair(ticket.code, 'a');
      registry.mirror('a', { type: 'say', text: 'current trip' }); detach(); vi.advanceTimersByTime(29_999);
      const resumed = vi.fn(); const close = registry.attach(ticket.watch_id, ticket.watch_token, resumed)!;
      expect(resumed).toHaveBeenCalledWith({ type: 'paired', stage: 'CHOOSE' }); expect(JSON.stringify(resumed.mock.calls)).toContain('current trip');
      vi.advanceTimersByTime(30_000); expect(registry.issue('two')).toEqual({ error: 'capacity' });
      close(); vi.advanceTimersByTime(30_000);
      expect(registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())).toBeUndefined();
      const next = registry.issue('one'); if ('error' in next) throw Error('capacity not released');
      const sink = vi.fn(); registry.attach(next.watch_id, next.watch_token, sink);
      registry.pair(ticket.code, 'a'); registry.connected('a'); registry.mirror('a', { type: 'say', text: 'old session' });
      expect(sink.mock.calls).toEqual([[{ type: 'unpaired' }]]);
    } finally { registry.dispose(); }
  });
  it('keeps a ticket while another watcher is attached and expires pairings with no watcher', () => {
    vi.useFakeTimers(); const registry = new WatchRegistry();
    try {
      const ticket = registry.issue('one'); if ('error' in ticket) throw Error('ticket');
      const first = registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())!;
      const second = vi.fn(); registry.attach(ticket.watch_id, ticket.watch_token, second); registry.pair(ticket.code, 'a');
      first(); vi.advanceTimersByTime(31_000); registry.mirror('a', { type: 'say', text: 'still connected' });
      expect(second).toHaveBeenLastCalledWith({ type: 'watch', event: { type: 'say', text: 'still connected' } });
      const abandoned = registry.issue('two'); if ('error' in abandoned) throw Error('ticket'); registry.pair(abandoned.code, 'b');
      vi.advanceTimersByTime(30_000); expect(registry.attach(abandoned.watch_id, abandoned.watch_token, vi.fn())).toBeUndefined();
    } finally { registry.dispose(); }
  });
  it('drops replay history at session reset and completion boundaries', () => {
    const registry = new WatchRegistry();
    try {
      const ticket = registry.issue('one'); if ('error' in ticket) throw Error('ticket');
      registry.attach(ticket.watch_id, ticket.watch_token, vi.fn()); registry.pair(ticket.code, 'a');
      for (const stage of ['LISTEN', 'DONE'] as const) {
        registry.mirror('a', { type: 'say', text: 'old trip' }); registry.mirror('a', { type: 'stage', stage });
        const late = vi.fn(); registry.attach(ticket.watch_id, ticket.watch_token, late);
        expect(JSON.stringify(late.mock.calls)).not.toContain('old trip');
      }
    } finally { registry.dispose(); }
  });
  it('caps capacity, expires never-paired codes and rate limits guesses silently', () => {
    vi.useFakeTimers(); const registry = new WatchRegistry(() => 'LISTEN', globalThis, 1);
    try {
      const ticket = registry.issue('one'); if ('error' in ticket) throw Error('ticket');
      expect(registry.issue('two')).toEqual({ error: 'capacity' });
      const sink = vi.fn(); registry.attach(ticket.watch_id, ticket.watch_token, sink);
      for (let n = 0; n < 6; n++) registry.pair('wrong', 'a'); registry.pair(ticket.code, 'a');
      expect(sink).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10 * 60_000); expect(sink).toHaveBeenLastCalledWith({ type: 'unpaired', expired: true });
      registry.pair(ticket.code, 'a'); expect(registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())).toBeUndefined();
      expect(registry.issue('one')).not.toHaveProperty('error');
    } finally { registry.dispose(); }
  });
  it('limits and expires unpaired tickets, rejects credentials and replaces pairings', () => {
    vi.useFakeTimers(); const registry = new WatchRegistry(() => 'CHOOSE');
    try {
      const ticket = registry.issue('one'); if ('error' in ticket) throw Error('ticket');
      expect(ticket.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/); expect(registry.attach(ticket.watch_id, 'wrong', vi.fn())).toBeUndefined();
      registry.issue('one'); registry.issue('one'); expect(registry.issue('one')).toEqual({ error: 'client-limit' });
      const sink = vi.fn(); registry.attach(ticket.watch_id, ticket.watch_token, sink);
      registry.pair('invalid', 'a'); expect(sink).toHaveBeenCalledTimes(1);
      registry.pair(ticket.code, 'a'); registry.pair(ticket.code, 'b'); sink.mockClear();
      registry.mirror('a', { type: 'say', text: 'old' }); registry.mirror('b', { type: 'say', text: 'new' });
      expect(sink.mock.calls).toEqual([[{ type: 'watch', event: { type: 'say', text: 'new' } }]]);
      const late = vi.fn(); registry.attach(ticket.watch_id, ticket.watch_token, late); expect(late).toHaveBeenCalledWith({ type: 'paired', stage: 'CHOOSE' });
      registry.disconnected('b'); vi.advanceTimersByTime(10 * 60_000);
      expect(registry.attach(ticket.watch_id, ticket.watch_token, vi.fn())).toBeUndefined();
    } finally { registry.dispose(); }
  });
  it('strips contact, profile, GPS, URL credentials and payment secrets, including contact candidates', () => {
    const profile = { language: 'fr', name: 'Karim', email: 'karim@example.com', phone: '0612345678' };
    expect(sanitizeWatchEvent({ type: 'profile', profile }, profile)).toBeUndefined();
    for (const event of [
      { type: 'say' as const, text: 'Karim karim@example.com 06 12 34 56 78 48.88354 2.17661' },
      { type: 'confirm' as const, summary: 'Karim karim@example.com 0612345678' },
      { type: 'agent_step' as const, action: 'Write Karim 0612345678', url: 'https://example.com/karim@example.com?latitude=48.88354&token=secret' },
    ]) { const safe = JSON.stringify(sanitizeWatchEvent(event, profile)); for (const secret of ['Karim','karim@example.com','0612345678','48.88354','2.17661','secret']) expect(safe).not.toContain(secret); }
    expect(sanitizeWatchEvent({ type: 'say', text: 'Unknown Name. Est-ce correct ?' }, profile, { collecting: true })).toMatchObject({ text: '[Contact details stay on the phone]' });
    expect(sanitizeWatchEvent({ type: 'payment_handoff', url: 'https://checkout.stripe.com/private', merchant: 'Shuttle', amount: 61.5 }, profile)).toEqual({ type: 'payment_handoff', merchant: 'Shuttle', amount: 61.5 });
    expect(sanitizeWatchEvent({ type: 'agent_step', action: 'Payment data' }, profile, { payment: true })).toBeUndefined();
    expect(sanitizeWatchEvent({ type: 'say', text: 'Karim, Martin, 48,91 € ou €48.9100. Latitude 48.91 et 2.17661' }, { ...profile, name: 'Karim Martin' })).toEqual({ type: 'say', text: '[contact], [contact], 48,91 € ou €48.9100. [position GPS] et [position GPS]' });
    expect(sanitizeWatchEvent({ type: 'options', items: [{ id: 'taxi', name: 'Karim to Bercy', price: 30, pickup_wait_minutes: 5, journey_minutes: 25, guide_dog_status: 'unknown', source: 'https://example.com/?phone=0612345678' }] }, profile)).toMatchObject({ items: [{ name: '[contact] to Bercy', source: 'https://example.com' }] });
    const card = sanitizeWatchEvent({ type: 'booking_card', booking: { ref: 'PAS-123', pickup_time: '2027-01-15T10:00:00Z', pickup_point: 'Karim 48.88354, 2.17661', price: 30, operator_phone: '0612345678', payment_url: 'https://checkout.stripe.com/private', guide_dog_status: 'unknown' } }, profile);
    expect(card).toMatchObject({ booking: { pickup_point: '[contact] [position GPS]' } }); expect(JSON.stringify(card)).not.toMatch(/operator_phone|payment_url|private|0612345678/);
    expect(sanitizeWatchEvent({ type: 'agent_step', action: 'Vehicle selection', url: 'https://shuttle.example/fr/reservation/private-id/vehicle?phone=0612345678' }, profile)).toEqual({ type: 'agent_step', action: 'Vehicle selection', url: 'https://shuttle.example/fr/reservation/…/vehicle' });
  });
  it('pairs over real sockets, mirrors text/events, ignores watcher commands and never evicts the phone', async () => {
    const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports: {
      understand: async () => ({ trip: { origin: 'La Défense', destination: 'Bercy', passengers: 1, guide_dog: false, luggage: 0 }, missing: [] }),
      trafficH: async () => ({ mode: 'live', status: 'normal', summary: 'Normal', cause: '', source: 'https://example.com', recorded: false }),
      linkup: async () => ({ corroboration: [], extraOptions: [] }),
    } });
    try {
      await once(running.server, 'listening'); const address = running.server.address(); if (!address || typeof address === 'string') throw Error('address');
      const ticket = await (await running.app.request('/watch', { method: 'POST' })).json();
      const issued = await (await running.app.request('/session', { method: 'POST' })).json();
      const events: any[] = [], phoneEvents: any[] = [];
      const watch = new WebSocket(`ws://127.0.0.1:${address.port}/ws/watch/${ticket.watch_id}?token=${ticket.watch_token}`); watch.on('message', (data) => events.push(JSON.parse(data.toString()))); await once(watch, 'open');
      const phone = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${issued.id}?token=${issued.resume_token}`); phone.on('message', (data) => phoneEvents.push(JSON.parse(data.toString()))); await once(phone, 'open');
      const hello = { type: 'hello', watch: 'invalid', profile: { language: 'fr', name: 'Karim', phone: '0612345678', email: 'karim@example.com' }, scenario: 'live', gps: null };
      phone.send(JSON.stringify(hello)); await vi.waitFor(() => expect(running.sessions.get(issued.id)?.language).toBe('fr'));
      expect(events.some((event) => event.type === 'paired')).toBe(false);
      phone.send(JSON.stringify({ ...hello, watch: ticket.code }));
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'paired', stage: 'LISTEN' }));
      watch.send(JSON.stringify({ type: 'stop' })); watch.send(JSON.stringify({ type: 'final_transcript', text: 'attacker' }));
      phone.send(JSON.stringify({ type: 'final_transcript', text: 'Je suis à La Défense, Bercy. Karim 0612345678 karim@example.com 48.88354 2.17661' }));
      await vi.waitFor(() => expect(phoneEvents).toContainEqual({ type: 'stage', stage: 'CHOOSE' }));
      expect(phone.readyState).toBe(WebSocket.OPEN); expect(events.some((event) => event.type === 'watch' && event.event.type === 'options')).toBe(true);
      expect(phoneEvents.some((event) => event.type === 'error')).toBe(false);
      expect(events.some((event) => event.type === 'watch' && event.event.type === 'final_transcript')).toBe(true);
      for (const secret of ['Karim','0612345678','karim@example.com','48.88354','2.17661','attacker','"profile"']) expect(JSON.stringify(events)).not.toContain(secret);
      phone.send(JSON.stringify({ type: 'user_reply', text: 'efface mes informations' }));
      await vi.waitFor(() => expect(phoneEvents.some((event) => event.type === 'say' && event.text.includes('Vos informations sont effacées'))).toBe(true));
      const replay: any[] = [];
      const late = new WebSocket(`ws://127.0.0.1:${address.port}/ws/watch/${ticket.watch_id}?token=${ticket.watch_token}`); late.on('message', (data) => replay.push(JSON.parse(data.toString()))); await once(late, 'open');
      await vi.waitFor(() => expect(JSON.stringify(replay)).toContain('Vos informations sont effacées'));
      expect(JSON.stringify(replay)).not.toContain('Bercy'); expect(replay.some((event) => event.event?.type === 'options')).toBe(false);
      phone.send(JSON.stringify({ type: 'final_transcript', text: 'Nouvelle demande vers Bercy' }));
      await vi.waitFor(() => expect(running.sessions.get(issued.id)?.stage).toBe('CHOOSE'));
      const fresh: any[] = []; const freshWatch = new WebSocket(`ws://127.0.0.1:${address.port}/ws/watch/${ticket.watch_id}?token=${ticket.watch_token}`); freshWatch.on('message', (data) => fresh.push(JSON.parse(data.toString()))); await once(freshWatch, 'open');
      await vi.waitFor(() => expect(fresh.some((event) => event.event?.type === 'options')).toBe(true));
      expect(JSON.stringify(fresh)).not.toContain('Vos informations sont effacées'); expect(JSON.stringify(fresh)).toContain('Nouvelle demande vers Bercy');
      late.close(); freshWatch.close();
      phone.close(); await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'unpaired' })); watch.close();
    } finally { await running.close(); }
  });
});
