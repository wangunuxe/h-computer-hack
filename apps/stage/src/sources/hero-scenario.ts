import type { Booking, TransportOption, Trip } from "../core/protocol";
import { sfx } from "../core/audio";
import type { Director } from "../core/director";

/**
 * PRD §2 hero scenario: RER B is down, Karim (blind, guide dog) at Gare du Nord,
 * flight from CDG 2E in 3 h. All data below is demo fixture data.
 */
export const SCENARIO = {
  start: new Date("2026-11-07T14:02:40+01:00"),
  deadline: new Date("2026-11-07T16:00:00+01:00"),
  bookingWindowMs: 10 * 60 * 1000,
  site: "https://paris-airport-shuttle.com/fr/reservation/",
};

const PRIM = { title: "IDFM PRIM · line_reports C01743", url: "https://prim.iledefrance-mobilites.fr/" };
const TRANSILIEN = { title: "transilien.com · RER B info trafic", url: "https://www.transilien.com/" };
const LINKUP = { title: "Linkup search", url: "https://www.linkup.so/" };

export const TRIP: Trip = {
  origin: "Paris Gare du Nord",
  destination: "CDG Terminal 2E",
  deadline: SCENARIO.deadline.toISOString(),
  flight: "AF 006 → JFK · 17:00",
  passengers: 1,
  guide_dog: true,
  luggage: 1,
};

export const OPTIONS: TransportOption[] = [
  { id: "shuttle", label: "Paris Airport Shuttle", operator: "paris-airport-shuttle.com", kind: "shuttle", pickup_eta_min: 15, travel_min: 50, price_eur: 65, guide_dog: "unknown", feasible: true, margin_min: 35, source: LINKUP },
  { id: "g7", label: "G7 taxi (booked)", operator: "G7", kind: "taxi", pickup_eta_min: 22, travel_min: 60, price_eur: 62, guide_dog: "accepted", feasible: true, margin_min: 20 },
  { id: "rank", label: "Taxi rank, Gare du Nord", operator: "Taxis parisiens", kind: "taxi", pickup_eta_min: 35, travel_min: 55, price_eur: 56, guide_dog: "accepted", feasible: true, margin_min: 12 },
  { id: "bus350", label: "Bus 350 from Gare de l'Est", operator: "RATP", kind: "bus", pickup_eta_min: 23, travel_min: 87, guide_dog: "accepted", feasible: false, margin_min: -7, reason: "arrives 15:52 — after buffer" },
  { id: "roissybus", label: "Roissybus from Opéra", operator: "RATP", kind: "bus", pickup_eta_min: 40, travel_min: 80, guide_dog: "accepted", feasible: false, margin_min: -17, reason: "arrives 16:02 — check-in closed" },
  { id: "uber", label: "Uber", operator: "Uber", kind: "vtc", pickup_eta_min: 0, travel_min: 0, guide_dog: "unknown", feasible: false, reason: "ruled out by Karim — no cars" },
  { id: "rerb", label: "RER B", operator: "SNCF / RATP", kind: "train", pickup_eta_min: 0, travel_min: 0, guide_dog: "accepted", feasible: false, reason: "traffic interrupted", source: PRIM },
];

export const BOOKING: Booking = {
  ref: "PAS-48213",
  pickup_time: "14:20",
  pickup_point: "Gare du Nord · exit rue de Dunkerque",
  price: "€65.00",
  operator: "Paris Airport Shuttle",
  operator_phone: "+33 1 84 80 00 00",
  payment_url: "https://checkout.stripe.com/c/pay/cs_test_…",
  guide_dog_status: "unknown",
};

export interface ScenarioOptions {
  coldOpen?: boolean;
}

export function heroScenario(opts: ScenarioOptions = {}) {
  const coldOpen = opts.coldOpen ?? true;
  return async (d: Director) => {
    let step = 0;
    const think = async (text: string, ms = 900) => {
      d.agent({ kind: "think", step: ++step, text });
      await d.wait(ms);
    };
    const click = async (target: string, ms = 650) => {
      step++;
      d.agent({ kind: "click", target });
      await d.wait(ms);
    };
    const type = async (target: string, text: string) => {
      step++;
      d.agent({ kind: "type", target, text });
      await d.wait(550 + text.length * 38);
    };
    const select = async (target: string, value: string) => {
      step++;
      d.agent({ kind: "select", target, value });
      await d.wait(800);
    };
    const reveal = async (target: string, ms = 450) => {
      d.agent({ kind: "reveal", target });
      await d.wait(ms);
    };
    const page = async (name: string, ms = 900) => {
      sfx.whoosh();
      d.agent({ kind: "navigate", url: SCENARIO.site, page: name });
      await d.wait(ms);
    };

    // ── Cold open ────────────────────────────────────────────────
    if (coldOpen) {
      d.beat("Cold open");
      sfx.ambienceOn(1);
      d.emit({
        type: "cue",
        name: "coldopen",
        lines: [
          "Gare du Nord. 14:02.",
          "Karim is blind. He travels with Olaf, his guide dog.",
          "His flight to New York leaves CDG 2E in 3 hours.",
          "The RER B just stopped. Uber shows no cars.",
        ],
      });
      await d.wait(900);
      sfx.jingle();
      await d.wait(9800);
      sfx.alarm(3);
      await d.wait(1800);
      d.emit({ type: "cue", name: "coldopen_end" });
      await d.wait(700);
    } else {
      sfx.ambienceOn(0.6);
    }

    // ── 1. Listen ────────────────────────────────────────────────
    d.beat("Listen");
    d.emit({ type: "stage", stage: "LISTEN" });
    d.emit({ type: "cue", name: "focus", panel: "phone" });
    d.emit({ type: "cue", name: "listen_start" });
    d.emit({ type: "feed", kind: "tool", text: "Gladia live v2 · fr+en · audio_enhancer on · noiseSuppression on" });
    await d.wait(700);
    await d.userSays(
      "RER B has stopped! My flight to New York is in 3 hours, I can't get an Uber. Book me a car that can leave now, takes my guide dog, to CDG 2E!",
      200,
    );
    sfx.ambienceOn(0.25);
    d.emit({ type: "feed", kind: "ok", text: "Transcript final · 31 words · 84 dB ambient · confidence 0.94" });

    // ── 2. Understand ────────────────────────────────────────────
    d.beat("Understand");
    d.emit({ type: "stage", stage: "UNDERSTAND" });
    d.emit({ type: "cue", name: "focus", panel: null });
    d.emit({ type: "feed", kind: "info", text: "Utterance + GPS (48.8809, 2.3553) + profile → Trip" });
    await d.wait(700);
    d.emit({ type: "trip", trip: TRIP });
    d.emit({ type: "feed", kind: "ok", text: "Trip · Gare du Nord → CDG 2E · be there by 16:00 (check-in close) · 1 adult + guide dog · 1 bag" });
    await d.say("Got it, Karim. Checking the RER B and every way to CDG.");

    // ── 3. Research ──────────────────────────────────────────────
    d.beat("Research");
    d.emit({ type: "stage", stage: "RESEARCH" });
    d.emit({ type: "cue", name: "focus", panel: "feed" });
    d.emit({ type: "feed", kind: "search", text: "GET line_reports · line:IDFM:C01743", source: PRIM });
    await d.wait(900);
    sfx.alarm(1);
    d.emit({
      type: "feed",
      kind: "alert",
      text: "RER B — Trafic interrompu entre Paris Nord et Aéroport CDG 2 (incident technique). Reprise : non communiquée.",
      source: PRIM,
    });
    await d.wait(800);
    d.emit({ type: "feed", kind: "search", text: "Linkup · “RER B interrompu Gare du Nord CDG aujourd'hui”", source: LINKUP });
    await d.wait(900);
    d.emit({ type: "feed", kind: "ok", text: "Disruption corroborated by 2 independent sources", source: TRANSILIEN });
    await d.wait(500);
    d.emit({ type: "feed", kind: "search", text: "Linkup · alternatives Gare du Nord → CDG T2 · guide dog · now", source: LINKUP });
    await d.wait(900);
    d.emit({ type: "feed", kind: "info", text: "Feasibility · now + pickup + road + 15 min buffer ≤ 16:00" });
    d.emit({ type: "options", items: OPTIONS, now: SCENARIO.start.toISOString(), deadline: SCENARIO.deadline.toISOString() });
    await d.wait(3600);
    d.emit({ type: "feed", kind: "warn", text: "4 dropped · RER B interrupted · Uber no cars · Bus 350 +7 min late · Roissybus +17 min late" });
    d.emit({ type: "stage", stage: "PRESENT" });
    d.emit({ type: "cue", name: "focus", panel: "phone" });
    await d.say("The RER B is interrupted to the airport, says Île-de-France Mobilités. Three options still beat your check-in.");
    await d.say(
      "One: Paris Airport Shuttle, pickup in 15 minutes, 65 euros. Two: a G7 taxi, in 22 minutes, 62 euros. Three: the taxi rank, about 35 minutes of queue. Which one?",
    );

    // ── 4. Decide ────────────────────────────────────────────────
    d.beat("Decide");
    d.emit({ type: "stage", stage: "CHOOSE" });
    await d.userSays("The shuttle.", 300);
    d.emit({ type: "chosen", id: "shuttle" });
    d.emit({ type: "feed", kind: "ok", text: "Choice · “the shuttle” → Paris Airport Shuttle" });
    await d.say("The shuttle. Booking it on their website now. Nothing is submitted without your OK.");

    // ── 5. Act ───────────────────────────────────────────────────
    d.beat("Act");
    d.emit({ type: "stage", stage: "EXECUTE" });
    d.emit({ type: "cue", name: "pipeline", show: true });
    const underTheHood = d.say("Under the hood: Voilà briefs H's computer-use agent. It reads the screen as pixels, and stops twice for Karim.");
    underTheHood.catch(() => {});
    await d.wait(12500);
    await underTheHood;
    d.emit({ type: "cue", name: "pipeline", show: false });
    await d.wait(600);
    d.emit({ type: "cue", name: "focus", panel: "agent" });
    d.agent({ kind: "session", model: "holo4-27b", session_id: "ses_8f2c1e", max_steps: 60 });
    d.emit({ type: "feed", kind: "agent", text: "H Agents API · holo4-27b · cloud browser 1280×800 · playbook paris-airport-shuttle.md" });
    await page("route", 1100);
    d.agent({ kind: "audit", on: true });
    d.emit({ type: "feed", kind: "warn", text: "Screen-reader audit · 9 unlabeled inputs · 2 custom pickers · hidden lat/lng · no guide-dog field" });
    await d.say("This form is a wall for VoiceOver: nine unlabeled fields. The agent just looks at it.");
    d.agent({ kind: "audit", on: false });
    await d.wait(300);

    await think("Cookie banner covers the form. Accept it first.", 700);
    await click("cookies");
    await think("Pickup is a Google-style autocomplete. Type, wait for suggestions, pick the first.");
    await click("pickup", 450);
    await type("pickup", "Gare du Nord");
    await reveal("pickup-ac", 500);
    await click("pickup-ac-0");
    d.narrate("Pickup: Gare du Nord.");
    await click("dropoff", 450);
    await type("dropoff", "Aéroport CDG Terminal 2E");
    await reveal("dropoff-ac", 500);
    await click("dropoff-ac-0");
    await think("Date is a jQuery datepicker, typing is blocked. Open it and click today, the 7th.");
    await click("date", 400);
    await reveal("cal", 500);
    await click("cal-7");
    await select("time", "14:20");
    d.narrate("Route set: terminal 2E, today, 14:20.");
    await click("next-1", 500);

    await page("vehicle");
    await think("Vehicle list. Berline, 1 to 3 passengers, 65 €. Matches the quoted price.");
    await click("veh-berline", 600);

    await page("details");
    await think("Passenger details from Karim's profile.", 600);
    await click("first", 300);
    await type("first", "Karim");
    await click("last", 300);
    await type("last", "Benali");
    await click("email", 300);
    await type("email", "karim.b@mail.fr");
    await click("phone", 300);
    await type("phone", "06 12 34 56 78");
    await select("bags", "1 bagage");
    d.narrate("Filling your details.");
    await think("No field for a guide dog. The comment box is collapsed: expand it and write the note.");
    await click("comment-toggle", 500);
    await reveal("comment", 400);
    await type("comment", "Passager non-voyant avec chien guide (loi 87-588 art. 88). Merci de l'aider à trouver le véhicule.");
    await click("cgv", 500);
    await think("Everything filled. Calling confirm_with_user before submitting.", 700);

    // ── 6. Confirm ───────────────────────────────────────────────
    d.beat("Confirm");
    const summary = [
      "Today 14:20 · Gare du Nord, exit rue de Dunkerque",
      "→ CDG Terminal 2E · arrive ≈ 15:10",
      "Berline · 1 adult · 1 bag",
      "Guide dog noted in comments",
      "€65.00",
    ];
    d.agent({ kind: "tool_call", name: "confirm_with_user", args: { summary: summary.join(" | ") } });
    d.agent({ kind: "paused", reason: "Waiting for Karim's OK" });
    d.emit({ type: "feed", kind: "tool", text: "confirm_with_user(summary) → waiting for voice" });
    d.emit({ type: "stage", stage: "CONFIRM" });
    d.emit({ type: "cue", name: "focus", panel: "phone" });
    d.emit({ type: "confirm", summary });
    await d.say("Before I book: today 14:20, Gare du Nord, rue de Dunkerque exit, to terminal 2E. 65 euros. Olaf is noted. Shall I book it?");
    await d.userSays("Oui.", 350);
    d.emit({ type: "confirmed" });
    d.emit({ type: "feed", kind: "ok", text: "confirm_with_user → “confirmed”" });

    d.emit({ type: "stage", stage: "EXECUTE" });
    d.emit({ type: "cue", name: "focus", panel: "agent" });
    await click("submit", 500);
    await page("payment", 900);
    await think("Booking PAS-48213 created. Card payment redirects to Stripe. Stop here: never pay.", 800);
    await click("pay-card", 400);
    await reveal("countdown", 1800);
    d.agent({ kind: "tool_call", name: "handoff_payment", args: { ref: "PAS-48213", amount: "€65.00", merchant: "Paris Airport Shuttle" } });
    d.agent({ kind: "paused", reason: "Payment handed to Karim's phone" });
    d.emit({ type: "feed", kind: "tool", text: "handoff_payment(ref=PAS-48213) → checkout.stripe.com · domain validated" });

    // ── 7. Pay ───────────────────────────────────────────────────
    d.beat("Pay");
    d.emit({ type: "stage", stage: "HANDOFF" });
    d.emit({ type: "cue", name: "focus", panel: "phone" });
    d.emit({ type: "payment_handoff", url: BOOKING.payment_url, amount: "€65.00", merchant: "Paris Airport Shuttle" });
    await d.say("Your car is held. Pay 65 euros with Apple Pay now: double-click the side button.");
    d.emit({ type: "stage", stage: "AWAIT_PAYMENT" });
    await d.wait(3600);
    sfx.pay();
    d.emit({ type: "payment_completed" });
    d.emit({ type: "feed", kind: "ok", text: "Stripe webhook · checkout.session.completed · PAS-48213 paid" });
    d.emit({ type: "feed", kind: "info", text: "Card data seen by Voilà or the agent: none" });
    d.agent({ kind: "done" });

    // ── 8. Follow up ─────────────────────────────────────────────
    d.beat("Follow up");
    d.emit({ type: "stage", stage: "DONE" });
    d.emit({ type: "booking_card", booking: BOOKING });
    d.emit({ type: "feed", kind: "warn", text: "Guide dog · noted, not yet confirmed by operator → follow-up email sent" });
    await d.say(
      "Booked. Pickup 14:20, Gare du Nord, rue de Dunkerque exit. You'll reach 2E around 15:10. Olaf is noted, but the operator hasn't confirmed yet. I've emailed them and I'll tell you.",
    );
    await d.wait(800);
    sfx.ambienceOff(2);
    sfx.voila();
    d.emit({ type: "cue", name: "finale", stats: [] });
  };
}
