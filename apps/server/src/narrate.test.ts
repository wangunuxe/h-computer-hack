import { describe, expect, it } from 'vitest';
import { say } from './narrate.js';
import { optionsForTrip, presetOptions } from './options.js';
import type { ConfirmationFields } from './confirmation.js';

const confirmation = { trip: { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T22:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true }, option: presetOptions[0]!, now: new Date('2027-01-15T10:00:00Z') };
const details: ConfirmationFields = { pickup_date: '2027-01-15', pickup_time: '20:00', total_price: 65, currency: 'EUR' };

describe('say', () => {
  it.each(['fr', 'en'])('keeps Étoile in taxi options and confirmation without narrating a station pickup in %s', (language) => {
    const trip = { ...confirmation.trip, origin: 'Étoile' };
    const options = optionsForTrip(trip, true);
    for (const text of [say('present-options', { options, now: confirmation.now }, language), say('confirm', { ...confirmation, trip, option: options[0]! }, language), say('disruption', { mode: 'demo', status: 'disrupted', cause: 'Gare du Nord to CDG interrupted', origin: trip.origin, recorded: true }, language)]) {
      expect(text).toContain('Étoile'); expect(text).not.toContain('Gare du Nord');
    }
  });
  it.each(['fr', 'en'])('clearly announces normal and unknown live status in %s', (language) => {
    const normal = say('disruption', { mode: 'live', status: 'normal', cause: '', recorded: false }, language);
    expect(normal).toContain('H'); expect(normal).toContain(language === 'fr' ? 'circule normalement' : 'running normally');
    const unknown = say('disruption', { mode: 'live', status: 'unknown', cause: '', recorded: false }, language);
    expect(unknown).toContain(language === 'fr' ? 'Statut inconnu' : 'status is unknown');
    expect(unknown).not.toContain('Recorded');
  });
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
      say('still-working', {}, language), say('confirm', { ...confirmation, details }, language),
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
    const options = [...presetOptions, { ...presetOptions[0]!, id: 'third', name: 'Third option' }, { ...presetOptions[0]!, id: 'fourth', name: 'Fourth option' }];
    const text = say('present-options', { options, now: new Date('2027-01-15T10:00:00Z') }, 'en');
    expect(text).toContain('1. Airport taxi, estimated arrival 11:55, €65.00.');
    expect(text).toContain('3. Third option');
    expect(text).not.toContain('Fourth option');
  });
  it('handles no options and no failure reason without empty or undefined speech', () => {
    expect(say('present-options', { options: [], now: new Date() }, 'fr')).toContain('Aucune option');
    expect(say('booking-failed', {}, 'en')).toBe('Booking failed.');
  });
  it('summarizes structured pickup facts in French', () => {
    expect(say('confirm', { ...confirmation, details }, 'fr')).toBe('Taxi vers l’aéroport, vers CDG, aujourd’hui à 20 h, 65 €, avec votre chien guide. Je confirme ?');
  });
  it('supports tomorrow and uses the Paris date across midnight and DST', () => {
    expect(say('confirm', { ...confirmation, details: { ...details, pickup_date: '2027-01-16', pickup_time: '20:30', total_price: 65.5 } }, 'en')).toContain('tomorrow at 20:30, €65.5');
    const text = say('confirm', { ...confirmation, now: new Date('2027-03-27T23:00:00Z'), details: { ...details, pickup_date: '2027-03-28', pickup_time: '03:30' } }, 'fr');
    expect(text).toContain('aujourd’hui à 3 h 30');
  });
  it('omits missing or invalid fields instead of using the deadline or catalogue price', () => {
    for (const value of [undefined, {}, { pickup_date: '2027-02-30', pickup_time: '29:99', total_price: -1, currency: 'USD' }]) {
      const text = say('confirm', { ...confirmation, trip: { ...confirmation.trip, guide_dog: false }, details: value as ConfirmationFields }, 'en');
      expect(text).toBe('Airport taxi, to CDG. Shall I confirm?');
    }
  });
  it('says a later pickup date explicitly', () => {
    expect(say('confirm', { ...confirmation, details: { ...details, pickup_date: '2027-01-18' } }, 'fr')).toContain('le 18 janvier 2027 à 20 h');
  });
  it.each([undefined, 'USD'])('does not assume EUR if currency is %s', (currency) => {
    expect(say('confirm', { ...confirmation, details: { total_price: 65, currency } as ConfirmationFields }, 'en')).not.toContain('€');
  });
  it('preserves valid fields when other fields are invalid and accepts a zero price', () => {
    expect(say('confirm', { ...confirmation, details: { ...details, pickup_time: '24:00', total_price: 0 } }, 'fr')).toContain('aujourd’hui, 0 €');
    expect(say('confirm', { ...confirmation, details: { pickup_time: '20:30' } }, 'fr')).toContain('à 20 h 30');
  });
  it.each([
    ['paris-airport-shuttle', 'Taxi vers l’aéroport'], ['rer-b-replacement-bus', 'Bus de remplacement du RER B'],
  ])('uses a French spoken name for %s without changing the option data', (id, name) => {
    const option = presetOptions.find((o) => o.id === id)!;
    expect(say('present-options', { options: [option], now: confirmation.now }, 'fr')).toContain(`1. ${name},`);
    expect(say('no-feasible-options', { rejected: [{ ...option, reason: 'too_late' }] }, 'fr')).toContain(`${name}: arrivée trop tardive`);
    expect(say('present-options', { options: [option], now: confirmation.now }, 'en')).toContain(option.name);
  });
  it('falls back to the supplied name for an unknown option id', () => {
    const option = { ...presetOptions[0]!, id: 'custom', name: 'Transfert solidaire' };
    expect(say('present-options', { options: [option], now: confirmation.now }, 'fr')).toContain(option.name);
    expect(say('confirm', { ...confirmation, option }, 'fr').startsWith(option.name)).toBe(true);
  });
});
