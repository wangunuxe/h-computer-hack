import { describe, expect, it, vi } from 'vitest';
import { estimateTaxi, resolveTaxiQuote } from '@voila/shared';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { optionsForTrip } from '../../server/src/options.js';
import { registerFareQuote } from '../../server/src/booking.js';
const at = new Date('2026-11-09T11:00:00Z');
describe('shared route fare from narration through checkout', () => {
  it.each([['La Défense', 'Bercy'], ['Gare du Nord', 'CDG'], ['Gare du Nord', 'Gare de l’Est'], ['près du 7 Avenue Mary, à Rueil-Malmaison', 'Bercy']])('charges the server estimate for %s → %s', async (origin, destination) => {
    const store = createStore(), app = createApp({ store, env: { INTERNAL_CALLBACK_TOKEN: 'test-token' } });
    const quote = await resolveTaxiQuote({ origin, destination }, { now: at, gps: origin.startsWith('près') ? { latitude: 48.88354, longitude: 2.17661 } : undefined });
    const option = optionsForTrip({ origin, destination }, false, quote)[0]!;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => app.request(String(url), init));
    const url = await registerFareQuote({ fareQuote: quote, startUrl: 'https://shuttle.test/fr/reservation/?difficulty=easy' }, fetcher, 'test-token', 'https://shuttle.test');
    expect(url).not.toMatch(/latitude|longitude|48\./);
    const response = await app.request(url), base = response.headers.get('location')!.replace(/\/route$/, '');
    const post = (path: string, body: Record<string,string>) => app.request(path, { method: 'POST', body: new URLSearchParams(body) });
    // The quote retains the narrated time-of-day tariff even if H completes the form later.
    const date = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    expect((await post(base + '/route', { pickup: origin, dropoff: destination, date, time: '12:00', pickup_lat: '', pickup_lng: '', dropoff_lat: '', dropoff_lng: '' })).status).toBe(303);
    expect(await (await app.request(base + '/vehicle')).text()).toContain(`${option.price} EUR`);
    await post(base + '/vehicle', { vehicle: 'sedan' });
    await post(base + '/info', { name: 'Test', email: 'test@example.com', phone: '0612345678', passengers: '1', luggage: '0', notes: '' });
    const order = [...store.orders.values()][0]!; expect(order.vehicle.price).toBe(option.price);
    expect(order.vehicle.price).toBe(estimateTaxi(quote).price);
    const checkout = vi.fn(async () => 'https://checkout.test/');
    const withPayments = createApp({ store, env: {}, payments: { checkout, verify: vi.fn() } });
    await withPayments.request(`/checkout/${order.id}`, { method: 'POST' }); expect(checkout.mock.calls[0]![0]).toMatchObject({ vehicle: { price: option.price } });
  });
  it('rejects unauthenticated, malformed and expired quotes', async () => {
    const store = createStore(), app = createApp({ store, env: { INTERNAL_CALLBACK_TOKEN: 'test-token' } });
    expect((await app.request('/internal/fare-quotes', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await app.request('/internal/fare-quotes', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
    expect((await app.request('/fr/reservation/?quote=missing')).status).toBe(400);
    const fareQuote = await resolveTaxiQuote({ origin: 'Bercy', destination: 'CDG' });
    store.quotes.set('expired', { fare: fareQuote, expires: Date.now() - 1 }); expect((await app.request('/fr/reservation/?quote=expired')).status).toBe(400);
    await expect(registerFareQuote({ fareQuote, startUrl: 'https://shuttle.test' }, async () => new Response('', { status: 500 }), 'test-token', 'https://shuttle.test')).rejects.toThrow('Could not register');
    await expect(registerFareQuote({ fareQuote, startUrl: 'https://shuttle.test' }, async () => new Response('{}'), 'test-token', 'https://shuttle.test')).rejects.toThrow('Invalid fare quote response');
    const fetcher = vi.fn(); await expect(registerFareQuote({ fareQuote, startUrl: 'https://external.test' }, fetcher, 'test-token', 'https://shuttle.test')).rejects.toThrow('configured shuttle clone origin'); expect(fetcher).not.toHaveBeenCalled();
    await expect(registerFareQuote({ fareQuote: await resolveTaxiQuote({ origin: 'Bercy', destination: 'CDG' }), startUrl: 'https://shuttle.test' }, vi.fn(), '')).rejects.toThrow('authentication');
  });
});
