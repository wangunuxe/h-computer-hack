import { describe, expect, it } from 'vitest';
import { fallbackQuestion } from './questions.js';
import { presetOptions } from './options.js';

describe('bilingual fallback questions', () => {
  it.each(['fr', 'en'])('does not offer nonexistent choices in %s', (language) => {
    const text = fallbackQuestion({ stage: 'CHOOSE', language, missing: [], options: [], now: new Date(), attempt: 2 });
    expect(text).toMatch(/modifier|change/); expect(text).not.toContain('1.');
  });
  it.each(['fr', 'en'])('varies every pending question and changes strategy in %s', (language) => {
    for (const stage of ['CLARIFY', 'CHOOSE', 'CONFIRM', 'RESEARCH'] as const) {
      const replies = [0, 1, 2].map((attempt) => fallbackQuestion({ stage, language, attempt, missing: ['origin', 'destination', 'deadline'], options: [...presetOptions], now: new Date('2027-01-15T10:00:00Z') }));
      expect(new Set(replies).size).toBe(3);
      if (stage === 'CHOOSE') expect(replies[2]).toContain('1.');
      if (stage === 'CONFIRM') expect(replies[2]).toMatch(/boutons|buttons/);
      if (stage === 'CLARIFY') expect(replies[2]).toContain('CDG');
    }
  });
});
