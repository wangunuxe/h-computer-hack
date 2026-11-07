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

## M4 real understanding and search adapters

`understand({ transcript, profile, now, previous? }, client?)` uses the official
`@google/genai` SDK and `GEMINI_API_KEY`. `previous` is the earlier `result.trip`.
It returns `{ trip, missing, notes? }`; passengers default to 1, luggage to 0 and
guide-dog status to the profile. Only unknown origin, destination and deadline
require clarification. An unspecified “airport” is not silently turned into CDG.
Flight departure is extracted separately; code subtracts 60 elapsed minutes to
derive check-in cutoff and labels that assumption in `notes`. Times are serialized
with Europe/Paris's seasonal offset. The profile's contact details are not sent
to Gemini. Timeout (8 seconds), invalid output and provider errors have typed
`UnderstandError.code` values. Inject `UnderstandingClient` for offline tests.

The default model `gemini-3.6-flash` was verified against the authenticated model
list. `GEMINI_MODEL` can override it, but must select Gemini 3.x or newer.
SDK 3.0.0 uses `config.thinkingConfig.thinkingLevel: ThinkingLevel.MINIMAL`
(the enum serializes as uppercase `MINIMAL`), `responseMimeType`,
`responseJsonSchema`, and `abortSignal`. Real smoke requests accepted this config.

`searchDisruptionAndAlternatives({ query, context?, signal?, ... })` uses
`LINKUP_API_KEY` and accepts injectable `fetch`, `apiKey`, and `timeoutMs`
(default 8 seconds). The documented contract is POST
`https://api.linkup.so/v1/search`, Bearer authentication, and JSON
`{ q, depth: 'fast', outputType: 'searchResults', maxResults: 5 }`.
Text results provide `name`, `url`, `content`; image results are ignored.
Reference: https://docs.linkup.so/pages/documentation/endpoints/search/reference.md

Corroboration preserves sources but is evidence to evaluate, not a claim that a
disruption is confirmed today. The real smoke returned general travel articles,
not a dated official disruption confirmation. Only clear matches on the known
operator/station domains become extra options; their timing/fare values remain
catalogue estimates, not extracted live quotes or availability. HTTP, parse,
timeout and abort errors throw so orchestration can choose its fallback.

Run one smoke batch (three utterances) and one search, with keys in the environment:

```sh
pnpm exec tsx apps/server/src/smoke-adapters.ts gemini
pnpm exec tsx apps/server/src/smoke-adapters.ts linkup
```

The search smoke uses a 15-second timeout, prints only the first three snippets
(400 characters each), and includes the Paris date in its query. No state machine,
HTTP routes, or live H browser sessions are added by these adapters.

## M4 session orchestration

`VoilaSession(emit, ports?)` accepts validated web events through `handle`, emits
shared server events, and exposes `stage`, `attach(emit)`, `markPaid(ref)` and
`dispose()`. All service ports, the clock, timers and logger can be replaced in
tests. Research begins with the first transcript, alongside understanding, and
continues during clarification; presentation waits for a complete trip. GPS is
used as a coordinate origin when no spoken origin is available. PRIM and Linkup
have independent deadlines; failures retain preset options rather than blocking
the trip. PRIM recorded-mode feed entries explicitly say “recorded data”.

`stop` aborts research and the H runner, resolves pending confirmation negatively,
and invalidates callbacks from older operations. Heartbeats run after four silent
seconds in UNDERSTAND, RESEARCH and EXECUTE. Agent progress remains in the feed;
its spoken updates are throttled to eight seconds. Confirmation replies accept
French/English yes/no phrases; unclear replies do not approve a booking.

Run `pnpm --filter @voila/server dev` (PORT defaults to 3000). `/ws/session/:id`
creates an in-memory session. Reconnecting to the same id replaces its active
socket and replays the current stage without restarting work. Send `hello` once
with the shared profile/GPS shape; subsequent messages use `WebEventSchema`.
Sessions are retained until process shutdown, with no persistence or expiry yet.
Embedding code can use `createSessionServer({ port: 0, ports })` and `close()`.

Set `SHUTTLE_PUBLIC_URL` to a public clone URL for H bookings (private/local URLs
are rejected). A bare origin starts at `/fr/reservation/`, letting the clone
initialize the browser's draft; a configured route URL is preserved. Set
`HAI_API_KEY` for H, optional `PRIM_API_KEY` for live traffic, and the Gemini/Linkup
keys described above. Tests inject fakes and never start H sessions.

`POST /internal/payment-completed` matches the clone's callback:
`Authorization: Bearer <INTERNAL_CALLBACK_TOKEN>` and JSON
`{ "order_id": "clone-order-id", "ref": "PAS-...", "status": "paid" }`.
Configure the same nonempty token on both servers; missing/bad tokens get 401.
Authorization compares fixed-length SHA-256 digests with `timingSafeEqual`.
The booking reference routes the receipt to an awaiting session; duplicate
receipts are idempotent. Unknown references return 404, malformed payloads 400.
The demo `paid` web event also finishes the awaiting booking; it is not independent
proof of a Stripe payment. On disconnect, work continues for reconnection.
