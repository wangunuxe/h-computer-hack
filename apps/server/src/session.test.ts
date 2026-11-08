import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerEventSchema, type MonitorEvent, type ServerEvent, type Trip } from '@voila/shared';
import { VoilaSession, type SessionPorts } from './session.js';
import type { BookingInput } from './booking.js';
import { presetOptions } from './options.js';
import { readRerBTraffic, type TrafficClient } from './adapters/traffic-h.js';
import { understand } from './understand.js';

const profile = { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'en', guide_dog: true };
const fare = { total_price: 65, currency: 'EUR' as const };
const trip: Trip = { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2027-01-15T16:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true };
const booking = { ref: 'PAS-123', pickup_time: '2027-01-15T11:00:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33123456789', guide_dog_status: 'accepted' as const, payment_url: 'https://checkout.stripe.com/test' };
const disruption = { status: 'disrupted' as const, mode: 'live' as const, summary: 'RER B interrupted', cause: 'Signal failure.', source: 'https://www.rerb-leblog.fr/incident', recorded: false };
const completed = { booking, metrics: { steps: 2, durationMs: 100, costUsd: 0 }, agentViewUrl: undefined };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const sessions: VoilaSession[] = [];
function setup(overrides: Partial<SessionPorts> = {}) {
  const events: ServerEvent[] = [];
  const observed: (ServerEvent | MonitorEvent)[] = [];
  const activity: Extract<ServerEvent, { type: 'activity' }>[] = [];
  const ports = {
    understand: vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip, missing: [] }),
    converse: vi.fn<SessionPorts['converse']>().mockRejectedValue(new Error('offline')),
    trafficH: vi.fn<SessionPorts['trafficH']>().mockResolvedValue(disruption),
    linkup: vi.fn<SessionPorts['linkup']>().mockResolvedValue({ corroboration: [], extraOptions: [] }),
    runBooking: vi.fn<SessionPorts['runBooking']>().mockResolvedValue(completed),
    logger: { error: vi.fn() }, shuttlePublicUrl: () => 'https://shuttle.example', ...overrides,
  };
  const session = new VoilaSession((event) => { ServerEventSchema.parse(event); if (event.type === 'activity') activity.push(event); else events.push(event); }, ports, (event) => observed.push(event));
  sessions.push(session);
  const hello = (language = 'en', gps: { latitude: number; longitude: number } | null = null) => session.handle({ type: 'hello', profile: { ...profile, language }, gps, scenario: 'live' });
  const start = async () => { hello(); session.handle({ type: 'final_transcript', text: 'CDG from Gare du Nord' }); await flush(); };
  const choose = async (text = 'shuttle') => { session.handle({ type: 'user_reply', text }); await flush(); };
  return { session, events, observed, activity, ports, hello, start, choose };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00+01:00')); });
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('VoilaSession', () => {
  it('observes the registered profile, accepted transcripts, and understood trip', async () => {
    const s = setup();
    s.hello();
    expect(s.observed.slice(0, 2)).toEqual([
      { type: 'session', name: profile.name, scenario: 'live', started_at: '2027-01-15T09:00:00.000Z' },
      { type: 'stage', stage: 'LISTEN' },
    ]);
    s.session.handle({ type: 'final_transcript', text: 'CDG from Gare du Nord' }); await flush();
    expect(s.observed).toContainEqual({ type: 'transcript', text: 'CDG from Gare du Nord' });
    expect(s.observed).toContainEqual({ type: 'trip', trip: { ...trip } });
    s.session.handle({ type: 'user_reply', text: 'The first shuttle' }); await flush();
    expect(s.observed).toContainEqual({ type: 'transcript', text: 'The first shuttle' });
  });
  it('uses a neutral monitor label until the phone registers a name', () => {
    const s = setup();
    s.session.handle({ type: 'hello', profile: { language: 'en' }, gps: null, scenario: 'live' });
    expect(s.observed[0]).toEqual({
      type: 'session', name: 'User', scenario: 'live', started_at: '2027-01-15T09:00:00.000Z',
    });
  });
  it('redacts phone numbers from observed transcripts', () => {
    const s = setup();
    s.hello();
    s.session.handle({ type: 'final_transcript', text: 'My phone number is 0771234567' });
    expect(s.observed).toContainEqual({ type: 'transcript', text: 'My phone number is [phone]' });
  });
  it('observes every phone event and forwards booking frames, metrics, and agent view', async () => {
    const s = setup({
      runBooking: async (input) => {
        input.onFrame?.({ image: 'data:image/png;base64,abc', url: 'https://shuttle.example/page', step: 3 });
        input.onMetrics?.({ steps: 3, costUsd: 0.02 });
        input.onAgentView?.('https://h.example/view/123');
        await input.confirm('Ready to book', fare);
        await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: 'Ready' });
        return completed;
      },
    });
    s.session.handle(null);
    await s.start();
    await s.choose();
    expect(s.session.stage).toBe('CONFIRM');
    await s.choose('yes');
    expect(s.session.stage).toBe('AWAIT_PAYMENT');
    s.session.markPaid(booking.ref);
    expect(s.session.stage).toBe('DONE');
    expect(s.observed).toContainEqual({ type: 'agent_frame', image: 'data:image/png;base64,abc', url: 'https://shuttle.example/page', step: 3 });
    expect(s.observed).toContainEqual({ type: 'agent_metrics', steps: 3, cost_usd: 0.02 });
    expect(s.observed).toContainEqual({ type: 'agent_view', url: 'https://h.example/view/123' });
    for (const type of ['error', 'stage', 'say', 'feed', 'options', 'confirm', 'payment_handoff', 'booking_card']) {
      expect(s.observed.some((event) => event.type === type), `missing ${type}`).toBe(true);
    }
  });
  it.each(['je veux un taxi', 'taxi', 'un taxi', 'call me a taxi', 'la navette'])('books the airport taxi from Étoile in the demo for "%s", with confirmation and user payment', async (choice) => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: JSON.stringify({ trip: { origin: 'Étoile', destination: 'CDG' } }) })) } };
    const runBooking = vi.fn<SessionPorts['runBooking']>().mockImplementation(async (input) => {
      const decision = await input.confirm('Taxi', { ...fare, pickup_date: '2027-01-15', pickup_time: '10:15' });
      expect(decision.approved).toBe(true);
      await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Paris Airport Shuttle', summary: 'Taxi' });
      return { ...completed, booking: { ...booking, pickup_point: 'Étoile' } };
    });
    const s = setup({ understand: (input) => understand(input, client), runBooking });
    s.session.handle({ type: 'hello', profile: { ...profile, language: 'fr' }, gps: null, scenario: 'demo' });
    s.session.handle({ type: 'final_transcript', text: "Je suis à l'Étoile, mon avion part dans 2 heures, je dois aller à CDG" });
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    expect(s.events.find((event) => event.type === 'options')).toMatchObject({ items: [{ id: 'paris-airport-shuttle', name: 'Airport taxi — Étoile' }] });
    expect(runBooking).not.toHaveBeenCalled();
    expect(JSON.stringify(s.events.filter((event) => event.type === 'say' || event.type === 'options'))).not.toContain('Gare du Nord');
    await s.choose(choice); expect(runBooking).toHaveBeenCalledOnce(); expect(s.session.stage).toBe('CONFIRM');
    expect(runBooking.mock.calls[0]![0]).toMatchObject({ trip: { origin: 'Étoile', destination: 'CDG' }, journeyMinutes: 35 });
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('Taxi vers l’aéroport, prise en charge à Étoile') });
    expect(JSON.stringify(client.models.generateContent.mock.calls)).not.toContain('Gare du Nord');
    await s.choose('oui'); expect(s.session.stage).toBe('AWAIT_PAYMENT');
    s.session.handle({ type: 'paid' }); expect(s.session.stage).toBe('DONE');
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'booking_card', booking: expect.objectContaining({ pickup_point: 'Étoile' }) }));
    expect(s.ports.linkup).not.toHaveBeenCalled(); expect(s.ports.trafficH).not.toHaveBeenCalled();
  });
  it('keeps the stated pickup when live research returns a context-free catalogue or obsolete manual taxis', async () => {
    const s = setup({ understand: async () => ({ trip: { ...trip, origin: 'Châtelet' }, missing: [] }), linkup: async () => ({ corroboration: [], extraOptions: [presetOptions[0]!, { ...presetOptions[0]!, id: 'g7-phone', name: 'G7 by phone' }, { ...presetOptions[0]!, id: 'gare-du-nord-taxi', name: 'Gare du Nord taxi rank' }] }) });
    s.hello(); s.session.handle({ type: 'final_transcript', text: 'Châtelet vers CDG' }); await flush();
    const options = s.events.find((event) => event.type === 'options');
    expect(options).toMatchObject({ items: [expect.objectContaining({ name: 'Airport taxi — Châtelet', journey_minutes: 45 }), expect.objectContaining({ id: 'rer-b-replacement-bus' })] });
    expect(JSON.stringify(options)).not.toMatch(/Gare du Nord|g7-phone/);
  });
  it('does not enter departure-time clarification for an ASAP relative flight with a known origin', async () => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: JSON.stringify({ trip: { origin: 'Gare du Nord', destination: 'CDG 2E' } }) })) } };
    const s = setup({ understand: (input) => understand(input, client) }); s.hello();
    s.session.handle({ type: 'final_transcript', text: 'At Gare du Nord, my airplane is in 2 hours i need arrive cdg as soon as possible' }); await flush();
    expect(s.session.stage).toBe('CHOOSE'); expect(s.events).not.toContainEqual({ type: 'stage', stage: 'CLARIFY' });
    expect(s.ports.converse).not.toHaveBeenCalled(); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it('keeps comma-separated profile phone replies local and sends the confirmed number to booking', async () => {
    const s = setup(); s.session.handle({ type: 'hello', profile: { language: 'fr', name: 'Marie', email: 'marie@example.com', guide_dog: false }, gps: null, scenario: 'live' });
    s.session.handle({ type: 'final_transcript', text: 'Gare du Nord to CDG' }); await flush(); await s.choose();
    await s.choose('zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit');
    expect(s.ports.runBooking).not.toHaveBeenCalled(); await s.choose('oui');
    expect(s.ports.runBooking.mock.calls[0]![0].profile.phone).toBe('0612345678');
    expect(s.ports.understand).toHaveBeenCalledOnce(); expect(s.ports.linkup).toHaveBeenCalledOnce(); expect(s.ports.converse).not.toHaveBeenCalled();
    expect(JSON.stringify([s.ports.understand.mock.calls[0]![0].transcript, s.ports.linkup.mock.calls])).not.toMatch(/zéro six|0612345678/);
  });
  it("keeps c'est Marie local after asking for a name and passes the confirmed name only to booking", async () => {
    const s = setup(); s.session.handle({ type: 'hello', profile: { language: 'fr', guide_dog: false }, gps: null, scenario: 'live' });
    s.session.handle({ type: 'final_transcript', text: 'Gare du Nord to CDG' }); await flush(); await s.choose();
    for (const text of ["c'est Marie", 'oui', '0612345678', 'oui', 'marie at example dot com', 'oui']) await s.choose(text);
    expect(s.ports.runBooking).toHaveBeenCalledOnce(); expect(s.ports.runBooking.mock.calls[0]![0].profile.name).toBe('Marie');
    expect(s.ports.understand).toHaveBeenCalledOnce(); expect(s.ports.linkup).toHaveBeenCalledOnce(); expect(s.ports.converse).not.toHaveBeenCalled();
    const external = JSON.stringify([s.ports.understand.mock.calls[0]![0].transcript, s.ports.linkup.mock.calls]); expect(external).not.toContain('Marie');
  });
  it.each([[false, true], [true, false]])('preserves an explicit trip dog=%s over saved dog=%s after contact collection', async (savedDog, tripDog) => {
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: { ...trip, guide_dog: tripDog }, missing: [] }) });
    s.session.handle({ type: 'hello', profile: { language: 'en', guide_dog: savedDog }, gps: null, scenario: 'live' });
    s.session.handle({ type: 'final_transcript', text: `Gare du Nord to CDG ${tripDog ? 'with' : 'without'} a guide dog` }); await flush(); await s.choose();
    for (const value of ['Marie', 'yes', '0612345678', 'yes', 'marie at example dot com', 'yes']) await s.choose(value);
    expect(s.ports.runBooking).toHaveBeenCalledOnce();
    expect(s.ports.runBooking.mock.calls[0]![0].trip.guide_dog).toBe(tripDog);
    expect(s.ports.runBooking.mock.calls[0]![0].profile.guide_dog).toBe(tripDog);
    expect(s.events.filter((event) => event.type === 'profile').at(-1)).toMatchObject({ profile: { guide_dog: savedDog } });
  });
  it.each([true, false])('still applies a newly confirmed guide-dog field: %s', async (guideDog) => {
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: { ...trip, guide_dog: false }, missing: [] }) });
    s.session.handle({ type: 'hello', profile: { name: profile.name, phone: profile.phone, email: profile.email, language: 'en' }, gps: null, scenario: 'live' });
    s.session.handle({ type: 'final_transcript', text: 'Gare du Nord to CDG' }); await flush(); await s.choose();
    await s.choose(guideDog ? 'yes' : 'no'); await s.choose('yes');
    expect(s.ports.runBooking).toHaveBeenCalledOnce(); expect(s.ports.runBooking.mock.calls[0]![0].trip.guide_dog).toBe(guideDog); expect(s.ports.runBooking.mock.calls[0]![0].profile.guide_dog).toBe(guideDog);
  });
  it.each(["j'ai payé", "I've paid", 'I have paid'])('accepts a spoken paid confirmation for a local stub only: %s', async (text) => {
    const s = setup({ runBooking: async (input) => { await input.onPaymentHandoff({ url: 'https://shuttle.example/stub-payment/demo?mode=no-stripe-key', amount: 65, merchant: 'Demo', summary: 'Demo' }); return completed; } });
    await s.start(); await s.choose(); expect(s.session.stage).toBe('AWAIT_PAYMENT'); s.session.handle({ type: 'user_reply', text }); await flush();
    expect(s.session.stage).toBe('DONE'); expect(s.ports.converse).not.toHaveBeenCalled();
  });
  it('does not treat a spoken paid claim as verification of Stripe payment', async () => {
    const s = setup({ runBooking: async (input) => { await input.onPaymentHandoff({ url: 'https://checkout.stripe.com/test', amount: 65, merchant: 'Stripe', summary: 'Transfer' }); return completed; } });
    await s.start(); await s.choose(); s.session.handle({ type: 'user_reply', text: "I've paid" }); await flush(); expect(s.session.stage).toBe('AWAIT_PAYMENT');
  });
  it('defers one-field voice profile collection until selection and keeps replies/readbacks out of Gemini history', async () => {
    const s = setup({ runBooking: vi.fn(() => new Promise(() => {})) });
    s.session.handle({ type: 'hello', profile: { language: 'fr' }, gps: null, scenario: 'demo' });
    s.session.handle({ type: 'final_transcript', text: 'CDG depuis Gare du Nord' }); await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    expect(s.events.some((event) => event.type === 'profile_request')).toBe(false);
    await s.choose(); expect(s.ports.runBooking).not.toHaveBeenCalled();
    const reply = async (text: string) => { s.session.handle({ type: 'user_reply', text }); await flush(); };
    expect(s.events.at(-1)).toEqual({ type: 'say', text: expect.stringContaining('nom') });
    await reply('Marie Test'); await reply('oui');
    await reply('invalide'); expect(s.events.at(-1)).toEqual({ type: 'say', text: expect.stringContaining('téléphone') });
    await reply('zéro six douze trente quatre cinquante six soixante dix huit'); await reply('non');
    await reply('0712345678'); await reply('oui');
    await reply('marie point test arobase example point com'); await reply('oui');
    await reply('non'); expect(s.ports.runBooking).not.toHaveBeenCalled(); await reply('oui');
    expect(s.ports.runBooking).toHaveBeenCalledOnce();
    expect(s.ports.runBooking.mock.calls[0]![0].profile).toEqual({ language: 'fr', name: 'Marie Test', phone: '0712345678', email: 'marie.test@example.com', guide_dog: false });
    expect(s.ports.converse).not.toHaveBeenCalled();
    await reply('Où en est-on ?');
    const context = JSON.stringify(s.ports.converse.mock.calls);
    for (const secret of ['Marie Test', '0712345678', 'marie.test', 'zero, six', 'zero, sept']) expect(context).not.toContain(secret);
    expect(s.events.filter((event) => event.type === 'profile')).toHaveLength(4);
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('efface mes informations') });
  });
  it('asks only for guide-dog information for a manual option and skips stored fields', async () => {
    const s = setup(); s.session.handle({ type: 'hello', profile: { language: 'en', guide_dog: false }, gps: null, scenario: 'demo' });
    s.session.handle({ type: 'final_transcript', text: 'Gare du Nord to CDG' }); await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE')); await s.choose('bus');
    expect(s.session.stage).toBe('DONE'); expect(s.ports.runBooking).not.toHaveBeenCalled(); expect(s.events.some((event) => event.type === 'profile_request')).toBe(false);
  });
  it.each(['efface mes informations', 'forget my details'])('clears saved and pending profile data without Gemini: %s', async (text) => {
    const s = setup(); await s.start();
    const phoneEvents: ServerEvent[] = [];
    s.session.attach((event) => phoneEvents.push(event));
    const earlierProfile = s.observed.findIndex((event) => event.type === 'profile');
    await s.choose(text);
    const resetSession = s.observed.findIndex((event) => event.type === 'session' && event.name === 'User');
    expect(earlierProfile).toBeGreaterThanOrEqual(0);
    expect(resetSession).toBeGreaterThan(earlierProfile);
    expect(s.session.stage).toBe('LISTEN'); expect(phoneEvents).toContainEqual({ type: 'profile', profile: { language: 'en' } });
    expect(s.ports.converse).not.toHaveBeenCalled(); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it('accepts spoken Stop before a trip without starting research or Gemini', () => {
    const s = setup(); s.hello(); s.session.handle({ type: 'final_transcript', text: 'Stop.' });
    expect(s.session.stage).toBe('LISTEN'); expect(s.ports.understand).not.toHaveBeenCalled(); expect(s.ports.trafficH).not.toHaveBeenCalled();
  });
  it('keeps cancellation available in CLARIFY while research runs, replays it, and aborts on Stop', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['trafficH']>>>();
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: { origin: 'Gare du Nord', destination: 'CDG' }, missing: ['deadline'] }), trafficH: vi.fn(() => pending.promise) });
    await s.start(); expect(s.session.stage).toBe('CLARIFY');
    expect(s.activity.at(-1)).toEqual({ type: 'activity', cancellable: true });
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay).toContainEqual({ type: 'activity', cancellable: true });
    s.session.handle({ type: 'stop' });
    expect(s.ports.trafficH.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(replay.at(-1)).toEqual({ type: 'activity', cancellable: false });
    pending.resolve(disruption); await flush();
    expect(s.session.stage).toBe('LISTEN'); expect(replay.at(-1)).toEqual({ type: 'activity', cancellable: false });
  });
  it('hides cancellation in CLARIFY once all work settles, including understanding failures', async () => {
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: {}, missing: ['origin', 'destination', 'deadline'] }) });
    await s.start(); expect(s.session.stage).toBe('CLARIFY'); expect(s.activity.at(-1)?.cancellable).toBe(false);
    const failed = setup({ understand: vi.fn().mockRejectedValue(new Error('unavailable')) });
    await failed.start(); expect(failed.session.stage).toBe('LISTEN'); expect(failed.activity.at(-1)?.cancellable).toBe(false);
  });
  it.each([{ pickup_date: '2027-01-15', pickup_time: '12:00' }, { total_price: 65 }, { currency: 'EUR' as const }])('never presents a confirmation without both transfer fare fields: %j', async (details) => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Unverified price', details)); return completed; } });
    await s.start(); await s.choose();
    expect(decision).toHaveBeenCalledWith({ approved: false, reply: expect.stringContaining('total price and EUR currency') });
    expect(s.events.some((event) => event.type === 'confirm')).toBe(false);
  });
  it.each(['demo', 'live'] as const)('starts a new trip from a paid DONE booking, preserving profile and %s scenario', async (scenario) => {
    const understand = vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip, missing: [] });
    const s = setup({ understand });
    const savedProfile = { ...profile, language: 'fr' };
    s.session.handle({ type: 'hello', profile: savedProfile, gps: null, scenario });
    s.session.handle({ type: 'final_transcript', text: 'Premier trajet vers CDG' });
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    await s.choose(); s.session.handle({ type: 'paid' }); expect(s.session.stage).toBe('DONE');
    const count = s.events.length;
    s.session.handle({ type: 'final_transcript', text: 'Encore un trajet vers CDG' });
    expect(s.session.stage).toBe('UNDERSTAND');
    expect(s.events.slice(count, count + 2)).toEqual([{ type: 'stage', stage: 'LISTEN' }, { type: 'stage', stage: 'UNDERSTAND' }]);
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    expect(understand).toHaveBeenLastCalledWith(expect.objectContaining({ transcript: 'Encore un trajet vers CDG', profile: savedProfile, previous: {}, signal: expect.any(AbortSignal) }));
    expect(s.ports.trafficH).toHaveBeenCalledTimes(scenario === 'demo' ? 0 : 2);
    expect(s.ports.linkup).toHaveBeenCalledTimes(scenario === 'demo' ? 0 : 2);
    await s.choose('bus'); expect(s.session.stage).toBe('DONE');
    expect(s.ports.runBooking).toHaveBeenCalledOnce();
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'DONE' }]);
    expect(s.events.slice(count).filter((event) => ['error', 'booking_card', 'payment_handoff', 'confirm'].includes(event.type))).toEqual([]);
    s.session.handle({ type: 'final_transcript', text: 'Nouvelle réservation après le taxi' });
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    await s.choose(); expect(s.session.stage).toBe('AWAIT_PAYMENT');
    expect(s.ports.runBooking).toHaveBeenCalledTimes(2);
    expect(understand).toHaveBeenLastCalledWith(expect.objectContaining({ profile: savedProfile, previous: {} }));
  });
  it('keeps a completed booking when DONE receives an empty transcript', async () => {
    const s = setup(); await s.start(); await s.choose(); s.session.handle({ type: 'paid' });
    s.session.handle({ type: 'final_transcript', text: '   ' });
    expect(s.session.stage).toBe('DONE'); expect(s.ports.understand).toHaveBeenCalledOnce();
    expect(s.events.at(-1)).toEqual({ type: 'error', message: 'Transcript must not be empty.' });
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'DONE' }, { type: 'booking_card', booking }]);
  });
  it('does not restore a previous booking when understanding the next trip fails', async () => {
    const understand = vi.fn<SessionPorts['understand']>().mockResolvedValueOnce({ trip, missing: [] }).mockRejectedValueOnce(new Error('unavailable'));
    const s = setup({ understand }); await s.start(); await s.choose(); s.session.handle({ type: 'paid' });
    s.session.handle({ type: 'final_transcript', text: 'Another trip' }); await flush();
    expect(s.session.stage).toBe('LISTEN'); expect(s.session.markPaid(booking.ref)).toBe(false);
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'LISTEN' }]);
  });
  it.each([undefined, 'demo', 'invalid'])('defaults to deterministic demo with VOILA_SCENARIO=%s and never calls H or Linkup', async (value) => {
    vi.stubEnv('VOILA_SCENARIO', value);
    const s = setup();
    s.session.handle({ type: 'hello', profile, gps: null });
    s.session.handle({ type: 'final_transcript', text: 'Gare du Nord CDG' });
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    expect(s.ports.trafficH).not.toHaveBeenCalled(); expect(s.ports.linkup).not.toHaveBeenCalled();
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', mode: 'demo', status: 'disrupted', text: expect.stringContaining('incident de signalisation') }));
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'say', text: expect.stringContaining('Demo mode. Recorded data, not live:') }));
  });
  it('honours an explicit demo hello over a live environment', async () => {
    vi.stubEnv('VOILA_SCENARIO', 'live');
    const s = setup(); s.session.handle({ type: 'hello', profile, gps: null, scenario: 'demo' });
    s.session.handle({ type: 'final_transcript', text: 'CDG' });
    await vi.waitFor(() => expect(s.session.stage).toBe('CHOOSE'));
    expect(s.ports.trafficH).not.toHaveBeenCalled();
  });
  it('uses only the H traffic reader for live traffic selected by the environment', async () => {
    vi.stubEnv('VOILA_SCENARIO', 'live');
    const s = setup(); s.session.handle({ type: 'hello', profile, gps: null });
    s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush();
    expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.trafficH).toHaveBeenCalledOnce();
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', mode: 'live', status: 'disrupted' }));
  });
  it('still offers options when H reports normal traffic', async () => {
    const s = setup({ trafficH: vi.fn().mockResolvedValue({ ...disruption, status: 'normal', mode: 'live', cause: '' }) });
    await s.start();
    expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.trafficH).toHaveBeenCalledOnce();
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', mode: 'live', status: 'normal' }));
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'say', text: expect.stringContaining('The RER B is running normally.') }));
    expect(s.events.find((e) => e.type === 'options')?.items.length).toBeGreaterThan(0);
  });
  it('speaks unknown status and continues with alternatives if the live reader fails', async () => {
    const s = setup({ trafficH: vi.fn().mockRejectedValue(new Error('offline')) }); await s.start();
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', mode: 'live', status: 'unknown' }));
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'say', text: expect.stringContaining('Its status is unknown.') }));
    expect(s.events.find((e) => e.type === 'options')?.items.length).toBeGreaterThan(0);
  });
  it('stop cancels the actual H text reader session and ignores late traffic results', async () => {
    const cancel = vi.fn(async () => {});
    const client = { startSession: vi.fn(async () => ({ cancel, waitForCompletion: () => new Promise(() => {}) })) } as unknown as TrafficClient;
    const s = setup({ trafficH: (input) => readRerBTraffic(input, client) });
    await s.start(); expect(client.startSession).toHaveBeenCalledOnce();
    s.session.handle({ type: 'stop' }); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(s.session.stage).toBe('LISTEN');
    expect(s.events.some((e) => e.type === 'options' || (e.type === 'feed' && e.mode === 'live'))).toBe(false);
  });
  it('replays choices after the current stage without repeating speech', async () => {
    const s = setup(); await s.start();
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'CHOOSE' }, s.events.find((e) => e.type === 'options')]);
  });
  it('replays the pending localized confirmation after CONFIRM', async () => {
    const s = setup({ runBooking: async (input) => { await input.confirm('Original agent summary', fare); return completed; } });
    await s.start(); await s.choose();
    const replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'CONFIRM' }, s.events.find((event) => event.type === 'confirm')]);
    expect(JSON.stringify(replay)).not.toContain('Original agent summary');
  });
  it('replays payment in HANDOFF and AWAIT_PAYMENT, then the booking card in DONE', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return pending.promise; } });
    await s.start(); await s.choose();
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    const payment = { type: 'payment_handoff', url: booking.payment_url, amount: 65, merchant: 'Shuttle' };
    let replay: ServerEvent[] = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'HANDOFF' }, payment]);
    pending.resolve(completed); await flush();
    replay = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'AWAIT_PAYMENT' }, payment]);
    s.session.markPaid(booking.ref);
    replay = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'DONE' }, { type: 'booking_card', booking }]);
    s.session.handle({ type: 'stop' });
    replay = []; s.session.attach((event) => replay.push(event));
    expect(replay.filter((event) => !['activity', 'profile'].includes(event.type))).toEqual([{ type: 'stage', stage: 'LISTEN' }]);
  });
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
  it('accepts a user paid event during HANDOFF and completes when the booking resolves', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return pending.promise; } });
    await s.start(); await s.choose();
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    s.session.handle({ type: 'paid' }); s.session.handle({ type: 'paid' });
    expect(s.session.stage).toBe('HANDOFF');
    expect(s.events.filter((event) => event.type === 'booking_card' || event.type === 'error')).toEqual([]);
    pending.resolve(completed); await flush();
    expect(s.session.stage).toBe('DONE');
    expect(s.events.filter((event) => event.type === 'booking_card')).toEqual([{ type: 'booking_card', booking }]);
    expect(s.events).not.toContainEqual({ type: 'stage', stage: 'AWAIT_PAYMENT' });
  });
  it('rejects user paid before a handoff and does not remember it', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    const s = setup({ runBooking: () => pending.promise }); await s.start(); await s.choose();
    s.session.handle({ type: 'paid' });
    expect(s.events).toContainEqual({ type: 'error', message: 'Event paid is not allowed in EXECUTE.' });
    pending.resolve(completed); await flush();
    expect(s.session.stage).toBe('AWAIT_PAYMENT'); expect(s.events.some((event) => event.type === 'booking_card')).toBe(false);
  });
  it('clears early user payment on stop so it cannot complete another booking', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['runBooking']>>>();
    let input!: BookingInput;
    const runner = vi.fn<SessionPorts['runBooking']>().mockImplementationOnce(async (value) => { input = value; return pending.promise; }).mockResolvedValue(completed);
    const s = setup({ runBooking: runner }); await s.start(); await s.choose();
    await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: '' });
    s.session.handle({ type: 'paid' }); s.session.handle({ type: 'stop' }); pending.resolve(completed); await flush();
    expect(s.session.stage).toBe('LISTEN'); expect(s.events.some((event) => event.type === 'booking_card')).toBe(false);
    await s.start(); await s.choose(); expect(s.session.stage).toBe('AWAIT_PAYMENT');
    expect(s.events.some((event) => event.type === 'booking_card')).toBe(false);
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
    const traffic = deferred<Awaited<ReturnType<SessionPorts['trafficH']>>>();
    const linkup = deferred<Awaited<ReturnType<SessionPorts['linkup']>>>();
    const runner = vi.fn<SessionPorts['runBooking']>(async (input) => {
      input.onProgress('Opening booking form');
      input.onPage?.('route');
      expect(await input.confirm('Shuttle, 65 EUR.', fare)).toEqual({ approved: true, reply: 'oui' });
      await input.onPaymentHandoff({ url: booking.payment_url, amount: 65, merchant: 'Shuttle', summary: 'Ready' });
      return completed;
    });
    const s = setup({ trafficH: () => traffic.promise, linkup: () => linkup.promise, runBooking: runner });
    await s.start();
    expect(s.session.stage).toBe('RESEARCH');
    traffic.resolve(disruption); await flush();
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
    expect(s.events).toContainEqual({ type: 'feed', kind: 'traffic', text: 'live — RER B interrupted', source: disruption.source, mode: 'live', status: 'disrupted' });
    expect(s.session.markPaid('PAS-123')).toBe(true);
    expect(s.events.filter((e) => e.type === 'booking_card')).toHaveLength(1);
  });
  it('runs research while clarifying and merges the reply without restarting research', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['trafficH']>>>();
    const understanding = vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip: { origin: trip.origin, destination: trip.destination }, missing: ['deadline'] });
    const converse = vi.fn<SessionPorts['converse']>().mockResolvedValueOnce({ intent: 'unclear', confidence: .1, reply: 'What time is your flight?' }).mockResolvedValueOnce({ intent: 'provide_info', confidence: .95, trip_patch: { deadline: trip.deadline }, reply: 'Thank you.' });
    const s = setup({ understand: understanding, converse, trafficH: vi.fn(() => pending.promise) });
    await s.start();
    expect(s.session.stage).toBe('CLARIFY');
    expect(s.ports.trafficH).toHaveBeenCalled(); expect(s.ports.linkup).toHaveBeenCalled();
    pending.resolve(disruption); await flush();
    expect(s.session.stage).toBe('CLARIFY');
    expect(s.events.some((e) => e.type === 'options')).toBe(false);
    await s.choose('My flight is at 21h');
    expect(converse.mock.calls[1]![0].trip).toMatchObject({ origin: trip.origin, destination: trip.destination, luggage: 0 });
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.ports.trafficH).toHaveBeenCalledTimes(1);
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
    expect(s.events).toContainEqual({ type: 'say', text: 'Je peux réserver un taxi vers l’aéroport. Pour vérifier ce trajet, quel aéroport souhaitez-vous rejoindre et d’où partez-vous ?' });
    expect(s.ports.linkup.mock.calls[0]?.[0].query).not.toContain('Gare du Nord to CDG');
  });
  it('uses only researched extra options for an unsupported preset route', async () => {
    const extra = { ...presetOptions[0]!, name: 'Airport taxi to Orly', source: 'https://paris-airport-shuttle.com/fr/reservation/' };
    const s = setup({ understand: async () => ({ trip: { ...trip, destination: 'Orly' }, missing: [] }), linkup: async () => ({ corroboration: [], extraOptions: [extra] }) });
    await s.start();
    expect(s.events).toContainEqual({ type: 'options', items: [extra] });
  });
  it('times out research ports that ignore their signals', async () => {
    const s = setup({ trafficH: () => new Promise(() => {}), linkup: () => new Promise(() => {}) });
    await s.start();
    await vi.advanceTimersByTimeAsync(46_000); await flush();
    expect(s.session.stage).toBe('CHOOSE');
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'feed', mode: 'live', status: 'unknown' }));
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
    await s.choose('bus');
    expect(s.session.stage).toBe('DONE');
    expect(s.events).toContainEqual({ type: 'say', text: expect.stringContaining('Demandez aux agents si un bus de remplacement') });
    expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each([['yes', true], ["d'accord", true], ['vas-y', true], ['non', false], ['attends', false]])('passes confirmation %s back to the runner', async (reply, approved) => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle', fare)); if (!approved) throw new Error('Declined'); return completed; } });
    await s.start(); await s.choose();
    expect(s.session.stage).toBe('CONFIRM');
    await s.choose(reply);
    expect(decision).toHaveBeenCalledWith({ approved, reply });
    expect(s.session.stage).toBe(approved ? 'AWAIT_PAYMENT' : 'CHOOSE');
  });
  it('re-asks unclear selection and confirmation without advancing', async () => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle', fare)); return completed; } });
    await s.start(); await s.choose('something'); expect(s.session.stage).toBe('CHOOSE');
    await s.choose(); await s.choose('oui mais non');
    expect(s.session.stage).toBe('CONFIRM'); expect(decision).not.toHaveBeenCalled();
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Please say yes to approve, or no to decline.' });
  });
  it.each([
    '**Booking summary:**\nFlight Price: 400 EUR\nTotal: 65 EUR\nEmail: karim@example.com',
    'Date: 2027-01-15\nTime: 20:00', 'Total - 65 EUR',
  ])('builds French confirmation cards and speech from structured facts, not agent prose: %s', async (summary) => {
    const s = setup({ runBooking: async (input) => { await input.confirm(summary, { pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR' }); return completed; } });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    expect(s.events).toContainEqual({ type: 'confirm', summary: 'Taxi vers l’aéroport, prise en charge à Gare du Nord, vers CDG 2E, aujourd’hui à 20 h, 65 €, avec votre chien guide. Je confirme ?' });
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Taxi vers l’aéroport, prise en charge à Gare du Nord, vers CDG 2E, aujourd’hui à 20 h, 65 €, avec votre chien guide. Je confirme ?' });
    expect(s.events.filter((e) => e.type === 'say').map((e) => e.text).join(' ')).not.toMatch(/Booking summary|karim@example|\*\*/);
  });
  it('never extracts date or time from a summary when only structured fare is provided', async () => {
    const summary = 'Date: 2027-01-15\nTime: 20:00\nFlight Price: 400 EUR\nTotal - 65 EUR';
    const s = setup({ runBooking: async (input) => { await input.confirm(summary, fare); return completed; } });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    expect(s.events).toContainEqual({ type: 'confirm', summary: 'Taxi vers l’aéroport, prise en charge à Gare du Nord, vers CDG 2E, 65 €, avec votre chien guide. Je confirme ?' });
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Taxi vers l’aéroport, prise en charge à Gare du Nord, vers CDG 2E, 65 €, avec votre chien guide. Je confirme ?' });
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
    let understandingSignal: AbortSignal | undefined;
    const s = setup({ understand: (input) => { understandingSignal = input.signal; return pending.promise; }, trafficH: async (input) => { signal = input?.signal; return new Promise(() => {}); } });
    await s.start(); s.session.handle({ type: 'stop' });
    expect(signal?.aborted).toBe(true);
    expect(understandingSignal?.aborted).toBe(true);
    pending.resolve({ trip, missing: [] }); await flush();
    expect(s.session.stage).toBe('LISTEN');
    expect(s.events.some((e) => e.type === 'options')).toBe(false);
  });
  it('stop releases a pending confirmation as a rejection without stale error events', async () => {
    const decision = vi.fn();
    const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle', fare)); throw new Error('Stopped'); } });
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
  it('booking failure returns to CHOOSE with the taxi available for an explicit retry', async () => {
    const s = setup({ runBooking: vi.fn().mockRejectedValue(new Error('provider unavailable')) });
    await s.start(); await s.choose();
    expect(s.session.stage).toBe('CHOOSE');
    const lastOptions = s.events.filter((e) => e.type === 'options').at(-1);
    expect(lastOptions?.items.some((o) => o.id === 'paris-airport-shuttle')).toBe(true);
    expect(s.events).toContainEqual({ type: 'say', text: 'This booking attempt failed. Would you like to retry the airport taxi?' });
  });
  it('does not keep narrating after UNDERSTAND has already timed out', async () => {
    const s = setup({ understand: () => new Promise(() => {}) }); await s.start();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(s.events.some((e) => e.type === 'say' && e.text === 'The check is still in progress. You can say stop.')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.session.stage).toBe('LISTEN');
    expect(s.events.some((e) => e.type === 'say' && e.text === 'The check is still in progress. You can say stop.')).toBe(false);
  });
  it.each(['fr', 'en'])('backs off unprefixed EXECUTE heartbeats in %s', async (language) => {
    const s = setup({ runBooking: () => new Promise(() => {}) });
    s.hello(language); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    const cues = language === 'fr' ? ['La vérification est toujours en cours. Vous pouvez dire stop.', 'Je reste en attente de la réponse du site.', 'Cela prend plus de temps que prévu. Je surveille la réponse.'] : ['The check is still in progress. You can say stop.', 'I am waiting for the site to respond.', 'This is taking longer than expected. I am watching for a response.'];
    const heartbeats = () => s.events.filter((e) => e.type === 'say' && cues.includes(e.text));
    await vi.advanceTimersByTimeAsync(24_999); expect(heartbeats()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(24_999); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(25_000); expect(heartbeats()).toHaveLength(3);
    const spoken = heartbeats().map((event) => event.type === 'say' ? event.text : '');
    expect(spoken).toEqual(cues);
    s.session.handle({ type: 'stop' });
    s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    await vi.advanceTimersByTimeAsync(25_000); expect(heartbeats()).toHaveLength(4);
  });
  it('does not carry a research heartbeat back-off into EXECUTE', async () => {
    const pending = deferred<Awaited<ReturnType<SessionPorts['trafficH']>>>();
    const s = setup({ trafficH: () => pending.promise, runBooking: () => new Promise(() => {}) });
    await s.start(); expect(s.session.stage).toBe('RESEARCH');
    const heartbeats = () => s.events.filter((e) => e.type === 'say' && /The check is still|waiting for the site|taking longer/.test(e.text));
    await vi.advanceTimersByTimeAsync(25_000); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    pending.resolve(disruption); await flush(); await s.choose();
    expect(s.session.stage).toBe('EXECUTE');
    await vi.advanceTimersByTimeAsync(24_999); expect(heartbeats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(24_999); expect(heartbeats()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(heartbeats()).toHaveLength(3);
  });
  it('keeps raw progress in the feed and speaks only localized observed-page milestones', async () => {
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return new Promise(() => {}); } });
    s.hello('fr'); s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    input.onProgress('Step 5: click_web — Pickup date field'); input.onProgress('Filling in the passenger details');
    input.onPage?.('route'); input.onPage?.('vehicle'); input.onPage?.('info'); input.onPage?.('payment');
    input.onAction?.('time');
    await vi.advanceTimersByTimeAsync(25_000); input.onProgress('User approved. Creating the booking now.');
    expect(s.events.filter((e) => e.type === 'feed' && e.kind === 'agent')).toHaveLength(3);
    expect(s.events).toContainEqual({ type: 'feed', kind: 'agent', text: 'Step 5: click_web — Pickup date field' });
    const speech = s.events.filter((e) => e.type === 'say').map((e) => e.text);
    for (const text of ['Je remplis l’itinéraire.', 'Je choisis le véhicule.', 'Je remplis vos coordonnées.', 'La réservation est prête pour le paiement.']) expect(speech).toContain(text);
    expect(speech.join(' ')).not.toMatch(/click_web|Step 5|Filling in|User approved/);
    expect(speech).toContain('Je choisis l’heure de prise en charge.');
    input.onRetry?.();
    expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Le site met du temps, je réessaie.' });
  });
  it('reports invalid/wrong-stage input and wrong payment references without crashing', async () => {
    const s = setup();
    s.session.handle(null); s.session.handle({ type: 'paid' }); s.hello(); s.session.handle({ type: 'user_reply', text: 'yes' });
    expect(s.events.filter((e) => e.type === 'error')).toHaveLength(3);
    expect(s.session.markPaid('wrong')).toBe(false);
    expect(s.session.stage).toBe('LISTEN');
  });
  it('does not carry a pending action through confirmation or into a new trip', async () => {
    let input!: BookingInput;
    const s = setup({ runBooking: async (value) => { input = value; return new Promise(() => {}); } });
    await s.start(); await s.choose(); input.onAction?.('pickup');
    void input.confirm('Taxi', { total_price: 65, currency: 'EUR' }); await flush();
    await s.choose('yes'); await vi.advanceTimersByTimeAsync(25_000);
    expect(s.events.filter((event) => event.type === 'say').map((event) => event.text)).not.toContain('I am entering the pickup address.');
    input.onAction?.('pickup'); s.session.handle({ type: 'stop' });
    s.session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); await s.choose();
    const count = s.events.length; await vi.advanceTimersByTimeAsync(25_000);
    expect(s.events.slice(count).filter((event) => event.type === 'say').map((event) => event.text)).not.toContain('I am entering the pickup address.');
  });
});
