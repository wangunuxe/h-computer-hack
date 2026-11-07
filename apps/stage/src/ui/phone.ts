import type { Booking, TransportOption, Trip } from "../core/protocol";
import type { Bus } from "../core/bus";
import { h } from "../core/dom";

const ICON = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  dog: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4c1.2 0 2.5.9 3 2l-2 1.5V10c0 2.5-1.7 4.6-4 5.3V20h-2v-4h-3v4H8v-4.3C6.3 14.9 5 13.1 5 11V9.5L3 8l1-2 3 2h6.5L15 5.5C15.8 4.6 16.8 4 18 4Z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>`,
  apple: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9-1.7 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.8c1.3 0 2.1-1.2 2.9-2.4a10 10 0 0 0 1.3-2.7 4.2 4.2 0 0 1-2.3-3.8ZM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>`,
  face: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 14V8a4 4 0 0 1 4-4h6M34 4h6a4 4 0 0 1 4 4v6M44 34v6a4 4 0 0 1-4 4h-6M14 44H8a4 4 0 0 1-4-4v-6M16 17v4M32 17v4M24 17v10h-2M17 33c4 3.5 10 3.5 14 0"/></svg>`,
};

/** The phone web page (PRD §8, FR-1…FR-5): talk button, live transcript, options, confirm, payment handoff, booking card. */
export function mountPhone(root: HTMLElement, bus: Bus, opts: { framed: boolean }) {
  const canvas = h("canvas", { class: "ph-wave", width: 640, height: 640, "aria-hidden": "true" });
  const talk = h("button", { class: "ph-talk", "aria-label": "Hold to talk to Voilà", html: ICON.mic });
  const talkLabel = h("div", { class: "ph-talk-label" }, "Hold to talk");
  const transcript = h("p", { class: "ph-transcript", "aria-live": "polite" });
  const noise = h("div", { class: "ph-noise" }, h("span", { class: "ph-noise-dot" }), "Station noise 84 dB · suppression on");
  const trip = h("div", { class: "ph-trip" });
  const viewTalk = h("section", { class: "ph-view ph-view-talk is-on" }, h("div", { class: "ph-talk-wrap" }, canvas, talk), talkLabel, noise, transcript, trip);

  const options = h("div", { class: "ph-options", role: "list" });
  const viewOptions = h("section", { class: "ph-view ph-view-options" }, h("h2", { class: "ph-h" }, "3 options make your check-in"), options);

  const steps = h("ol", { class: "ph-steps" });
  const viewProgress = h("section", { class: "ph-view ph-view-progress" }, h("h2", { class: "ph-h" }, "Booking on paris-airport-shuttle.com"), steps);

  const confirmList = h("ul", { class: "ph-confirm-list" });
  const confirmState = h("div", { class: "ph-confirm-state" }, "Say “oui” to book");
  const viewConfirm = h(
    "section",
    { class: "ph-view ph-view-confirm" },
    h("div", { class: "ph-kicker" }, "Before I submit"),
    h("h2", { class: "ph-h" }, "Book this ride?"),
    confirmList,
    confirmState,
  );

  const bookingEl = h("div", { class: "ph-booking" });
  const viewBooking = h("section", { class: "ph-view ph-view-booking" }, bookingEl);

  const pay = h("div", { class: "ph-pay", "aria-hidden": "true" });
  const say = h("div", { class: "ph-say", "aria-live": "assertive" });

  const statusTime = h("span", {}, "14:02");
  const screen = h(
    "div",
    { class: "ph-screen" },
    h(
      "header",
      { class: "ph-status" },
      statusTime,
      h("span", { class: "ph-island" }),
      h("span", { class: "ph-status-r", html: "5G <i class='ph-batt'></i>" }),
    ),
    h("div", { class: "ph-appbar" }, h("span", { class: "ph-brand" }, "Voilà"), h("span", { class: "ph-live" }, h("i"), "Karim · Olaf")),
    h("main", { class: "ph-main" }, viewTalk, viewOptions, viewProgress, viewConfirm, viewBooking),
    say,
    pay,
  );
  const device = h("div", { class: opts.framed ? "ph-device" : "ph-device ph-bare" }, h("span", { class: "ph-btn-side" }), screen);
  root.append(device);

  const views = [viewTalk, viewOptions, viewProgress, viewConfirm, viewBooking];
  const show = (v: HTMLElement) => views.forEach((x) => x.classList.toggle("is-on", x === v));

  // ── voice level + radial waveform ──
  let level = 0;
  let target = 0;
  let mode: "idle" | "listen" | "think" = "idle";
  const ctx = canvas.getContext("2d")!;
  let t0 = performance.now();
  const draw = (t: number) => {
    level += (target - level) * 0.18;
    target *= 0.9;
    const w = canvas.width;
    ctx.clearRect(0, 0, w, w);
    const cx = w / 2;
    const bars = 96;
    const base = 150;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2 + (t - t0) / 4000;
      const n = Math.sin(i * 0.7 + t / 140) * 0.5 + Math.sin(i * 1.9 - t / 90) * 0.5;
      let len: number;
      if (mode === "listen") len = 8 + Math.abs(n) * 90 * (0.25 + level);
      else if (mode === "think") len = 6 + (Math.sin(i / 3 - t / 160) * 0.5 + 0.5) * 34;
      else len = 4 + Math.abs(Math.sin(i * 0.4 + t / 900)) * 8;
      const r1 = base + 6;
      const r2 = r1 + len;
      ctx.strokeStyle = mode === "listen" ? `rgba(215,255,60,${0.35 + level * 0.6})` : mode === "think" ? "rgba(61,225,255,.55)" : "rgba(255,255,255,.18)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cx + Math.sin(a) * r2);
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const setMode = (m: typeof mode, label: string) => {
    mode = m;
    talk.dataset.mode = m;
    talkLabel.textContent = label;
  };

  const renderTrip = (tr: Trip) => {
    trip.replaceChildren(
      ...[
        ["From", "Gare du Nord"],
        ["To", "CDG 2E"],
        ["By", "16:00"],
        ["With", "Olaf"],
      ].map(([k, v], i) => h("span", { class: "ph-chip", style: `--i:${i}` }, h("b", {}, k), v)),
    );
    trip.dataset.guideDog = String(tr.guide_dog);
  };

  const renderOptions = (items: TransportOption[]) => {
    options.replaceChildren(
      ...items
        .filter((o) => o.feasible)
        .map((o, i) =>
          h(
            "article",
            { class: "ph-opt", role: "listitem", "data-id": o.id, style: `--i:${i}` },
            h("span", { class: "ph-opt-n" }, String(i + 1)),
            h(
              "div",
              { class: "ph-opt-body" },
              h("div", { class: "ph-opt-t" }, o.label),
              h("div", { class: "ph-opt-m" }, `pickup ${o.pickup_eta_min} min · €${o.price_eur} · +${o.margin_min} min spare`),
            ),
            h("span", { class: `ph-dog ph-dog-${o.guide_dog}`, html: ICON.dog, title: `Guide dog: ${o.guide_dog}` }),
          ),
        ),
    );
  };

  const progressSteps = ["Opening the booking form", "Route & date", "Vehicle", "Your details", "Guide-dog note", "Your OK", "Payment page"];
  const renderSteps = (active: number) => {
    steps.replaceChildren(
      ...progressSteps.map((s, i) =>
        h("li", { class: i < active ? "is-done" : i === active ? "is-active" : "" }, h("i", { html: i < active ? ICON.check : "" }), s),
      ),
    );
  };

  const renderBooking = (b: Booking) => {
    bookingEl.replaceChildren(
      h("div", { class: "ph-booked-badge", html: `${ICON.check}<span>Booked & paid</span>` }),
      h("div", { class: "ph-bk-time" }, b.pickup_time),
      h("div", { class: "ph-bk-where" }, b.pickup_point),
      h(
        "dl",
        { class: "ph-bk-grid" },
        h("dt", {}, "Ref"),
        h("dd", {}, b.ref),
        h("dt", {}, "Operator"),
        h("dd", {}, b.operator),
        h("dt", {}, "Paid"),
        h("dd", {}, `${b.price} · Apple Pay`),
        h("dt", {}, "Arrive"),
        h("dd", {}, "CDG 2E ≈ 15:10"),
      ),
      h("div", { class: "ph-bk-dog", html: `${ICON.dog}<span><b>Guide dog noted</b> · awaiting operator confirmation. Follow-up email sent.</span>` }),
      h("a", { class: "ph-call", href: `tel:${b.operator_phone.replace(/\s/g, "")}`, html: `${ICON.phone}<span>Call driver</span>` }),
    );
  };

  const renderPay = (amount: string, merchant: string) => {
    pay.replaceChildren(
      h(
        "div",
        { class: "ph-pay-sheet" },
        h("div", { class: "ph-pay-head" }, h("span", { class: "ph-pay-logo", html: `${ICON.apple}Pay` }), h("span", { class: "ph-pay-x" }, "Cancel")),
        h("div", { class: "ph-pay-row" }, h("span", { class: "ph-pay-card" }), h("div", {}, h("b", {}, "Visa ···· 4242"), h("small", {}, "Karim Benali"))),
        h("div", { class: "ph-pay-row ph-pay-merchant" }, h("small", {}, `PAY ${merchant.toUpperCase()}`), h("b", {}, amount)),
        h("div", { class: "ph-pay-face" }, h("span", { html: ICON.face }), h("span", { class: "ph-pay-face-t" }, "Double-click to pay")),
      ),
      h("div", { class: "ph-pay-side-hint" }, h("i"), h("i")),
    );
  };

  let agentPhase = 0;
  const pageToStep: Record<string, number> = { route: 1, vehicle: 2, details: 3, payment: 6 };

  bus.on((e) => {
    if (e.type === "cue") {
      if (e.name === "reset") {
        show(viewTalk);
        setMode("idle", "Hold to talk");
        transcript.textContent = "";
        trip.replaceChildren();
        say.textContent = "";
        say.classList.remove("is-on");
        pay.className = "ph-pay";
        device.classList.remove("is-listening", "is-paying");
        noise.classList.remove("is-on");
        agentPhase = 0;
      }
      if (e.name === "listen_start") {
        noise.classList.add("is-on");
      }
      if (e.name === "user_say") {
        setMode("listen", "Listening…");
        device.classList.add("is-listening");
        if (viewTalk.classList.contains("is-on")) transcript.textContent = "";
      }
      return;
    }
    switch (e.type) {
      case "transcript":
        target = 0.6 + Math.random() * 0.4;
        if (viewTalk.classList.contains("is-on")) transcript.textContent = `“${e.text}${e.final ? "" : "…"}”`;
        else {
          say.textContent = `You: “${e.text}”`;
          say.classList.add("is-on", "is-user");
        }
        if (e.final) {
          device.classList.remove("is-listening");
          setMode("think", "Thinking…");
          noise.classList.remove("is-on");
        }
        break;
      case "say":
        say.classList.remove("is-user");
        say.textContent = e.text;
        say.classList.add("is-on");
        break;
      case "trip":
        renderTrip(e.trip);
        break;
      case "stage":
        if (e.stage === "RESEARCH") setMode("think", "Checking RER B…");
        if (e.stage === "PRESENT") show(viewOptions);
        if (e.stage === "EXECUTE" && agentPhase === 0) {
          show(viewProgress);
          renderSteps(0);
        }
        if (e.stage === "EXECUTE" && agentPhase > 0) show(viewProgress);
        break;
      case "options":
        renderOptions(e.items);
        break;
      case "chosen":
        options.querySelectorAll(".ph-opt").forEach((el) => {
          const on = (el as HTMLElement).dataset.id === e.id;
          el.classList.toggle("is-chosen", on);
          el.classList.toggle("is-dim", !on);
        });
        break;
      case "agent": {
        const a = e.action;
        if (a.kind === "navigate") {
          agentPhase = pageToStep[a.page] ?? agentPhase;
          renderSteps(agentPhase);
        }
        if (a.kind === "reveal" && a.target === "comment") renderSteps((agentPhase = 4));
        if (a.kind === "tool_call" && a.name === "confirm_with_user") renderSteps((agentPhase = 5));
        break;
      }
      case "confirm":
        confirmList.replaceChildren(...e.summary.map((s, i) => h("li", { style: `--i:${i}` }, s)));
        confirmState.textContent = "Say “oui” to book";
        confirmState.classList.remove("is-ok");
        show(viewConfirm);
        break;
      case "confirmed":
        confirmState.replaceChildren(h("span", { html: ICON.check }), " Confirmed by voice");
        confirmState.classList.add("is-ok");
        break;
      case "payment_handoff":
        renderPay(e.amount, e.merchant);
        device.classList.add("is-paying");
        requestAnimationFrame(() => pay.classList.add("is-on"));
        setTimeout(() => pay.classList.add("is-face"), 2600);
        break;
      case "payment_completed":
        pay.classList.add("is-done");
        pay.querySelector(".ph-pay-face")!.replaceChildren(h("span", { class: "ph-pay-ok", html: ICON.check }), h("span", { class: "ph-pay-face-t" }, "Done"));
        setTimeout(() => {
          pay.classList.remove("is-on");
          device.classList.remove("is-paying");
        }, 1300);
        break;
      case "booking_card":
        renderBooking(e.booking);
        setTimeout(() => show(viewBooking), 900);
        break;
    }
  });

  return {
    setTime: (s: string) => (statusTime.textContent = s),
  };
}
