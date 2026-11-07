import { WebSocket } from 'ws';
import type { MonitorEvent, MonitorMessage, ServerEvent } from '@voila/shared';

type PublishedEvent = ServerEvent | MonitorEvent;
type BufferedMessage = { message: MonitorMessage };
type SessionBuffer = { messages: BufferedMessage[]; session?: BufferedMessage; frame?: BufferedMessage };
type MonitorClient = { ws: WebSocket; pinned: boolean; session?: string };

const MAX_MESSAGES = 300;
const MAX_SESSIONS = 20;
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;

export class MonitorHub {
  private sessions = new Map<string, SessionBuffer>();
  private clients = new Set<MonitorClient>();
  private latestSession?: string;

  publish(session: string, event: PublishedEvent) {
    const message: MonitorMessage = { session, at: new Date().toISOString(), event };
    let buffer = this.sessions.get(session);
    if (!buffer || event.type === 'session') buffer = { messages: [] };
    this.sessions.delete(session);
    this.sessions.set(session, buffer);

    if (event.type === 'stage' && event.stage === 'LISTEN') {
      buffer.frame = undefined;
      buffer.messages = buffer.messages.filter(({ message }) =>
        message.event.type !== 'agent_view' && message.event.type !== 'agent_metrics');
    }

    const buffered = { message };
    if (event.type === 'session') buffer.session = buffered;
    else if (event.type === 'agent_frame') buffer.frame = buffered;
    else {
      buffer.messages.push(buffered);
      if (buffer.messages.length > MAX_MESSAGES) buffer.messages.shift();
    }
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);

    const switched = event.type === 'session' && this.latestSession !== session;
    if (event.type === 'session') this.latestSession = session;
    for (const client of this.clients) {
      if (client.pinned) {
        if (client.session === session) this.send(client, buffered);
      } else if (switched) {
        client.session = session;
        this.sendBuffer(client, session);
      } else if (client.session === session) this.send(client, buffered);
    }
  }

  subscribe(ws: WebSocket, session?: string) {
    const client: MonitorClient = { ws, pinned: session !== undefined, session };
    this.clients.add(client);
    if (session !== undefined) this.sendBuffer(client, session);
    else if (this.latestSession) {
      client.session = this.latestSession;
      this.sendBuffer(client, this.latestSession);
    }
    return () => this.clients.delete(client);
  }

  private sendBuffer(client: MonitorClient, session: string) {
    const buffer = this.sessions.get(session);
    if (!buffer) return;
    if (buffer.session) this.send(client, buffer.session);
    for (const item of buffer.messages) this.send(client, item);
    if (buffer.frame) this.send(client, buffer.frame);
  }

  private send(client: MonitorClient, item: BufferedMessage) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (item.message.event.type === 'agent_frame' && client.ws.bufferedAmount > MAX_BUFFERED_AMOUNT) return;
    try { client.ws.send(JSON.stringify(item.message)); } catch { /* A closed monitor must not affect the phone session. */ }
  }
}
