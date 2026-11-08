import { randomUUID, timingSafeEqual } from 'node:crypto';
import { TaxiQuoteSchema, geocodeTaxiPlace, taxiPlacesEquivalent, taxiPoint, parisPickupTime } from '@voila/shared';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { parisToday, pickupIsPast } from './dates.js';
import { createPayments } from './payments.js';
import type { PaymentGateway } from './payments.js';
import { confirmationPage, infoPage, paymentPage, routePage, stubPage, vehiclePage } from './pages.js';
import { createStore, newDraft, vehiclesForDraft, timeOptions, passengerOptions, luggageOptions } from './store.js';
import type { Order, Store } from './store.js';

const routeSchema = z.object({
  pickup: z.string().trim().min(1), dropoff: z.string().trim().min(1),
  pickup_lat: z.string(), pickup_lng: z.string(), dropoff_lat: z.string(), dropoff_lng: z.string(),
  date: z.iso.date(), time: z.enum(timeOptions as [string, ...string[]]),
});
const infoSchema = z.object({
  name: z.string().trim().min(1), email: z.email(), phone: z.string().trim().min(1),
  passengers: z.string().refine((v) => passengerOptions.some((o) => o.value === v)),
  luggage: z.string().refine((v) => luggageOptions.some((o) => o.value === v)),
  notes: z.string().max(4000),
});
const validCoordinate = (value: string, max: number) =>
  value.trim() !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= max;

export function createApp({
  store = createStore(), env = process.env, payments = createPayments(env), fetcher = fetch, geocodeFetch = fetch,
}: { store?: Store; env?: NodeJS.ProcessEnv; payments?: PaymentGateway; fetcher?: typeof fetch; geocodeFetch?: typeof fetch } = {}) {
  const app = new Hono();
  const completePayment = async (order: Order) => {
    order.paid = true;
    if (!env.SERVER_PUBLIC_URL) return true;
    try {
      const response = await fetcher(`${env.SERVER_PUBLIC_URL.replace(/\/$/, '')}/internal/payment-completed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INTERNAL_CALLBACK_TOKEN ?? ''}` },
        body: JSON.stringify({ order_id: order.id, ref: order.ref, status: 'paid' }), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      console.error('Payment callback failed', error instanceof Error ? error.message : 'Unknown error'); return false;
    }
  };
  const root = fileURLToPath(new URL('../public', import.meta.url));
  app.use('/assets/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/assets/, '') }));
  app.get('/', (c) => c.redirect('/fr/reservation/'));
  app.post('/internal/fare-quotes', async (c) => {
    const expected = env.INTERNAL_CALLBACK_TOKEN ? `Bearer ${env.INTERNAL_CALLBACK_TOKEN}` : '', actual = c.req.header('Authorization') ?? '';
    if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return c.text('Unauthorized', 401);
    const parsed = TaxiQuoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.text('Invalid fare quote', 400);
    for (const [id, quote] of store.quotes) if (quote.expires <= Date.now()) store.quotes.delete(id);
    if (store.quotes.size >= 1000) return c.text('Quote capacity reached', 503);
    const id = randomUUID(); store.quotes.set(id, { fare: parsed.data, expires: Date.now() + 30 * 60_000 }); return c.json({ id }, 201);
  });
  app.get('/fr/reservation/', (c) => {
    const draft = newDraft(c.req.query('difficulty') === 'easy' ? 'easy' : 'real');
    const id = c.req.query('quote');
    if (id) { const quote = store.quotes.get(id); if (!quote || quote.expires <= Date.now()) return c.text('Fare estimate expired. Ask Voilà for new options.', 400); draft.fare = quote.fare; }
    store.drafts.set(draft.id, draft);
    return c.redirect(`/fr/reservation/${draft.id}/route`);
  });
  app.get('/fr/reservation/:id/route', (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    return draft ? c.html(routePage(draft)) : c.text('Draft not found', 404);
  });
  app.post('/fr/reservation/:id/route', async (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    if (!draft) return c.text('Draft not found', 404);
    const values = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
    const parsed = routeSchema.safeParse(values);
    if (!parsed.success) return c.html(routePage(draft, 'Please complete the route, date and time.', values), 400);
    const r = parsed.data;
    const now = new Date();
    if (r.date < parisToday(now)) {
      return c.html(routePage(draft, 'Pickup date cannot be before today (Europe/Paris).', values), 400);
    }
    if (pickupIsPast(r.date, r.time, now)) {
      return c.html(routePage(draft, 'Pickup date and time cannot be in the past (Europe/Paris).', values), 400);
    }
    if (draft.difficulty === 'real' && (!validCoordinate(r.pickup_lat, 90) || !validCoordinate(r.pickup_lng, 180)
      || !validCoordinate(r.dropoff_lat, 90) || !validCoordinate(r.dropoff_lng, 180))) {
      return c.html(routePage(draft, 'Select both addresses from the suggestion dropdown (missing lat/lng).', values), 400);
    }
    if (draft.orderId) return c.text('An order already exists for this draft', 409);
    const pickup = parisPickupTime(r.date, r.time);
    if (!pickup) return c.html(routePage(draft, 'Invalid or ambiguous Paris pickup time.', values), 400);
    const sameOrigin = draft.fare && taxiPlacesEquivalent(draft.fare.origin, r.pickup);
    const sameDestination = draft.fare && taxiPlacesEquivalent(draft.fare.destination, r.dropoff);
    const quotedFrom = draft.fare && (draft.fare.from ?? taxiPoint(draft.fare.origin));
    const quotedTo = draft.fare && (draft.fare.to ?? taxiPoint(draft.fare.destination));
    if (sameOrigin && sameDestination) draft.fare = { ...draft.fare!, at: pickup.toISOString() };
    else {
      const [from, to] = await Promise.all([
        sameOrigin && quotedFrom ? quotedFrom : geocodeTaxiPlace(r.pickup, { fetch: geocodeFetch }),
        sameDestination && quotedTo ? quotedTo : geocodeTaxiPlace(r.dropoff, { fetch: geocodeFetch }),
      ]);
      if ((quotedFrom && !from) || (quotedTo && !to)) return c.html(routePage(draft, 'Could not verify the changed addresses. Keep the original stop or ask Voilà for new options.', values), 400);
      const resolved = TaxiQuoteSchema.parse({ origin: r.pickup, destination: r.dropoff, from, to, passengers: draft.fare?.passengers ?? Number(draft.info?.passengers ?? 1), at: pickup.toISOString() });
      draft.fare = resolved;
    }
    draft.route = r; draft.vehicle = undefined; draft.info = undefined;
    return c.redirect(`/fr/reservation/${draft.id}/vehicle`, 303);
  });
  app.get('/fr/reservation/:id/vehicle', (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    if (!draft) return c.text('Draft not found', 404);
    if (!draft.route) return c.redirect(`/fr/reservation/${draft.id}/route`);
    return c.html(vehiclePage(draft));
  });
  app.post('/fr/reservation/:id/vehicle', async (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    if (!draft) return c.text('Draft not found', 404);
    if (!draft.route) return c.text('Complete route first', 400);
    if (draft.orderId) return c.text('An order already exists for this draft', 409);
    const body = await c.req.parseBody();
    const vehicle = vehiclesForDraft(draft).find((v) => v.id === body.vehicle);
    if (!vehicle) return c.html(vehiclePage(draft, 'Select a vehicle class.'), 400);
    draft.vehicle = vehicle;
    return c.redirect(`/fr/reservation/${draft.id}/info`, 303);
  });
  app.get('/fr/reservation/:id/info', (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    if (!draft) return c.text('Draft not found', 404);
    if (!draft.route || !draft.vehicle) return c.redirect(`/fr/reservation/${draft.id}/vehicle`);
    return c.html(infoPage(draft));
  });
  app.post('/fr/reservation/:id/info', async (c) => {
    const draft = store.drafts.get(c.req.param('id'));
    if (!draft) return c.text('Draft not found', 404);
    if (!draft.route || !draft.vehicle) return c.text('Complete route and vehicle first', 400);
    if (draft.orderId) return c.redirect(`/fr/reservation/payment/${draft.orderId}`, 303);
    const values = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
    const parsed = infoSchema.safeParse({ ...values, notes: values.notes ?? '' });
    if (!parsed.success) return c.html(infoPage(draft, 'Please complete valid passenger information.', values), 400);
    if (Number(parsed.data.passengers) > draft.vehicle.capacity) {
      return c.html(infoPage(draft, `Selected vehicle allows at most ${draft.vehicle.capacity} passengers. Choose a larger vehicle or reduce the passenger count.`, values), 400);
    }
    if (Number(parsed.data.luggage) > draft.vehicle.luggageCapacity) {
      return c.html(infoPage(draft, `Selected vehicle allows at most ${draft.vehicle.luggageCapacity} suitcases. Choose a larger vehicle or reduce the luggage count.`, values), 400);
    }
    if (draft.orderId) return c.redirect(`/fr/reservation/payment/${draft.orderId}`, 303);
    draft.info = parsed.data;
    draft.vehicle = vehiclesForDraft(draft).find((vehicle) => vehicle.id === draft.vehicle!.id)!;
    const id = randomUUID();
    const order: Order = {
      id, ref: `PAS-${id.slice(0, 8).toUpperCase()}`, route: { ...draft.route },
      vehicle: draft.vehicle, info: { ...draft.info }, paid: false,
    };
    store.orders.set(id, order);
    draft.orderId = id;
    return c.redirect(`/fr/reservation/payment/${id}`, 303);
  });
  app.get('/fr/reservation/payment/:orderId', (c) => {
    const order = store.orders.get(c.req.param('orderId'));
    return order ? c.html(paymentPage(order, c.req.query('cancelled') === '1')) : c.text('Order not found', 404);
  });
  app.post('/checkout/:orderId', async (c) => {
    const order = store.orders.get(c.req.param('orderId'));
    if (!order) return c.text('Order not found', 404);
    if (order.paid) return c.redirect(`/fr/reservation/confirmation/${order.id}`, 303);
    try {
      const baseUrl = (env.SHUTTLE_PUBLIC_URL || `http://localhost:${env.PORT || 3001}`).replace(/\/$/, '');
      order.checkoutUrl = await payments.checkout(order, baseUrl);
      c.header('X-Payment-Mode', env.STRIPE_SECRET_KEY ? 'stripe' : 'fake-local-stub');
      return c.redirect(order.checkoutUrl, 303);
    } catch (error) {
      console.error('Checkout failed', error instanceof Error ? error.message : 'Unknown error');
      return c.text('Could not create payment session. Please retry.', 502);
    }
  });
  app.get('/stub-payment/:orderId', (c) => {
    const order = store.orders.get(c.req.param('orderId'));
    if (env.STRIPE_SECRET_KEY || order?.checkoutSessionId) return c.text('Stub payment unavailable', 404);
    return order ? c.html(stubPage(order)) : c.text('Order not found', 404);
  });
  app.post('/stub-payment/:orderId', async (c) => {
    const order = store.orders.get(c.req.param('orderId'));
    if (env.STRIPE_SECRET_KEY || order?.checkoutSessionId) return c.text('Stub payment unavailable', 404);
    if (!order) return c.text('Order not found', 404);
    if (!await completePayment(order)) return c.html(stubPage(order, 'Could not notify Voilà. Please retry the simulated payment.'), 503);
    return c.redirect(`/fr/reservation/confirmation/${order.id}`, 303);
  });
  app.get('/fr/reservation/confirmation/:orderId', (c) => {
    const order = store.orders.get(c.req.param('orderId'));
    return order ? c.html(confirmationPage(order)) : c.text('Order not found', 404);
  });
  app.post('/stripe/webhook', async (c) => {
    if (!env.STRIPE_WEBHOOK_SECRET) return c.text('Webhook secret not configured', 503);
    let event;
    try {
      event = payments.verify(await c.req.text(), c.req.header('stripe-signature') ?? '');
    } catch {
      return c.text('Invalid Stripe signature', 400);
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const order = store.orders.get(session.metadata?.orderId ?? session.client_reference_id ?? '');
      if (!order) return c.text('Order not found', 404);
      if (session.payment_status !== 'paid') return c.json({ received: true });
      await completePayment(order);
    }
    return c.json({ received: true });
  });
  return app;
}
