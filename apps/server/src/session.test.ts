import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerEventSchema, type ServerEvent, type Trip } from '@voila/shared';
import { VoilaSession, type SessionPorts } from './session.js';
import type { BookingInput } from './booking.js';
import { presetOptions } from './options.js';

const profile = { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'en', guide_dog: true };
const trip: Trip = { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2027-01-15T16:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true };
const booking = { ref: 'PAS-123', pickup_time: '2027-01-15T11:00:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33123456789', guide_dog_status: 'accepted' as const, payment_url: 'https://checkout.stripe.com/test' };
const disruption = { summary: 'RER B interrupted', cause: 'Signal failure.', source: 'https://www.rerb-leblog.fr/incident', recorded: true };
const completed = { booking, metrics: { steps: 2, durationMs: 100, costUsd: 0 }, agentViewUrl: undefined };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const sessions: VoilaSession[] = [];
function setup(overrides: Partial<SessionPorts> = {}) {
  const events: ServerEvent[] = [];
  const ports = {
    understand: vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip, missing: [] }),
    prim: vi.fn<SessionPorts['prim']>().mockResolvedValue(disruption),
    linkup: vi.fn<SessionPorts['linkup']>().mockResolvedValue({ corroboration: [], extraOptions: [] }),
    runBooking: vi.fn<SessionPorts['runBooking']>().mockResolvedValue(completed),
    logger: { error: vi.fn() }, shuttlePublicUrl: () => 'https://shuttle.example', ...overrides,
  };
  const session = new VoilaSession((event) => { ServerEventSchema.parse(event); events.push(event); }, ports);
  sessions.push(session);
  const hello = (language = 'en', gps: { latitude: number; longitude: number } | null = null) => session.handle({ type: 'hello', profile: { ...profile, language }, gps });
  const start = async () => { hello(); session.handle({ type: 'final_transcript', text: 'CDG from Gare du Nord' }); await flush(); };
  const choose = async (text = 'shuttle') => { session.handle({ type: 'user_reply', text }); await flush(); };
  return { session, events, ports, hello, start, choose };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00+01:00')); });
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.useRealTimers(); });

describe('VoilaSession', () => {
  it.each(['EXECUTE', 'HANDOFF'])('remembers payment during %s and finishes only when the matching booking arrives', async (stage) => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return pending.promise; } });
    await s.start(); await s.choose();
    if (stage === 'HANDOFF') await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    expect(s.session.markPaid(booking.ref)).toBe(true);
    expect(s.events.some((e) => e.type === 'booking_card')).toBe(false);
    pending.resolve(completed); await flush();
    expect(s.session.stage).toBe('DONE');
    expect(s.events).toContainEqual({ type: 'booking_card', booking });
    expect(s.events).not.toContainEqual({ type: 'stage', stage: 'AWAIT_PAYMENT' });
  });
  it('does not apply an early receipt for a different booking reference', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    const s = setup({ runBooking: () => pending.promise }); await s.start(); await s.choose();
    expect(s.session.markPaid('another-order')).toBe(true);
    pending.resolve(completed); await flush();
    expect(s.session.stage).toBe('AWAIT_PAYMENT');
    expect(s.events.some((e) => e.type === 'booking_card')).toBe(false);
    s.session.markPaid(booking.ref); expect(s.session.stage).toBe('DONE');
  });
  it('emits the exact happy-path event and stage sequence through paid', async () => {
    const prim = deferred<Awaited<ReturnType<SessionPorts['prim']>>>();
    const linkup = deferred<Awaited<ReturnType<SessionPorts['linkup']>>>();
    const runner = vi.fn<SessionPorts['runBooking']>(async (input) => {
      input.onProgress('Opening booking form');
      input.onPage?.('route');
      expect(await input.confirm('Shuttle, 65 EUR.')).toEqual({ approved: true, reply: 'oui' });
      await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: 'Ready' });
      return completed;
    });
    const s = setup({ prim: () => prim.promise, linkup: () => linkup.promise, runBooking: runner });
    await s.start();
    expect(s.session.stage).toBe('RESEARCH');
    prim.resolve(disruption); await flush();
    linkup.resolve({ corroboration: [{ text: 'Service interrupted', sources: ['https://example.com/traffic'] }], extraOptions: [] }); await flush();
    await s.choose();
    expect(s.session.stage).toBe('CONFIRM');
    await s.choose('oui');
    expect(s.session.stage).toBe('AWAIT_PAYMENT');
    s.session.handle({ type: 'paid' });
    expect(s.events.map((e) => e.type === 'stage' ? `stage:${e.stage}` : e.type)).toEqual([
      'stage:LISTEN', 'stage:UNDERSTAND', 'say', 'say', 'stage:RESEARCH', 'feed', 'feed',
      'stage:PRESENT', 'options', 'say', 'say', 'stage:CHOOSE',
      'stage:EXECUTE', 'feed', 'say', 'stage:CONFIRM', 'confirm', 'say',
      'stage:EXECUTE', 'stage:HANDOFF', 'payment_handoff', 'say', 'stage:AWAIT_PAYMENT',
      'stage:DONE', 'booking_card', 'say',
    ]);
    expect(s.events).toContainEqual({ type: 'booking_card', booking });
    expect(s.events).toContainEqual({ type: 'feed', kind: 'prim', text: 'recorded data — RER B interrupted', source: disruption.source });
    expect(s.session.markPaid('PAS-123')).toBe(true);
    expect(s.events.filter((e) => e.type === 'booking_card')).toHaveLength(1);
  });
  it('runs research while clarifying and merges the reply without restarting research', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['prim']>>>();
    const understanding = vi.fn<SessionPorts['understand']>().mockResolvedValueOnce({ trip: { origin: trip.origin, destination: trip.destination }, missing: ['deadline'] }).mockResolvedValueOnce({ trip, missing: [] });
    const s = setup({ understand: understanding, prim: vi.fn(() => pending.promise) });
    await s.start();
    expect(s.session.stage).toBe('CLARIFY');
    expect(s.ports.prim).toHaveBeenCalled(); expect(s.ports.linkup).toHaveBeenCalled();
    pending.resolve(disruption); await flush();
    expect(s.session.stage).toBe('CLARIFY');
    expect(s.events.some((e) => e.type === 'options')).toBe(false);
    await s.choose('My flight is at 21h');
    expect(understanding.mock.calls[1]![0].previous).toMatchObject({ origin: trip.origin, destination: trip.destination, luggage: 0 });
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.ports.prim).toHaveBeenCalledTimes(1);
  });
  it('uses GPS origin when text has none, without asking for luggage or passenger count', async () => {
    const s = setup({ understand: vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip: { destination: trip.destination, deadline: trip.deadline }, missing: ['origin'] }) });
    s.hello('fr', { latitude: 48.88, longitude: 2.35 });
    s.session.handle({ type: 'final_transcript', text: 'CDG à 21h' }); await flush();
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.events.some((e) => e.type === 'clarify')).toBe(false);
  });
  it('continues with presets if Linkup fails', async () => {
    const s = setup({ linkup: vi.fn().mockRejectedValue(new Error('offline')) });
    await s.start();
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.events.find((e) => e.type === 'options')).toMatchObject({ items: expect.any(Array) });
    expect(s.events.some((e) => e.type === 'error')).toBe(false);
  });
  it('does not offer Gare du Nord–CDG presets for another route and speaks a safe fallback', async () => {
    const s = setup({ understand: async () => ({ trip: { ...trip, origin: 'Gare de Lyon', destination: 'Orly' }, missing: [] }) });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'Gare de Lyon vers Orly' }); await flush();
    expect(s.events).toContainEqual({ type: 'options', items: [] });
    expect(s.events).toContainEqual({ type: 'say', text: 'Je ne connais pas d’option pour ce trajet. Demandez de l’aide aux agents de la gare ou appelez un taxi.' });
    expect(s.ports.linkup.mock.calls[0]?.[0].query).not.toContain('Gare du Nord to CDG');
  });
  it('uses only researched extra options for an unsupported preset route', async () => {
    const extra = { ...presetOptions[1]!, name: 'G7 to Orly', source: 'https://www.g7.fr/orly' };
    const s = setup({ understand: async () => ({ trip: { ...trip, destination: 'Orly' }, missing: [] }), linkup: async () => ({ corroboration: [], extraOptions: [extra] }) });
    await s.start();
    expect(s.events).toContainEqual({ type: 'options', items: [extra] });
  });
  it('times out research ports that ignore their signals', async () => {
    const s = setup({ prim: () => new Promise(() => {}), linkup: () => new Promise(() => {}) });
    await s.start();
    await vi.advanceTimersByTimeAsync(9000); await flush();
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', kind: 'prim', text: expect.stringContaining('recorded data') }));
  });
  it('presents no feasible options and reads rejection reasons', async () => {
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: { ...trip, deadline: '2027-01-15T10:00:00+01:00' }, missing: [] }),
      linkup: async () => ({ corroboration: [], extraOptions: [{ ...presetOptions[0]!, guide_dog_status: 'refused' }] }) });
    await s.start();
    expect(s.events).toContainEqual({ type: 'options', items: [] });
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('arrival too late') });
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('guide dog refused') });
    expect(s.session.stage).toBe('CHOOSE');
  });
  it('reads manual instructions in the profile language then ends without H', async () => {
    const s = setup(); s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush();
    await s.choose('G7');
    expect(s.session.stage).toBe('DONE');
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('Appelez G7 au 3607') });
    expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each([['yes', true], ["d'accord", true], ['vas-y', true], ['non', false], ['attends', false]])('passes confirmation %s back to the runner', async (reply, approved) => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle')); if (!approved) throw new Error('Declined'); return completed; } });
    await s.start(); await s.choose();
    expect(s.session.stage).toBe('CONFIRM');
    await s.choose(reply);
    expect(decision).toHaveBeenCalledWith({ approved, reply });
    expect(s.session.stage).toBe(approved ? 'AWAIT_PAYMENT' : 'CHOOSE');
  });
  it('re-asks unclear selection and confirmation without advancing', async () => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle')); return completed; } });
    await s.start(); await s.choose('something'); expect(s.session.stage).toBe('CHOOSE');
    await s.choose(); await s.choose('oui mais non');
    expect(s.session.stage).toBe('CONFIRM'); expect(decision).not.toHaveBeenCalled();
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Please say yes to approve, or no to decline.' });
  });
  it('keeps the full agent summary on screen but speaks a short French confirmation', async () => {
    const summary = '**Booking summary:**\nDate: 2027-01-15, Time: 20:00 (Paris)\nTotal: 65 EUR\nEmail: karim@example.com';
    const s = setup({ runBooking: async (input) => { await input.confirm(summary); return completed; } });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    expect(s.events).toContainEqual({ type: 'confirm', summary });
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Navette Paris Airport Shuttle, vers CDG 2E, aujourd’hui à 20 h, 65 €, avec votre chien guide. Je confirme ?' });
    expect(s.events.filter((e) => e.type === 'say').map((e) => e.text).join(' ')).not.toMatch(/Booking summary|karim@example|\*\*/);
  });
  it('stop aborts booking and suppresses late callbacks and results', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return pending.promise; } });
    await s.start(); await s.choose(); s.session.handle({ type: 'stop' });
    expect(input.signal?.aborted).toBe(true); expect(s.session.stage).toBe('LISTEN');
    const count = s.events.length;
    input.onProgress('stale'); await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    expect(await input.confirm('stale')).toEqual({ approved: false, reply: 'Stopped' });
    pending.resolve(completed); await flush();
    expect(s.events).toHaveLength(count);
  });
  it('stop aborts research and ignores a late understanding response', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['understand']>>>();
    let signal: AbortSignal | undefined;
    const s = setup({ understand: () => pending.promise, prim: async (input) => { signal = input?.signal; return new Promise(() => {}); } });
    await s.start(); s.session.handle({ type: 'stop' });
    expect(signal?.aborted).toBe(true);
    pending.resolve({ trip, missing: [] }); await flush();
    expect(s.session.stage).toBe('LISTEN');
    expect(s.events.some((e) => e.type === 'options')).toBe(false);
  });
  it('stop releases a pending confirmation as a rejection without stale error events', async () => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle')); throw new Error('Stopped'); } });
    await s.start(); await s.choose();
    expect(s.session.stage).toBe('CONFIRM');
    s.session.handle({ type: 'stop' }); await flush();
    expect(decision).toHaveBeenCalledWith({ approved: false, reply: 'Stopped' });
    expect(s.session.stage).toBe('LISTEN');
    expect(s.events.some((e) => e.type === 'error')).toBe(false);
  });
  it('invalidates callbacks belonging to a failed booking attempt', async () => {
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; throw new Error('Failed'); } });
    await s.start(); await s.choose();
    const count = s.events.length;
    input.onProgress('late progress');
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    expect(input.signal?.aborted).toBe(true);
    expect(s.events).toHaveLength(count);
    expect(s.session.stage).toBe('CHOOSE');
  });
  it('booking failure returns to CHOOSE with the failed option removed', async () => {
    const s = setup({ runBooking: vi.fn().mockRejectedValue(new Error('provider unavailable')) });
    await s.start(); await s.choose();
    expect(s.session.stage).toBe('CHOOSE');
    const lastOptions = s.events.filter((e) => e.type === 'options').at(-1);
    expect(lastOptions?.items.some((o) => o.id === 'paris-airport-shuttle')).toBe(false);
    expect(s.events).toContainEqual({ type: 'say', text: 'Booking failed.' });
  });
  it('emits a heartbeat after four silent seconds in UNDERSTAND', async () => {
    const s = setup({ understand: () => new Promise(() => {}) }); await s.start();
    await vi.advanceTimersByTimeAsync(3999);
    expect(s.events.some((e) => e.type === 'say' && e.text === 'Still working. One moment.')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Still working. One moment.' });
  });
  it('backs off EXECUTE heartbeats to fifteen seconds after the first at four seconds', async () => {
    const s = setup({ runBooking: () => new Promise(() => {}) });
    await s.start(); await s.choose();
    const heartbeats = () => s.events.filter((e) => e.type === 'say' && e.text === 'Still working. One moment.');
    await vi.advanceTimersByTimeAsync(3999); expect(heartbeats()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000); expect(heartbeats()).toHaveLength(3);
    s.session.handle({ type: 'stop' });
    s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    await vi.advanceTimersByTimeAsync(4000); expect(heartbeats()).toHaveLength(4);
  });
  it('keeps raw progress in the feed and speaks only localized observed-page milestones', async () => {
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return new Promise(() => {}); } });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    input.onProgress('Step 5: click_web — Pickup date field'); input.onProgress('Filling in the passenger details');
    input.onPage?.('route'); input.onPage?.('vehicle'); input.onPage?.('info'); input.onPage?.('payment');
    await vi.advanceTimersByTimeAsync(8000); input.onProgress('User approved. Creating the booking now.');
    expect(s.events.filter((e) => e.type === 'feed' && e.kind === 'agent')).toHaveLength(3);
    expect(s.events).toContainEqual({ type: 'feed', kind: 'agent', text: 'Step 5: click_web — Pickup date field' });
    const speech = s.events.filter((e) => e.type === 'say').map((e) => e.text);
    for (const text of ['Je remplis l’itinéraire.', 'Je choisis le véhicule.', 'Je remplis vos coordonnées.', 'La réservation est prête pour le paiement.']) expect(speech).toContain(text);
    expect(speech.join(' ')).not.toMatch(/click_web|Step 5|Filling in|User approved/);
    expect(speech).toContain('Je continue, un instant.');
  });
  it('reports invalid/wrong-stage input and wrong payment references without crashing', async () => {
    const s = setup();
    s.session.handle(null); s.session.handle({ type: 'paid' }); s.hello(); s.session.handle({ type: 'user_reply', text: 'yes' });
    expect(s.events.filter((e) => e.type === 'error')).toHaveLength(3);
    expect(s.session.markPaid('wrong')).toBe(false);
    expect(s.session.stage).toBe('LISTEN');
  });
});
