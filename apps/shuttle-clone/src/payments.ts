import Stripe from 'stripe';
import type { Order } from './store.js';

export interface PaymentGateway {
  checkout(order: Order, baseUrl: string): Promise<string>;
  verify(rawBody: string, signature: string): Stripe.Event;
}
export function createPayments(env: NodeJS.ProcessEnv = process.env, client?: Stripe): PaymentGateway {
  const stripe = client ?? (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : undefined);
  return {
    async checkout(order, baseUrl) {
      if (!stripe) return `${baseUrl}/stub-payment/${order.id}?mode=no-stripe-key`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur', unit_amount: order.vehicle.price * 100,
            product_data: { name: `Paris Airport Shuttle — ${order.vehicle.text}` },
          },
          quantity: 1,
        }],
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        success_url: `${baseUrl}/fr/reservation/confirmation/${order.id}`,
        cancel_url: `${baseUrl}/fr/reservation/payment/${order.id}?cancelled=1`,
      }, { idempotencyKey: `checkout-${order.id}` });
      if (!session.url) throw new Error('Stripe did not return a Checkout URL');
      return session.url;
    },
    verify(rawBody, signature) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
      // Signature verification does not require a live API request.
      return new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_webhook_verification')
        .webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    },
  };
}
