import type { AgentAction, ServerEvent } from "@voila/shared";
import type { Bus, BusEvent, EventSourceLike } from "./bus";
import { sfx } from "./audio";
import { Tts } from "./tts";

class Aborted extends Error {}

/**
 * Runs a scripted scenario against the bus with presenter controls:
 * pause / resume, skip to next beat, restart, speed.
 */
export class Director implements EventSourceLike {
  paused = false;
  speed = 1;
  readonly tts = new Tts();
  private gen = 0;
  private skipping = false;
  private resumeWaiters: (() => void)[] = [];
  onBeat?: (name: string) => void;

  constructor(
    private bus: Bus,
    private script: (d: Director) => Promise<void>,
  ) {}

  async start() {
    const my = ++this.gen;
    this.skipping = false;
    this.paused = false;
    this.bus.emit({ type: "cue", name: "reset" });
    try {
      await this.script(this);
    } catch (e) {
      if (!(e instanceof Aborted) || my === this.gen) throw e;
    }
  }

  stop() {
    this.gen++;
    this.tts.cancel();
    this.resumeWaiters.splice(0).forEach((r) => r());
  }

  restart() {
    this.stop();
    void this.start();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      if ("speechSynthesis" in window) speechSynthesis.pause();
    } else {
      if ("speechSynthesis" in window) speechSynthesis.resume();
      this.resumeWaiters.splice(0).forEach((r) => r());
    }
    return this.paused;
  }

  skip() {
    this.skipping = true;
    this.tts.cancel();
    if (this.paused) this.togglePause();
  }

  get isSkipping() {
    return this.skipping;
  }

  private check(gen: number) {
    if (gen !== this.gen) throw new Aborted();
  }

  private async gate(gen: number) {
    while (this.paused) {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
      this.check(gen);
    }
  }

  /** Mark the start of a skippable section. */
  beat(name: string) {
    this.skipping = false;
    this.onBeat?.(name);
  }

  emit(e: ServerEvent | BusEvent) {
    this.bus.emit(e);
  }

  agent(action: AgentAction) {
    this.bus.emit({ type: "agent", action });
  }

  async wait(ms: number) {
    const gen = this.gen;
    let left = ms;
    while (left > 0) {
      this.check(gen);
      await this.gate(gen);
      if (this.skipping) return;
      const step = Math.min(50, left);
      await new Promise((r) => setTimeout(r, step));
      left -= step * this.speed;
    }
    this.check(gen);
  }

  /** Voilà speaks: caption + TTS, resolves when finished. */
  async say(text: string) {
    const gen = this.gen;
    await this.gate(gen);
    this.emit({ type: "say", text });
    if (this.skipping) return;
    const speaking = this.speed === 1 ? this.tts.speak(text) : this.wait(Tts.estimateMs(text));
    const interrupt = this.untilSkipOrAbort(gen);
    await Promise.race([speaking, interrupt.promise]);
    interrupt.cancel();
    this.check(gen);
    await this.wait(250);
  }

  /** The traveller speaks: streamed partial transcript, then final. */
  async userSays(text: string, wordMs = 230) {
    const gen = this.gen;
    sfx.listenStart();
    this.emit({ type: "cue", name: "user_say", text });
    const words = text.split(" ");
    for (let i = 1; i <= words.length; i++) {
      this.check(gen);
      this.emit({ type: "transcript", text: words.slice(0, i).join(" "), final: false });
      await this.wait(wordMs);
    }
    this.emit({ type: "transcript", text, final: true });
    sfx.listenStop();
    await this.wait(300);
  }

  /** Voilà speaks without blocking the script (progress narration while the agent works). */
  narrate(text: string) {
    this.emit({ type: "say", text });
    if (!this.skipping && this.speed === 1) void this.tts.speak(text);
  }

  private untilSkipOrAbort(gen: number) {
    let iv = 0;
    const promise = new Promise<void>((resolve) => {
      iv = window.setInterval(() => {
        if (this.skipping || gen !== this.gen) {
          clearInterval(iv);
          resolve();
        }
      }, 40);
    });
    return { promise, cancel: () => clearInterval(iv) };
  }
}
