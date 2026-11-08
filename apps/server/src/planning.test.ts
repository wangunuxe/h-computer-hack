import { describe, expect, it } from 'vitest';
import { OptionSchema, type Option, type Trip } from '@voila/shared';
import { assessOptions } from './feasibility.js';
import { bookingMethods, matchesPresetRoute, mergeOptions, optionsForTrip, presetOptions } from './options.js';
import { chooseOption } from './choose.js';
import { say } from './narrate.js';

const trip: Trip = { origin: 'Gare du Nord', destination: 'CDG', deadline: '2027-01-15T12:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true };
const now = new Date('2027-01-15T10:00:00+01:00');
const option = (id: string, minutes: number, status: Option['guide_dog_status'] = 'unknown'): Option => ({ id, name: id, pickup_wait_minutes: 10, journey_minutes: minutes - 10, price: 65, guide_dog_status: status });

describe('assessOptions', () => {
  it('allows arrival plus buffer exactly at check-in cutoff and rejects one minute later', () => {
    const boundary = option('boundary', 105);
    const late = option('late', 106);
    const result = assessOptions([boundary, late], trip, now);
    expect(result.feasible).toEqual([boundary]);
    expect(result.rejected).toEqual([{ option: late, reason: 'too_late', detail: expect.stringContaining('check-in cutoff') }]);
    expect(assessOptions([late], trip, now, { bufferMinutes: 0 }).feasible).toEqual([late]);
  });
  it('rejects guide-dog refusal, retains unknown, skips the rule without a guide dog', () => {
    const refused = option('refused', 30, 'refused');
    const unknown = option('unknown', 40);
    expect(assessOptions([refused, unknown], trip, now)).toEqual({ feasible: [unknown], rejected: [{ option: refused, reason: 'guide_dog_refused', detail: expect.any(String) }] });
    expect(assessOptions([refused], { ...trip, guide_dog: false }, now).feasible).toEqual([refused]);
  });
  it('sorts acceptance first then arrival without mutating input', () => {
    const options = [option('unknown-fast', 20), option('accepted-slow', 80, 'accepted'), option('accepted-fast', 40, 'accepted'), option('unknown-slow', 30)];
    expect(assessOptions(options, trip, now).feasible.map((o) => o.id)).toEqual(['accepted-fast', 'accepted-slow', 'unknown-fast', 'unknown-slow']);
    expect(options[0]!.id).toBe('unknown-fast');
  });
  it.each([
    ['2027-03-28T01:30:00+01:00', '2027-03-28T03:30:00+02:00'],
    ['2027-10-31T02:30:00+02:00', '2027-10-31T02:30:00+01:00'],
  ])('uses actual instants across Paris DST: %s to %s', (start, deadline) => {
    expect(assessOptions([option('at-cutoff', 45), option('late', 46)], { ...trip, deadline }, new Date(start)).feasible.map((o) => o.id)).toEqual(['at-cutoff']);
  });
  it('handles an empty catalogue and rejects invalid timing arguments', () => {
    expect(assessOptions([], trip, now)).toEqual({ feasible: [], rejected: [] });
    expect(() => assessOptions([], trip, now, { bufferMinutes: -1 })).toThrow();
    expect(() => assessOptions([], trip, new Date('invalid'))).toThrow();
  });
});

describe('preset options and merge', () => {
  it.each(['Étoile', 'Charles de Gaulle–Étoile', 'Châtelet', '12 Rue de la Paix, Paris', 'Gare de Lyon'])('offers a bookable taxi from %s, never a manual taxi', (origin) => {
    const options = optionsForTrip({ origin, destination: 'CDG 2E' }, true);
    expect(options[0]!.name).toContain(origin); expect(options[0]!.id).toBe('paris-airport-shuttle');
    expect(options.every((option) => option.id === 'rer-b-replacement-bus' || bookingMethods[option.id]?.kind === 'h_agent')).toBe(true);
    expect(JSON.stringify(options)).not.toContain('Gare du Nord');
  });
  it('uses distance estimates and limits replacement buses to disrupted RER B origins', () => {
    const route = (origin: string, disrupted = true) => optionsForTrip({ origin, destination: 'CDG' }, disrupted);
    expect(route('Étoile')[0]!.journey_minutes).toBeGreaterThan(30); expect(route('Châtelet')[0]!.price).toBe(56);
    expect(route('Montparnasse')[0]!.price).toBe(65); expect(route('12 Rue de la Paix')[0]!.journey_minutes).toBeGreaterThan(30);
    expect(route('Étoile')).toHaveLength(1); expect(route('Gare du Nord')).toHaveLength(2); expect(route('Châtelet')).toHaveLength(2);
    expect(route('Gare du Nord', false)).toHaveLength(1); expect(route('Châtelet', false)).toHaveLength(1);
    expect(optionsForTrip({ origin: '', destination: 'CDG' }, true)).toEqual([]);
    expect(optionsForTrip({ origin: 'Étoile', destination: 'Orly' }, true)).toHaveLength(1);
    expect(presetOptions[0]!.name).toBe('Airport taxi');
  });
  it.each(['CDG 2E', 'ROISSY', 'Aéroport Charles-de-Gaulle'])('recognizes the supported airport route to %s', (destination) => {
    expect(matchesPresetRoute({ origin: 'GARE DU NÖRD, Paris', destination })).toBe(true);
  });
  it.each([
    { origin: '', destination: 'CDG' }, { origin: 'Gare du Nord', destination: '' },
  ])('requires both route endpoints: %j', (route) => { expect(matchesPresetRoute(route)).toBe(false); });
  it('has only a bookable airport taxi and a manual replacement bus', () => {
    expect(presetOptions).toHaveLength(2);
    for (const o of presetOptions) {
      expect(OptionSchema.parse(o)).toEqual(o);
      expect(o.source).toMatch(/^https:/);
      expect(bookingMethods[o.id]).toBeDefined();
    }
    expect(bookingMethods['paris-airport-shuttle']).toEqual({ kind: 'h_agent', playbook: 'paris-airport-shuttle' });
    expect(presetOptions.filter((o) => /taxi/i.test(o.name)).every((o) => bookingMethods[o.id]?.kind === 'h_agent')).toBe(true);
    expect(bookingMethods['gare-du-nord-taxi']).toBeUndefined(); expect(bookingMethods['g7-phone']).toBeUndefined();
  });
  it('dedupes by id with extra taking precedence and preserves input', () => {
    const first = option('first', 30);
    const replacement = { ...first, price: 100 };
    expect(mergeOptions([first], [replacement, option('second', 40)])).toEqual([replacement, option('second', 40)]);
    expect(first.price).toBe(65);
    expect(mergeOptions([], [])).toEqual([]);
    expect(mergeOptions([first, first], [])).toEqual([first]);
  });
});

describe('chooseOption', () => {
  it.each(['fr', 'en'])('recognizes the exact spoken names in %s with case/accent normalization and fillers', (language) => {
    for (const option of presetOptions) {
      const spoken = say('present-options', { options: [option], now }, language).split(',')[0]!.replace(/^1\. /, '');
      expect(chooseOption(spoken, presetOptions)).toBe(option.id);
      expect(chooseOption(spoken.toUpperCase().normalize('NFD').replace(/\p{M}/gu, ''), presetOptions)).toBe(option.id);
      expect(chooseOption(language === 'fr' ? `la ${spoken} s’il vous plaît` : `the ${spoken} please`, presetOptions)).toBe(option.id);
    }
  });
  it('does not select names of unavailable options or resolve colliding localized names arbitrarily', () => {
    expect(chooseOption('taxi de la gare du Nord', [presetOptions[1]!])).toBeNull();
    expect(chooseOption('Airport taxi', [presetOptions[0]!, { ...presetOptions[0]!, id: 'other', name: 'Airport taxi' }])).toBeNull();
  });
  it.each(['the shuttle is fine', "la navette c'est bien", 'la navette', 'the shuttle please', 'la navette s’il vous plaît', 'je choisis la navette', 'Paris Airport Shuttle'])('accepts affirmative selection: %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe('paris-airport-shuttle');
  });
  it.each(['je veux savoir si la navette accepte mon chien', 'est-ce que la navette accepte les chiens', 'I wonder whether the shuttle takes dogs', 'do you know if the shuttle runs', 'je demande si la navette accepte les chiens', 'tell me if I can I take the shuttle', 'tell me about the shuttle', 'the shuttle would be fine if dogs are accepted', 'navette parce que je ne sais pas', 'maybe the shuttle', '   '])('does not extract a selection keyword from a longer utterance: %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBeNull();
  });
  it.each(['2', 'le deux', 'the second please'])('keeps short ordinal selections: %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe(presetOptions[1]!.id);
  });
  it.each(['is the shuttle ok', 'la navette accepte le chien ?', 'est-ce que la navette convient', 'combien coûte la navette', 'quelle navette', 'quand arrive le bus', 'comment réserver le shuttle', 'pourquoi prendre le bus', 'are shuttles available', 'does the shuttle accept dogs', 'do shuttles run', 'can I take the shuttle', 'how long is the shuttle journey', 'what is the shuttle price', 'which shuttle', 'accepte-t-elle les chiens, la navette'])('defers questions to Gemini: %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBeNull();
  });
  it.each(['stop the shuttle', 'annuler la navette', 'not the shuttle', 'le shuttle demain', 'le moins cher', 'the fastest shuttle'])('still defers cancellation, corrections and preferences: %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBeNull();
  });
  it('selects the sole bookable taxi by ordinal, full name or keyword', () => {
    const options = assessOptions(presetOptions, trip, now).feasible;
    for (const id of ['paris-airport-shuttle']) {
      const index = options.findIndex((option) => option.id === id); expect(index).toBeGreaterThanOrEqual(0);
      expect(chooseOption(String(index + 1), options)).toBe(id);
    }
    expect(chooseOption('Airport taxi', options)).toBe('paris-airport-shuttle');
    expect(chooseOption('taxi', options)).toBe('paris-airport-shuttle');
  });
  it.each(['le premier', 'LA PREMIÈRE', 'first', '1', 'option 1'])('maps %s to the first option', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe(presetOptions[0]!.id);
  });
  it.each(['la deuxième', 'second', '2', 'option 2'])('maps %s to the second option', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe(presetOptions[1]!.id);
  });
  it.each([['navette', 'paris-airport-shuttle'], ['SHUTTLE', 'paris-airport-shuttle'], ['taxi', 'paris-airport-shuttle'], ['je veux un taxi', 'paris-airport-shuttle'], ['un taxi', 'paris-airport-shuttle'], ['call me a taxi', 'paris-airport-shuttle'], ['bus', 'rer-b-replacement-bus']])('matches keyword %s', (reply, id) => {
    expect(chooseOption(reply, presetOptions)).toBe(id);
  });
  it.each(['G7', 'bus ou navette', 'option 1 ou 2', 'first bus', 'option 99', 'train', ''])('rejects ambiguous or unmatched %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBeNull();
  });
  it('supports taxi when only one taxi option exists and handles an empty list', () => {
    expect(chooseOption('taxi', [presetOptions[0]!])).toBe(presetOptions[0]!.id);
    expect(chooseOption('first', [])).toBeNull();
    expect(chooseOption('NAVETTE', [{ ...presetOptions[0]!, id: 'transfer', name: 'Navette aéroport' }])).toBe('transfer');
    expect(chooseOption('bus', [{ ...presetOptions[1]!, id: 'flight', name: 'Airbus' }])).toBeNull();
  });
});
