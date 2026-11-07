# Voilà Button — Product Requirements Document (PRD)

> 中文版：[PRD.zh.md](PRD.zh.md)

| Item | Value |
| - | - |
| Product | Voilà Button |
| Version | v0.1 (hackathon MVP) |
| Date | 2026-11-07 |
| Status | Draft |
| Source | "Voilà Button — Plan & Demo Design" |

---

## 1. Overview

**One line: add one line of code to any website, and users can get things done just by speaking.**

Voilà Button is a voice button embedded in a merchant's website. The user holds the button and says what they need; the backend calls H Company's computer-use agent, which clicks, fills in and pays on that website on the user's behalf. Before any irreversible action (payment), the agent reads back a summary and waits for the user's spoken confirmation.

## 2. Background & Problem

- Blind/low-vision, elderly and motor-impaired users, and people who don't speak the site's language, struggle to place orders, book appointments or pay bills online: a screen reader means listening through hundreds of elements, and a foreign-language user simply can't read the form.
- The European Accessibility Act (EAA, in force since June 2025) has pushed e-commerce, banking, transport and pharmacy buyers to budget for accessibility and look for vendors.
- The EAA covers millions of sites; remediation will take years, but users need to complete tasks today.
- Computer-use agents can, for the first time, operate any website just by looking at the screen; H's Agents API exposes this as a pay-per-call, observable cloud service that can be interrupted mid-run.

## 3. Positioning

**We say "accessibility", not "compliance".**

- Voilà provides an **alternative completion path**: users who can't use a keyboard, can't see the screen, or don't speak French can still finish the task.
- Voilà **does not change the website**: missing alt text, keyboard-unreachable buttons and unlabeled form fields remain; WCAG / EN 301 549 audit results do not change.
- Never claim "install it and you're compliant" (overlay vendors such as accessiBe have been sued for this). This is a hard line for product and marketing.
- We sell on **outcome metrics**: task completion rate for disabled/elderly/foreign-language users, cart abandonment, support call volume.
- Standard messaging: "Voilà lets every user complete their task; it complements accessibility remediation, it does not replace it."

## 4. Goals & Non-Goals

### 4.1 Goals

1. A user can complete a full transaction (including payment) on a merchant site by voice only, without looking at the screen or installing anything.
2. Minimal merchant integration: one `<script>` tag plus a natural-language site description.
3. 100% of irreversible actions (payment) require spoken user confirmation.
4. Full transparency: live spoken progress, live view, and after-the-fact replay.
5. The user's language is decoupled from the site's language.

### 4.2 Non-Goals

- Fixing the site's own accessibility defects or issuing compliance certificates.
- Replacing screen readers or other assistive technologies.
- In the MVP: solving CAPTCHAs; real payments (Stripe test mode only).
- In the MVP: Mode C (in-page native execution) beyond a PoC.

## 5. Users & Customers

| Role | Description | Pays? |
| - | - | - |
| Merchant (buyer) | EAA-affected sites: e-commerce, pharmacy, banking, transport | Yes: monthly subscription + per-task fee |
| End user | Blind/low-vision, elderly, motor-impaired, or non-native-language users | No; installs nothing |
| Caregiver / family | Reviews what was done on the user's behalf | No |

### Personas

- **Marie, 72, low vision**: wants to order her usual medicine for in-store pickup; can't read small text or forms.
- **Ahmed, foreign-language user**: speaks only Arabic, the site is in French; wants to order in his own language.
- **Luc, motor impairment**: can't use a mouse or keyboard precisely.

## 6. User Stories

| ID | As a… | I want to… | So that… |
| - | - | - | - |
| US-1 | End user | hold the button and say what I need | I can order without looking at the screen |
| US-2 | End user | ask a simple question (e.g. opening hours) and hear a sourced answer quickly | I don't wait for a browser session |
| US-3 | End user | hear what is happening at each step | I know the progress and feel in control while waiting |
| US-4 | End user | hear an order summary and confirm verbally before payment | I'm never charged by mistake |
| US-5 | End user | say "stop" or correct it at any time ("not delivery, in-store pickup") | I stay in control |
| US-6 | End user | speak and hear progress in my own language | the site's language doesn't limit me |
| US-7 | End user | not repeat my name, phone and address every time | I finish faster |
| US-8 | Caregiver | replay per-step screenshots afterwards | I can verify what was done |
| US-9 | Merchant | integrate with one line of code and a text description | I don't change my site's code |
| US-10 | Merchant | define areas the agent must never touch | account deletion etc. can't happen by accident |

## 7. Product Shape & Architecture

```
Merchant page ──<script src="voila.js">──► Voilà button (mic + spoken progress + live view)
                                                 │  audio stream
                                                 ▼
                                      Voilà backend (Node/Python)
            ┌──────────────┬──────────────┼──────────────┬──────────────┐
            ▼              ▼              ▼              ▼              ▼
         Gladia         Linkup        H Agents API    Stripe        User profile
       real-time STT    quick Q&A     cloud browser   Payment/      (name, address,
       + language ID    (sourced)     runs the task   Checkout      usual items)
```

### 7.1 Run Modes

| Mode | Implementation | Measured (12-step checkout) | Priority |
| - | - | - | - |
| A. Cloud browser | `host: cloud`; `LiveViewUrlEvent` embeds the live view in the button | 8–9 s startup, ~3 s/step, 40–59 s total, $0.03–0.04 | **P0 main mode** |
| B. User's own browser | `Client.local()` + `host: user_device` (HoloTab extension or desktop runtime) | 3 s startup, ~2 s/step, 27 s total | P1 (logged-in scenarios; demo hot standby) |
| C. In-page native | Button takes a screenshot → Models API `element-localization` returns coordinates → JS dispatches the click | 0.15–0.4 s per localization, 6/6 hits | P2 (v2; PoC only this weekend) |

## 8. Functional Requirements

Priority: P0 = MVP must-have; P1 = MVP should-have; P2 = later.

### 8.1 Button front end (voila.js)

| ID | Requirement | Priority |
| - | - | - |
| FR-1 | Injected via a single `<script>` tag; shows a large round button in the bottom-right corner | P0 |
| FR-2 | Push-to-talk; audio streamed to the backend (Gladia WebSocket); live transcript shown on the button | P0 |
| FR-3 | TTS playback of progress, confirmation prompts and final result | P0 |
| FR-4 | Embedded live view of the agent (`live_view_url` iframe); falls back to the Agent View link if the event is unavailable | P1 |
| FR-5 | Listens for "stop"-type commands and triggers pause/cancel | P1 |
| FR-6 | The button itself is keyboard-reachable and screen-reader friendly | P0 |

### 8.2 Backend orchestration

| ID | Requirement | Priority |
| - | - | - |
| FR-10 | Intent routing: read-only questions go to Linkup (with sources); tasks go to the H Agents API | P0 |
| FR-11 | Merge the user profile (name, phone, address, usual items) and site description into the task text / `instructions` | P0 |
| FR-12 | Stream `changes`, extract `policy_event.content` and send it to TTS | P0 |
| FR-13 | Custom tool `confirm_with_user(summary)`: speaks the agent-generated summary via TTS, recognizes "oui/non/yes/no" via Gladia, returns the answer to the agent | P0 |
| FR-14 | Mid-run intervention: `POST /sessions/{id}/pause`, `DELETE` (cancel), `send_message` (correction) | P1 |
| FR-15 | Structured result via `answer_format` JSON schema `{ref, total, items}` for read-out and receipt SMS | P1 |
| FR-16 | Card details filled via H vault + `fill_secret_at`; card number never enters the model context | P1 |
| FR-17 | Multilingual: Gladia detects the language; task and read-out use the user's language regardless of the site's | P1 |
| FR-18 | Audit replay: store per-step `observation_event.image` screenshots and the Agent View link | P1 |

### 8.3 Merchant integration

| ID | Requirement | Priority |
| - | - | - |
| FR-20 | One-line `<script>` integration | P0 |
| FR-21 | Site description (Site Skill): natural-language description of key pages, controls and full dropdown option texts | P0 |
| FR-22 | Configurable `start_url` (e.g. land directly on the catalogue) | P0 |
| FR-23 | Configurable skippable steps (e.g. logged-in state) and forbidden areas (e.g. account deletion, password change) | P1 |
| FR-24 | Payment amount cap; above it the task is refused or needs extra confirmation | P1 |

### 8.4 Recommended agent configuration

- Model `holo4-27b`, `reasoning_effort: disabled`, `settle_s: 0.3`, visual mode 1280×800.
- Provide a site description + `start_url` pointing at the catalogue (measured: 13 → 11 steps, 50 s → 40 s).
- Use `holo4-35b-a3b` only for read-only Q&A tasks (measured: it clicks around on homepage cards; cheaper but not faster).
- `max_steps: 40`, `max_time_s: 300`.

## 9. Non-Functional Requirements

| Category | Requirement |
| - | - |
| Latency | Typical checkout end-to-end ≤ 60 s (target 30–40 s); Q&A ≤ 5 s; every step narrated, no dead air |
| Cost | ≈ $0.03–0.04 agent cost per checkout; < €0.10 per task including STT/TTS |
| Reliability | Demo scenario 2 succeeds 3 times in a row in ≤ 60 s |
| Security | Mandatory confirmation for irreversible actions; card data via vault; merchant-defined forbidden areas |
| Privacy | Configurable screenshot retention (`delete_after_min`); in Modes B/C screenshots never leave the user's machine |
| Accessibility | The button itself meets WCAG 2.2 AA |
| Concurrency | Free plan: 3 concurrent sessions per org; production needs Builder (10) or higher |

## 10. Success Metrics

**Product metrics (for merchants)**
- Task completion rate for target user groups
- Reduction in cart abandonment
- Reduction in support call volume
- Cost and duration per task

**MVP / demo acceptance**
- Scenario 1 (Q&A): spoken question → sourced answer read aloud.
- Scenario 2 (order + payment): ≤ 60 s, confirmation called before payment, Stripe receipt delivered.
- Scenario 3 (multilingual): a Chinese/Arabic instruction completed on the French site, progress read in the user's language.

## 11. Measured Baseline (2026-11-07, mock pharmacy site)

Task: 2 boxes of Doliprane, in-store pickup, fill form, confirm, pay.

| Configuration | Time | Observed steps | Cost | Notes |
| - | - | - | - | - |
| holo4-27b default (reasoning on) | 58.8 s | 13 | $0.038 | One misclick on homepage |
| holo4-35b-a3b, reasoning off, settle 0.3 | 55.6 s | 17 | $0.032 | Clicked homepage cards 4 times |
| holo4-27b, reasoning off, settle 0.3 | 49.7 s | 13 | $0.039 | |
| Above + site description + start_url=catalogue | **40.1 s** | 11 | **$0.030** | Recommended |
| Same, local runtime | **26.6 s** | 12 | $0.041 | 3 s vs 9 s startup |
| Models API single element localization | 0.15–0.4 s | — | ~$0.0003 | 1280×800 screenshot ≈ 1,130 tokens |

- `confirm_with_user`: the agent called it before clicking pay in 4/4 runs.
- Known issue: native `<select>` with `select_option` requires the **full option text** ("Retrait en pharmacie (gratuit)", not "Retrait en pharmacie"); document full option texts in the site description.

## 12. Business Model

- B2B: monthly subscription + per-task fee (suggested €0.2–0.5 per task).
- Unit cost: 3–4 US cents agent + a few cents STT/TTS, an order of magnitude cheaper than a support call.
- Moat: per-merchant site descriptions (Site Skills) accumulated over time.

## 13. Risks & Mitigations

| Risk | Mitigation |
| - | - |
| Seen as an overlay "compliance" scam | State clearly that it doesn't replace remediation; talk only about task completion; show audit replay |
| Agent pays by mistake | Mandatory `confirm_with_user`; amount cap; Stripe test mode only in MVP |
| Latency causes dead air in voice UX | Spoken progress; site description to cut steps; `settle_s=0.3`; direct `start_url` |
| Real sites have CAPTCHA / login | Demo on own site; real sites use vault / browser profile for login |
| Privacy of uploaded screenshots | Local processing in Modes B/C; contractual retention period (`delete_after_min`) |
| Smaller model is cheaper but misclicks | Always use holo4-27b for tasks |
| Insufficient concurrency quota | Check no other sessions are running before demo, or upgrade to Builder |
| `LiveViewUrlEvent` not emitted | Fall back to the Agent View page |

## 14. Milestones (hackathon weekend, 4 people)

| Slot | Deliverable | Acceptance |
| - | - | - |
| Fri evening | Mock pharmacy site + Stripe Checkout test mode; H cloud run + confirm tool; verify `LiveViewUrlEvent` | One command runs a full checkout |
| Sat morning | Button front end: push-to-talk → Gladia → text; TTS progress | Speaking a sentence shows a transcript |
| Sat afternoon | Backend wiring: intent routing; `changes` → TTS; `confirm_with_user` over voice | Scenario 2 end-to-end |
| Sat evening | User profile, site description, Stripe vault, structured receipt SMS | Scenario 2 ≤ 60 s, 3 runs in a row |
| Sun morning | Multilingual scenario, Agent View replay page, pre-recorded backup video | All three scenarios back-to-back |
| Sun afternoon | Pitch, rehearsals, concurrency stress test | Fits in 3 minutes |

## 15. Open Questions

1. Is `LiveViewUrlEvent` reliably emitted in cloud mode? (verify Friday evening)
2. How do H vault + `fill_secret_at` work with Stripe Checkout? (untested)
3. How to detect a "stop" wake word while TTS is playing (echo cancellation / half-duplex)?
4. Where is the user profile stored and how is it authorized (merchant side vs Voilà side)?
5. Pricing details: per-task tiers and monthly caps.

## Appendix: References

- H docs (Markdown): `https://hub.hcompany.ai/llms.txt`; append `.md` to any page.
- Verified call example and experiment code: Appendix A of the plan document and `voila-demo/` (`run_experiment.py`, `run_local.py`, `localize.py`, `pharmacy/`).
