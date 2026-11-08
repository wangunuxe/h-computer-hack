import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { createPayments } from './payments.js';
import { vehicles } from './store.js';
import type { Order } from './store.js';

function fixture() {
  const stripe = new Stripe('sk_test_mock');
  const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
    id: 'cs_new', url: 'https://checkout.stripe.com/new',
  } as Stripe.Response<Stripe.Checkout.Session>);
  const retrieve = vi.spyOn(stripe.checkout.sessions, 'retrieve');
  const order: Order = {
    id: 'order-1', ref: 'PAS-1', vehicle: { ...vehicles[0], price: 65 }, paid: false,
    route: { pickup: 'Paris', dropoff: 'CDG', date: '2030-01-01', time: '12:00',
      pickup_lat: '48', pickup_lng: '2', dropoff_lat: '49', dropoff_lng: '2' },
    info: { name: 'Karim', email: 'karim@example.com', phone: '123', passengers: '1', luggage: '1', notes: '' },
    checkoutSessionId: 'cs_old', checkoutUrl: 'https://checkout.stripe.com/old',
  };
  return { create, retrieve, order, payments: createPayments({}, stripe) };
}

describe('Stripe session lifecycle', () => {
  it('retrieves and reuses only an open session', async () => {
    const { retrieve, create, order, payments } = fixture();
    retrieve.mockResolvedValue({ id: 'cs_old', status: 'open', url: 'https://checkout.stripe.com/open' } as Stripe.Response<Stripe.Checkout.Session>);
    expect(await payments.checkout(order, 'https://shuttle.example')).toBe('https://checkout.stripe.com/open');
    expect(retrieve).toHaveBeenCalledWith('cs_old');
    expect(create).not.toHaveBeenCalled();
  });
  it('replaces an expired session with a distinct idempotency key', async () => {
    const { retrieve, create, order, payments } = fixture();
    retrieve.mockResolvedValue({ id: 'cs_old', status: 'expired', url: null } as Stripe.Response<Stripe.Checkout.Session>);
    expect(await payments.checkout(order, 'https://shuttle.example')).toBe('https://checkout.stripe.com/new');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'payment' }), { idempotencyKey: 'checkout-order-1-cs_old' });
    expect(order.checkoutSessionId).toBe('cs_new');
    retrieve.mockResolvedValue({ id: 'cs_new', status: 'open', url: 'https://checkout.stripe.com/new' } as Stripe.Response<Stripe.Checkout.Session>);
    await payments.checkout(order, 'https://shuttle.example');
    expect(retrieve).toHaveBeenLastCalledWith('cs_new');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a cached URL when retrieval fails', async () => {
    const { retrieve, create, order, payments } = fixture();
    retrieve.mockRejectedValue(new Error('Stripe offline'));
    await expect(payments.checkout(order, 'https://shuttle.example')).rejects.toThrow('Stripe offline');
    expect(create).not.toHaveBeenCalled();
  });
  it('redirects completed sessions to confirmation without creating another session', async () => {
    const { retrieve, create, order, payments } = fixture();
    retrieve.mockResolvedValue({ id: 'cs_old', status: 'complete', url: null } as Stripe.Response<Stripe.Checkout.Session>);
    expect(await payments.checkout(order, 'https://shuttle.example')).toBe('https://shuttle.example/fr/reservation/confirmation/order-1');
    expect(create).not.toHaveBeenCalled();
    expect(order.paid).toBe(false);
  });
  it('never creates or retrieves a session for a paid order', async () => {
    const { retrieve, create, order, payments } = fixture();
    order.paid = true;
    expect(await payments.checkout(order, 'https://shuttle.example')).toBe('https://shuttle.example/fr/reservation/confirmation/order-1');
    expect(create).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(await createPayments({}).checkout(order, 'http://localhost:3001')).toBe('http://localhost:3001/fr/reservation/confirmation/order-1');
  });
  it('does not replace an open session with a missing URL', async () => {
    const { retrieve, create, order, payments } = fixture();
    retrieve.mockResolvedValue({ id: 'cs_old', status: 'open', url: null } as Stripe.Response<Stripe.Checkout.Session>);
    await expect(payments.checkout(order, 'https://shuttle.example')).rejects.toThrow('Open Stripe session has no Checkout URL');
    expect(create).not.toHaveBeenCalled();
  });
  it('does not retrieve Stripe sessions in no-key stub mode', async () => {
    const { order } = fixture();
    expect(await createPayments({}).checkout(order, 'http://localhost:3001')).toBe('http://localhost:3001/stub-payment/order-1?mode=no-stripe-key');
  });
});
