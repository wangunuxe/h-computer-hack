import type { FeedKind, TransportOption } from "../core/protocol";
import type { Bus } from "../core/bus";
import { fmtHM, h } from "../core/dom";
import { sfx } from "../core/audio";

const KIND_LABEL: Record<FeedKind, string> = {
  info: "THINK",
  search: "FETCH",
  alert: "ALERT",
  ok: "OK",
  warn: "NOTE",
  agent: "AGENT",
  tool: "TOOL",
};

/** Data stream panel (FR-6): research steps with sources + feasibility matrix. */
export function mountFeed(root: HTMLElement, bus: Bus, clock: () => number) {
  const list = h("div", { class: "feed-list" });
  const counter = h("span", { class: "feed-count" }, "0 events");
  const panel = h(
    "section",
    { class: "panel panel-feed", "data-panel": "feed" },
    h("header", { class: "panel-h" }, h("span", { class: "dot dot-live" }), h("span", {}, "DATA STREAM"), counter),
    list,
  );
  root.append(panel);
  let n = 0;

  const scroll = () => list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });

  const add = (el: HTMLElement) => {
    list.append(el);
    counter.textContent = `${++n} events`;
    requestAnimationFrame(() => {
      el.classList.add("is-in");
      scroll();
    });
  };

  const stamp = () => {
    const s = Math.floor(clock() / 1000);
    return `+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const matrix = (items: TransportOption[], now: Date, deadline: Date) => {
    const span = (deadline.getTime() - now.getTime()) / 60000;
    const pct = (m: number) => `${Math.max(0, Math.min(100, (m / span) * 100))}%`;
    const bufferStart = span - 15;
    const rows = items.map((o, i) => {
      const total = o.pickup_eta_min + o.travel_min;
      const arrive = new Date(now.getTime() + total * 60000);
      const bars =
        total > 0
          ? h(
              "div",
              { class: "mx-bars" },
              h("i", { class: "mx-wait", style: `width:${pct(o.pickup_eta_min)}` }),
              h("i", { class: "mx-ride", style: `left:${pct(o.pickup_eta_min)};width:${pct(o.travel_min)}` }),
              h("b", { class: "mx-arrive", style: `left:${pct(total)}` }, fmtHM(arrive)),
            )
          : h("div", { class: "mx-bars mx-none" }, h("span", {}, o.reason ?? ""));
      return h(
        "div",
        { class: `mx-row ${o.feasible ? "is-ok" : "is-ko"}`, style: `--i:${i}` },
        h("div", { class: "mx-name" }, h("b", {}, o.label), h("small", {}, o.feasible ? `€${o.price_eur} · pickup ${o.pickup_eta_min}′` : o.reason ?? "")),
        h("div", { class: "mx-track" }, bars),
        h("div", { class: `mx-verdict` }, o.feasible ? `+${o.margin_min}′` : "✕"),
      );
    });
    return h(
      "div",
      { class: "feed-item feed-matrix" },
      h("div", { class: "mx-head" }, h("span", {}, "FEASIBILITY"), h("span", {}, `${fmtHM(now)} → check-in closes ${fmtHM(deadline)}`)),
      h(
        "div",
        { class: "mx-grid" },
        h(
          "div",
          { class: "mx-axis" },
          h("i", { class: "mx-buffer", style: `left:${pct(bufferStart)};width:${pct(15)}` }),
          h("i", { class: "mx-deadline" }),
          h("span", { class: "mx-tl", style: "left:0" }, fmtHM(now)),
          h("span", { class: "mx-tl", style: `left:${pct(60)}` }, fmtHM(new Date(now.getTime() + 3600000))),
          h("span", { class: "mx-tl mx-tl-end" }, fmtHM(deadline)),
        ),
        ...rows,
      ),
    );
  };

  bus.on((e) => {
    if (e.type === "cue" && e.name === "reset") {
      list.replaceChildren();
      n = 0;
      counter.textContent = "0 events";
    }
    if (e.type === "feed") {
      const src = e.source ? h("a", { class: "feed-src", href: e.source.url, target: "_blank", rel: "noreferrer" }, e.source.title) : null;
      add(
        h(
          "div",
          { class: `feed-item feed-${e.kind}` },
          h("span", { class: "feed-t" }, stamp()),
          h("span", { class: "feed-k" }, KIND_LABEL[e.kind]),
          h("div", { class: "feed-body" }, h("span", { class: "feed-text" }, e.text), src),
        ),
      );
      sfx.blip(e.kind === "alert" ? 0.5 : e.kind === "ok" ? 1.3 : 1);
    }
    if (e.type === "options") {
      add(matrix(e.items, new Date(e.now), new Date(e.deadline)));
      e.items.forEach((_, i) => setTimeout(() => sfx.blip(0.8 + i * 0.08), 300 + i * 260));
    }
    if (e.type === "chosen") {
      list.querySelectorAll(".mx-row").forEach((r, i) => r.classList.toggle("is-chosen", i === 0));
    }
  });
}
