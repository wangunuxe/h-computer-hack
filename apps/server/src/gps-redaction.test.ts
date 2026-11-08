import { describe, expect, it, vi } from 'vitest';
import { redactGpsCoordinates } from './location.js';
import { understand } from './understand.js';
import { converse } from './converse.js';
import { searchDisruptionAndAlternatives } from './adapters/linkup.js';

describe('coordinate-format privacy', () => {
  it.each(['48.8566 2.3522', '48,8566 2,3522', '48 point 8566 2 virgule 3522', '-48.8566; +2.3522', '48.8566°N, 2.3522°E', 'latitude: 48.8566 longitude: 2.3522'])('redacts %s', (text) => {
    expect(redactGpsCoordinates(text)).not.toMatch(/8566|3522/);
  });
  it.each(['20:45 21:30', '20h45', '20.45 21.30', '15.01.2027', '2027-01-15', '65.00 EUR', 'prices: 48.85 2.35', '48.85, 2.35 EUR', '06 12 34 56 78', '+44 7700 900123', '06.12.34.56.78', '98.8566 202.3522', ''])('preserves ordinary travel numbers: %s', (text) => {
    expect(redactGpsCoordinates(text)).toBe(text);
  });
  it('sanitizes whitespace/spoken pairs at both actual provider boundaries', async () => {
    const text = '48.8566 2.3522 et 48 point 8566 2 virgule 3522';
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({ trip: {}, intent: 'question', confidence: 1, reply: 'Votre départ ?' }) }));
    await understand({ transcript: text, profile: { language: 'fr' }, now: new Date() }, { models: { generateContent } });
    await converse({ transcript: text, trip: {}, history: [], options: [], missing: ['origin'], stage: 'CLARIFY', language: 'fr', attempt: 0, now: new Date() }, { models: { generateContent } });
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) }) as Response);
    await searchDisruptionAndAlternatives({ query: text, apiKey: 'test', fetch: fetcher });
    expect(JSON.stringify(generateContent.mock.calls)).not.toMatch(/8566|3522/); expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/8566|3522/);
  });
});
