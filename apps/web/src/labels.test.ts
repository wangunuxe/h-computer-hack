import { describe, expect, it } from 'vitest';
import { optionLabel } from './labels.js';

describe('airport taxi label', () => {
  it.each(['fr', 'en'] as const)('keeps pickup origin when localizing %s cards and accessible labels', (language) => {
    const text = optionLabel({ id: 'paris-airport-shuttle', name: 'Airport taxi — Étoile' }, language);
    expect(text).toContain('Étoile'); expect(text).toContain(language === 'fr' ? 'Taxi vers l’aéroport' : 'Airport taxi');
    expect(text).not.toMatch(/Gare du Nord|Shuttle|Navette/);
    expect(optionLabel({ id: 'custom', name: 'Custom' }, language)).toBe('Custom');
  });
});
