import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { createPayments } from './payments.js';
import type { PaymentGateway } from './payments.js';
import { confirmationPage, infoPage, paymentPage, routePage, stubPage, vehiclePage } from './pages.js';
import { createStore, newDraft, vehicles, timeOptions, passengerOptions, luggageOptions } from './store.js';
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
  store = createStore(), env = process.env, payments = createPayments(env), fetcher = fetch,
}: { store?: Store; env?: NodeJS.ProcessEnv; payments?: PaymentGateway; fetcher?: typeof fetch } = {}) {
  const app = new Hono();
  const root = fileURLToPath(new URL('../public', import.meta.url));
  app.use('/assets/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/assets/, '') }));
  app.get('/', (c) => c.redirect('/fr/reservation/'));
  app.get('/fr/reservation/', (c) => {
    const draft = newDraft(c.req.query('difficulty') === 'easy' ? 'easy' : 'real');
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
    if (draft.difficulty === 'real' && (!validCoordinate(r.pickup_lat, 90) || !validCoordinate(r.pickup_lng, 180)
      || !validCoordinate(r.dropoff_lat, 90) || !validCoordinate(r.dropoff_lng, 180))) {
      return c.html(routePage(draft, 'Select both addresses from the suggestion dropdown (missing lat/lng).', values), 400);
    }
    if (draft.orderId) return c.text('An order already exists for this draft', 409);
    draft.route = r;
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
    const vehicle = vehicles.find((v) => v.id === body.vehicle);
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
    draft.info = parsed.data;
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
    return order ? c.html(stubPage(order)) : c.text('Order not found', 404);
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
      order.paid = true;
      if (env.SERVER_PUBLIC_URL) {
        try {
          const response = await fetcher(`${env.SERVER_PUBLIC_URL.replace(/\/$/, '')}/internal/payment-completed`, {
            method: 'POST', headers: {
              'Content-Type': 'application/json', Authorization: `Bearer ${env.INTERNAL_CALLBACK_TOKEN ?? ''}`,
            },
            body: JSON.stringify({ order_id: order.id, ref: order.ref, status: 'paid' }),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
          console.error('Payment callback failed', error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }
    return c.json({ received: true });
  });
  return app;
}
