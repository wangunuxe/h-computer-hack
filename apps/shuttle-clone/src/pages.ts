import { html } from 'hono/html';
import { parisToday } from './dates.js';
import { luggageOptions, operatorPhone, passengerOptions, timeOptions, vehicles } from './store.js';
import type { Draft, Order } from './store.js';

export function page(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Paris Airport Shuttle</title>
    <link rel="stylesheet" href="/assets/vendor/jquery-ui.min.css"><link rel="stylesheet" href="/assets/style.css">
    <script defer src="/assets/vendor/jquery.min.js"></script><script defer src="/assets/vendor/jquery-ui.min.js"></script>
    <script defer src="/assets/booking.js"></script></head><body>
    <header><strong>PARIS AIRPORT SHUTTLE</strong><span> Reservations · +33 1 84 80 00 00</span></header>
    <main><p class="banner">DEMONSTRATION SITE — no real transport is booked</p>
    <nav>1. Route → 2. Vehicle → 3. Information → 4. Payment</nav><h1>${title}</h1>${body}</main>
    <footer>Paris Airport Shuttle simulation · Prices in EUR</footer></body></html>`;
}
export function routePage(draft: Draft, error = '', values?: Record<string, string>) {
  const route = values ?? draft.route;
  const address = (name: 'pickup' | 'dropoff', label: string) => html`
    <div class="field address"><label>${label}</label>
    <input name="${name}" id="${name}" class="address-input" autocomplete="off" required value="${route?.[name] ?? ''}">
    <div class="suggestions" data-for="${name}"></div>
    <input type="hidden" name="${name}_lat" value="${route?.[`${name}_lat`] ?? ''}">
    <input type="hidden" name="${name}_lng" value="${route?.[`${name}_lng`] ?? ''}"></div>`;
  return page('Step 1 — Route', html`<p class="error">${error}</p>
    <form method="post" action="/fr/reservation/${draft.id}/route">
    ${address('pickup', 'Pickup address')}${address('dropoff', 'Dropoff address')}
    <div class="field"><label>Pickup date</label>${draft.difficulty === 'easy'
      ? html`<input type="date" name="date" min="${parisToday()}" required value="${route?.date ?? ''}">`
      : html`<input type="text" name="date" id="pickup-date" readonly required value="${route?.date ?? ''}" placeholder="Click calendar to choose">`}</div>
    <div class="field"><label>Pickup time</label><select name="time">${timeOptions.map((time) =>
      html`<option value="${time}" selected=${route?.time === time}>${time}</option>`)}</select></div>
    <button type="submit">Continue to vehicles</button></form>`);
}
export function vehiclePage(draft: Draft, error = '') {
  return page('Step 2 — Vehicle', html`<p class="error">${error}</p>
    <p>${draft.route?.pickup} → ${draft.route?.dropoff}</p>
    <form method="post" action="/fr/reservation/${draft.id}/vehicle">
    <div class="field"><label>Vehicle class</label><select name="vehicle">${vehicles.map((v) =>
      html`<option value="${v.id}" selected=${draft.vehicle?.id === v.id}>${v.text}</option>`)}</select></div>
    <button type="submit">Continue to passenger information</button></form>`);
}
export function infoPage(draft: Draft, error = '', values?: Record<string, string>) {
  const info = values ?? draft.info;
  return page('Step 3 — Passenger information', html`<p class="error">${error}</p>
    <form method="post" action="/fr/reservation/${draft.id}/info">
    <div class="field"><label>Full name</label><input name="name" required value="${info?.name ?? ''}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${info?.email ?? ''}"></div>
    <div class="field"><label>Telephone</label><input name="phone" type="tel" required value="${info?.phone ?? ''}"></div>
    <div class="field"><label>Passengers</label><select name="passengers">${passengerOptions.map((o) =>
      html`<option value="${o.value}" selected=${info?.passengers === o.value}>${o.text}</option>`)}</select></div>
    <div class="field"><label>Luggage</label><select name="luggage">${luggageOptions.map((o) =>
      html`<option value="${o.value}" selected=${info?.luggage === o.value}>${o.text}</option>`)}</select></div>
    <details><summary>Additional information / Notes</summary><label>Notes for the driver</label>
    <textarea name="notes" rows="4">${info?.notes ?? ''}</textarea></details>
    <p>Continuing creates an unpaid order. Review your details before submitting.</p>
    <button type="submit">Create booking and continue to payment</button></form>`);
}
function summary(order: Order) {
  return html`<dl><dt>Order reference</dt><dd>${order.ref}</dd>
    <dt>Pickup point</dt><dd>${order.route.pickup}</dd><dt>Dropoff</dt><dd>${order.route.dropoff}</dd>
    <dt>Pickup time</dt><dd>${order.route.date} ${order.route.time} (Paris local time)</dd>
    <dt>Vehicle</dt><dd>${order.vehicle.text}</dd><dt>Price</dt><dd>${order.vehicle.price.toFixed(2)} EUR</dd>
    <dt>Passenger</dt><dd>${order.info.name} · ${order.info.email} · ${order.info.phone}</dd>
    <dt>Passengers / luggage</dt><dd>${order.info.passengers} / ${order.info.luggage}</dd>
    <dt>Operator phone</dt><dd>${operatorPhone}</dd><dt>Status</dt><dd>${order.paid ? 'PAID' : 'UNPAID'}</dd>
    <dt>Notes</dt><dd>${order.info.notes || 'None'}</dd></dl>`;
}
export function paymentPage(order: Order, cancelled = false) {
  return page('Step 4 — Payment', html`${summary(order)}
    <p>Your order has already been created. It remains unpaid until payment is confirmed.</p>
    ${cancelled
      ? html`<p class="error">Payment cancelled. Your order remains unpaid. Use the button below to try again.</p>`
      : html`<p>Redirecting to payment in <span id="countdown">2</span> seconds.</p>`}
    <form id="checkout-form" method="post" action="/checkout/${order.id}">
    <button type="submit">Pay via Credit Card</button></form>
    <p><a href="/fr/reservation/confirmation/${order.id}">View booking confirmation</a></p>`);
}
export function confirmationPage(order: Order) {
  return page('Booking confirmation', html`${summary(order)}
    <p>A return from Checkout is not proof of payment; only the verified webhook marks this order paid.</p>`);
}
export function stubPage(order: Order) {
  return page('FAKE PAYMENT — LOCAL STUB', html`<p>No STRIPE_SECRET_KEY is configured. No Stripe session exists and no payment is taken.</p>
    ${summary(order)}<a href="/fr/reservation/confirmation/${order.id}">Return to unpaid confirmation</a>`);
}
