import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ServerEvent, type Trip } from '@voila/shared';
import { VoilaSession, type SessionPorts } from './session.js';
import type { TurnResult } from './converse.js';
import type { BookingInput } from './booking.js';

const trip: Trip = { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T21:00:00+01:00', guide_dog: true, passengers: 1, luggage: 0 };
const profile = { name: 'Karim', phone: '+33612345678', email: 'karim@example.com', guide_dog: true, language: 'fr' };
const result = (value: Partial<TurnResult>): TurnResult => ({ intent: 'unclear', reply: 'Quel trajet choisissez-vous ?', confidence: .95, ...value });
const sessions: VoilaSession[] = [];
async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
function setup(overrides: Partial<SessionPorts> = {}) {
  const events: ServerEvent[] = [];
  const ports = {
    understand: vi.fn<SessionPorts['understand']>().mockResolvedValue({ trip, missing: [] }),
    converse: vi.fn<SessionPorts['converse']>().mockResolvedValue(result({})),
    trafficH: vi.fn<SessionPorts['trafficH']>().mockResolvedValue({ status: 'normal', mode: 'live', summary: 'Normal', cause: '', source: 'https://www.ratp.fr', recorded: false }),
    linkup: vi.fn<SessionPorts['linkup']>().mockResolvedValue({ corroboration: [], extraOptions: [] }),
    runBooking: vi.fn<SessionPorts['runBooking']>().mockImplementation(() => new Promise(() => {})), logger: { error: vi.fn() }, shuttlePublicUrl: () => 'https://shuttle.example', ...overrides,
  };
  const session = new VoilaSession((event) => events.push(event), ports); sessions.push(session);
  const start = async (language = 'fr') => { session.handle({ type: 'hello', profile: { ...profile, language }, gps: null, scenario: 'live' }); session.handle({ type: 'final_transcript', text: 'CDG' }); await flush(); };
  const reply = async (text: string) => { session.handle({ type: 'user_reply', text }); await flush(); };
  return { session, ports, events, start, reply };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00+01:00')); });
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); });
describe('contextual conversation routing', () => {
  it('keeps the raw confirmation on screen but passes only structured fields to the interpreter', async () => {
    const summary = `Private summary: ${profile.name}, ${profile.phone}, ${profile.email}`;
    const s = setup({ runBooking: async (input) => { await input.confirm(summary, { pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR' }); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('quel est le prix ?');
    expect(s.events).toContainEqual({ type: 'confirm', summary });
    const context = s.ports.converse.mock.calls[0]![0];
    expect(context.confirmation).toEqual({ pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR', option_name: 'Paris Airport Shuttle', guide_dog_status: 'unknown' });
    for (const value of [profile.name, profile.phone, profile.email, summary]) expect(JSON.stringify(context)).not.toContain(value);
  });
  it('keeps ordinal selection instant without calling Gemini', async () => {
    const s = setup(); await s.start(); await s.reply('2'); expect(s.session.stage).toBe('DONE'); expect(s.ports.converse).not.toHaveBeenCalled();
  });
  it.each(['le moins cher', 'le plus rapide', 'celui qui accepte le chien'])('routes semantic choice %s through Gemini', async (text) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'choose', option_id: 'gare-du-nord-taxi' })) }); await s.start(); await s.reply(text);
    expect(s.ports.converse).toHaveBeenCalledOnce(); expect(s.session.stage).toBe('DONE'); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each(['le taxi accepte mon chien ?', 'does the shuttle accept my dog?'])('answers option questions without choosing: %s', async (text) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'question', reply: 'Les deux taxis acceptent les chiens guides.' })) }); await s.start(); await s.reply(text);
    expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.runBooking).not.toHaveBeenCalled(); expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Les deux taxis acceptent les chiens guides.' });
  });
  it('merges clarification patches, asks all remaining fields, and resumes planning', async () => {
    const converse = vi.fn<SessionPorts['converse']>().mockResolvedValueOnce(result({ reply: 'D’où partez-vous et à quelle heure devez-vous arriver ?' }))
      .mockResolvedValueOnce(result({ intent: 'provide_info', trip_patch: { origin: trip.origin }, reply: 'À quelle heure devez-vous arriver ?' }))
      .mockResolvedValueOnce(result({ intent: 'provide_info', trip_patch: { deadline: trip.deadline }, reply: 'Merci.' }));
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: { destination: 'CDG' }, missing: ['origin', 'deadline'] }), converse }); await s.start();
    expect(converse.mock.calls[0]![0].missing).toEqual(['origin', 'deadline']); expect(s.session.stage).toBe('CLARIFY');
    await s.reply('Je suis gare du Nord'); expect(s.events.at(-1)).toEqual({ type: 'say', text: 'À quelle heure devez-vous arriver ?' });
    await s.reply('à 21h'); expect(s.session.stage).toBe('CHOOSE'); expect(converse.mock.calls[2]![0].history.some((turn) => turn.text === 'Je suis gare du Nord')).toBe(true);
  });
  it.each([
    ['oui vas-y c’est bon', 'confirm', .99, true], ['euh je sais pas', 'confirm', .99, undefined],
    ['maybe', 'confirm', .5, undefined], ['attends, c’est pour demain', 'correct', .99, false], ['pas maintenant', 'decline', .99, false],
    ['quel est le prix ?', 'question', .99, undefined],
  ] as const)('safely interprets confirmation %s', async (text, intent, confidence, approved) => {
    const decision = vi.fn(); const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent, confidence })), runBooking: async (input) => { decision(await input.confirm('Shuttle', { pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR' })); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply(text);
    if (approved === undefined) { expect(decision).not.toHaveBeenCalled(); expect(s.session.stage).toBe('CONFIRM'); }
    else expect(decision).toHaveBeenCalledWith({ approved, reply: text });
    expect(s.ports.converse).toHaveBeenCalledWith(expect.objectContaining({ confirmation: expect.objectContaining({ pickup_date: '2027-01-15', total_price: 65 }) }));
  });
  it.each(['oui', 'non'])('keeps exact confirmation %s instant', async (text) => {
    const decision = vi.fn(); const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle')); return new Promise(() => {}); } }); await s.start(); await s.reply('shuttle'); await s.reply(text);
    expect(s.ports.converse).not.toHaveBeenCalled(); expect(decision).toHaveBeenCalledWith({ approved: text === 'oui', reply: text });
  });
  it('speaks the model acknowledgement when approving an interpreted confirmation', async () => {
    const decision = vi.fn(); const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'confirm', reply: 'Je transmets votre accord.' })), runBooking: async (input) => { decision(await input.confirm('Shuttle')); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('oui vas-y c’est bon');
    expect(s.events).toContainEqual({ type: 'say', text: 'Je transmets votre accord.' });
    expect(decision).toHaveBeenCalledWith({ approved: true, reply: 'oui vas-y c’est bon' });
  });
  it('re-runs research and feasibility after a route correction', async () => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'correct', trip_patch: { destination: 'Orly' } })) }); await s.start(); await s.reply('plutôt Orly');
    expect(s.ports.trafficH).toHaveBeenCalledTimes(2); expect(s.session.stage).toBe('CHOOSE'); expect(s.events.filter((e) => e.type === 'options').at(-1)).toEqual({ type: 'options', items: [] });
    expect(s.events).toContainEqual({ type: 'say', text: 'Quel trajet choisissez-vous ?' });
  });
  it.each(['RESEARCH', 'EXECUTE', 'HANDOFF', 'AWAIT_PAYMENT'] as const)('answers status in %s without changing flow', async (stage) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'question', reply: 'Votre demande est en cours.' })) }); await s.start(); s.session.stage = stage; await s.reply('où en est-on ?');
    expect(s.session.stage).toBe(stage); expect(s.events.at(-1)).toEqual({ type: 'say', text: 'Votre demande est en cours.' }); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it('honours model stop and cancels a pending booking', async () => {
    let booking!: BookingInput; const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'stop' })), runBooking: async (input) => { booking = input; return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('je voudrais tout arrêter'); expect(s.session.stage).toBe('LISTEN'); expect(booking.signal?.aborted).toBe(true);
  });
  it('times out an unresponsive model without approving or altering the booking flow', async () => {
    const decision = vi.fn(); const s = setup({ converse: vi.fn(() => new Promise(() => {})), runBooking: async (input) => { decision(await input.confirm('Shuttle')); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('euh'); await vi.advanceTimersByTimeAsync(20_500);
    expect(s.session.stage).toBe('CONFIRM'); expect(decision).not.toHaveBeenCalled(); expect(s.events.at(-1)?.type).toBe('say');
  });
  it('ignores a late model confirmation after stop', async () => {
    let resolve!: (value: TurnResult) => void; const decision = vi.fn();
    const s = setup({ converse: () => new Promise((r) => { resolve = r; }), runBooking: async (input) => { decision(await input.confirm('Shuttle')); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('vas-y alors'); s.session.handle({ type: 'stop' }); resolve(result({ intent: 'confirm' })); await flush();
    expect(s.session.stage).toBe('LISTEN'); expect(decision).toHaveBeenCalledExactlyOnceWith({ approved: false, reply: 'Stopped' });
  });
  it('clears previous conversation history when starting another trip', async () => {
    const s = setup(); await s.start(); await s.reply('ancienne question ?'); await s.reply('1');
    s.session.handle({ type: 'final_transcript', text: 'Nouveau trajet' }); await flush(); await s.reply('nouvelle question ?');
    const history = s.ports.converse.mock.calls.at(-1)![0].history;
    expect(history).toHaveLength(6); expect(history.some((turn) => turn.text === 'ancienne question ?')).toBe(false);
    expect(history.some((turn) => turn.text === 'Nouveau trajet')).toBe(true);
  });
  it.each(['fr', 'en'])('never repeats three unclear CHOOSE replies and changes strategy after two failures in %s', async (language) => {
    const converse = vi.fn().mockResolvedValue(result({ reply: language === 'fr' ? 'Quel trajet préférez-vous ?' : 'Which journey do you prefer?' }));
    const s = setup({ converse }); await s.start(language); const replies: string[] = [];
    for (let i = 0; i < 3; i++) { await s.reply('euh'); const event = s.events.at(-1); if (event?.type === 'say') replies.push(event.text); }
    expect(new Set(replies).size).toBe(3); expect(replies[1]).toContain('1.');
    expect(converse.mock.calls.map(([input]) => input.attempt)).toEqual([0, 1, 2]); expect(s.session.stage).toBe('CHOOSE');
  });
  it('asks for all missing facts together, then offers a concrete example after two failed clarifications', async () => {
    const s = setup({ understand: vi.fn().mockResolvedValue({ trip: {}, missing: ['origin', 'destination', 'deadline'] }), converse: vi.fn().mockRejectedValue(new Error('offline')) });
    await s.start(); await s.reply('euh'); await s.reply('euh');
    const questions = s.events.filter((event) => event.type === 'clarify').map((event) => event.question);
    expect(new Set(questions).size).toBe(3);
    for (const question of questions) expect(question).toMatch(/départ.*destination.*heure/);
    expect(questions[2]).toContain('CDG'); expect(s.session.stage).toBe('CLARIFY');
  });
  it('points to confirmation buttons after two failures without ever approving', async () => {
    const decision = vi.fn(); const s = setup({ runBooking: async (input) => { decision(await input.confirm('Shuttle')); return new Promise(() => {}); } });
    await s.start(); await s.reply('shuttle'); await s.reply('euh'); await s.reply('euh');
    expect(s.events.at(-1)).toEqual({ type: 'say', text: expect.stringContaining('boutons') }); expect(decision).not.toHaveBeenCalled();
  });
  it('varies deterministic fallback replies after repeated model timeouts', async () => {
    const s = setup({ converse: vi.fn(() => new Promise(() => {})) }); await s.start(); const replies: string[] = [];
    for (let i = 0; i < 3; i++) { await s.reply('euh'); await vi.advanceTimersByTimeAsync(20_500); const event = s.events.at(-1); if (event?.type === 'say') replies.push(event.text); }
    expect(new Set(replies).size).toBe(3); expect(s.session.stage).toBe('CHOOSE');
  });
  it('does not select a journey on bare hesitation even if a model overstates confidence', async () => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'choose', option_id: 'gare-du-nord-taxi', confidence: 1 })) }); await s.start(); await s.reply('euh');
    expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each(['arrêter la navette', 'annuler le shuttle'])('does not mistake cancellation for fast selection: %s', async (text) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'stop' })) }); await s.start(); await s.reply(text);
    expect(s.ports.converse).toHaveBeenCalledOnce(); expect(s.session.stage).toBe('LISTEN'); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each(['est-ce que la navette prend mon chien', 'is the shuttle dog friendly'])('interprets unpunctuated option questions before any booking: %s', async (text) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent: 'question' })) }); await s.start(); await s.reply(text);
    expect(s.ports.converse).toHaveBeenCalledOnce(); expect(s.session.stage).toBe('CHOOSE'); expect(s.ports.runBooking).not.toHaveBeenCalled();
  });
  it.each(['question', 'stop', 'confirm'] as const)('treats bare hesitation as unclear even when the model returns %s', async (intent) => {
    const s = setup({ converse: vi.fn().mockResolvedValue(result({ intent, confidence: 1 })) }); await s.start(); await s.reply('euh je sais pas'); await s.reply('euh je sais pas');
    expect(s.session.stage).toBe('CHOOSE'); expect(s.events.at(-1)).toEqual({ type: 'say', text: expect.stringContaining('1.') });
  });
});
