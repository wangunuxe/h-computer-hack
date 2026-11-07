type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function typeInto(el: HTMLElement, text: string, cps = 60): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30)));
      el.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(tick, 1000 / 30);
      else resolve();
    };
    tick();
  });
}

const TZ = "Europe/Paris";

export const fmtClock = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });

export const fmtHM = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const fmtMMSS = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
