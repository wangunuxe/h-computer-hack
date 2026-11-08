import { html } from 'hono/html';
import { parisToday } from './dates.js';
import { luggageOptions, operatorPhone, passengerOptions, timeOptions, vehiclesForDraft } from './store.js';
import type { Draft, Order } from './store.js';

export function page(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Taxi Paris Réservation</title>
    <link rel="stylesheet" href="/assets/vendor/jquery-ui.min.css"><link rel="stylesheet" href="/assets/style.css">
    <script defer src="/assets/vendor/jquery.min.js"></script><script defer src="/assets/vendor/jquery-ui.min.js"></script>
    <script defer src="/assets/booking.js"></script></head><body>
    <header><strong>TAXI PARIS RÉSERVATION</strong><span> Book your taxi · +33 1 84 80 00 00</span></header>
    <main><p class="banner">DEMONSTRATION SITE — no real transport is booked</p>
    <nav>1. Taxi route → 2. Taxi class → 3. Passengers → 4. Payment</nav><h1>${title}</h1>${body}</main>
    <footer>Taxi Paris Réservation simulation · Prices in EUR</footer></body></html>`;
}
export function routePage(draft: Draft, error = '', values?: Record<string, string>) {
  const route = values ?? draft.route;
  const minimumDate = parisToday();
  const address = (name: 'pickup' | 'dropoff', label: string) => html`
    <div class="field address"><label>${label}</label>
    <input name="${name}" id="${name}" class="address-input" autocomplete="off" placeholder="Address, station or landmark" required value="${route?.[name] ?? ''}">
    <div class="suggestions" data-for="${name}"></div>
    <input type="hidden" name="${name}_lat" value="${route?.[`${name}_lat`] ?? ''}">
    <input type="hidden" name="${name}_lng" value="${route?.[`${name}_lng`] ?? ''}"></div>`;
  return page('Step 1 — Taxi route', html`<p>Book a taxi between any addresses, stations or landmarks in Paris and the surrounding area.</p><p class="error">${error}</p>
    <form method="post" action="/fr/reservation/${draft.id}/route">
    ${address('pickup', 'Pickup address')}${address('dropoff', 'Dropoff address')}
    <div class="field"><label>Pickup date</label>${draft.difficulty === 'easy'
      ? html`<input type="date" name="date" min="${minimumDate}" required value="${route?.date ?? ''}">`
      : html`<input type="text" name="date" id="pickup-date" data-min-date="${minimumDate}" readonly required value="${route?.date ?? ''}" placeholder="Click calendar to choose">`}</div>
    <div class="field"><label>Pickup time</label><select name="time">${timeOptions.map((time) =>
      html`<option value="${time}"${(route?.time ?? '00:00') === time ? html` selected` : ''}>${time}</option>`)}</select></div>
    <button type="submit">Choose your taxi</button></form>`);
}
export function vehiclePage(draft: Draft, error = '') {
  return page('Step 2 — Taxi class', html`<p class="error">${error}</p>
    <p>${draft.route?.pickup} → ${draft.route?.dropoff}</p>
    <form method="post" action="/fr/reservation/${draft.id}/vehicle">
    <p>Route fare estimate; the same estimate is charged by this demonstration site. No reservation, waiting or toll extras.</p>
    <div class="field"><label>Taxi class</label><select name="vehicle">${vehiclesForDraft(draft).map((v) =>
      html`<option value="${v.id}"${(draft.vehicle?.id ?? 'sedan') === v.id ? html` selected` : ''}>${v.text}</option>`)}</select></div>
    <button type="submit">Continue to taxi passengers</button></form>`);
}
export function infoPage(draft: Draft, error = '', values?: Record<string, string>) {
  const info = values ?? draft.info;
  return page('Step 3 — Taxi passengers', html`<p class="error">${error}</p>
    <form method="post" action="/fr/reservation/${draft.id}/info">
    <div class="field"><label>Full name</label><input name="name" required value="${info?.name ?? ''}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${info?.email ?? ''}"></div>
    <div class="field"><label>Telephone</label><input name="phone" type="tel" required value="${info?.phone ?? ''}"></div>
    <div class="field"><label>Passengers</label><select name="passengers">${passengerOptions.map((o) =>
      html`<option value="${o.value}"${(info?.passengers ?? '1') === o.value ? html` selected` : ''}>${o.text}</option>`)}</select></div>
    <div class="field"><label>Luggage</label><select name="luggage">${luggageOptions.map((o) =>
      html`<option value="${o.value}"${(info?.luggage ?? '0') === o.value ? html` selected` : ''}>${o.text}</option>`)}</select></div>
    <details><summary>Guide dog / assistance animal and driver notes</summary><label>Notes for the taxi driver</label>
    <p>Add guide dog, assistance animal or other requests below. A note does not confirm operator acceptance; ask the operator to confirm.</p>
    <textarea name="notes" rows="4">${info?.notes ?? ''}</textarea></details>
    <p>Continuing creates an unpaid taxi booking. Review your route, passengers and fare before submitting.</p>
    <button type="submit">Book taxi and continue to payment</button></form>`);
}
function summary(order: Order) {
  return html`<dl><dt>Taxi booking reference</dt><dd>${order.ref}</dd>
    <dt>Pickup point</dt><dd>${order.route.pickup}</dd><dt>Dropoff</dt><dd>${order.route.dropoff}</dd>
    <dt>Pickup time</dt><dd>${order.route.date} ${order.route.time} (Paris local time)</dd>
    <dt>Taxi</dt><dd>${order.vehicle.text}</dd><dt>Price</dt><dd>${order.vehicle.price.toFixed(2)} EUR</dd>
    <dt>Passenger</dt><dd>${order.info.name} · ${order.info.email} · ${order.info.phone}</dd>
    <dt>Passengers / luggage</dt><dd>${order.info.passengers} / ${order.info.luggage}</dd>
    <dt>Operator phone</dt><dd>${operatorPhone}</dd><dt>Status</dt><dd>${order.paid ? 'PAID' : 'UNPAID'}</dd>
    <dt>Notes</dt><dd>${order.info.notes || 'None'}</dd></dl>`;
}
export function paymentPage(order: Order, cancelled = false) {
  if (order.paid) {
    return page('Step 4 — Taxi payment', html`${summary(order)}
      <p>Payment already received. No further payment is required.</p>
      <p><a href="/fr/reservation/confirmation/${order.id}">View taxi booking confirmation</a></p>`);
  }
  return page('Step 4 — Taxi payment', html`<p>Merchant: Taxi Paris Réservation</p>${summary(order)}
    <p>Your order has already been created. It remains unpaid until payment is confirmed.</p>
    ${cancelled
      ? html`<p class="error">Payment cancelled. Your order remains unpaid. Use the button below to try again.</p>`
      : html`<p>Redirecting to payment in <span id="countdown">2</span> seconds.</p>`}
    <form id="checkout-form" method="post" action="/checkout/${order.id}">
    <button type="submit">Pay for taxi by card</button></form>
    <p><a href="/fr/reservation/confirmation/${order.id}">View taxi booking confirmation</a></p>`);
}
export function confirmationPage(order: Order) {
  return page('Taxi booking confirmation', html`${summary(order)}
    <p>A return from Checkout is not proof of payment; only the verified webhook marks this order paid.</p>`);
}
export function stubPage(order: Order, error = '') {
  return page('FAKE PAYMENT — LOCAL STUB', html`<p>No STRIPE_SECRET_KEY is configured. No Stripe session exists and no payment is taken.</p>
    ${error ? html`<p role="alert">${error}</p>` : ''}
    ${summary(order)}<form method="post" action="/stub-payment/${order.id}"><button style="min-height:64px" type="submit">Simulate payment — no charge</button></form>
    <p>Return to Voilà after confirming. If it is still waiting, say “I've paid” or “j'ai payé”.</p>`);
}
