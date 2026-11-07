import type { AgentAction } from "@voila/shared";
import type { Bus } from "../core/bus";
import { h } from "../core/dom";
import { sfx } from "../core/audio";

const SITE_W = 1280;

/** Recreation of the hostile WordPress "Chauffeur Booking System" form (PRD Appendix A). */
function sitePages() {
  const lbl = (t: string) => `<div class="ws-lbl">${t}</div>`;
  return `
  <div class="ws-top">
    <div class="ws-logo"><b>PARIS</b> AIRPORT <i>SHUTTLE</i></div>
    <nav><span>Accueil</span><span>Tarifs</span><span class="on">Réservation</span><span>Flotte</span><span>Contact</span><span class="ws-tel">☎ 01 84 80 00 00</span></nav>
  </div>
  <div class="ws-hero"><h1>Réservation en ligne</h1><p>Transferts aéroports CDG · Orly · Beauvais — 24h/24</p></div>
  <div class="ws-tabs"><span data-tab="route">1 · Itinéraire</span><span data-tab="vehicle">2 · Véhicule</span><span data-tab="details">3 · Informations</span><span data-tab="payment">4 · Paiement</span></div>

  <div class="ws-page" data-page="route">
    <div class="ws-grid">
      <div class="ws-f">${lbl("Type de service *")}<select class="ws-in" data-audit="unlabeled select"><option>Transfert simple</option></select></div>
      <div class="ws-f">${lbl("Lieu de prise en charge *")}<input class="ws-in" data-t="pickup" placeholder="Saisir une adresse" data-audit="unlabeled · autocomplete"/>
        <ul class="ws-ac" data-t="pickup-ac"><li data-t="pickup-ac-0"><b>Gare du Nord</b>, Rue de Dunkerque, Paris</li><li>Gare du Nord (Parking)</li><li>Gare de l'Est, Paris</li></ul>
        <input type="hidden" name="pickup_lat"/></div>
      <div class="ws-f">${lbl("Destination *")}<input class="ws-in" data-t="dropoff" placeholder="Saisir une adresse" data-audit="unlabeled · autocomplete"/>
        <ul class="ws-ac" data-t="dropoff-ac"><li data-t="dropoff-ac-0"><b>Aéroport CDG Terminal 2E</b>, Roissy</li><li>Aéroport CDG Terminal 2F</li><li>Aéroport CDG Terminal 1</li></ul></div>
      <div class="ws-f ws-f-half">${lbl("Date *")}<input class="ws-in" data-t="date" readonly placeholder="jj/mm/aaaa" data-audit="readonly · jQuery picker"/>
        <div class="ws-cal" data-t="cal"><div class="ws-cal-h">‹ Novembre 2026 ›</div><div class="ws-cal-g">${["L","M","M","J","V","S","D"].map((d) => `<b>${d}</b>`).join("")}${"<span></span>".repeat(6)}${Array.from({ length: 30 }, (_, i) => `<span data-t="cal-${i + 1}" class="${i + 1 < 7 ? "off" : ""}">${i + 1}</span>`).join("")}</div></div></div>
      <div class="ws-f ws-f-half">${lbl("Heure *")}<select class="ws-in" data-t="time" data-audit="unlabeled select"><option>--:--</option><option>14:20</option></select></div>
      <div class="ws-f ws-f-half">${lbl("Passagers")}<select class="ws-in" data-audit="unlabeled select"><option>1</option></select></div>
    </div>
    <div class="ws-recap"><span class="ws-g-recaptcha" data-audit="hidden reCAPTCHA"></span><button class="ws-btn" data-t="next-1" data-audit="no accessible name">SUIVANT →</button></div>
  </div>

  <div class="ws-page" data-page="vehicle">
    <div class="ws-cars">
      ${[
        ["berline", "Berline", "1–3 pers. · 3 bagages", "65,00 €"],
        ["van", "Van", "4–7 pers. · 7 bagages", "89,00 €"],
        ["minibus", "Minibus", "8 pers. · 8 bagages", "119,00 €"],
      ]
        .map(
          ([id, n, d, p]) => `<div class="ws-car" data-car="${id}"><div class="ws-car-img"><svg viewBox="0 0 120 44"><path d="M8 32c0-6 4-8 10-9l14-10c3-2 6-3 10-3h30c5 0 8 2 11 5l9 8c10 1 18 3 18 9v4H8Z" fill="#bfc6cf"/><circle cx="32" cy="36" r="7" fill="#444"/><circle cx="92" cy="36" r="7" fill="#444"/></svg></div><b>${n}</b><small>${d}</small><div class="ws-price">${p}</div><button class="ws-btn ws-btn-s" data-t="veh-${id}">SÉLECTIONNER</button></div>`,
        )
        .join("")}
    </div>
  </div>

  <div class="ws-page" data-page="details">
    <div class="ws-grid">
      <div class="ws-f ws-f-half">${lbl("Prénom *")}<input class="ws-in" data-t="first" data-audit="unlabeled"/></div>
      <div class="ws-f ws-f-half">${lbl("Nom *")}<input class="ws-in" data-t="last" data-audit="unlabeled"/></div>
      <div class="ws-f ws-f-half">${lbl("E-mail *")}<input class="ws-in" data-t="email" data-audit="unlabeled"/></div>
      <div class="ws-f ws-f-half">${lbl("Téléphone *")}<input class="ws-in" data-t="phone" data-audit="unlabeled"/></div>
      <div class="ws-f ws-f-half">${lbl("Bagages")}<select class="ws-in" data-t="bags"><option>0</option><option>1 bagage</option></select></div>
      <div class="ws-f ws-f-half">${lbl("Siège enfant")}<select class="ws-in"><option>Non</option></select></div>
      <div class="ws-f ws-f-full"><a class="ws-link" data-t="comment-toggle" data-audit="div, not a button">+ Ajouter un commentaire</a><textarea class="ws-in ws-ta" data-t="comment"></textarea></div>
      <div class="ws-f ws-f-full ws-cgv"><span class="ws-box" data-t="cgv"></span> J'accepte les conditions générales de vente</div>
    </div>
    <div class="ws-recap"><button class="ws-btn" data-t="submit">RÉSERVER</button></div>
  </div>

  <div class="ws-page" data-page="payment">
    <div class="ws-pay">
      <div class="ws-ok">✔ Réservation n° <b>PAS-48213</b> enregistrée</div>
      <div class="ws-sum"><span>Gare du Nord → Aéroport CDG Terminal 2E</span><span>07/11/2026 · 14:20 · Berline</span><b>Total : 65,00 €</b></div>
      <div class="ws-pay-btns"><button class="ws-btn ws-btn-pp">Payer via PayPal</button><button class="ws-btn" data-t="pay-card">Payer par carte bancaire</button></div>
      <div class="ws-countdown" data-t="countdown">Redirection vers la page de paiement sécurisée dans <b>2</b> secondes…</div>
    </div>
  </div>

  <div class="ws-cookie" data-t="cookie-banner">Nous utilisons des cookies pour améliorer votre expérience. <button class="ws-btn ws-btn-s" data-t="cookies">ACCEPTER</button></div>`;
}

/** H agent live view (FR-6): cloud browser, cursor, reasoning steps, custom tool calls. */
export function mountAgentView(root: HTMLElement, bus: Bus) {
  const site = h("div", { class: "ws", html: sitePages() });
  const cursor = h("div", {
    class: "ag-cursor",
    html: `<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L21 10.8Z" fill="#fff" stroke="#000" stroke-width="1.3"/></svg><span>H</span>`,
  });
  const ripple = h("div", { class: "ag-ripple" });
  site.append(cursor, ripple);
  const scaler = h("div", { class: "ag-scaler" }, site);
  const pause = h("div", { class: "ag-pause" });
  const a11y = h(
    "div",
    { class: "ag-a11y" },
    h("div", { class: "ag-a11y-h" }, "VOICEOVER HEARS"),
    ...["“edit text”", "“edit text”", "“pop-up button”", "“edit text, dimmed”", "“button”", "“link, plus”", "…"].map((t, i) =>
      h("div", { class: "ag-a11y-l", style: `--i:${i}` }, t),
    ),
  );
  const url = h("span", { class: "ag-url-t" }, "about:blank");
  const steps = h("b", {}, "00");
  const maxSteps = h("span", {}, "/60");
  const cost = h("b", {}, "$0.000");
  const model = h("span", { class: "ag-model" }, "holo4-27b");
  const thoughts = h("div", { class: "ag-thoughts" });
  const viewport = h("div", { class: "ag-viewport" }, scaler, pause, a11y);

  const panel = h(
    "section",
    { class: "panel panel-agent", "data-panel": "agent" },
    h(
      "header",
      { class: "panel-h" },
      h("span", { class: "dot dot-cyan" }),
      h("span", {}, "H AGENT · LIVE VIEW"),
      model,
      h("span", { class: "ag-meter" }, "step ", steps, maxSteps, h("i", {}, "·"), cost),
    ),
    h(
      "div",
      { class: "ag-browser" },
      h(
        "div",
        { class: "ag-chrome" },
        h("span", { class: "ag-lights" }, h("i"), h("i"), h("i")),
        h("div", { class: "ag-url" }, h("span", { class: "ag-lock", html: "&#x1F512;&#xFE0E;" }), url),
        h("span", { class: "ag-cloud" }, "cloud browser · 1280×800"),
      ),
      viewport,
    ),
    thoughts,
  );
  root.append(panel);

  const q = (t: string) => site.querySelector<HTMLElement>(`[data-t="${t}"]`);
  let stepN = 0;
  let typingTimer = 0;

  const scale = () => scaler.getBoundingClientRect().width / SITE_W || 1;
  const moveTo = (el: HTMLElement) => {
    const s = scale();
    const r = el.getBoundingClientRect();
    const o = site.getBoundingClientRect();
    const x = (r.left - o.left + Math.min(r.width * 0.5, 80)) / s;
    const y = (r.top - o.top + r.height * 0.55) / s;
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cursor.classList.add("is-on");
    return { x, y };
  };
  const clickFx = (p: { x: number; y: number }) => {
    ripple.style.transform = `translate(${p.x}px, ${p.y}px)`;
    ripple.classList.remove("is-on");
    void ripple.offsetWidth;
    ripple.classList.add("is-on");
    sfx.click();
  };
  const bump = () => {
    stepN++;
    steps.textContent = String(stepN).padStart(2, "0");
    cost.textContent = `$${(stepN * 0.0028).toFixed(3)}`;
  };
  const showPage = (p: string) => {
    site.querySelectorAll<HTMLElement>(".ws-page").forEach((el) => el.classList.toggle("is-on", el.dataset.page === p));
    site.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => el.classList.toggle("on", el.dataset.tab === p));
    site.querySelectorAll(".is-open").forEach((el) => el.classList.remove("is-open"));
  };
  const reset = () => {
    site.innerHTML = sitePages();
    site.append(cursor, ripple);
    cursor.classList.remove("is-on");
    cursor.style.transform = "translate(640px, 420px)";
    url.textContent = "about:blank";
    stepN = 0;
    steps.textContent = "00";
    cost.textContent = "$0.000";
    thoughts.replaceChildren();
    pause.className = "ag-pause";
    panel.classList.remove("is-audit", "is-live", "is-done");
    site.classList.remove("is-loaded");
  };
  reset();

  const think = (step: number, text: string) => {
    const el = h("div", { class: "ag-th" }, h("span", { class: "ag-th-n" }, `#${String(step).padStart(2, "0")}`), h("span", {}, text));
    thoughts.prepend(el);
    while (thoughts.children.length > 3) thoughts.lastElementChild?.remove();
    requestAnimationFrame(() => el.classList.add("is-in"));
  };

  const run = (a: AgentAction) => {
    switch (a.kind) {
      case "session":
        panel.classList.add("is-live");
        model.textContent = a.model;
        maxSteps.textContent = `/${a.max_steps}`;
        break;
      case "navigate":
        url.textContent = a.url.replace(/^https:\/\//, "");
        site.classList.add("is-loaded");
        showPage(a.page);
        bump();
        break;
      case "think":
        think(a.step, a.text);
        break;
      case "click": {
        const el = q(a.target);
        if (!el) return;
        bump();
        const p = moveTo(el);
        setTimeout(() => {
          clickFx(p);
          el.classList.add("is-clicked");
          if (a.target === "cookies") q("cookie-banner")?.classList.add("is-gone");
          if (a.target.endsWith("-ac-0")) {
            const input = q(a.target.replace("-ac-0", ""));
            if (input) (input as HTMLInputElement).value = el.textContent ?? "";
            el.parentElement?.classList.remove("is-open");
          }
          if (a.target.startsWith("cal-")) {
            (q("date") as HTMLInputElement).value = `${a.target.slice(4).padStart(2, "0")}/11/2026`;
            q("cal")?.classList.remove("is-open");
          }
          if (a.target.startsWith("veh-")) el.closest(".ws-car")?.classList.add("is-sel");
          if (a.target === "cgv") el.classList.add("is-checked");
          document.querySelectorAll(".ws .is-focus").forEach((x) => x.classList.remove("is-focus"));
          if (el.matches("input,textarea,select")) el.classList.add("is-focus");
        }, 380);
        break;
      }
      case "type": {
        const el = q(a.target) as HTMLInputElement | null;
        if (!el) return;
        bump();
        moveTo(el);
        el.classList.add("is-focus");
        clearInterval(typingTimer);
        let i = 0;
        el.value = "";
        typingTimer = window.setInterval(() => {
          el.value = a.text.slice(0, ++i);
          if (i % 2) sfx.tick();
          if (i >= a.text.length) clearInterval(typingTimer);
        }, 34);
        break;
      }
      case "select": {
        const el = q(a.target) as HTMLSelectElement | null;
        if (!el) return;
        bump();
        const p = moveTo(el);
        setTimeout(() => {
          clickFx(p);
          el.value = a.value;
          el.classList.add("is-flash");
          setTimeout(() => el.classList.remove("is-flash"), 600);
        }, 380);
        break;
      }
      case "reveal":
        q(a.target)?.classList.add("is-open");
        break;
      case "audit":
        panel.classList.toggle("is-audit", a.on);
        break;
      case "tool_call":
        pause.innerHTML = `<div class="ag-tool"><small>CUSTOM TOOL</small><code>${a.name}(${a.name === "handoff_payment" ? "ref: \"PAS-48213\", amount: \"€65.00\"" : "summary"})</code></div>`;
        pause.className = "ag-pause is-on";
        break;
      case "paused":
        pause.insertAdjacentHTML("beforeend", `<div class="ag-pause-r"><i></i>${a.reason}</div>`);
        break;
      case "done":
        pause.innerHTML = `<div class="ag-tool ag-tool-ok"><small>SESSION COMPLETE</small><code>Booking { ref: "PAS-48213", status: "paid" }</code></div>`;
        pause.className = "ag-pause is-on is-ok";
        panel.classList.add("is-done");
        break;
    }
  };

  bus.on((e) => {
    if (e.type === "cue" && e.name === "reset") reset();
    if (e.type === "agent") run(e.action);
    if (e.type === "confirmed") pause.className = "ag-pause";
  });
}
