import { describe, expect, it } from 'vitest';
import { initialState, optionEvent, reduce, transcriptEvent, type Stage } from './state.js';
describe('event state and routing', () => {
  it('keeps Stop in CLARIFY only while server-reported work is cancellable', () => {
    let state = reduce(initialState(), { type: 'stage', stage: 'CLARIFY' });
    state = reduce(state, { type: 'activity', cancellable: true }); expect(state.cancellable).toBe(true);
    state = reduce(state, { type: 'activity', cancellable: false }); expect(state.cancellable).toBe(false);
  });
  it('selects each taxi unambiguously by its current one-based ordinal rather than its name', () => {
    const taxi = { pickup_wait_minutes: 10, journey_minutes: 45, price: 56, guide_dog_status: 'accepted' as const };
    const options = [{ ...taxi, id: 'gare-du-nord-taxi', name: 'Gare du Nord taxi rank' }, { ...taxi, id: 'g7-phone', name: 'G7 by phone' }];
    expect(optionEvent(options, options[0]!.id)).toEqual({ type: 'user_reply', text: '1' });
    expect(optionEvent(options, options[1]!.id)).toEqual({ type: 'user_reply', text: '2' });
    expect(optionEvent([...options].reverse(), options[0]!.id)).toEqual({ type: 'user_reply', text: '2' });
    expect(optionEvent([], options[0]!.id)).toBeUndefined(); expect(optionEvent(options, 'missing')).toBeUndefined();
  });
  it('reduces stage, options, confirmation, payment, booking, feed and errors', () => {
    let state = reduce(initialState(), { type: 'stage', stage: 'CHOOSE' }); expect(state.stage).toBe('CHOOSE');
    const items = [{ id: 'taxi', name: 'Taxi', pickup_wait_minutes: 5, journey_minutes: 40, price: 65, guide_dog_status: 'unknown' as const }];
    state = reduce(state, { type: 'options', items }); expect(state.options).toEqual(items);
    state = reduce(state, { type: 'options', items: [] }); expect(state.options).toEqual([]);
    state = reduce(state, { type: 'confirm', summary: 'Summary' }); expect(state.summary).toBe('Summary');
    state = reduce(state, { type: 'payment_handoff', url: 'https://example.com/pay', amount: 65, merchant: 'Shuttle' }); expect(state.payment?.amount).toBe(65);
    state = reduce(state, { type: 'booking_card', booking: { ref: 'PAS', pickup_time: '2027-01-01T10:00:00Z', pickup_point: 'Paris', price: 65, operator_phone: '123', payment_url: 'https://example.com/pay', guide_dog_status: 'unknown' } }); expect(state.booking?.ref).toBe('PAS');
    state = reduce(state, { type: 'feed', kind: 'traffic', text: 'Recorded' }); state = reduce(state, { type: 'error', message: 'Offline' }); expect(state.error).toBe('Offline');
    expect(reduce(state, { type: 'say', text: 'Hello' })).toBe(state);
    expect(reduce(state, { type: 'stage', stage: 'LISTEN' })).toEqual({ ...initialState(), feed: state.feed });
  });
  it('bounds the feed', () => { let state = initialState(); for (let i = 0; i < 101; i++) state = reduce(state, { type: 'feed', kind: 'test', text: String(i) }); expect(state.feed).toHaveLength(100); expect(state.feed[0]?.text).toBe('1'); });
  it.each(['LISTEN', 'UNDERSTAND', 'CLARIFY', 'RESEARCH', 'PRESENT', 'CHOOSE', 'EXECUTE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT', 'DONE'] as Stage[])('routes text from %s', (stage) => {
    expect(transcriptEvent(stage, ' Bonjour ')).toEqual({ type: ['LISTEN', 'DONE'].includes(stage) ? 'final_transcript' : 'user_reply', text: 'Bonjour' }); expect(transcriptEvent(stage, '  ')).toBeUndefined();
  });
  it('starts a fresh trip from DONE and clears completed-trip UI on the server LISTEN transition', () => {
    let state = reduce(initialState(), { type: 'options', items: [{ id: 'shuttle', name: 'Shuttle', price: 65, pickup_wait_minutes: 10, journey_minutes: 45, guide_dog_status: 'accepted' }] });
    state = reduce(state, { type: 'confirm', summary: 'Previous booking' });
    state = reduce(state, { type: 'payment_handoff', url: 'https://example.com/pay', amount: 65, merchant: 'Shuttle' });
    state = reduce(state, { type: 'booking_card', booking: { ref: 'OLD', pickup_time: '2027-01-15T20:00:00+01:00', pickup_point: 'Paris', price: 65, operator_phone: '123', payment_url: 'https://example.com/pay', guide_dog_status: 'accepted' } });
    state = reduce(state, { type: 'stage', stage: 'DONE' });
    expect(transcriptEvent(state.stage, ' Un autre trajet ')).toEqual({ type: 'final_transcript', text: 'Un autre trajet' });
    state = reduce(state, { type: 'stage', stage: 'LISTEN' });
    state = reduce(state, { type: 'stage', stage: 'UNDERSTAND' });
    expect(state).toEqual({ ...initialState(), stage: 'UNDERSTAND' });
  });
});
