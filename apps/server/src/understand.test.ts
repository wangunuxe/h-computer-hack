import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import type { Profile } from '@voila/shared';
import { understand, UnderstandError, type UnderstandingClient } from './understand.js';

const profile: Profile = { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'fr', guide_dog: true };
const now = new Date('2026-11-07T12:00:00Z');
const clientWith = (value: unknown) => ({ models: { generateContent: vi.fn<UnderstandingClient['models']['generateContent']>(async () => ({ text: JSON.stringify(value) })) } });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('understand', () => {
  it('uses Gemini 3.6, minimal thinking, structured JSON and profile defaults', async () => {
    const client = clientWith({ trip: { origin: 'Gare du Nord', destination: 'CDG 2E', luggage: 1 }, departure: '2026-11-07T21:00:00+01:00' });
    const result = await understand({ transcript: 'Mon vol CDG 2E part à 21h, une valise, Gare du Nord', profile, now }, client);
    expect(result).toEqual({ trip: { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2026-11-07T20:00:00+01:00', passengers: 1, guide_dog: true, luggage: 1 }, missing: [], notes: expect.stringContaining('minus 60 minutes') });
    expect(client.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.6-flash', config: expect.objectContaining({ thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }, responseMimeType: 'application/json', responseJsonSchema: expect.any(Object), abortSignal: expect.any(AbortSignal) }) }));
    const sent = JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents));
    expect(sent.now).toBe('2026-11-07T13:00:00+01:00');
    expect(sent).not.toHaveProperty('profile');
  });
  it('merges a clarify reply into previous facts and applies corrections over defaults', async () => {
    const result = await understand({ transcript: 'Mon vol est à 21h, nous sommes deux, pas de chien', profile, now, previous: { origin: 'Gare du Nord', destination: 'CDG', luggage: 0 } }, clientWith({ trip: { passengers: 2, guide_dog: false }, departure: '2026-11-07T21:00:00+01:00' }));
    expect(result.trip).toMatchObject({ origin: 'Gare du Nord', destination: 'CDG', passengers: 2, guide_dog: false, luggage: 0 });
    expect(result.missing).toEqual([]);
  });
  it('leaves unknown destination and deadline missing instead of inventing facts', async () => {
    const result = await understand({ transcript: 'I need the airport, RER B is down', profile, now }, clientWith({ trip: {} }));
    expect(result.trip).toEqual({ passengers: 1, guide_dog: true });
    expect(result.missing).toEqual(['origin', 'destination', 'deadline', 'luggage']);
  });
  it('preserves and canonicalizes previous cutoff when the reply supplies another field', async () => {
    const result = await understand({ transcript: 'one bag', profile, now, previous: { deadline: '2026-11-07T19:00:00Z' } }, clientWith({ trip: { luggage: 1 } }));
    expect(result.trip.deadline).toBe('2026-11-07T20:00:00+01:00');
    expect(result.trip.luggage).toBe(1);
    expect(result.notes).toBeUndefined();
  });
  it('keeps an explicit cutoff instead of subtracting another hour', async () => {
    const result = await understand({ transcript: 'check-in closes at 20h', profile, now }, clientWith({ trip: { deadline: '2026-11-07T19:00:00Z' }, departure: '2026-11-07T21:00:00+01:00' }));
    expect(result.trip.deadline).toBe('2026-11-07T20:00:00+01:00');
    expect(result.notes).toBeUndefined();
  });
  it('computes a cutoff across Paris DST in actual elapsed time', async () => {
    const result = await understand({ transcript: 'departure tomorrow 03:30', profile, now }, clientWith({ trip: {}, departure: '2027-03-28T03:30:00+02:00' }));
    expect(result.trip.deadline).toBe('2027-03-28T01:30:00+01:00');
  });
  it.each(['Je suis à Gare du Nord', 'I am at Gare du Nord', 'chui a gar du nor chien gid valiz'])('passes multilingual/noisy text as data: %s', async (transcript) => {
    const client = clientWith({ trip: { origin: 'Gare du Nord' } });
    expect((await understand({ transcript, profile, now }, client)).trip.origin).toBe('Gare du Nord');
    expect(String(client.models.generateContent.mock.calls[0]![0].contents)).toContain(transcript);
  });
  it.each([{ trip: { passengers: 0 } }, { trip: { deadline: '21h' } }, { trip: { luggage: -1 } }, { trip: { origin: null } }, {}])('rejects invalid model output %j', async (value) => {
    await expect(understand({ transcript: 'travel', profile, now }, clientWith(value))).rejects.toMatchObject({ name: 'UnderstandError', code: 'invalid_output' });
  });
  it('rejects non-JSON and empty answers', async () => {
    for (const text of ['not JSON', undefined]) {
      const client: UnderstandingClient = { models: { generateContent: async () => ({ text }) } };
      await expect(understand({ transcript: 'travel', profile, now }, client)).rejects.toMatchObject({ code: 'invalid_output' });
    }
  });
  it('throws typed timeout after eight seconds and aborts the SDK request', async () => {
    vi.useFakeTimers();
    const client = clientWith({});
    client.models.generateContent.mockImplementation(() => new Promise(() => {}));
    const pending = understand({ transcript: 'travel', profile, now }, client);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'UnderstandError', code: 'timeout' });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(client.models.generateContent.mock.calls[0]![0].config?.abortSignal?.aborted).toBe(true);
  });
  it('supports newer model overrides but rejects older models', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.7-flash');
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'travel', profile, now }, client);
    expect(client.models.generateContent.mock.calls[0]![0].model).toBe('gemini-3.7-flash');
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash');
    await expect(understand({ transcript: 'travel', profile, now }, client)).rejects.toBeInstanceOf(UnderstandError);
  });
  it('reports provider errors without echoing credentials', async () => {
    const client = clientWith({});
    client.models.generateContent.mockRejectedValue(new Error('secret provider detail'));
    await expect(understand({ transcript: 'travel', profile, now }, client)).rejects.toMatchObject({ code: 'provider_error', message: 'Gemini trip understanding request failed.' });
  });
});
