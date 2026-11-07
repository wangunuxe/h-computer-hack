import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { createApp } from './app.js';
import { createStore, vehicles } from './store.js';
import { createPayments } from './payments.js';
import { parisToday } from './dates.js';

const route = {
  pickup: 'Gare du Nord, 18 Rue de Dunkerque, Paris', dropoff: 'CDG Airport Terminal 2E, Roissy-en-France',
  pickup_lat: '48.8809', pickup_lng: '2.3553', dropoff_lat: '49.0038', dropoff_lng: '2.5795',
  date: parisToday(new Date(Date.now() + 86400000)), time: '12:15',
};
const info = { name: 'Karim', email: 'karim@example.com', phone: '+33123456789', passengers: '1', luggage: '1', notes: 'Je voyage avec un chien guide.' };
function setup(env: NodeJS.ProcessEnv = {}) {
  const store = createStore();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
  return { app: createApp({ store, env, fetcher }), store, fetcher };
}
type App = ReturnType<typeof createApp>;
function post(app: App, path: string, body: Record<string, string>) {
  return app.request(path, { method: 'POST', body: new URLSearchParams(body) });
}
async function start(app: App, easy = false) {
  const response = await app.request('/fr/reservation/' + (easy ? '?difficulty=easy' : ''));
  expect(response.status).toBe(302);
  return response.headers.get('location')!.replace(/\/route$/, '');
}
async function complete(app: App, easy = false) {
  const base = await start(app, easy);
  expect((await app.request(base + '/route')).status).toBe(200);
  const step1 = await post(app, base + '/route', easy
    ? { ...route, pickup: 'Any hotel', dropoff: 'Any terminal', pickup_lat: '', pickup_lng: '', dropoff_lat: '', dropoff_lng: '' } : route);
  expect(step1.status).toBe(303);
  expect(step1.headers.get('location')).toBe(base + '/vehicle');
  expect((await app.request(base + '/vehicle')).status).toBe(200);
  expect((await post(app, base + '/vehicle', { vehicle: 'sedan' })).headers.get('location')).toBe(base + '/info');
  expect((await app.request(base + '/info')).status).toBe(200);
  const step3 = await post(app, base + '/info', info);
  expect(step3.status).toBe(303);
  return { base, paymentPath: step3.headers.get('location')! };
}

describe('four-step booking', () => {
  it.each(vehicles)('enforces advertised luggage capacity for $id', async (vehicle) => {
    const { app, store } = setup();
    const base = await start(app);
    await post(app, base + '/route', route);
    await post(app, base + '/vehicle', { vehicle: vehicle.id });
    if (vehicle.luggageCapacity < 8) {
      const response = await post(app, base + '/info', { ...info, luggage: '8' });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain(`Selected vehicle allows at most ${vehicle.luggageCapacity} suitcases.`);
      expect(body).toContain('Step 3 — Passenger information');
      expect(body).toContain('<option value="8" selected>');
      expect(store.orders.size).toBe(0);
    }
    expect((await post(app, base + '/info', { ...info, luggage: String(vehicle.luggageCapacity) })).status).toBe(303);
    expect([...store.orders.values()][0]!.info.luggage).toBe(String(vehicle.luggageCapacity));
  });
  it('accepts no luggage and rejects a missing luggage selection', async () => {
    const { app, store } = setup();
    const base = await start(app);
    await post(app, base + '/route', route);
    await post(app, base + '/vehicle', { vehicle: 'sedan' });
    expect((await post(app, base + '/info', { ...info, luggage: '' })).status).toBe(400);
    expect(store.orders.size).toBe(0);
    expect((await post(app, base + '/info', { ...info, luggage: '0' })).status).toBe(303);
  });
  it('renders the same Paris date minimum for both date controls across a timezone boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T23:30:00Z'));
    try {
      const { app } = setup();
      const hard = await start(app);
      const easy = await start(app, true);
      const hardHtml = await (await app.request(hard + '/route')).text();
      const easyHtml = await (await app.request(easy + '/route')).text();
      const expected = parisToday();
      expect(expected).toBe('2026-11-08');
      expect(hardHtml).toContain(`data-min-date="${expected}"`);
      expect(easyHtml).toContain(`min="${expected}"`);
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())).toBe('2026-11-07');
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([false, true])('selects only midnight by default and preserves chosen time (easy=%s)', async (easy) => {
    const { app } = setup();
    const base = await start(app, easy);
    const selectedOptions = (body: string) => body.match(/<option\b[^>]*\bselected\b[^>]*>/g);
    expect(selectedOptions(await (await app.request(base + '/route')).text())).toEqual(['<option value="00:00" selected>']);
    await post(app, base + '/route', route);
    expect(selectedOptions(await (await app.request(base + '/route')).text())).toEqual(['<option value="12:15" selected>']);
    expect(selectedOptions(await (await app.request(base + '/vehicle')).text())).toEqual(['<option value="sedan" selected>']);
    await post(app, base + '/vehicle', { vehicle: 'estate' });
    expect(selectedOptions(await (await app.request(base + '/vehicle')).text())).toEqual(['<option value="estate" selected>']);
    expect(selectedOptions(await (await app.request(base + '/info')).text())).toEqual([
      '<option value="1" selected>', '<option value="0" selected>',
    ]);
  });
  it.each([false, true])('rejects past dates using Paris today (easy=%s)', async (easy) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T23:30:00Z'));
    try {
      const { app, store } = setup();
      const base = await start(app, easy);
      expect(parisToday()).toBe('2026-11-08');
      const response = await post(app, base + '/route', { ...route, date: '2026-11-07' });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Pickup date cannot be before today (Europe/Paris).');
      expect(store.orders.size).toBe(0);
      if (easy) expect(await (await app.request(base + '/route')).text()).toContain('min="2026-11-08"');
      expect((await post(app, base + '/route', { ...route, date: '2026-11-08' })).status).toBe(303);
      expect((await post(app, base + '/route', { ...route, date: '2026-11-09' })).status).toBe(303);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(vehicles)('enforces advertised capacity for $id', async (vehicle) => {
    const { app, store } = setup();
    const base = await start(app);
    await post(app, base + '/route', route);
    await post(app, base + '/vehicle', { vehicle: vehicle.id });
    if (vehicle.capacity < 8) {
      const response = await post(app, base + '/info', { ...info, passengers: String(vehicle.capacity + 1) });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(`Selected vehicle allows at most ${vehicle.capacity} passengers.`);
      expect(store.orders.size).toBe(0);
    }
    expect((await post(app, base + '/info', { ...info, passengers: String(vehicle.capacity) })).status).toBe(303);
    expect(store.orders.size).toBe(1);
  });
  it('shows a manual payment retry without a countdown after cancellation', async () => {
    const { app } = setup();
    const { paymentPath } = await complete(app);
    const body = await (await app.request(paymentPath + '?cancelled=1')).text();
    expect(body).toContain('Payment cancelled.');
    expect(body).toContain('Pay via Credit Card');
    expect(body).toContain('id="checkout-form"');
    expect(body).not.toContain('id="countdown"');
    expect(body).toContain('UNPAID');
  });
  it('rejects the lat/lng trap even when visible addresses are filled', async () => {
    const { app, store } = setup();
    const base = await start(app);
    const response = await post(app, base + '/route', { ...route, pickup_lat: '', pickup_lng: '' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Select both addresses from the suggestion dropdown');
    expect(store.orders.size).toBe(0);
  });
  it('walks all four steps and creates exactly one unpaid order before checkout', async () => {
    const { app, store } = setup();
    const { base, paymentPath } = await complete(app);
    const payment = await app.request(paymentPath);
    const body = await payment.text();
    expect(body).toContain('Step 4 — Payment');
    expect(body).toContain('Pay via Credit Card');
    expect(body).toContain('id="countdown">2');
    expect(body).toContain(info.notes);
    expect(store.orders.size).toBe(1);
    const order = [...store.orders.values()][0]!;
    expect(order.paid).toBe(false);
    expect(order.vehicle.price).toBe(65);
    expect(order.route).toEqual(route);
    expect((await post(app, base + '/info', info)).headers.get('location')).toBe(paymentPath);
    expect(store.orders.size).toBe(1);
    const checkout = await app.request('/checkout/' + order.id, { method: 'POST' });
    expect(checkout.status).toBe(303);
    expect(checkout.headers.get('x-payment-mode')).toBe('fake-local-stub');
    expect(checkout.headers.get('location')).toBe('http://localhost:3001/stub-payment/' + order.id + '?mode=no-stripe-key');
    const stub = await app.request(checkout.headers.get('location')!);
    expect(await stub.text()).toContain('FAKE PAYMENT — LOCAL STUB');
    const confirmation = await app.request('/fr/reservation/confirmation/' + order.id);
    expect(await confirmation.text()).toContain('UNPAID');
  });
  it('keeps difficulty=easy and accepts free-text addresses without coordinates', async () => {
    const { app, store } = setup();
    const { base, paymentPath } = await complete(app, true);
    const routeHtml = await (await app.request(base + '/route')).text();
    expect(routeHtml).toContain('type="date"');
    expect(routeHtml).not.toContain('readonly');
    expect((await app.request(paymentPath)).status).toBe(200);
    expect([...store.orders.values()][0]!.route.pickup).toBe('Any hotel');
  });
  it('uses readonly calendar, unassociated labels and a collapsed notes section', async () => {
    const { app } = setup();
    const base = await start(app);
    const body = await (await app.request(base + '/route')).text();
    expect(body).toContain('readonly');
    expect(body).toContain('/assets/vendor/jquery-ui.min.js');
    expect(body).not.toMatch(/aria-label|<label[^>]*for=/);
    await post(app, base + '/route', route);
    await post(app, base + '/vehicle', { vehicle: 'sedan' });
    const html = await (await app.request(base + '/info')).text();
    expect(html).toContain('<details>');
    expect(html).not.toContain('<details open');
    expect((await app.request('/assets/vendor/jquery.min.js')).status).toBe(200);
    expect((await app.request('/assets/vendor/jquery-ui.min.css')).status).toBe(200);
  });
  it('rejects incomplete steps, invalid selections, dates and missing orders', async () => {
    const { app } = setup();
    const base = await start(app);
    expect((await post(app, base + '/info', info)).status).toBe(400);
    expect((await post(app, base + '/route', { ...route, date: '2027-02-30' })).status).toBe(400);
    await post(app, base + '/route', route);
    expect((await post(app, base + '/vehicle', { vehicle: 'invalid' })).status).toBe(400);
    await post(app, base + '/vehicle', { vehicle: 'sedan' });
    expect((await post(app, base + '/info', { ...info, email: 'invalid' })).status).toBe(400);
    expect((await app.request('/checkout/missing', { method: 'POST' })).status).toBe(404);
  });
  it('escapes notes rather than rendering HTML', async () => {
    const { app } = setup();
    const base = await start(app);
    await post(app, base + '/route', route);
    await post(app, base + '/vehicle', { vehicle: 'sedan' });
    const response = await post(app, base + '/info', { ...info, notes: '<script>alert(1)</script>' });
    const body = await (await app.request(response.headers.get('location')!)).text();
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>alert');
  });
});

describe('payments', () => {
  it('shows no payment form or countdown for a paid order and redirects checkout to confirmation', async () => {
    const store = createStore();
    const checkout = vi.fn();
    const app = createApp({ store, env: {}, payments: { checkout, verify: vi.fn() } });
    const { paymentPath } = await complete(app);
    const order = [...store.orders.values()][0]!;
    order.paid = true;
    const body = await (await app.request(paymentPath)).text();
    expect(body).toContain('Payment already received.');
    expect(body).not.toContain('id="countdown"');
    expect(body).not.toContain('id="checkout-form"');
    const response = await app.request('/checkout/' + order.id, { method: 'POST' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/fr/reservation/confirmation/' + order.id);
    expect(checkout).not.toHaveBeenCalled();
  });
  it('ignores forged request origins and Host headers when building Stripe redirects', async () => {
    const stripe = new Stripe('sk_test_mock');
    const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_mock', url: 'https://checkout.stripe.com/mock',
    } as Stripe.Response<Stripe.Checkout.Session>);
    const store = createStore();
    const env = { STRIPE_SECRET_KEY: 'sk_test_mock', PORT: '3456' };
    const app = createApp({ store, env, payments: createPayments(env, stripe) });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    await app.request('https://attacker.example/checkout/' + order.id, {
      method: 'POST', headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      success_url: `http://localhost:3456/fr/reservation/confirmation/${order.id}`,
      cancel_url: `http://localhost:3456/fr/reservation/payment/${order.id}?cancelled=1`,
    }), expect.anything());
    expect(JSON.stringify(create.mock.calls)).not.toContain('attacker.example');
  });
  it('delegates each checkout request to the gateway for session validation', async () => {
    const store = createStore();
    const checkout = vi.fn().mockResolvedValue('https://checkout.stripe.com/c/pay/test_session');
    const app = createApp({ store, env: { STRIPE_SECRET_KEY: 'test', SHUTTLE_PUBLIC_URL: 'https://shuttle.example/' }, payments: { checkout, verify: vi.fn() } });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    const first = await app.request('/checkout/' + order.id, { method: 'POST' });
    expect(first.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/test_session');
    await app.request('/checkout/' + order.id, { method: 'POST' });
    expect(checkout).toHaveBeenCalledTimes(2);
    expect(checkout).toHaveBeenLastCalledWith(order, 'https://shuttle.example');
  });
  it('returns a retryable error if the gateway fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore();
    const app = createApp({ store, env: {}, payments: { checkout: vi.fn().mockRejectedValue(new Error('offline')), verify: vi.fn() } });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    expect((await app.request('/checkout/' + order.id, { method: 'POST' })).status).toBe(502);
    expect(order.paid).toBe(false);
    log.mockRestore();
  });
  it('requires webhook configuration and rejects invalid signatures', async () => {
    expect((await setup().app.request('/stripe/webhook', { method: 'POST', body: '{}' })).status).toBe(503);
    const { app } = setup({ STRIPE_WEBHOOK_SECRET: 'whsec_demo' });
    expect((await app.request('/stripe/webhook', { method: 'POST', body: '{}' })).status).toBe(400);
  });
  it('verifies the raw signed body, marks paid and sends the bearer callback', async () => {
    const { app, store, fetcher } = setup({ STRIPE_WEBHOOK_SECRET: 'whsec_demo', SERVER_PUBLIC_URL: 'https://server.example/', INTERNAL_CALLBACK_TOKEN: 'demo-token' });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    const payload = JSON.stringify({ id: 'evt_demo', type: 'checkout.session.completed', data: { object: { metadata: { orderId: order.id }, payment_status: 'paid' } } });
    const stripe = new Stripe('sk_test_signature_only');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_demo' });
    const response = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload });
    expect(response.status).toBe(200);
    expect(order.paid).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://server.example/internal/payment-completed', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo-token' },
      body: JSON.stringify({ order_id: order.id, ref: order.ref, status: 'paid' }),
    }));
    expect(await (await app.request('/fr/reservation/confirmation/' + order.id)).text()).toContain('<dd>PAID</dd>');
  });
  it('acknowledges callback failure without losing paid status', async () => {
    const { app, store, fetcher } = setup({ STRIPE_WEBHOOK_SECRET: 'whsec_demo', SERVER_PUBLIC_URL: 'https://server.example' });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    fetcher.mockRejectedValue(new Error('offline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { orderId: order.id }, payment_status: 'paid' } } });
    const signature = new Stripe('sk_test_signature_only').webhooks.generateTestHeaderString({ payload, secret: 'whsec_demo' });
    expect((await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload })).status).toBe(200);
    expect(order.paid).toBe(true);
    expect(log).toHaveBeenCalledWith('Payment callback failed', 'offline');
    log.mockRestore();
  });
  it('does not call back when SERVER_PUBLIC_URL is absent', async () => {
    const { app, store, fetcher } = setup({ STRIPE_WEBHOOK_SECRET: 'whsec_demo' });
    await complete(app);
    const order = [...store.orders.values()][0]!;
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { orderId: order.id }, payment_status: 'paid' } } });
    const signature = new Stripe('sk_test_signature_only').webhooks.generateTestHeaderString({ payload, secret: 'whsec_demo' });
    await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload });
    expect(order.paid).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('creates a fake local redirect without any Stripe key', async () => {
    const { app, store } = setup();
    await complete(app);
    const order = [...store.orders.values()][0]!;
    expect(await createPayments({}).checkout(order, 'https://demo.example')).toContain('/stub-payment/' + order.id);
  });
});
