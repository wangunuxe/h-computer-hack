import type { Bus } from "../core/bus";
import { h, sleep } from "../core/dom";

/** Title card, cold open (departure board) and finale. */
export function mountOverlays(root: HTMLElement, bus: Bus, onStart: () => void, getStats: () => { label: string; value: string; sub?: string }[]) {
  const title = h(
    "div",
    { class: "ov ov-title is-on" },
    h("div", { class: "ov-title-grid" }),
    h("div", { class: "ov-title-kicker" }, "H COMPANY HACKATHON · PARIS"),
    h("h1", { class: "ov-title-logo" }, "Voilà", h("span", {}, ".")),
    h("p", { class: "ov-title-tag" }, "When the city breaks down, say one sentence."),
    h("p", { class: "ov-title-sub" }, "A voice assistant that books the ride for blind travellers — on websites never built for them."),
    h("button", { class: "ov-start", onclick: () => onStart() }, h("span", {}, "▶"), "Start the demo"),
    h(
      "div",
      { class: "ov-stack" },
      ...["Gladia · live STT", "IDFM PRIM · traffic", "Linkup · sourced search", "H Agents API · holo4-27b", "Stripe · Apple Pay"].map((t) => h("span", {}, t)),
    ),
  );

  const board = h("div", { class: "sb" });
  const rows: [string, string, string, string][] = [
    ["14:04", "RER B", "AÉROPORT CDG 2 TGV", "SUPPRIMÉ"],
    ["14:11", "RER B", "MITRY-CLAYE", "SUPPRIMÉ"],
    ["14:19", "RER B", "AÉROPORT CDG 2 TGV", "SUPPRIMÉ"],
    ["14:26", "RER D", "ORRY-LA-VILLE", "À L'HEURE"],
  ];
  const lines = h("div", { class: "co-lines" });
  const cold = h("div", { class: "ov ov-cold" }, h("div", { class: "co-board" }, h("div", { class: "sb-h" }, h("span", {}, "DÉPARTS"), h("span", {}, "PARIS NORD")), board), lines);

  const statsEl = h("div", { class: "fin-stats" });
  const finale = h(
    "div",
    { class: "ov ov-finale" },
    h("div", { class: "fin-burst" }),
    h("h1", { class: "fin-logo" }, "Voilà", h("span", {}, ".")),
    h("p", { class: "fin-tag" }, "Karim is in the car. Olaf too."),
    statsEl,
    h("p", { class: "fin-line" }, "Your assistant, on any website. ", h("b", {}, "The user always pays himself — Voilà never sees a card.")),
  );
  root.append(cold, finale, title);

  const flap = (cell: HTMLElement, text: string, delay: number) => {
    const chars = "ABCDEFGHIJKLMNOPRSTUVÉÀ0123456789 ";
    let n = 0;
    setTimeout(() => {
      const iv = setInterval(() => {
        n++;
        cell.textContent = text
          .split("")
          .map((c, i) => (n > i * 0.8 + 6 ? c : chars[Math.floor(Math.random() * chars.length)]))
          .join("");
        if (n > text.length * 0.8 + 7) {
          cell.textContent = text;
          clearInterval(iv);
        }
      }, 45);
    }, delay);
  };

  const playCold = async (ls: string[]) => {
    board.replaceChildren();
    lines.replaceChildren();
    cold.classList.add("is-on");
    rows.forEach((r, i) => {
      const cells = r.map((_, j) => h("span", { class: `sb-c sb-c${j}` }, ""));
      const row = h("div", { class: `sb-row ${r[3] === "SUPPRIMÉ" ? "is-ko" : ""}` }, ...cells);
      board.append(row);
      r.forEach((t, j) => flap(cells[j], t, 200 + i * 180 + j * 90));
    });
    for (const [i, l] of ls.entries()) {
      await sleep(i === 0 ? 1600 : 2200);
      const el = h("p", { class: "co-line" }, l);
      lines.append(el);
      requestAnimationFrame(() => el.classList.add("is-in"));
    }
  };

  const countUp = (el: HTMLElement, value: string) => {
    const m = value.match(/^([^0-9]*)([0-9]+(?:[.:][0-9]+)?)(.*)$/);
    if (!m || m[2].includes(":")) {
      el.textContent = value;
      return;
    }
    const [, pre, num, post] = m;
    const target = parseFloat(num);
    const dec = num.includes(".") ? num.split(".")[1].length : 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1200);
      el.textContent = `${pre}${(target * (1 - Math.pow(1 - p, 3))).toFixed(dec)}${post}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  bus.on((e) => {
    if (e.type !== "cue") return;
    if (e.name === "reset") {
      title.classList.remove("is-on");
      cold.classList.remove("is-on");
      finale.classList.remove("is-on");
    }
    if (e.name === "coldopen") void playCold(e.lines);
    if (e.name === "coldopen_end") cold.classList.remove("is-on");
    if (e.name === "finale") {
      const stats = getStats();
      statsEl.replaceChildren(
        ...stats.map((s, i) => {
          const v = h("b", {}, s.value);
          const el = h("div", { class: "fin-stat", style: `--i:${i}` }, v, h("span", {}, s.label), s.sub ? h("small", {}, s.sub) : null);
          setTimeout(() => countUp(v, s.value), 500 + i * 150);
          return el;
        }),
      );
      finale.classList.add("is-on");
    }
  });

  return { showTitle: () => title.classList.add("is-on") };
}
