import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decisionLabels, optionLabel } from './labels.js';
import { initialState, reduce } from './state.js';

describe('confirmation button labels', () => {
  it.each(['fr', 'en'] as const)('uses literal yes/no for GPS and profile questions but approval labels for bookings in %s', (language) => {
    const expected = language === 'fr' ? { yes: 'Oui', no: 'Non' } : { yes: 'Yes', no: 'No' };
    const gps = reduce(reduce(initialState(), { type: 'stage', stage: 'CLARIFY' }), { type: 'clarify', question: 'Your origin?', yes_no: true });
    const profile = reduce(reduce(initialState(), { type: 'stage', stage: 'CHOOSE' }), { type: 'profile_request', question: 'Your name?', yes_no: true });
    for (const state of [gps, profile]) { expect(state.yesNo).toBe(true); expect(decisionLabels(language, state.stage)).toEqual(expected); }
    const booking = reduce(reduce(initialState(), { type: 'stage', stage: 'CONFIRM' }), { type: 'confirm', summary: 'Approve booking?' });
    expect(booking.yesNo).toBe(true);
    expect(decisionLabels(language, booking.stage)).toEqual(language === 'fr' ? { yes: 'Confirmer', no: 'Annuler' } : { yes: 'Confirm', no: 'Cancel' });
  });
  it('uses the selected visible button labels as their accessible names', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(source).toContain('decisionLabels(language, state.stage)');
    for (const name of ['yes', 'no']) {
      expect(source).toContain(`button(decision.${name},`);
      expect(source).toContain(`${name}.setAttribute('aria-label', decision.${name})`);
    }
  });
});

describe('airport taxi label', () => {
  it.each(['fr', 'en'] as const)('keeps pickup origin when localizing %s cards and accessible labels', (language) => {
    const text = optionLabel({ id: 'paris-airport-shuttle', name: 'Airport taxi — Étoile' }, language);
    expect(text).toContain('Étoile'); expect(text).toContain(language === 'fr' ? 'Taxi vers l’aéroport' : 'Airport taxi');
    expect(text).not.toMatch(/Gare du Nord|Shuttle|Navette/);
    expect(optionLabel({ id: 'custom', name: 'Custom' }, language)).toBe('Custom');
  });
});
