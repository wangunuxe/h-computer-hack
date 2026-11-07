import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import type { Profile } from '@voila/shared';
import { understand, UnderstandError, type UnderstandingClient } from './understand.js';

const profile: Profile = { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', language: 'fr', guide_dog: true };
const now = new Date('2026-11-07T12:00:00Z');
const clientWith = (value: unknown) => ({ models: { generateContent: vi.fn<UnderstandingClient['models']['generateContent']>(async () => ({ text: JSON.stringify(value) })) } });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('understand', () => {
  it('keeps every introduced comma-separated phone group out of Gemini without losing passenger counts', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'Mon téléphone est zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit, 2 personnes de Gare du Nord à CDG à 20:45', profile, now }, client);
    const payload = JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents));
    expect(payload.transcript).toBe('Mon téléphone est [phone], 2 personnes de Gare du Nord à CDG à 20:45');
  });
  it('preserves dates, times and passenger counts surrounding a phone in the SDK payload', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: '2027-01-15 2 personnes, à 20:45 06 12 34 56 78, 2 personnes depuis gare du Nord vers CDG', profile, now }, client);
    const payload = JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents));
    expect(payload.transcript).toBe('2027-01-15 2 personnes, à 20:45 [phone], 2 personnes depuis gare du Nord vers CDG');
  });
  it('redacts a time-shaped phone without losing a real time in the Gemini payload', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'à 20:45 depuis gare du Nord vers CDG, mon numéro est 06:12 34 56 78', profile, now }, client);
    const payload = JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents));
    expect(payload.transcript).toBe('à 20:45 depuis gare du Nord vers CDG, mon numéro est [phone]');
  });
  it.each(["c'est pour demain", "c'est pour aller à CDG", "c'est urgent"])('preserves ambiguous French trip speech in the actual Gemini request: %s', async (transcript) => {
    const client = clientWith({ trip: {} }); await understand({ transcript, profile, now }, client);
    expect(JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents)).transcript).toBe(transcript);
  });
  it('preserves date and time facts in the Gemini payload while removing phones', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'Gare du Nord to CDG 2E on 2027-01-15 at 20:45, call me on 06 12 34 56 78', profile, now }, client);
    const payload = JSON.parse(String(client.models.generateContent.mock.calls[0]![0].contents));
    expect(payload.transcript).toContain('2027-01-15 at 20:45'); expect(payload.transcript).not.toContain('06 12 34 56 78');
  });
  it('keeps a mixed spoken/literal email out of Gemini while preserving the route', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'my email is anna at gmail.com, from Gare du Nord to CDG 2E', profile, now }, client);
    const payload = JSON.stringify(client.models.generateContent.mock.calls[0]![0]); expect(payload).not.toMatch(/anna|gmail/); expect(payload).toContain('Gare du Nord to CDG 2E');
  });
  it('redacts spoken and saved contacts in the actual Gemini request without losing the route', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: "I'm Marie, from Gare du Nord to CDG 2E. Call me on zero six twelve thirty four fifty six seventy eight. My email is marie at gmail dot com. Karim +33612345678 karim@example.com", profile, now }, client);
    const payload = JSON.stringify(client.models.generateContent.mock.calls[0]![0]);
    for (const secret of ['Marie', 'marie', profile.name, profile.phone, profile.email, 'zero six twelve']) expect(payload).not.toContain(secret);
    expect(payload).toContain('Gare du Nord'); expect(payload).toContain('CDG 2E');
  });
  it('preserves a relative arrival cutoff across midnight without treating it as flight departure', async () => {
    const client = clientWith({ trip: { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2026-11-08T00:41:46+01:00' } });
    const result = await understand({ transcript: 'Je dois arriver dans deux heures, trois heures au maximum.', profile, now: new Date('2026-11-07T21:41:46Z') }, client);
    expect(result.trip.deadline).toBe('2026-11-08T00:41:46+01:00');
    expect(client.models.generateContent.mock.calls[0]![0].config?.systemInstruction).toContain('adding elapsed time to now');
    expect(result.notes).toBeUndefined();
  });
  it('does not include profile name, phone or email in the Gemini request', async () => {
    const client = clientWith({ trip: {} });
    await understand({ transcript: 'Je veux aller à CDG', profile, now }, client);
    const payload = JSON.stringify(client.models.generateContent.mock.calls[0]![0]);
    for (const value of [profile.name, profile.phone, profile.email]) expect(payload).not.toContain(value);
  });
  it('does not start Gemini when the caller signal is already aborted', async () => {
    const client = clientWith({ trip: {} });
    await expect(understand({ transcript: 'travel', profile, now, signal: AbortSignal.abort() }, client)).rejects.toMatchObject({ code: 'aborted' });
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });
  it('aborts the SDK request and settles even when the fake ignores cancellation', async () => {
    const controller = new AbortController();
    const client = clientWith({ trip: {} });
    client.models.generateContent.mockImplementation(() => new Promise(() => {}));
    const pending = understand({ transcript: 'travel', profile, now, signal: controller.signal }, client);
    const sdkSignal = client.models.generateContent.mock.calls[0]![0].config?.abortSignal;
    expect(sdkSignal?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'UnderstandError', code: 'aborted' });
    expect(sdkSignal?.aborted).toBe(true);
  });
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
    expect(result.trip).toEqual({ passengers: 1, luggage: 0, guide_dog: true });
    expect(result.missing).toEqual(['origin', 'destination', 'deadline']);
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
  it('throws typed timeout after twenty seconds and aborts the SDK request', async () => {
    vi.useFakeTimers();
    const client = clientWith({});
    client.models.generateContent.mockImplementation(() => new Promise(() => {}));
    const pending = understand({ transcript: 'travel', profile, now }, client);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'UnderstandError', code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
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
