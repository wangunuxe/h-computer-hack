import { afterEach, describe, expect, it, vi } from 'vitest';
import { TripSchema, type ServerEvent } from '@voila/shared';
import { understand } from './understand.js';
import { relevantLines, stationForPlace, trafficPage } from './stations.js';
import { optionsForTrip } from './options.js';
import { assessOptions } from './feasibility.js';
import { pickupWindow } from './pickup-window.js';
import { VoilaSession } from './session.js';
import { readRerBTraffic, type TrafficClient } from './adapters/traffic-h.js';

const now = new Date('2027-01-15T10:00:00+01:00');
const profile = { name: 'Camille Test', email: 'camille@example.com', phone: '+33612345678', language: 'fr', guide_dog: false };
const trip = { origin: 'La Défense', destination: 'Bercy', passengers: 1, luggage: 0, guide_dog: false };
const sessions: VoilaSession[] = [];
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); });
describe('any-destination ASAP trips', () => {
  it('asks for the destination, not GPS, when only an explicit origin is known', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const events: ServerEvent[] = [];
    const session = new VoilaSession((event) => events.push(event), { understand: (input) => understand(input, { models: { generateContent: async () => ({ text: '{"trip":{}}' }) } }) }); sessions.push(session);
    session.handle({ type: 'hello', profile: { language: 'fr' }, gps: null, scenario: 'demo' });
    session.handle({ type: 'final_transcript', text: 'Je suis à La Défense' });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'clarify')).toBe(true));
    expect(events.some((event) => event.type === 'location_request')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('position de votre téléphone');
  });
  it.each([null, { latitude: 48.8619, longitude: 2.3470 }])('never requests or confirms GPS for a stated origin omitted by Gemini (GPS %j)', async (gps) => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const events: ServerEvent[] = [];
    let resolve!: (value: { text: string }) => void;
    const generateContent = vi.fn(() => new Promise<{ text: string }>((done) => { resolve = done; }));
    const session = new VoilaSession((event) => events.push(event), { understand: (input) => understand(input, { models: { generateContent } }) }); sessions.push(session);
    session.handle({ type: 'hello', profile: { language: 'fr' }, gps, scenario: 'demo' });
    session.handle({ type: 'final_transcript', text: 'Je suis à La Défense, je veux aller à Bercy' });
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledOnce());
    expect(events.some((event) => event.type === 'location_request')).toBe(false);
    resolve({ text: JSON.stringify({ trip: { destination: 'Bercy' } }) });
    await vi.waitFor(() => expect(session.stage).toBe('CHOOSE'));
    expect(events.some((event) => event.type === 'location_request' || event.type === 'clarify')).toBe(false);
    expect(JSON.stringify(events)).not.toMatch(/position de votre téléphone|Châtelet|Gare du Nord|CDG/);
    expect(events).toContainEqual({ type: 'options', items: [expect.objectContaining({ name: 'Taxi to Bercy — La Défense' })] });
  });
  it.each(['Bercy', 'Gare de Lyon', '12 Rue de la Paix, Paris'])('extracts the stated destination %s without requiring a deadline', async (destination) => {
    const generateContent = vi.fn(async (_request: unknown) => ({ text: JSON.stringify({ trip: { origin: trip.origin, destination } }) }));
    const result = await understand({ transcript: `Je suis à La Défense, je veux aller à ${destination}`, profile, now }, { models: { generateContent } });
    expect(result.trip.destination).toBe(destination); expect(result.trip.deadline).toBeUndefined(); expect(result.missing).toEqual([]);
    const request = generateContent.mock.calls[0]![0] as { contents: string; config: { systemInstruction: string } };
    expect(request.contents).not.toContain('CDG'); expect(request.config.systemInstruction).toContain('Preserve the stated destination as-is');
  });
  it('allows an optional deadline but still rejects an invalid supplied deadline', () => {
    expect(TripSchema.parse(trip)).toEqual(trip); expect(TripSchema.safeParse({ ...trip, deadline: 'tomorrow' }).success).toBe(false);
    const options = optionsForTrip(trip, true);
    expect(options).toHaveLength(1); expect(options[0]!.name).toBe('Taxi to Bercy — La Défense');
    expect(assessOptions(options, trip, now).feasible).toEqual(options);
    expect(pickupWindow(trip, now).latest.getTime()).toBe(now.getTime() + 60 * 60_000);
    expect(assessOptions(options, { ...trip, deadline: now.toISOString() }, now).feasible).toEqual([]);
  });
  it('ranks relevant shared lines first, excludes unrelated RER B, and handles unknown places', () => {
    expect(relevantLines('La Défense', 'Bercy')).toEqual(['RER A', 'M14']);
    expect(relevantLines('Gare du Nord', 'CDG')).toEqual(['RER B']);
    expect(relevantLines('Châtelet', 'Gare de Lyon')).toEqual(['RER A', 'RER D', 'M1']);
    expect(relevantLines('Unknown street', 'Unknown destination')).toEqual([]);
    expect(stationForPlace('Charles de Gaulle–Étoile')?.name).toContain('Étoile');
    expect(trafficPage('RER A')).toBe('https://www.ratp.fr/infos-trafic/rer-transilien/a');
    expect(trafficPage('M14')).toBe('https://www.ratp.fr/infos-trafic/metro/14');
    expect(() => trafficPage('not a line')).toThrow();
  });
  it('plans La Défense to Bercy in demo mode without any airport, deadline question or unrelated traffic', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const events: ServerEvent[] = [];
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ trip: { origin: trip.origin, destination: trip.destination } }) }));
    const runBooking = vi.fn(async () => new Promise<never>(() => {}));
    const trafficH = vi.fn();
    const session = new VoilaSession((event) => events.push(event), { understand: (input) => understand(input, { models: { generateContent } }), trafficH, runBooking, shuttlePublicUrl: () => 'https://shuttle.example' }); sessions.push(session);
    session.handle({ type: 'hello', profile, gps: null, scenario: 'demo' });
    session.handle({ type: 'final_transcript', text: 'Je suis à La Défense, je veux aller à Bercy' });
    await vi.waitFor(() => expect(session.stage).toBe('CHOOSE'));
    const spoken = JSON.stringify(events.filter((event) => event.type === 'say' || event.type === 'options'));
    expect(spoken).toContain('Taxi vers Bercy'); expect(spoken).toContain('Aucune donnée enregistrée');
    expect(spoken).not.toMatch(/Gare du Nord|CDG|RER B|heure limite|check.in/);
    expect(trafficH).not.toHaveBeenCalled();
    session.handle({ type: 'user_reply', text: 'taxi' });
    await vi.waitFor(() => expect(runBooking).toHaveBeenCalledOnce());
    expect(runBooking.mock.calls[0]![0]).toMatchObject({ trip });
  });
  it('reads connected route lines in parallel and reports one failure as unknown without losing the taxi', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const events: ServerEvent[] = [];
    const resolve: (() => void)[] = [];
    const trafficH = vi.fn(async ({ line }: { line?: string }) => { await new Promise<void>((done) => resolve.push(done)); if (line === 'RER A') throw new Error('unavailable'); return { status: 'normal' as const, mode: 'live' as const, summary: `${line} : trafic normal.`, cause: '', source: trafficPage(line!), recorded: false }; });
    const session = new VoilaSession((event) => events.push(event), { understand: async () => ({ trip, missing: [] }), trafficH, linkup: async () => ({ corroboration: [], extraOptions: [] }) }); sessions.push(session);
    session.handle({ type: 'hello', profile, gps: null, scenario: 'live' }); session.handle({ type: 'final_transcript', text: 'La Défense vers Bercy' });
    await vi.waitFor(() => expect(trafficH).toHaveBeenCalledTimes(2)); expect(session.stage).toBe('RESEARCH'); resolve.forEach((done) => done());
    await vi.waitFor(() => expect(session.stage).toBe('CHOOSE'));
    expect(events).toContainEqual({ type: 'say', text: 'RER A : Je n’ai pas pu lire le trafic actuel. Son état est inconnu.' });
    expect(JSON.stringify(events.filter((event) => event.type === 'say' || event.type === 'options'))).not.toMatch(/RER B|Gare du Nord|CDG/);
  });
  it('starts a line-specific H text reader and accepts an explicit unknown answer', async () => {
    const cancel = vi.fn(async () => {});
    const startSession = vi.fn(async () => ({ cancel, waitForCompletion: async () => ({ status: 'completed', answer: { status: 'unknown', summary: 'Trafic illisible.', cause: '', source: trafficPage('M14') } }) }));
    const result = await readRerBTraffic({ line: 'M14' }, { startSession } as unknown as TrafficClient);
    expect(result).toMatchObject({ line: 'M14', status: 'unknown' }); expect(cancel).toHaveBeenCalledOnce();
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ environments: [expect.objectContaining({ startUrl: trafficPage('M14'), mode: { type: 'text' } })] }) }));
  });
});
