import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = await readFile(new URL('../public/booking.js', import.meta.url), 'utf8');
const context = { jQuery: () => {} };
runInNewContext(script, context);
const suggest = runInNewContext('addressSuggestions', context) as (query: string, pickup: boolean) => [string, number, number][];

describe('simulated address suggestions', () => {
  it.each(['Étoile', 'Etoile', 'Charles de Gaulle–Étoile', 'Châtelet', 'Chatelet', 'Gare du Nord'])('keeps a matching pickup for %s', (query) => {
    const suggestions = suggest(query, true);
    expect(suggestions).toHaveLength(1); expect(suggestions[0]![1]).toBeGreaterThan(48);
    if (!query.includes('Nord')) expect(suggestions[0]![0]).not.toContain('Gare du Nord');
  });
  it('keeps an unlisted pickup exactly, with approximate simulation coordinates', () => {
    expect(suggest('12 Rue de la Paix, Paris', true)).toEqual([['12 Rue de la Paix, Paris', 48.8566, 2.3522]]);
    expect(suggest('12 Rue de la Paix, Paris', false)).toEqual([['12 Rue de la Paix, Paris', 48.8566, 2.3522]]);
    expect(suggest('', true)).toEqual([]); expect(suggest(' ', true)).toEqual([]); expect(suggest('ab', true)).toEqual([]);
  });
  it.each(['La Défense', 'Bercy', 'Gare de Lyon'])('offers %s as either pickup or dropoff', (address) => {
    expect(suggest(address, false)).toEqual(suggest(address, true)); expect(suggest(address, false)).toHaveLength(1);
  });
});
