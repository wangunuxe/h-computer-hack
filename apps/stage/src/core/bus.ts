import type { ServerEvent } from "./protocol";

/** Stage-only cues that are not part of the server protocol. */
export type DirectorCue =
  | { type: "cue"; name: "focus"; panel: "phone" | "feed" | "agent" | null }
  | { type: "cue"; name: "coldopen"; lines: string[] }
  | { type: "cue"; name: "coldopen_end" }
  | { type: "cue"; name: "listen_start" }
  | { type: "cue"; name: "finale"; stats: { label: string; value: string }[] }
  | { type: "cue"; name: "reset" }
  | { type: "cue"; name: "user_say"; text: string }
  | { type: "cue"; name: "pipeline"; show: boolean };

export type BusEvent = ServerEvent | DirectorCue;
type Handler = (e: BusEvent) => void;

export class Bus {
  private handlers = new Set<Handler>();
  on(fn: Handler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  emit(e: BusEvent) {
    for (const fn of this.handlers) fn(e);
  }
}

/** Anything that produces session events: the scripted demo or a live backend. */
export interface EventSourceLike {
  start(): void | Promise<void>;
  stop(): void;
}
