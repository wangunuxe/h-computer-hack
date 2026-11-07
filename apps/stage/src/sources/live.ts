import type { ClientEvent, ServerEvent } from "../core/protocol";
import type { Bus, EventSourceLike } from "../core/bus";

/** Live mode: forwards events from the Voilà server (`/ws/session/:id`) onto the bus. */
export class LiveSource implements EventSourceLike {
  private ws?: WebSocket;

  constructor(
    private bus: Bus,
    private url: string,
  ) {}

  start() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (m) => {
      try {
        this.bus.emit(JSON.parse(String(m.data)) as ServerEvent);
      } catch {
        this.bus.emit({ type: "error", message: "Malformed server event" });
      }
    };
    this.ws.onclose = () => this.bus.emit({ type: "feed", kind: "warn", text: "Live session disconnected" });
  }

  send(e: ClientEvent) {
    this.ws?.send(JSON.stringify(e));
  }

  stop() {
    this.ws?.close();
  }
}
