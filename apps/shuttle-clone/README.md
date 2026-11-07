# Shuttle clone (M1)

Start from the workspace root: `pnpm --filter ./apps/shuttle-clone dev`.
Default port: 3001. Open `/fr/reservation/`; append `?difficulty=easy`
when starting a new draft for the escape hatch. Draft ids in URLs retain the mode.

Drafts and orders are in process-local Maps: **all data is lost on restart**.
No real transport is booked. There is no authentication; use only demo data.

Static files are resolved relative to this app, including committed local jQuery
3.7.1 and jQuery UI 1.13.3 copies and the UI theme images/licenses.

Environment:
- `PORT`: default 3001.
- `SHUTTLE_PUBLIC_URL`: canonical public origin for Checkout redirects; otherwise
  `http://localhost:<PORT>` (default 3001). Request headers are never trusted.
- `STRIPE_SECRET_KEY`: Stripe test key. If absent, Checkout redirects to a clearly
  marked local stub that never marks the order paid.
- `STRIPE_WEBHOOK_SECRET`: raw-body signature verification secret. Without it the
  webhook returns 503. Configure Stripe to POST to `/stripe/webhook`.
- `SERVER_PUBLIC_URL`, `INTERNAL_CALLBACK_TOKEN`: optional best-effort callback
  to `/internal/payment-completed`, bearer token, JSON
  `{ order_id, ref, status: "paid" }`. Failures are logged and acknowledged to Stripe.

After the info POST, an unpaid order exists and step 4 counts down two seconds,
then submits `POST /checkout/:orderId`. This returns HTTP 303 to Checkout or the
stub. Successful Stripe sessions are cached per order; Stripe also receives an
idempotency key. Confirmation never trusts its URL to mark an order paid:
only a signed `checkout.session.completed` with `payment_status: paid` does that.
Callbacks may repeat on webhook retries; consumers should deduplicate by order id.

See `../../playbooks/paris-airport-shuttle.md` for exact widget operation.
