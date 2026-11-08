import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebEventSchema, type Gps, type ServerEvent } from '@voila/shared';
import { originFromGps, redactGpsCoordinates } from './location.js';
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
  const session = new VoilaSession((event) => events.push(event), { ...ports, shuttlePublicUrl: () => 'https://shuttle.example', ...overrides }); sessions.push(session);
  session.handle({ type: 'hello', profile, gps, scenario: 'live' }); session.handle({ type: 'final_transcript', text: 'Je veux aller à Bercy' });
  const reply = async (text: string) => { session.handle({ type: 'user_reply', text }); await flush(); };
  const result = async (gps: Gps | null) => { const request = events.find((event) => event.type === 'location_request'); if (request?.type !== 'location_request') throw new Error('No location request'); session.handle({ type: 'location_result', request_id: request.request_id, gps }); await flush(); return request.request_id; };
  return { session, events, ports, reply, result };
}
describe('consented phone origins', () => {
  it('resolves the nearest station within 800m, but not distant or inaccurate positions', () => {
    expect(originFromGps(station)).toBe('La Défense');
    expect(originFromGps({ ...station, latitude: station.latitude + .004 })).toBe('La Défense');
    expect(originFromGps({ ...station, latitude: station.latitude + .01 })).toMatch(/^Position GPS/);
    expect(originFromGps({ ...station, accuracy: 1000 })).toMatch(/^Position GPS/);
    expect(originFromGps(far)).toBe('Position GPS (48.91000, 2.20000)');
  });
  it('explains the request first and waits for explicit yes before using the suggested station', async () => {
    const s = setup(); await flush();
    const requestIndex = s.events.findIndex((event) => event.type === 'location_request');
    expect(s.events[requestIndex - 1]).toEqual({ type: 'say', text: 'Pour trouver votre point de départ, j’utilise la position de votre téléphone.' });
    await s.result(station); expect(s.session.stage).toBe('CLARIFY'); expect(s.ports.linkup).not.toHaveBeenCalled();
    expect(s.events).toContainEqual({ type: 'clarify', question: 'Je vous situe à La Défense. Est-ce votre point de départ ? Dites oui ou non.' });
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
    expect(s.session.stage).toBe('CLARIFY'); expect(s.events.filter((event) => event.type === 'clarify').at(-1)).toMatchObject({ question: expect.stringContaining('départ') });
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
    await s.reply('taxi'); expect(s.ports.runBooking).toHaveBeenCalledOnce(); expect(s.ports.runBooking.mock.calls[0]![0]).toMatchObject({ trip: { origin: 'Position GPS (48.91000, 2.20000)', destination: 'Bercy' } });
  });
  it('removes coordinates from the actual Gemini and Linkup payloads, including bare decimal pairs', async () => {
    const origin = originFromGps(far), generateContent = vi.fn(async () => ({ text: JSON.stringify({ trip: {}, intent: 'question', confidence: .9, reply: 'Quel est votre départ ?' }) }));
    await understand({ transcript: `Je pars de ${origin}`, previous: { origin }, profile, now: new Date() }, { models: { generateContent } });
    await converse({ transcript: origin, trip: { origin }, history: [{ role: 'assistant', text: origin }], options: [], missing: [], stage: 'CLARIFY', language: 'fr', attempt: 0, now: new Date() }, { models: { generateContent } });
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response);
    await searchDisruptionAndAlternatives({ query: origin, context: '48.91, 2.20', apiKey: 'test', fetch: fetcher });
    expect(JSON.stringify(generateContent.mock.calls)).not.toMatch(/48\.91|2\.20/); expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/48\.91|2\.20/);
    expect(redactGpsCoordinates('Position GPS (48.91000, 2.20000)')).toBe('Position GPS');
  });
});
