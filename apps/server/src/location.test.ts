import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebEventSchema, type Gps, type ServerEvent } from '@voila/shared';
import { originFromGps, resolveGpsOrigin, redactGpsCoordinates } from './location.js';
import { VoilaSession, type SessionPorts } from './session.js';
import { understand } from './understand.js';
import { converse } from './converse.js';
import { searchDisruptionAndAlternatives } from './adapters/linkup.js';

const profile = { name: 'Camille Test', email: 'camille@example.com', phone: '+33612345678', language: 'fr', guide_dog: false };
const station = { latitude: 48.8919, longitude: 2.2387, accuracy: 15 };
const far = { latitude: 48.91, longitude: 2.20, accuracy: 10 };
const sessions: VoilaSession[] = [];
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00+01:00')); });
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); });
function setup(gps: Gps | null = null, overrides: Partial<SessionPorts> = {}) {
  const events: ServerEvent[] = [];
  const ports = { understand: vi.fn(async () => ({ trip: { destination: 'Bercy' }, missing: ['origin'] as const })), converse: vi.fn(async () => { throw new Error('offline'); }), trafficH: vi.fn(async () => ({ mode: 'live' as const, status: 'unknown' as const, summary: 'Unknown', cause: '', source: 'https://www.ratp.fr/infos-trafic', recorded: false })), linkup: vi.fn(async () => ({ corroboration: [], extraOptions: [] })), runBooking: vi.fn(async () => new Promise<never>(() => {})) };
  const session = new VoilaSession((event) => events.push(event), { ...ports, resolveOrigin: async (gps) => originFromGps(gps) ?? 'près du 7 Avenue Mary, à Rueil-Malmaison', shuttlePublicUrl: () => 'https://shuttle.example', ...overrides }); sessions.push(session);
  session.handle({ type: 'hello', profile, gps, scenario: 'live' }); session.handle({ type: 'final_transcript', text: 'Je veux aller à Bercy' });
  const reply = async (text: string) => { session.handle({ type: 'user_reply', text }); await flush(); };
  const result = async (gps: Gps | null) => { const request = events.find((event) => event.type === 'location_request'); if (request?.type !== 'location_request') throw new Error('No location request'); session.handle({ type: 'location_result', request_id: request.request_id, gps }); await flush(); return request.request_id; };
  return { session, events, ports, reply, result };
}
describe('consented phone origins', () => {
  it.each(['Non.', 'non merci', 'nan', "non c'est pas ça", 'no'])('clears a rejected GPS candidate and never repeats it for %s', async (reply) => {
    const s = setup(); await flush(); await s.result(station);
    const index = s.events.length; await s.reply(reply); await s.reply('euh');
    expect(s.events.slice(index).some((event) => event.type === 'clarify' && event.yes_no)).toBe(false);
    expect(s.events.slice(index)).toContainEqual({ type: 'clarify', question: 'Où êtes-vous ?' });
    expect(s.events.filter((event) => event.type === 'location_request')).toHaveLength(1);
  });
  it.each(["oui c'est ça", 'ouais', 'exact', 'yes'])('accepts a clear positive GPS answer %s', async (reply) => {
    const s = setup(); await flush(); await s.result(station); await s.reply(reply);
    expect(s.session.stage).toBe('CHOOSE');
  });
  it('asks for a spoken origin when no human label is available', async () => {
    const s = setup(null, { resolveOrigin: async () => undefined }); await flush(); await s.result(far);
    expect(s.events).toContainEqual({ type: 'clarify', question: 'Où êtes-vous ?' });
    expect(JSON.stringify(s.events)).not.toMatch(/48\.91|2\.20|Je vous situe/);
  });
  it('discards reverse-geocoding results after stop', async () => {
    let resolve!: (value: string) => void;
    const s = setup(null, { resolveOrigin: () => new Promise((done) => { resolve = done; }) });
    await flush(); await s.result(far); s.session.handle({ type: 'stop' }); const index = s.events.length;
    resolve('près du 7 Avenue Mary, à Rueil-Malmaison'); await flush();
    expect(s.session.stage).toBe('LISTEN'); expect(s.events.slice(index)).toEqual([]);
  });
  it('resolves the nearest station within 800m, but not distant or inaccurate positions', () => {
    expect(originFromGps(station)).toBe('La Défense');
    expect(originFromGps({ ...station, latitude: station.latitude + .004 })).toBe('La Défense');
    expect(originFromGps({ ...station, latitude: station.latitude + .01 })).toBeUndefined();
    expect(originFromGps({ ...station, accuracy: 1000 })).toBeUndefined();
    expect(originFromGps(far)).toBeUndefined();
  });
  it('explains the request first and waits for explicit yes before using the suggested station', async () => {
    const s = setup(); await flush();
    const requestIndex = s.events.findIndex((event) => event.type === 'location_request');
    expect(s.events[requestIndex - 1]).toEqual({ type: 'say', text: 'Pour trouver votre point de départ, j’utilise la position de votre téléphone.' });
    await s.result(station); expect(s.session.stage).toBe('CLARIFY'); expect(s.ports.linkup).not.toHaveBeenCalled();
    expect(s.events).toContainEqual({ type: 'clarify', question: 'Je vous situe à La Défense. Est-ce votre point de départ ? Dites oui ou non.', yes_no: true });
    await s.reply('oui mais je ne sais pas'); expect(s.ports.linkup).not.toHaveBeenCalled();
    await s.reply('oui, c’est ça !'); expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.linkup).toHaveBeenCalledOnce(); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it('supports hello GPS but does not seed it into Gemini or accept it before confirmation', async () => {
    const s = setup(station); await flush();
    expect(s.events.some((event) => event.type === 'location_request')).toBe(false); expect(s.session.stage).toBe('CLARIFY');
    expect(s.ports.understand.mock.calls[0]![0]).toMatchObject({ previous: {} });
    expect(s.ports.trafficH).not.toHaveBeenCalled(); await s.reply('yes'); expect(s.session.stage).toBe('CHOOSE');
  });
  it.each(['denied', 'timeout', 'rejected'] as const)('falls back to a voice origin without repeating permission prompts: %s', async (reason) => {
    const s = setup(); await flush();
    if (reason === 'denied') await s.result(null);
    else if (reason === 'timeout') { await vi.advanceTimersByTimeAsync(11_000); await flush(); }
    else { await s.result(station); await s.reply('non'); }
    expect(s.session.stage).toBe('CLARIFY'); expect(s.events.filter((event) => event.type === 'clarify').at(-1)).toMatchObject({ question: reason === 'rejected' ? 'Où êtes-vous ?' : expect.stringContaining('départ') });
    await s.reply('euh'); expect(s.events.filter((event) => event.type === 'location_request')).toHaveLength(1); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it('ignores a late location response after stop', async () => {
    const s = setup(); await flush(); s.session.handle({ type: 'stop' }); await s.result(station);
    expect(s.session.stage).toBe('LISTEN'); expect(s.ports.linkup).not.toHaveBeenCalled();
  });
  it('keeps rejected location candidates out of Gemini history and asks for origin locally', async () => {
    const s = setup(); await flush(); await s.result(station); await s.reply('non');
    expect(s.ports.converse).not.toHaveBeenCalled();
    await s.reply('euh'); expect(JSON.stringify(s.ports.converse.mock.calls)).not.toContain('La Défense');
  });
  it.each(['Non, je pars de Châtelet', 'No, I start at Châtelet'])('interprets a spoken GPS rejection and correction in the same turn: %s', async (text) => {
    const converse = vi.fn<SessionPorts['converse']>().mockResolvedValue({ intent: 'provide_info', confidence: 1, trip_patch: { origin: 'Châtelet' }, reply: 'Merci.' });
    const s = setup(null, { converse }); await flush(); await s.result(station);
    const before = s.events.length; await s.reply(text);
    expect(converse).toHaveBeenCalledOnce(); expect(converse.mock.calls[0]![0].transcript).toBe(text);
    expect(s.session.stage).toBe('CHOOSE'); expect(s.events.slice(before).some((event) => event.type === 'clarify')).toBe(false);
    expect(JSON.stringify(converse.mock.calls)).not.toContain('La Défense');
    await s.reply('taxi'); expect(s.ports.runBooking.mock.calls[0]![0]).toMatchObject({ trip: { origin: 'Châtelet', destination: 'Bercy' } });
  });
  it('lets an explicitly spoken origin take precedence when its interpretation races with GPS', async () => {
    let resolve!: (value: Awaited<ReturnType<SessionPorts['converse']>>) => void;
    const converse = vi.fn<SessionPorts['converse']>(() => new Promise((done) => { resolve = done; }));
    const s = setup(null, { converse }); await flush(); await s.reply('Je pars de Châtelet');
    await s.result(station); resolve({ intent: 'provide_info', confidence: 1, trip_patch: { origin: 'Châtelet' }, reply: 'Merci.' }); await flush();
    expect(s.session.stage).toBe('CHOOSE'); await s.reply('taxi');
    expect(s.ports.runBooking).toHaveBeenCalledOnce(); expect(s.ports.runBooking.mock.calls[0]![0]).toMatchObject({ trip: { origin: 'Châtelet' } });
  });
  it.each([{ latitude: 91, longitude: 2, accuracy: 1 }, { latitude: 48, longitude: 181, accuracy: 1 }, { latitude: 48, longitude: 2, accuracy: -1 }])('rejects invalid GPS protocol data: %j', (gps) => {
    expect(WebEventSchema.safeParse({ type: 'location_result', request_id: 'request', gps }).success).toBe(false);
  });
  it('gives H the confirmed GPS coordinates but sanitizes trip, options, history and Linkup context', async () => {
    const s = setup(); await flush(); await s.result(far); await s.reply('oui');
    await s.reply('quel est le prix ?');
    expect(JSON.stringify(s.ports.converse.mock.calls)).not.toMatch(/48\.91000|2\.20000/);
    expect(JSON.stringify(s.ports.linkup.mock.calls)).not.toMatch(/48\.91000|2\.20000/);
    expect(JSON.stringify(s.events)).not.toMatch(/48\.91|2\.20/);
    await s.reply('taxi'); expect(s.ports.runBooking).toHaveBeenCalledOnce(); expect(s.ports.runBooking.mock.calls[0]![0]).toMatchObject({ trip: { origin: 'près du 7 Avenue Mary, à Rueil-Malmaison', destination: 'Bercy' }, pickupGps: far });
  });
  it('hides coordinates even if H repeats them in public progress', async () => {
    const runBooking = vi.fn<SessionPorts['runBooking']>(async (input) => {
      input.onProgress('Pickup latitude 48.91000 and longitude 2.20000. Latitude 48,91000.');
      return new Promise<never>(() => {});
    });
    const s = setup(null, { runBooking }); await flush(); await s.result(far); await s.reply('oui'); await s.reply('taxi');
    expect(s.events).toContainEqual({ type: 'feed', kind: 'agent', text: 'Pickup latitude [position] and longitude [position]. Latitude [position].' });
    expect(JSON.stringify(s.events)).not.toMatch(/48[.,]91|2[.,]20/);
  });
  it('preserves fares, short single decimals and unit-bearing values while hiding coordinate pairs', async () => {
    const fare = 'Tarif 48,91 € / €48.91 / EUR 48.9100 / 48,9100 euros. Distance 48.9100 km / km 48,9100. Valeurs 48.91 et 48,910.';
    const pairs = 'GPS 48.91, 2.20; GPS 48,9100 2,2000; latitude 48 point 9100 longitude 2 point 2000';
    const runBooking = vi.fn<SessionPorts['runBooking']>(async (input) => {
      input.onProgress(fare); input.onProgress(pairs); return new Promise<never>(() => {});
    });
    const s = setup(null, { runBooking }); await flush(); await s.result(far); await s.reply('oui'); await s.reply('taxi');
    expect(s.events).toContainEqual({ type: 'feed', kind: 'agent', text: fare });
    const progress = s.events.filter((event) => event.type === 'feed' && event.kind === 'agent').at(-1)!;
    expect(JSON.stringify(progress)).not.toMatch(/48[.,]91|2[.,]20|point 9100|point 2000/);
    expect(JSON.stringify(progress)).toContain('[position GPS]');
  });
  it('removes coordinates from the actual Gemini and Linkup payloads, including bare decimal pairs', async () => {
    const origin = 'Position GPS (48.91000, 2.20000)', generateContent = vi.fn(async () => ({ text: JSON.stringify({ trip: {}, intent: 'question', confidence: .9, reply: 'Quel est votre départ ?' }) }));
    await understand({ transcript: `Je pars de ${origin}`, previous: { origin }, profile, now: new Date() }, { models: { generateContent } });
    await converse({ transcript: origin, trip: { origin }, history: [{ role: 'assistant', text: origin }], options: [], missing: [], stage: 'CLARIFY', language: 'fr', attempt: 0, now: new Date() }, { models: { generateContent } });
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response);
    await searchDisruptionAndAlternatives({ query: origin, context: '48.91, 2.20', apiKey: 'test', fetch: fetcher });
    expect(JSON.stringify(generateContent.mock.calls)).not.toMatch(/48\.91|2\.20/); expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/48\.91|2\.20/);
    expect(redactGpsCoordinates('Position GPS (48.91000, 2.20000)')).toBe('Position GPS');
  });
});
describe('human GPS labels', () => {
  const point = { latitude: 48.88354, longitude: 2.17661 };
  it('uses nearby stations without sending a reverse request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await resolveGpsOrigin(station, { fetch: fetcher })).toBe('La Défense'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([['7', 'près du 7 Avenue Mary, à Rueil-Malmaison'], [undefined, 'Avenue Mary, Rueil-Malmaison']])('builds a human BAN label for house number %s', async (housenumber, label) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ features: [{ properties: { housenumber, street: 'Avenue Mary', city: 'Rueil-Malmaison', distance: 26 } }] })));
    expect(await resolveGpsOrigin(point, { fetch: fetcher })).toBe(label);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api-adresse.data.gouv.fr/reverse/?lon=2.17661&lat=48.88354');
  });
  it.each(['empty', 'error', 'malformed', 'coordinates'])('does not confirm raw coordinates when BAN returns %s', async (kind) => {
    const fetcher = vi.fn<typeof fetch>(async () => { if (kind === 'error') throw new Error('offline'); return new Response(kind === 'malformed' ? 'bad json' : JSON.stringify(kind === 'coordinates' ? { features: [{ properties: { street: '48.88354, 2.17661', city: 'Paris' } }] } : { features: [] })); });
    expect(await resolveGpsOrigin(point, { fetch: fetcher })).toBeUndefined();
  });
  it('falls back to a station within 2km and respects cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('offline'); });
    expect(await resolveGpsOrigin({ ...station, latitude: station.latitude + .01 }, { fetch: fetcher })).toBe('près de La Défense');
    const controller = new AbortController(); controller.abort();
    await expect(resolveGpsOrigin(point, { signal: controller.signal, fetch: fetcher })).rejects.toBeDefined();
  });
  it('bounds a slow BAN request to three seconds', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { const controller = new AbortController(); setTimeout(() => controller.abort(), 3000); return controller.signal; });
    const result = resolveGpsOrigin(point, { fetch: fetcher }); await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeUndefined(); expect(timeout).toHaveBeenCalledWith(3000); timeout.mockRestore();
  });
});
