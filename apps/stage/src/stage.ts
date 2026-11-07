import "./styles/stage.css";
import "./styles/phone.css";
import "./styles/site.css";
import { Bus } from "./core/bus";
import { Director } from "./core/director";
import { sfx } from "./core/audio";
import { fmtHM, fmtMMSS, h } from "./core/dom";
import { heroScenario, SCENARIO } from "./sources/hero-scenario";
import { LiveSource } from "./sources/live";
import { mountTopbar } from "./ui/topbar";
import { mountPhone } from "./ui/phone";
import { mountFeed } from "./ui/feed";
import { mountAgentView } from "./ui/agent-view";
import { mountCaptions } from "./ui/captions";
import { mountOverlays } from "./ui/overlays";

const params = new URLSearchParams(location.search);
const stage = document.getElementById("stage")!;
const bus = new Bus();

// ── session clock (pause-aware) ──
let startedAt = 0;
let pausedAt = 0;
let pausedTotal = 0;
let paidAt = 0;
let agentSteps = 0;
const elapsed = () => (startedAt ? (pausedAt || performance.now()) - startedAt - pausedTotal : 0);

bus.on((e) => {
  if (e.type === "cue" && e.name === "reset") {
    startedAt = pausedAt = pausedTotal = paidAt = agentSteps = 0;
  }
  if (e.type === "cue" && e.name === "listen_start") startedAt = performance.now();
  if (e.type === "cue" && e.name === "focus") stage.dataset.focus = e.panel ?? "";
  if (e.type === "payment_completed") paidAt = elapsed();
  if (e.type === "agent" && ["click", "type", "select", "navigate"].includes(e.action.kind)) agentSteps++;
});

// ── layout ──
mountTopbar(stage, bus, { start: SCENARIO.start, deadline: SCENARIO.deadline, windowMs: SCENARIO.bookingWindowMs, elapsed });
const main = h("div", { class: "main" });
const phoneCol = h("section", { class: "panel-phone", "data-panel": "phone" });
main.append(phoneCol);
stage.append(main);
const phone = mountPhone(phoneCol, bus, { framed: true });
mountFeed(main, bus, elapsed);
mountAgentView(main, bus);
mountCaptions(stage, bus);
stage.append(h("div", { class: "fx-vignette" }), h("div", { class: "fx-grain" }));

setInterval(() => {
  const t = new Date(SCENARIO.start.getTime() + elapsed());
  phone.setTime(fmtHM(t));
}, 500);

// ── source ──
const live = params.get("source") === "live";
const director = new Director(bus, heroScenario({ coldOpen: !params.has("nocold") }));
if (params.has("speed")) director.speed = Number(params.get("speed")) || 1;
const liveUrl = params.get("ws") ?? `ws://${location.hostname}:8787/ws/session/demo`;
let liveSource = live ? new LiveSource(bus, liveUrl) : null;

const overlays = mountOverlays(
  stage,
  bus,
  () => begin(),
  () => [
    { label: "sentence spoken", value: "1" },
    { label: "to a paid booking", value: fmtMMSS(paidAt || elapsed()), sub: "of a 10:00 window" },
    { label: "agent actions on an inaccessible site", value: String(agentSteps) },
    { label: "card digits seen by Voilà", value: "0" },
    { label: "agent cost (est.)", value: `$${(agentSteps * 0.0028).toFixed(2)}` },
  ],
);

let begun = false;
function begin() {
  sfx.ensure();
  begun = true;
  if (liveSource) {
    bus.emit({ type: "cue", name: "reset" });
    liveSource.start();
  } else void director.start();
}

// ── presenter HUD ──
const beatEl = h("b", {}, "—");
const pauseEl = h("span", { class: "hud-pause" }, "");
const hud = h(
  "div",
  { class: "hud" },
  h("span", { class: "hud-mode" }, live ? "LIVE" : "SCRIPTED"),
  beatEl,
  pauseEl,
  h("span", { class: "hud-keys" }, "SPACE pause · → skip · R restart · M mute · F full · H hide"),
);
stage.append(hud);
director.onBeat = (n) => (beatEl.textContent = n);

const setMuted = (m: boolean) => {
  sfx.setMuted(m);
  director.tts.muted = m;
  if (m) director.tts.cancel();
  hud.classList.toggle("is-muted", m);
};
if (params.has("mute")) setMuted(true);

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === " " || k === "enter") {
    e.preventDefault();
    if (!begun) return begin();
    if (live) return;
    const p = director.togglePause();
    if (p) pausedAt = performance.now();
    else if (pausedAt) {
      pausedTotal += performance.now() - pausedAt;
      pausedAt = 0;
    }
    pauseEl.textContent = p ? "PAUSED" : "";
    stage.classList.toggle("is-paused", p);
  }
  if (k === "arrowright" && begun && !live) director.skip();
  if (k === "r") {
    sfx.ambienceOff(0.3);
    director.tts.cancel();
    stage.classList.remove("is-paused");
    pauseEl.textContent = "";
    begun = true;
    if (live) {
      liveSource?.stop();
      bus.emit({ type: "cue", name: "reset" });
      liveSource = new LiveSource(bus, liveUrl);
      liveSource.start();
    } else director.restart();
  }
  if (k === "escape") {
    director.stop();
    liveSource?.stop();
    sfx.ambienceOff(0.3);
    bus.emit({ type: "cue", name: "reset" });
    overlays.showTitle();
    begun = false;
  }
  if (k === "m") setMuted(!sfx.muted);
  if (k === "h") hud.classList.toggle("is-hidden");
  if (k === "f") {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
});

// ── fixed 1920×1080 canvas, scaled to fit ──
const fit = () => {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
};
window.addEventListener("resize", fit);
fit();

if (params.has("autostart")) begin();
