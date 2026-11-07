import { afterEach, describe, expect, it, vi } from 'vitest';
import { converse, type TurnInput } from './converse.js';
import { presetOptions } from './options.js';

const input: TurnInput = { transcript: 'le moins cher', stage: 'CHOOSE', language: 'fr', trip: {}, missing: [], options: [...presetOptions], history: [], attempt: 0, now: new Date('2027-01-15T12:00:00Z') };
const result = { intent: 'choose', option_id: 'gare-du-nord-taxi', reply: 'Le taxi de la gare est le moins cher parmi les taxis.', confidence: .95 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('Gemini turn interpreter', () => {
  it('does not expose a self-introduced name after an honorific in the SDK request', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(result) });
    const text = 'my name is Dr. Anna Lee, from Gare du Nord to CDG 2E';
    await converse({ ...input, transcript: text, history: [{ role: 'user', text }] }, { models: { generateContent } });
    const payload = JSON.stringify(generateContent.mock.calls[0]![0]); expect(payload).not.toMatch(/Anna|Lee/); expect(payload).toContain('from Gare du Nord to CDG 2E');
  });
  it('redacts spoken contacts from both the transcript and history in the actual SDK payload', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(result) });
    const text = "I'm Marie, from Gare du Nord to CDG 2E. Call me on zero 6 twelve 34 five six seventy eight. My email is marie at gmail dot com.";
    await converse({ ...input, transcript: text, history: [{ role: 'user', text }] }, { models: { generateContent } });
    const context = JSON.parse(generateContent.mock.calls[0]![0].contents);
    for (const value of [context.transcript, context.history[0].text]) { expect(value).not.toMatch(/Marie|marie|zero 6 twelve/); expect(value).toContain('Gare du Nord'); expect(value).toContain('CDG 2E'); }
  });
  it('whitelists Gemini context and excludes profile contacts and free-text booking summaries', async () => {
    const profile = { name: 'Private Person', phone: '+33987654321', email: 'private@example.com' };
    const summary = `Private booking summary: ${profile.name}, ${profile.phone}, ${profile.email}`;
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(result) });
    const context = { ...input, profile, summary, confirmation: { pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR' as const, option_name: 'Shuttle', guide_dog_status: 'accepted' as const, summary, profile } };
    await converse(context, { models: { generateContent } });
    const payload = JSON.stringify(generateContent.mock.calls[0]![0]);
    for (const value of [profile.name, profile.phone, profile.email, summary]) expect(payload).not.toContain(value);
    expect(JSON.parse(generateContent.mock.calls[0]![0].contents).confirmation).toEqual({ pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR', option_name: 'Shuttle', guide_dog_status: 'accepted' });
  });
  it('uses minimal-thinking structured Gemini with Paris time and at most ten history turns', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(result) });
    expect(await converse({ ...input, transcript: 'é'.repeat(3000), history: Array.from({ length: 12 }, (_, i) => ({ role: 'user', text: String(i) })) }, { models: { generateContent } })).toEqual(result);
    const params = generateContent.mock.calls[0]![0];
    expect(params.model).toBe('gemini-3.6-flash'); expect(params.config.thinkingConfig.thinkingLevel).toBe('MINIMAL');
    expect(params.config.responseMimeType).toBe('application/json'); expect(params.config.abortSignal).toBeInstanceOf(AbortSignal);
    const context = JSON.parse(params.contents); expect(context.now).toBe('2027-01-15T13:00:00+01:00'); expect(context.history).toHaveLength(10); expect(context.history[0].text).toBe('2');
  });
  it.each([{ ...result, option_id: 'invented' }, { ...result, confidence: 2 }, { ...result, reply: '' }, { ...result, trip_patch: { passengers: 0 } }])('rejects unsafe or invalid model output %j', async (value) => {
    await expect(converse(input, { models: { generateContent: async () => ({ text: JSON.stringify(value) }) } })).rejects.toThrow();
  });
  it('aborts a model that ignores its signal after twenty seconds', async () => {
    vi.useFakeTimers(); const generateContent = vi.fn(() => new Promise<never>(() => {}));
    const promise = converse(input, { models: { generateContent } }); const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(generateContent.mock.calls[0]![0].config.abortSignal.aborted).toBe(true);
  });
  it('cancels on the caller signal and never starts when already cancelled', async () => {
    const controller = new AbortController(); const generateContent = vi.fn(() => new Promise<never>(() => {}));
    const promise = converse({ ...input, signal: controller.signal }, { models: { generateContent } }); const assertion = expect(promise).rejects.toThrow(); controller.abort(); await assertion;
    await expect(converse({ ...input, signal: controller.signal }, { models: { generateContent } })).rejects.toThrow(); expect(generateContent).toHaveBeenCalledOnce();
  });
});
