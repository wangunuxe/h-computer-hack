import { describe, expect, it } from 'vitest';
import { say } from './narrate.js';
import { presetOptions } from './options.js';

const confirmation = { trip: { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T22:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true }, option: presetOptions[2]!, now: new Date('2027-01-15T10:00:00Z') };

describe('say', () => {
  it.each(['route', 'vehicle', 'info', 'payment'] as const)('localizes the %s milestone without raw tool text', (page) => {
    const fr = say('booking-page', { page }, 'fr');
    const en = say('booking-page', { page }, 'en');
    expect(fr).not.toBe(en);
    expect(fr.length).toBeLessThan(60); expect(en.length).toBeLessThan(60);
    expect(fr + en).not.toMatch(/Step|click_web|undefined/);
  });
  it.each(['fr', 'en'])('provides every short narration key in %s', (language) => {
    const lines = [
      say('acknowledgement', {}, language), say('clarify-deadline', {}, language),
      say('research-started', {}, language), say('disruption', { cause: 'Incident.', recorded: false }, language),
      say('still-working', {}, language), say('confirm', { ...confirmation, summary: 'Taxi, 56 EUR.' }, language),
      say('payment-handoff', { merchant: 'Shuttle', amount: 65 }, language),
      say('booking-done', { ref: 'PAS-123' }, language), say('stopped', {}, language),
      say('booking-failed', { reason: 'Timeout.' }, language),
    ];
    for (const line of lines) { expect(line.length).toBeGreaterThan(0); expect(line.length).toBeLessThan(150); expect(line).not.toContain('undefined'); }
  });
  it('falls back to English and supports French locale tags', () => {
    expect(say('stopped', {}, 'de')).toBe(say('stopped', {}, 'en'));
    expect(say('stopped', {}, 'fr-FR')).toBe(say('stopped', {}, 'fr'));
  });
  it('explicitly labels recorded disruptions in both languages', () => {
    expect(say('disruption', { cause: 'Signal failure.', recorded: true }, 'en')).toBe('Recorded data, not live: Signal failure.');
    expect(say('disruption', { cause: 'Incident.', recorded: true }, 'fr')).toBe('Données enregistrées, pas en direct : Incident.');
    expect(say('disruption', { cause: 'Live incident.', recorded: false }, 'en')).toBe('Live incident.');
  });
  it('reads at most three numbered options with Paris arrival and EUR prices', () => {
    const text = say('present-options', { options: presetOptions, now: new Date('2027-01-15T10:00:00Z') }, 'en');
    expect(text).toContain('1. Gare du Nord taxi rank, estimated arrival 11:55, €56.00.');
    expect(text).toContain('3. Paris Airport Shuttle');
    expect(text).not.toContain('replacement bus');
  });
  it('handles no options and no failure reason without empty or undefined speech', () => {
    expect(say('present-options', { options: [], now: new Date() }, 'fr')).toContain('Aucune option');
    expect(say('booking-failed', {}, 'en')).toBe('Booking failed.');
  });
  it('summarizes the booking in French without reading English markdown or contact details', () => {
    const summary = '**Booking summary:**\n- Date: Saturday 2027-01-15, Time: 20:00 (Paris)\n- Vehicle: Sedan, 63 EUR\n- Total: 65 EUR\n- Contact: karim@example.com\n- Notes: PAY NOW';
    expect(say('confirm', { ...confirmation, summary }, 'fr')).toBe('Navette Paris Airport Shuttle, vers CDG, aujourd’hui à 20 h, 65 €, avec votre chien guide. Je confirme ?');
  });
  it('supports English, tomorrow and an ISO pickup instant across Paris DST', () => {
    expect(say('confirm', { ...confirmation, summary: 'Pickup time: 20h30, Date: 2027-01-16. Total: EUR 65.50' }, 'en')).toContain('tomorrow at 20:30, €65.5');
    const text = say('confirm', { ...confirmation, now: new Date('2027-03-27T23:00:00Z'), summary: 'Pickup: 2027-03-28T01:30:00Z, total 65 €' }, 'fr');
    expect(text).toContain('aujourd’hui à 3 h 30');
  });
  it('omits missing or invalid time/price instead of using deadline, catalogue price or raw text', () => {
    for (const summary of ['', 'Time: 29:99, total: many EUR', 'Flight departs at 23:00, 60 EUR or 90 EUR']) {
      const text = say('confirm', { ...confirmation, trip: { ...confirmation.trip, guide_dog: false }, summary }, 'en');
      expect(text).toBe('Paris Airport Shuttle, to CDG. Shall I confirm?');
    }
  });
  it.each([
    ['gare-du-nord-taxi', 'Taxi de la gare du Nord'], ['g7-phone', 'Taxi G7 par téléphone'],
    ['paris-airport-shuttle', 'Navette Paris Airport Shuttle'], ['rer-b-replacement-bus', 'Bus de remplacement du RER B'],
  ])('uses a French spoken name for %s without changing the option data', (id, name) => {
    const option = presetOptions.find((o) => o.id === id)!;
    expect(say('present-options', { options: [option], now: confirmation.now }, 'fr')).toContain(`1. ${name},`);
    expect(say('no-feasible-options', { rejected: [{ ...option, reason: 'too_late' }] }, 'fr')).toContain(`${name}: arrivée trop tardive`);
    expect(say('present-options', { options: [option], now: confirmation.now }, 'en')).toContain(option.name);
  });
  it('falls back to the supplied name for an unknown option id', () => {
    const option = { ...presetOptions[0]!, id: 'custom', name: 'Transfert solidaire' };
    expect(say('present-options', { options: [option], now: confirmation.now }, 'fr')).toContain(option.name);
    expect(say('confirm', { ...confirmation, option, summary: '' }, 'fr').startsWith(option.name)).toBe(true);
  });
});
