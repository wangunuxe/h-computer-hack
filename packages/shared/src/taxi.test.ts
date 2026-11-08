import { describe, expect, it, vi } from 'vitest';
import { estimateTaxi, geocodeTaxiPlace, resolveTaxiQuote, parisPickupTime, taxiPlacesEquivalent } from './taxi.js';
const at = '2026-11-09T11:00:00Z';
describe('shared regulated taxi estimates', () => {
  it.each(['CDG Airport Terminal 2E, 95700 Roissy-en-France', 'Roissy CDG Terminal 2F, 93290 Tremblay-en-France', 'Orly Airport Terminal 4, 94390 Orly'])('retains airport detection regardless of the suffix in %s', async (airport) => {
    const fetcher = vi.fn<typeof fetch>();
    const quote = await resolveTaxiQuote({ origin: 'Gare du Nord', destination: airport }, { now: new Date(at), fetch: fetcher });
    expect(estimateTaxi(quote).price).toBe(airport.startsWith('Orly') ? 45 : 56); expect(estimateTaxi(quote).tariff).toBe('forfait'); expect(fetcher).not.toHaveBeenCalled();
    expect(estimateTaxi({ ...quote, origin: airport, destination: 'Gare du Nord', from: quote.to, to: quote.from }).tariff).toBe('forfait');
  });
  it('matches canonical stations and complete normalized addresses, never postal or proximity guesses', () => {
    expect(taxiPlacesEquivalent('Gare du Nord', 'Gare du Nord, 18 Rue de Dunkerque, Paris')).toBe(true);
    expect(taxiPlacesEquivalent('12 Rue de la Paix, 75002 Paris', '12 rue de la paix 75002 Paris')).toBe(true);
    expect(taxiPlacesEquivalent('12 Rue de la Paix, Paris', '12 Rue de la Paix, 75002 Paris')).toBe(false);
    expect(taxiPlacesEquivalent('12 Rue de la Paix, 75002 Paris', '12 Rue de la Paix, 75008 Paris')).toBe(false);
    expect(taxiPlacesEquivalent('Gare du Nord', 'Gare du Nord, Saint-Denis')).toBe(false);
    expect(taxiPlacesEquivalent('Tour Eiffel', 'Tour Eiffel, 5 Avenue Anatole France, Paris')).toBe(false);
    expect(taxiPlacesEquivalent('Tour Eiffel', 'Tour Eiffel Restaurant, Nice')).toBe(false);
    expect(taxiPlacesEquivalent('Tour Eiffel', 'Unknown')).toBe(false);
  });
  it('resolves summer/winter pickup clocks and rejects missing, invalid or ambiguous times', () => {
    expect(parisPickupTime('2026-11-09', '18:00')?.toISOString()).toBe('2026-11-09T17:00:00.000Z');
    expect(parisPickupTime('2027-07-01', '18:00')?.toISOString()).toBe('2027-07-01T16:00:00.000Z');
    for (const [date, time] of [['', ''], ['2027-03-28', '02:30'], ['2027-10-31', '02:30'], ['2027-02-30', '12:00']]) expect(parisPickupTime(date!, time!)).toBeUndefined();
  });
  it.each([[5, 61.5], [6, 67], [7, 72.5], [8, 78]])('preserves the regulated airport supplement for %i passengers', (passengers, price) => {
    expect(estimateTaxi({ origin: 'Gare du Nord', destination: 'CDG', at, passengers }).price).toBe(price);
  });
  it('gives distinct plausible routes instead of one fixed fare and duration', () => {
    const routes = [['La Défense', 'Bercy'], ['Gare du Nord', 'CDG'], ['Gare du Nord', 'Gare de l’Est']].map(([origin, destination]) => estimateTaxi({ origin: origin!, destination: destination!, at, passengers: 1 }));
    expect(new Set(routes.map((route) => route.price)).size).toBe(3); expect(new Set(routes.map((route) => route.journey_minutes)).size).toBe(3);
    expect(routes[0]!.price).toBeGreaterThan(20); expect(routes[0]!.price).toBeLessThan(50);
    expect(routes[1]).toMatchObject({ price: 56, tariff: 'forfait' }); expect(routes[2]!.price).toBe(8);
  });
  it.each([['Gare du Nord', 'CDG', 56], ['Montparnasse', 'CDG', 65], ['Gare du Nord', 'Orly', 45], ['Montparnasse', 'Orly', 36], ['CDG', 'Gare du Nord', 56], ['Orly', 'Montparnasse', 36]] as const)('uses the airport forfait %s → %s', (origin, destination, price) => expect(estimateTaxi({ origin, destination, at, passengers: 1 }).price).toBe(price));
  it('does not apply a Paris airport forfait to La Défense and varies time-of-day estimates', () => {
    expect(estimateTaxi({ origin: 'La Défense', destination: 'CDG', at, passengers: 1 }).tariff).not.toBe('forfait');
    const quote = { origin: 'Châtelet', destination: 'Montparnasse', at, passengers: 1 };
    const off = estimateTaxi(quote), peak = estimateTaxi({ ...quote, at: '2026-11-09T17:00:00Z' });
    expect(off.tariff).toBe('A'); expect(peak.tariff).toBe('B'); expect(peak.journey_minutes).toBeGreaterThan(off.journey_minutes); expect(peak.pickup_wait_minutes).toBeGreaterThan(off.pickup_wait_minutes);
    expect(estimateTaxi({ ...quote, at: '2026-11-08T01:00:00Z' }).tariff).toBe('C');
    expect(estimateTaxi({ ...quote, at: '2026-11-11T11:00:00Z' }).tariff).toBe('B');
  });
  it('geocodes a BAN address and uses GPS without a reverse/search call', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ features: [{ geometry: { coordinates: [2.33, 48.86] }, properties: { score: .9, citycode: '75101' } }] })));
    const quote = await resolveTaxiQuote({ origin: '12 Rue de la Paix, Paris', destination: 'Bercy' }, { now: new Date(at), fetch: fetcher });
    expect(quote.from).toEqual({ latitude: 48.86, longitude: 2.33, paris: true }); expect(fetcher).toHaveBeenCalledOnce(); expect(estimateTaxi(quote).fallback).toBe(false);
    fetcher.mockClear(); const gps = { latitude: 48.88354, longitude: 2.17661 };
    expect((await resolveTaxiQuote({ origin: 'près du 7 Avenue Mary, à Rueil-Malmaison', destination: 'Bercy' }, { now: new Date(at), gps, fetch: fetcher })).from).toMatchObject(gps); expect(fetcher).not.toHaveBeenCalled();
  });
  it('geocodes street and hotel names containing station aliases instead of treating them as airports/stations', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ features: [{ geometry: { coordinates: [2.28, 48.88] }, properties: { score: .9, citycode: '92051' } }] })));
    const quote = await resolveTaxiQuote({ origin: '12 Avenue Charles de Gaulle, Neuilly', destination: 'Hôtel du Luxembourg' }, { now: new Date(at), fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(quote.from).toMatchObject({ latitude: 48.88, longitude: 2.28, paris: false });
    expect(estimateTaxi(quote).tariff).not.toBe('forfait');
  });
  it.each(['empty', 'error', 'bad-json', 'invalid-coordinates'])('uses a zone fallback when geocoding returns %s', async (kind) => {
    const fetcher = vi.fn<typeof fetch>(async () => { if (kind === 'error') throw new Error('offline'); return new Response(kind === 'bad-json' ? 'bad' : JSON.stringify({ features: kind === 'empty' ? [] : [{ geometry: { coordinates: [999,999] }, properties: { score: .9 } }] })); });
    const quote = await resolveTaxiQuote({ origin: 'Unknown hotel', destination: 'Bercy' }, { now: new Date(at), fetch: fetcher });
    expect(estimateTaxi(quote).fallback).toBe(true); expect(estimateTaxi(quote).price).toBeGreaterThanOrEqual(8);
  });
  it('rejects invalid quote inputs and honours cancellation', async () => {
    expect(() => estimateTaxi({ origin: '', destination: '', at, passengers: 1 })).toThrow();
    const controller = new AbortController(); controller.abort(); await expect(geocodeTaxiPlace('Unknown', { signal: controller.signal })).rejects.toBeDefined();
  });
});
