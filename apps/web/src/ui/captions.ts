import type { Bus } from "../core/bus";
import { h } from "../core/dom";

/** Large on-stage captions so the jury can follow every spoken line. */
export function mountCaptions(root: HTMLElement, bus: Bus) {
  const who = h("span", { class: "cap-who" });
  const text = h("span", { class: "cap-text" });
  const el = h("div", { class: "captions" }, who, text);
  root.append(el);

  const show = (speaker: "voila" | "karim", words: string) => {
    el.dataset.who = speaker;
    who.textContent = speaker === "voila" ? "VOILÀ" : "KARIM";
    el.classList.add("is-on");
    text.replaceChildren(...words.split(" ").map((w, i) => h("span", { class: "cap-w", style: `--i:${i}` }, w + " ")));
  };

  bus.on((e) => {
    if (e.type === "say") show("voila", e.text);
    if (e.type === "transcript") {
      el.dataset.who = "karim";
      who.textContent = "KARIM";
      el.classList.add("is-on");
      text.textContent = e.text;
      text.classList.toggle("is-partial", !e.final);
    }
    if (e.type === "cue" && (e.name === "reset" || e.name === "finale")) {
      el.classList.remove("is-on");
      text.textContent = "";
    }
  });
}
