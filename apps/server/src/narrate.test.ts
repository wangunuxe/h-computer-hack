import { describe, expect, it } from 'vitest';
import { say } from './narrate.js';
import { presetOptions } from './options.js';

describe('say', () => {
  it.each(['fr', 'en'])('provides every short narration key in %s', (language) => {
    const lines = [
      say('acknowledgement', {}, language), say('clarify-deadline', {}, language),
      say('research-started', {}, language), say('disruption', { cause: 'Incident.', recorded: false }, language),
      say('still-working', {}, language), say('confirm', { summary: 'Taxi, 56 EUR.' }, language),
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
    expect(say('disruption', { cause: 'Signal failure.', recorded: true }, 'en')).toContain('Recorded demo information.');
    expect(say('disruption', { cause: 'Incident.', recorded: true }, 'fr')).toContain('enregistrées');
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
});
