import "./styles/phone.css";
import { Bus } from "./core/bus";
import { Director } from "./core/director";
import { sfx } from "./core/audio";
import { heroScenario } from "./sources/hero-scenario";
import { LiveSource } from "./sources/live";
import { mountPhone } from "./ui/phone";
import { fmtHM } from "./core/dom";

/** Standalone phone web page. `?source=live&ws=…` for the real backend, otherwise the scripted hero scenario. */
const params = new URLSearchParams(location.search);
const root = document.getElementById("phone-root")!;
const bus = new Bus();
const phone = mountPhone(root, bus, { framed: false });
setInterval(() => phone.setTime(fmtHM(new Date())), 1000);

let started = false;
const start = () => {
  if (started) return;
  started = true;
  sfx.ensure();
  if (params.get("source") === "live") new LiveSource(bus, params.get("ws") ?? `wss://${location.host}/ws/session/demo`).start();
  else void new Director(bus, heroScenario({ coldOpen: false })).start();
};
root.querySelector(".ph-talk")?.addEventListener("click", start);
