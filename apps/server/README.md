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
