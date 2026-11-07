# Deploy (Render)

Create a Render Blueprint from this repository using `render.yaml`. It provisions
two free Node 22 web services, `voila` and `voila-shuttle`, both auto-deploying
pushes to `main`. Each builds the monorepo with pnpm; `voila` serves the built
web client and API/WebSockets on the same HTTPS origin (`/health` is its health
check). No separate static-site service or production Vite proxy is needed.

In Render, supply the requested API keys and Stripe **test-mode** secrets. Set
`VOILA_SCENARIO` to `demo` (or `live` for real integrations). After Render assigns
the public URLs, set `SHUTTLE_PUBLIC_URL` on **both** services to the shuttle's
full HTTPS URL, and `SERVER_PUBLIC_URL` on the shuttle to Voilà's full HTTPS URL.
The blueprint generates `INTERNAL_CALLBACK_TOKEN` on Voilà and shares it with
the shuttle for authenticated payment callbacks. Configure Stripe's webhook to
the shuttle's `/stripe/webhook` endpoint and use its signing secret as
`STRIPE_WEBHOOK_SECRET`.

Render supplies `PORT`; `TRUST_PROXY=1` enables forwarded client IP handling on
Voilà. Optional server overrides are `GEMINI_MODEL`, `HAI_MODEL`, and
`WEB_DIST_DIR` (an absolute path or a path relative to the process working
directory). By default the production server resolves `apps/web/dist` relative
to its own compiled file; missing web builds leave API routes available.

Free services sleep when idle, so allow for cold starts. Sessions, reservations,
and payment state are in memory and are lost on sleep/restart/redeploy; this is
a demo deployment, not durable production booking infrastructure.

## Live monitor

Open `/monitor.html?key=<MONITOR_TOKEN>` on a desktop to follow the latest phone
session; add `&session=<id>` to pin the monitor to one session. Without `key`,
the page plays its scripted replay. Render generates `MONITOR_TOKEN` for the
Voilà service.