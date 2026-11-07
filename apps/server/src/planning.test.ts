import { describe, expect, it } from 'vitest';
import { OptionSchema, type Option, type Trip } from '@voila/shared';
import { assessOptions } from './feasibility.js';
import { bookingMethods, matchesPresetRoute, mergeOptions, presetOptions } from './options.js';
import { chooseOption } from './choose.js';

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
  it.each(['CDG 2E', 'ROISSY', 'Aéroport Charles-de-Gaulle'])('recognizes the supported airport route to %s', (destination) => {
    expect(matchesPresetRoute({ origin: 'GARE DU NÖRD, Paris', destination })).toBe(true);
  });
  it.each([
    { origin: 'Gare de Lyon', destination: 'CDG' }, { origin: 'Gare du Nord', destination: 'Orly' },
    { origin: '', destination: 'CDG' }, { origin: 'Gare du Nord', destination: 'ABCDG' },
  ])('rejects a different or unknown preset route: %j', (route) => { expect(matchesPresetRoute(route)).toBe(false); });
  it('has four valid sourced options and a booking method for each', () => {
    expect(presetOptions).toHaveLength(4);
    for (const o of presetOptions) {
      expect(OptionSchema.parse(o)).toEqual(o);
      expect(o.source).toMatch(/^https:/);
      expect(bookingMethods[o.id]).toBeDefined();
    }
    expect(bookingMethods['paris-airport-shuttle']).toEqual({ kind: 'h_agent', playbook: 'paris-airport-shuttle' });
    expect(presetOptions.filter((o) => /taxi|G7/.test(o.name)).every((o) => o.guide_dog_status === 'accepted')).toBe(true);
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
  it('selects either feasible taxi by ordinal even when the taxi-rank name is ambiguous', () => {
    const options = assessOptions(presetOptions, trip, now).feasible;
    for (const id of ['gare-du-nord-taxi', 'g7-phone']) {
      const index = options.findIndex((option) => option.id === id); expect(index).toBeGreaterThanOrEqual(0);
      expect(chooseOption(String(index + 1), options)).toBe(id);
    }
    expect(chooseOption('Gare du Nord taxi rank', options)).toBeNull();
  });
  it.each(['le premier', 'LA PREMIÈRE', 'first', '1', 'option 1'])('maps %s to the first option', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe(presetOptions[0]!.id);
  });
  it.each(['la deuxième', 'second', '2', 'option 2'])('maps %s to the second option', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBe(presetOptions[1]!.id);
  });
  it.each([['navette', 'paris-airport-shuttle'], ['SHUTTLE', 'paris-airport-shuttle'], ['G7', 'g7-phone'], ['bus', 'rer-b-replacement-bus']])('matches keyword %s', (reply, id) => {
    expect(chooseOption(reply, presetOptions)).toBe(id);
  });
  it.each(['taxi', 'bus ou navette', 'option 1 ou 2', 'first bus', 'option 99', 'train', ''])('rejects ambiguous or unmatched %s', (reply) => {
    expect(chooseOption(reply, presetOptions)).toBeNull();
  });
  it('supports taxi when only one taxi option exists and handles an empty list', () => {
    expect(chooseOption('taxi', [presetOptions[0]!])).toBe(presetOptions[0]!.id);
    expect(chooseOption('first', [])).toBeNull();
    expect(chooseOption('NAVETTE', [{ ...presetOptions[2]!, id: 'transfer', name: 'Navette aéroport' }])).toBe('transfer');
    expect(chooseOption('bus', [{ ...presetOptions[3]!, id: 'flight', name: 'Airbus' }])).toBeNull();
  });
});
