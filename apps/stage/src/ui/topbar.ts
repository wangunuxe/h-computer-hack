import { FLOW, flowIndex } from "../core/protocol";
import type { Bus } from "../core/bus";
import { fmtClock, fmtMMSS, h } from "../core/dom";

/** Header: brand, 8-step flow, scenario clock and the 10-minute booking window. */
export function mountTopbar(root: HTMLElement, bus: Bus, opts: { start: Date; deadline: Date; windowMs: number; elapsed: () => number }) {
  const nodes = FLOW.map((f, i) =>
    h("li", { class: "step", style: `--i:${i}` }, h("span", { class: "step-dot" }, String(i + 1)), h("span", { class: "step-l" }, f.label)),
  );
  const fill = h("i", { class: "flow-fill" });
  const flow = h("ol", { class: "flow" }, h("i", { class: "flow-line" }), fill, ...nodes);

  const clock = h("b", { class: "tb-clock" }, fmtClock(opts.start));
  const ringFg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const ring = h("div", { class: "tb-ring", html: `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="ring-bg"/></svg>` });
  ring.querySelector("svg")!.append(ringFg);
  ringFg.setAttribute("cx", "22");
  ringFg.setAttribute("cy", "22");
  ringFg.setAttribute("r", "19");
  ringFg.setAttribute("class", "ring-fg");
  const win = h("b", { class: "tb-win" }, "10:00");
  const winLabel = h("small", {}, "BOOKING WINDOW");
  const checkin = h("b", { class: "tb-checkin" }, "—");

  const bar = h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, h("span", { class: "brand-mark" }, "Voilà"), h("span", { class: "brand-sub" }, "voice · agent · any website")),
    flow,
    h(
      "div",
      { class: "tb-right" },
      h("div", { class: "tb-cell" }, h("small", {}, "GARE DU NORD"), clock),
      h("div", { class: "tb-cell" }, h("small", {}, "CHECK-IN CLOSES IN"), checkin),
      h("div", { class: "tb-cell tb-cell-win" }, ring, h("div", {}, winLabel, win)),
    ),
  );

  const ticker = h(
    "div",
    { class: "ticker" },
    h("span", { class: "ticker-tag" }, "RER B"),
    h(
      "div",
      { class: "ticker-track" },
      h(
        "div",
        { class: "ticker-run" },
        ..."TRAFIC INTERROMPU · PARIS NORD ↔ AÉROPORT CDG 2 · INCIDENT TECHNIQUE · REPRISE NON COMMUNIQUÉE · TRAFFIC INTERRUPTED · "
          .repeat(4)
          .split("·")
          .map((s) => h("span", {}, s.trim(), h("i", {}, "◆"))),
      ),
    ),
  );
  root.append(bar, ticker);

  let running = false;
  let frozen: number | null = null;
  const C = 2 * Math.PI * 19;
  ringFg.style.strokeDasharray = `${C}`;

  const tick = () => {
    const el = frozen ?? (running ? opts.elapsed() : 0);
    const now = new Date(opts.start.getTime() + el);
    clock.textContent = fmtClock(now);
    const left = opts.deadline.getTime() - now.getTime();
    checkin.textContent = `${Math.floor(left / 3600000)}h ${String(Math.floor((left % 3600000) / 60000)).padStart(2, "0")}m ${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}s`;
    const w = Math.max(0, opts.windowMs - el);
    win.textContent = fmtMMSS(w);
    ringFg.style.strokeDashoffset = `${C * (1 - w / opts.windowMs)}`;
    bar.classList.toggle("is-urgent", running && frozen === null && w < opts.windowMs * 0.5);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  bus.on((e) => {
    if (e.type === "cue" && e.name === "reset") {
      running = false;
      frozen = null;
      winLabel.textContent = "BOOKING WINDOW";
      bar.classList.remove("is-done");
      ticker.classList.remove("is-on");
      nodes.forEach((n) => n.classList.remove("is-active", "is-done"));
      fill.style.width = "0%";
    }
    if (e.type === "cue" && e.name === "listen_start") running = true;
    if (e.type === "feed" && e.kind === "alert") ticker.classList.add("is-on");
    if (e.type === "stage") {
      const idx = flowIndex(e.stage);
      nodes.forEach((n, i) => {
        n.classList.toggle("is-done", i < idx || e.stage === "DONE");
        n.classList.toggle("is-active", i === idx && e.stage !== "DONE");
      });
      fill.style.width = `${(Math.max(0, idx) / (FLOW.length - 1)) * 100}%`;
    }
    if (e.type === "payment_completed") {
      frozen = opts.elapsed();
      winLabel.textContent = `PAID WITH ${fmtMMSS(opts.windowMs - frozen)} TO SPARE`;
      bar.classList.add("is-done");
    }
  });
}
