# H shuttle booking runner (M2)

From the workspace root:

```sh
export HAI_API_KEY=... # keep this in your environment, never commit it
export SHUTTLE_PUBLIC_URL=https://your-existing-public-shuttle-host.example
pnpm booking          # prompts for approval before order creation
pnpm booking --yes    # automatically approves the sample booking
```

The shuttle must already be reachable from H's cloud browser. Missing or localhost
URLs are rejected. The CLI creates a draft, then starts H directly on its route page.
Append `?difficulty=easy` to the public URL for the clone's easier controls.
The sample is Karim, Gare du Nord → CDG 2E, one passenger, one bag, a guide dog,
and a flight deadline four hours from now. Ctrl-C cancels the H session.
Progress, payment URL, final booking, metrics (duration in milliseconds, cost in USD
when reported), and Agent View URL are printed. Pay only on your own device.

`HAI_MODEL` optionally overrides `holo4-27b`. The SDK uses its default EU region.
The clone's `SHUTTLE_PUBLIC_URL` must also be configured correctly in the clone's
environment so its Stripe/stub redirect is publicly reachable. No Stripe key is
needed for the local stub path. No H key is needed for the mocked unit tests.

Import `runBooking` from `src/booking.ts` for orchestration; pass shared Trip/Profile,
a direct draft route URL, progress/confirmation/payment callbacks, and optionally an
AbortSignal. The result contains a shared Booking, metrics, and optional Agent View
URL. Completed or idle sessions with an answer are accepted; answers fall back from
the completion result to final changes to a fresh session envelope's latest answer.
Rejection/no handoff/failed completion throws; sessions are cancelled on success,
errors or abort. Confirmation rules are agent instructions, not a server-side transaction
gate: a live H run is still required to verify real browser compliance.

SDK checked: `hai-agents` 1.3.2. Public properties use camelCase, including
`agentViewUrl` (wire `agent_view_url`), `answerFormat` (wire `answer_format`),
`maxSteps`, `maxTimeS`, `startUrl`, `settleS`, and `reasoningEffort`.
We use `answerSchema`, never an answer-format override. Tools take JSON Schema
objects (not Zod schemas); the final answer takes a Zod v4 schema.
Session quota is `available`/`active`/`limit`. MetricsUpdateEvent provides
`data.metrics.steps` and `totalCost`; final changes can also contain metrics.
`SessionHandle.get()` supplies `agentViewUrl`; it is not a handle property.
The event union includes a generic trajectory envelope with `data: unknown`, so
the runner validates event payloads before using them rather than assuming that
checking `type` alone narrows every payload.

Real cloud/browser runs remain pending until HAI_API_KEY is available.

## M4 planning modules (no state machine yet)

`feasibility.ts` compares actual instants (including deadline UTC offsets), with a
15-minute default buffer before the check-in cutoff. Guide-dog refusals take
precedence over late-arrival rejection when both apply. Accepted options sort
before unknown options, then by arrival. Refused options remain usable without a
guide dog and sort last. `choose.ts` conservatively returns null on multiple
matching options, including “taxi” when both the taxi rank and G7 are offered.

`options.ts` exports `presetOptions`, `bookingMethods` and `mergeOptions`. Times
and prices are illustrative estimates, not live availability or quotations. The
replacement bus must be confirmed with station staff. Taxi guide-dog acceptance
reflects the legal requirement, not a reservation confirmation from a driver.

`adapters/prim.ts` accepts an explicit API key and injectable fetch; it never needs
a key for recorded mode. The configured URL is
`https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=STIF:Line::C01743:`
with an `apikey` header. Attempts to read PRIM's public general-message page and
FAQ returned HTTP 403. The endpoint, line identifier, header, and SIRI-Lite response
shape therefore remain assumptions to verify with official API access; tests
verify our request contract against a fake only.

On missing keys, network/HTTP/parse errors, empty messages, timeout or caller abort,
the adapter loads `scripts/fixtures/prim-rer-b.json` and sets `recorded: true`.
That fixture is explicitly synthetic demo data, not an actual captured service
response. Keep this file available alongside the repo when running built code.
`narrate.ts` exports typed `say(key, params, language)` templates; option arrival
times are spoken in Europe/Paris, prices in EUR, and recorded disruptions are
explicitly labelled. Unsupported languages fall back to English.
