import { describe, expect, it } from 'vitest';
import { relevantLines, stationForPlace, stations } from './stations.js';

describe('connected traffic routes', () => {
  it('uses one connecting RER pair rather than padding with Gare du Nord endpoint lines', () => {
    expect(relevantLines('Gare du Nord', 'La Défense')).toEqual(['RER B', 'RER A']);
    const reverse = relevantLines('La Défense', 'Gare du Nord');
    expect(reverse).toHaveLength(2); expect(reverse[0]).toBe('RER A'); expect(['RER B', 'RER D']).toContain(reverse[1]);
  });
  it.each([['La Défense', 'Bercy'], ['Montparnasse', 'Orly'], ['Gare du Nord', 'La Défense']])('connects %s to %s at stations in the table', (origin, destination) => {
    const lines = relevantLines(origin, destination);
    expect(lines.length).toBeGreaterThan(0); expect(lines.length).toBeLessThanOrEqual(3);
    expect(stationForPlace(origin)!.lines).toContain(lines[0]); expect(stationForPlace(destination)!.lines).toContain(lines.at(-1));
    for (let i = 1; i < lines.length; i++) expect(stations.some((station) => station.lines.includes(lines[i - 1]!) && station.lines.includes(lines[i]!))).toBe(true);
  });
  it('does not invent connecting lines for an unknown endpoint', () => {
    expect(relevantLines('Unknown address', 'La Défense')).toEqual([]);
    expect(relevantLines('Gare du Nord', 'Unknown address')).toEqual([]);
  });
});
