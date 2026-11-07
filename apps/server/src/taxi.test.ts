import { describe, expect, it } from 'vitest';
import { mentionsTaxiRequest, requestsTaxi, refusesTaxi, taxiTurn } from './taxi.js';
import type { TurnInput, TurnResult } from './converse.js';
import { presetOptions } from './options.js';

const input: TurnInput = { transcript: 'can you call me a taxi?', stage: 'CHOOSE', language: 'en', trip: { origin: 'Étoile', destination: 'CDG', deadline: '2027-01-15T21:00:00+01:00' }, missing: [], options: [...presetOptions], now: new Date('2027-01-15T10:00:00+01:00'), attempt: 0, history: [] };
const refusal: TurnResult = { intent: 'question', reply: "I can't book a taxi. Please call one yourself.", confidence: .99 };
describe('airport taxi capability policy', () => {
  it.each(['pouvez-vous m’appeler un taxi ?', 'can you call me a taxi?', 'could you please book me a taxi?', 'je veux un taxi', 'un taxi', 'la navette'])('recognizes the booking request %s', (text) => { expect(requestsTaxi(text)).toBe(true); });
  it.each(['can I take the taxi with my dog?', 'le taxi accepte mon chien ?', 'ne réservez pas de taxi', 'do not call me a taxi', 'can you call me a taxi from Châtelet instead?', ''])('does not select an old route or infer authorization from %s', (text) => { expect(requestsTaxi(text)).toBe(false); });
  it.each(["I can't book a taxi", 'Je ne peux pas appeler un taxi', 'Je ne suis pas en mesure de réserver un taxi', 'Taxis cannot be booked here', 'Ask station staff to call a taxi'])('blocks capability refusals and deflections: %s', (text) => { expect(refusesTaxi(text)).toBe(true); });
  it('does not turn a provider refusal into authorization without a user request', () => {
    const result = taxiTurn({ ...input, transcript: 'How can you help me?' }, refusal);
    expect(result.intent).toBe('question'); expect(result.option_id).toBeUndefined(); expect(result.reply).toContain('I can book'); expect(refusesTaxi(result.reply)).toBe(false);
  });
  it('preserves genuine questions about taxi accessibility rather than replacing their answers', () => {
    const result: TurnResult = { intent: 'question', reply: 'Guide-dog acceptance is still unknown.', confidence: .99 };
    expect(taxiTurn({ ...input, transcript: 'je veux savoir si la navette accepte mon chien' }, result)).toEqual(result);
  });
  it('clarifies compound taxi requests without selecting an old pickup when extraction fails', () => {
    const transcript = 'can you call me a taxi from Châtelet instead?';
    expect(mentionsTaxiRequest(transcript)).toBe(true); expect(requestsTaxi(transcript)).toBe(false);
    const output = taxiTurn({ ...input, transcript }, { intent: 'unclear', reply: 'Which option?', confidence: 0 });
    expect(output.intent).toBe('question'); expect(output.option_id).toBeUndefined(); expect(output.reply).toContain('where should the taxi pick you up');
    expect(mentionsTaxiRequest('do not call me a taxi')).toBe(false);
  });
  it.each(['origin', 'destination'] as const)('asks for missing %s without inventing facts or selecting', (field) => {
    const trip = { ...input.trip }; delete trip[field];
    const result = taxiTurn({ ...input, stage: 'CLARIFY', trip }, refusal);
    expect(result.intent).toBe('question'); expect(result.trip_patch).toBeUndefined(); expect(result.option_id).toBeUndefined(); expect(result.reply).toContain('I can book'); expect(result.reply).toContain('?');
  });
  it('keeps corrections and missing-field questions rather than choosing the old pickup', () => {
    const result = taxiTurn({ ...input, trip: { destination: 'CDG' } }, { ...refusal, intent: 'provide_info', trip_patch: { origin: 'Châtelet' } });
    expect(result.intent).toBe('provide_info'); expect(result.trip_patch).toEqual({ origin: 'Châtelet' }); expect(result.option_id).toBeUndefined(); expect(result.reply).toContain('check the options');
  });
  it('clarifies an unknown route instead of inventing an option', () => {
    const result = taxiTurn({ ...input, trip: { ...input.trip, destination: 'Beauvais' }, options: [] }, refusal);
    expect(result.intent).toBe('question'); expect(result.reply).toContain('constraints'); expect(result.option_id).toBeUndefined(); expect(refusesTaxi(result.reply)).toBe(false);
  });
  it('keeps feasibility constraints when no offered taxi can meet them', () => {
    const result = taxiTurn({ ...input, options: [] }, refusal);
    expect(result.intent).toBe('question'); expect(result.reply).toContain('constraints'); expect(result.option_id).toBeUndefined();
  });
  it.each(['UNDERSTAND', 'RESEARCH', 'EXECUTE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT'] as const)('does not start duplicate bookings or approve/pay in %s', (stage) => {
    const result = taxiTurn({ ...input, stage }, refusal);
    expect(result.intent).toBe('question'); expect(result.option_id).toBeUndefined(); expect(refusesTaxi(result.reply)).toBe(false);
  });
});
