# Voilà — Product Requirements Document (PRD)

> 中文版：[PRD.zh.md](PRD.zh.md)

| Item | Value |
| - | - |
| Product | Voilà (voice assistant app for blind and low-vision users) |
| Version | v0.2 (hackathon MVP), replaces v0.1 "Voilà Button" (B2B merchant widget) |
| Date | 2026-11-07 |
| Status | Draft |
| Main demo | RER B down, blind traveller with a guide dog stuck at Gare du Nord, 3 h before a flight from CDG 2E |

---

## 1. Overview

**One line: when the city breaks down, a blind traveller says one sentence and Voilà gets them a car to the airport. The traveller pays on their own phone.**

Voilà is a mobile voice assistant. The user speaks in a noisy place. Voilà checks what is going on, works out which options are still feasible and reads them aloud. It then sends H Company's computer-use agent to book the chosen option on a **third-party website that was never designed for them**. The agent stops at payment and hands the merchant's payment page to the user's phone, so the user pays with Apple Pay. Card details never reach Voilà or the agent.

What changed from v0.1: the product used to be a button that merchants embed on their own site (B2B, merchant-provided site description). It is now the **user's own app**, acting on sites that have not integrated anything. See [Appendix B](#appendix-b-changes-from-v01).

## 2. Hero Scenario: RER B Is Down

The RER B is the only rail trunk line from central Paris to CDG airport, and it regularly stops along its whole length with little warning.

**Setting.** Karim is blind and travels with his guide dog. He is at Gare du Nord and his flight to New York leaves CDG terminal 2E in 3 hours. Station alarms and announcements are going off. He doesn't know why no train is coming, and Uber shows no available cars.

| # | What happens | Tech |
| - | - | - |
| 1 | **Voice.** Karim holds the button and says in a rush: "RER B has stopped! My flight to New York is in 3 hours, I can't get an Uber. Book me a car that can leave now, takes my guide dog, to CDG 2E!" | Gladia real-time STT on noisy audio + on-device noise suppression |
| 2 | **Understand.** Voilà extracts a structured trip request: from Gare du Nord (GPS), to CDG 2E, flight departure (asks the time if unknown), 1 adult plus guide dog, luggage. Uber has already been ruled out by the user. | LLM + user profile |
| 3 | **Research.** The screen shows a data stream: "RER B: traffic interrupted (source)… Feasible options: station taxi rank, G7 booking, Paris Airport Shuttle…". Voilà reads the top 2–3 options with pickup time, price and whether a guide dog is OK. | IDFM PRIM real-time traffic API, Linkup search (with sources), feasibility filter |
| 4 | **Decide.** Karim: "The shuttle." | Voice choice |
| 5 | **Act.** H's cloud agent opens `paris-airport-shuttle.com/fr/reservation/`, a hostile booking form for screen readers (see [Appendix A](#appendix-a-real-site-observations)). It fills route, date and time, vehicle and passenger details, and adds a guide-dog note. Each step is narrated. | H Agents API (cloud browser), progress → TTS |
| 6 | **Confirm.** Before submitting the booking, Voilà reads back pickup time, address, price and the guide-dog note. Karim: "Oui." | `confirm_with_user` |
| 7 | **Hand off payment.** The agent reaches the merchant's card-payment page and stops. The app opens that page on Karim's phone and says: "Your car is held. Please pay 65 euros with Apple Pay now." Karim double-clicks the side button and confirms with Face ID. | `handoff_payment` custom tool → merchant's Stripe Checkout in an in-app browser |
| 8 | **Follow-up.** Voilà reads the booking card: pickup point, time, booking reference and operator phone number, with a one-tap call button. If the guide-dog acceptance is not confirmed yet, Voilà says so honestly and keeps trying (email/call). | Structured result |

**Time budget.** International check-in usually closes about 60 min before departure (airline-specific). Gare du Nord → CDG by road takes 40–60+ min, and longer when the RER B is down. **Voilà therefore has roughly 10 minutes** to get Karim to a confirmed, paid booking.

## 3. Background & Problem

- Blind and low-vision people already struggle with booking and payment sites: a screen reader means listening through hundreds of elements, and many small travel and transport sites use custom widgets with no labels.
- Disruptions turn this into an emergency: no time, noisy environment, no one to ask, high cost of failure (missed flight).
- The sites that matter in an emergency (local shuttles, taxi companies, small operators) are the least likely to be accessible or to integrate anything. A merchant-side widget (v0.1) can't help here. The help has to come from the **user's side**.
- Computer-use agents can operate any website just by looking at it. H's Agents API offers this as an observable, interruptible cloud service.

## 4. Positioning

- **"Your assistant, on any website."** Voilà acts for the user, at the user's explicit request, on public booking flows, like a sighted friend holding the phone.
- **We say "accessibility", not "compliance".** Voilà doesn't change any website and doesn't make anyone compliant. Never claim otherwise.
- **The user stays in control:** every booking is confirmed by voice, and **the user pays themselves**. Voilà never holds card data.
- **Honest under pressure:** Voilà says what is confirmed and what is not ("guide dog not yet confirmed by the operator"), and never promises the user will make the flight.

## 5. Goals & Non-Goals

### 5.1 Goals

1. From one spoken request in a noisy place to a confirmed booking and a payment prompt on the phone in **≤ 5 min** (target), and always within the time budget.
2. Before acting, check the situation in real time (disruption, alternatives) and offer only options that can still meet the deadline.
3. Complete a real-world, inaccessible third-party booking flow without the user seeing the screen.
4. **Zero card data** in Voilà or the agent: payment happens on the user's phone through the merchant's own payment page (Apple Pay where available).
5. Every irreversible step (submitting a booking) needs spoken confirmation.
6. Account for the guide dog: say it when booking and report honestly whether the operator has accepted it.

### 5.2 Non-Goals

- Fixing third-party sites or issuing compliance claims.
- Being the merchant of record or holding funds (no wallet, no virtual cards in the MVP).
- Guaranteeing arrival or availability.
- Solving CAPTCHAs; if blocked, Voilà switches option instead.
- Placing real bookings during the hackathon demo (a mock site is used, see §11).

## 6. Users & Customers

| Role | Description | Pays? |
| - | - | - |
| End user | Blind/low-vision travellers (primary); also elderly, motor-impaired, non-French speakers | Hypothesis: free core, see §13 |
| Caregiver / family | Receives a summary or shared booking card, can be called in | No |
| Partner (B2B2C, hypothesis) | Transport operators, airports, airlines, travel insurers, disability associations who want to offer assistance during disruptions | To validate |

### Persona

- **Karim, 34, blind, guide-dog user**: travels for work, fluent with VoiceOver, but gives up on most small booking sites. He doesn't want to give his card to an unknown app.

## 7. User Stories

| ID | As a… | I want to… | So that… |
| - | - | - | - |
| US-1 | Blind traveller | say what I need in one rushed sentence in a noisy station | I don't have to navigate any app or site |
| US-2 | Blind traveller | hear why my train isn't coming, with a source | I can decide quickly and trust the info |
| US-3 | Blind traveller | hear only options that still get me there on time, with price and pickup time | I don't waste minutes on dead ends |
| US-4 | Blind traveller | have my guide dog taken into account | I'm not refused at pickup |
| US-5 | Blind traveller | hear a summary and say "oui" before anything is booked | nothing is booked by mistake |
| US-6 | Blind traveller | pay myself with Apple Pay on my phone | my card details stay with me |
| US-7 | Blind traveller | hear where and when to meet the driver and call them with one tap | I find the car |
| US-8 | Blind traveller | say "stop" or correct it at any time | I stay in control |
| US-9 | Blind traveller | not repeat my name, phone, email and guide-dog info | it's faster |
| US-10 | Caregiver | receive the booking card / replay | I can help or check |

## 8. Product Shape & Architecture

```
Phone app (PWA): big talk button · spoken progress · data stream · payment handoff · booking card
        │ audio stream                                  ▲ payment URL / booking card
        ▼                                               │
                       Voilà backend (orchestrator)
   ┌───────────┬──────────────┬───────────────┬──────────────┬─────────────┐
   ▼           ▼              ▼               ▼              ▼             ▼
 Gladia      IDFM PRIM      Linkup         H Agents API    TTS          User profile
 STT in      real-time      web search     cloud browser               (name, phone,
 noise       traffic        (sourced):     books on the                email, guide dog,
             (RER B)        alternatives   3rd-party site              language)
                                              │ stops at payment
                                              ▼
                              Merchant's own payment page (e.g. Stripe Checkout)
                              opened on the user's phone → Apple Pay
```

### 8.1 Flow

`Listen → Understand → Research → Decide → Act → Confirm → Hand off payment → Follow up`

Every phase is narrated (no more than ~5 s of silence) and shown in the data stream panel, for sighted companions and for the demo.

### 8.2 Payment Handoff: Options Considered

| Option | How | Verdict |
| - | - | - |
| **A. Hand off the merchant's payment URL** | The agent reaches the merchant's hosted payment page (the real site redirects to Stripe). The backend takes the URL and the app opens it in an in-app browser (SFSafariViewController / Custom Tabs, or Safari for a PWA). The user pays with Apple Pay if the merchant has enabled it, otherwise with a card on that page. | **Chosen.** Card data never touches Voilà. Hosted pages such as Stripe Checkout don't depend on the agent's browser cookies. |
| B. Mirror the agent's live view on the phone | Stream the cloud browser to the phone | Rejected: a video stream can't be read by VoiceOver, so it hands the inaccessible page straight back to the blind user. |
| C. Voilà as merchant of record | User pays Voilà via Stripe/Apple Pay; Voilà pays the merchant with a single-use virtual card (e.g. Stripe Issuing) | Later: clean UX, but Voilà handles funds (compliance, refunds, disputes). Not in the MVP. |
| D. Pay the driver | Choose cash or pay-on-board if the merchant offers it | Fallback only; can't be assumed. |

Notes: payment-page links usually expire (merchant-configured). The real site creates the booking **before** payment, so an unpaid booking stays pending and the user must be told.

## 9. Functional Requirements

Priority: P0 = MVP must-have; P1 = MVP should-have; P2 = later.

### 9.1 Phone app

| ID | Requirement | Priority |
| - | - | - |
| FR-1 | Full-screen talk button; fully usable with VoiceOver/TalkBack; haptic feedback for start, stop and done | P0 |
| FR-2 | Audio streamed to Gladia (WebSocket) with `getUserMedia` `noiseSuppression` + `echoCancellation`; live transcript on screen | P0 |
| FR-3 | TTS for progress, options, confirmation prompts and results; no silent gap > ~5 s | P0 |
| FR-4 | Payment handoff screen: opens the payment URL in an in-app browser, announces the amount and merchant, returns to Voilà afterwards | P0 |
| FR-5 | Booking card: pickup point, time, reference, price, operator phone (one-tap call), guide-dog status; read aloud | P0 |
| FR-6 | Data stream panel: research steps with sources, agent progress, optional live view | P1 (P0 for demo) |
| FR-7 | Voice "stop" / corrections at any time | P1 |
| FR-8 | Share booking card with a caregiver (SMS / link) | P2 |

### 9.2 Backend: understand and research

| ID | Requirement | Priority |
| - | - | - |
| FR-10 | Extract a structured trip request `{origin, destination, deadline, passengers, guide_dog, luggage}` from the utterance + GPS + profile; ask only for missing critical facts (e.g. flight time) | P0 |
| FR-11 | Disruption check: IDFM PRIM real-time traffic messages for the line; Linkup for corroboration; read the cause with its source | P0 |
| FR-12 | Option research: candidate list (station taxi rank, G7 booking, airport shuttle sites, replacement buses) from a curated list + Linkup | P0 |
| FR-13 | Feasibility filter: pickup ETA + travel time + buffer ≤ deadline; guide dog accepted or acceptable; drop infeasible options and explain why | P0 |
| FR-14 | Read the top 2–3 options; choose by voice ("the first one", "the shuttle") | P0 |

### 9.3 Backend: act and pay

| ID | Requirement | Priority |
| - | - | - |
| FR-20 | Launch the H agent on the chosen site with task + `instructions`: trip request, user profile, guide-dog note, "never pay; call `handoff_payment` at the payment page" | P0 |
| FR-21 | Stream `changes`, turn `policy_event.content` into short spoken progress | P0 |
| FR-22 | Custom tool `confirm_with_user(summary)` before submitting the booking; summary includes date, time, address, price, guide-dog note | P0 |
| FR-23 | Custom tool `handoff_payment(amount, merchant, summary)`: backend reads the current page URL and pushes it to the phone; the agent then waits | P0 |
| FR-24 | Structured result via `answer_format`: `{ref, pickup_time, pickup_point, price, operator_phone, payment_url, guide_dog_status}` | P0 |
| FR-25 | Guide dog: put it in a comments field if one exists; otherwise send an email or call the operator after booking; report the status honestly | P1 |
| FR-26 | Fallback: bot challenge, CAPTCHA, no availability or time-out → next feasible option; every attempt is time-boxed | P1 |
| FR-27 | Payment status: on the demo site via Stripe webhook; on real sites the agent revisits the confirmation page or the user says "it's paid" | P1 |
| FR-28 | Mid-run intervention: pause, cancel, `send_message` corrections | P1 |
| FR-29 | Audit replay: per-step screenshots and the Agent View link | P2 |
| FR-30 | Multilingual: user's language independent of the site's language | P2 |

### 9.4 Recommended agent configuration

- Model `holo4-27b`, `reasoning_effort: disabled`, `settle_s: 0.3`, visual mode 1280×800 (see §12 baseline).
- Without a merchant-provided site description, keep an internal **site playbook** per known booking site (field order, widget quirks, full option texts). It is written by us, not the merchant.
- `start_url` = the booking form directly; `max_steps: 60`; `max_time_s: 240` (time-boxed, see FR-26).

## 10. Non-Functional Requirements

| Category | Requirement |
| - | - |
| Latency | Voice → options read ≤ 30 s; booking agent run ≤ 3 min; voice → payment prompt ≤ 5 min (target) |
| Robustness | Correct transcript on station-noise recordings (alarms, announcements); demo flow succeeds 3 times in a row |
| Cost | < €0.30 per assisted journey (agent + STT/TTS + search) |
| Security | Never handle card data; agent forbidden from paying; every booking submission confirmed by voice |
| Privacy | Location and voice used only for the current task; configurable screenshot retention (`delete_after_min`); profile stored on device where possible |
| Accessibility | App meets WCAG 2.2 AA and is tested with VoiceOver |
| Concurrency | Free plan: 3 concurrent H sessions per org; make sure none are left running before the demo |

## 11. Demo Design

**Do not submit bookings on the real site** (it would create real orders, and its bot challenge makes runs unpredictable). Instead:

| Element | Demo |
| - | - |
| Booking site | **Mock clone** of the paris-airport-shuttle.com booking flow, keeping its bad UI: unlabeled fields, custom date/time pickers, address autocomplete with hidden coordinates, multi-step flow, auto-redirect to payment after a countdown |
| Payment | Mock site creates a **Stripe Checkout Session in test mode** with Apple Pay enabled. The phone opens the hosted Checkout page and pays with Apple Pay (test). Same architecture as the real site, which also redirects to Stripe. |
| RER B status | Live PRIM if available that day; otherwise a recorded response, labelled as such in the data stream |
| Uber | Not queried: the user says it's unavailable (Linkup can't return live Uber ETAs) |
| Alternatives | Real Linkup search + curated list |
| Noise | Play a recorded Gare du Nord alarm/announcement track during the voice request |
| Stage | Laptop shows the data stream + agent live view; phone mirrored for the Apple Pay moment |

## 12. Success Metrics

**Product (hypotheses to validate)**
- Assisted-journey completion rate (request → paid booking) in disruption situations
- Time from request to payment prompt
- Share of bookings where the guide dog is confirmed before pickup
- User trust: share of users who pay through the handoff rather than abandoning

**MVP / demo acceptance**
- One spoken sentence over station noise → correct trip request.
- Disruption + 2–3 feasible options read aloud with sources in ≤ 30 s.
- Agent completes the mock booking flow, `confirm_with_user` called before submission, `handoff_payment` called at the payment page in **every** run.
- Apple Pay (test) completed on the phone; booking card read aloud.
- Whole flow ≤ 5 min, 3 runs in a row; fits in a 3-minute pitch with cuts.

## 13. Measured Baseline & Real-Site Notes

From the v0.1 experiments on a 12-step mock pharmacy checkout (2026-11-07):

| Configuration | Time | Steps | Cost |
| - | - | - | - |
| holo4-27b, reasoning off, settle 0.3 | 49.7 s | 13 | $0.039 |
| Same + site description + direct `start_url` | **40.1 s** | 11 | **$0.030** |
| Same, local runtime | 26.6 s | 12 | $0.041 |
| holo4-35b-a3b, reasoning off | 55.6 s | 17 | $0.032 (misclicks) |

- `confirm_with_user` was called before payment in 4/4 runs, which supports making `handoff_payment` just as reliable.
- Native `<select>` needs the full option text; the shuttle form has many selects (passengers, bags, transfer type), so put their full option texts in the site playbook.
- The shuttle flow is longer and harder than the pharmacy (autocomplete, pickers). Expect 20–40 steps. **To measure on the mock clone.**

## 14. Business Model (hypotheses)

- **B2B2C (preferred):** partners pay per assisted journey or per seat: transport operators and airports (assistance to travellers with reduced mobility during disruptions), airlines (fewer missed connections), travel insurers, disability associations.
- **B2C:** free for emergencies, optional subscription for everyday tasks.
- Unit cost: a few cents of agent time plus STT/TTS/search, far cheaper than a human assistance call.
- Moat: site playbooks for local operators plus disruption-handling logic.

## 15. Risks & Mitigations

| Risk | Mitigation |
| - | - |
| Third-party site terms / anti-bot (the real site serves a JS challenge on first load) | User-initiated, low-volume actions; fall back to the next option; partnerships long term |
| CAPTCHA blocks the agent | Time-box, switch option or call the operator; never try to defeat it |
| Wrong date/time in custom pickers | Read-back confirmation includes date and time; check the structured result |
| Booking created but not paid | Tell the user; the handoff stays available until the link expires; cancel if abandoned |
| Merchant hasn't enabled Apple Pay | Card form on the merchant's page (still on the user's phone) or pay-on-board if offered |
| Guide dog refused at pickup | Note in the booking + explicit operator confirmation; tell the user the status; remind them of the guide-dog access rules (legal reference to verify) |
| Missed flight despite booking | Never promise; show margins; offer the fastest option first (station taxi rank) |
| Voice misrecognition in noise | Noise suppression + Gladia; confirm critical slots (terminal, time); test on recordings |
| Latency / dead air | Narrate every phase; research while asking for missing slots; direct `start_url` |
| Real orders during demo | Mock site only; Stripe test mode |
| Concurrency quota | Check no running H sessions before demo |

## 16. Milestones (hackathon weekend, 4 people)

| Slot | Deliverable | Acceptance |
| - | - | - |
| Fri evening | Mock shuttle site (bad UI kept) + Stripe Checkout test mode with Apple Pay; H agent books up to the payment page and calls `handoff_payment` | One command returns a payment URL |
| Sat morning | PWA: push-to-talk → Gladia (tested on station noise) → transcript; TTS progress | Noisy sentence → correct trip request |
| Sat afternoon | Research phase (PRIM + Linkup + feasibility filter) → options read aloud → voice choice | Options in ≤ 30 s |
| Sat evening | End-to-end: confirm → handoff → Apple Pay on phone → booking card; fallback path | Full flow ≤ 5 min, 3 runs in a row |
| Sun morning | Data stream panel, replay, guide-dog follow-up, pre-recorded backup video | Stage-ready |
| Sun afternoon | Pitch, rehearsals | Fits in 3 minutes |

## 17. Open Questions

1. Does the real site's Stripe account have Apple Pay enabled? How long is its payment link valid? (Affects the real-world story, not the demo.)
2. Is Apple Pay on Stripe-hosted Checkout available in test mode with no domain verification or Apple developer account on our side? (Expected yes; verify Friday.)
3. PRIM API access (token) and which endpoint gives RER B disruption messages.
4. Gladia accuracy on loud station noise; do we need extra client-side denoising?
5. Can the H agent reliably report the payment page URL, or should the backend read it from session events?
6. Legal reference for guide-dog access in taxis/VTC/shuttles in France (to cite correctly).
7. Who pays (B2B2C partner vs user)?

## Appendix A: Real-Site Observations

`https://paris-airport-shuttle.com/fr/reservation/`, read on 2026-11-07 (HTML only, nothing submitted):

- First request returned a "One moment, please..." JS challenge page that reloads after 5 s. The real page loaded on retry.
- WordPress "Chauffeur Booking System" plugin. Multi-step: route → vehicle → details → payment.
- `<label>` elements aren't associated with inputs; date/time via jQuery pickers; addresses via Google autocomplete writing to hidden coordinate fields; hidden reCAPTCHA token field.
- No field for pets/guide dogs or accessibility; the comment field is hidden.
- Payment: "Pay via PayPal" or "Pay via Credit Card" (redirects to Stripe after a 2-second countdown). The booking is created before payment.

## Appendix B: Changes from v0.1

| v0.1 Voilà Button | v0.2 Voilà |
| - | - |
| Merchant embeds a `<script>` button (B2B) | User's own phone app (B2C / B2B2C) |
| Merchant-provided site description, `start_url`, forbidden areas, amount cap (FR-20–24) | Removed; replaced by internal site playbooks + agent never pays |
| Linkup for quick Q&A | Linkup + PRIM for real-time research and option feasibility |
| Card filled via H vault (`fill_secret_at`) | Removed; `handoff_payment` → user pays on own phone (Apple Pay) |
| 60 s pharmacy checkout demo | RER B disruption demo with time budget, guide dog, mock shuttle site |
| CAPTCHA out of scope | Still not solved, but handled by fallback |

## References

- H docs (Markdown): `https://hub.hcompany.ai/llms.txt`; append `.md` to any page.
- v0.1 experiment code: `voila-demo/` (`run_experiment.py`, `run_local.py`, `localize.py`, `pharmacy/`).
