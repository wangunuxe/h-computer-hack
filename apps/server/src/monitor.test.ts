import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { MonitorMessageSchema, type MonitorEvent, type MonitorMessage, type ServerEvent } from '@voila/shared';
import { MonitorHub } from './monitor.js';

const startedAt = '2026-11-07T12:00:00Z';
const sessionEvent = (name: string): MonitorEvent => ({ type: 'session', name, scenario: 'demo', started_at: startedAt });
const messages = (sent: string[]) => sent.map((message) => MonitorMessageSchema.parse(JSON.parse(message) as MonitorMessage));
function socket(bufferedAmount = 0) {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send: vi.fn((message: string) => sent.push(message)),
  } as unknown as WebSocket;
  return { ws, sent };
}

describe('MonitorHub', () => {
  it('sends a session buffer followed by live events', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    hub.publish('s1', { type: 'stage', stage: 'LISTEN' });
    const client = socket();
    hub.subscribe(client.ws);
    expect(messages(client.sent).map(({ event }) => event.type)).toEqual(['session', 'stage']);
    hub.publish('s1', { type: 'say', text: 'Ready' });
    expect(messages(client.sent).at(-1)?.event).toEqual({ type: 'say', text: 'Ready' });
  });

  it('follows the latest session and switches with its reset event', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    hub.publish('s1', { type: 'stage', stage: 'RESEARCH' });
    const follower = socket();
    hub.subscribe(follower.ws);
    hub.publish('s2', sessionEvent('Karim'));
    hub.publish('s1', { type: 'feed', kind: 'agent', text: 'stale session' });
    hub.publish('s2', { type: 'stage', stage: 'LISTEN' });
    expect(messages(follower.sent).map(({ session, event }) => [session, event.type])).toEqual([
      ['s1', 'session'], ['s1', 'stage'], ['s2', 'session'], ['s2', 'stage'],
    ]);
  });

  it('pins a client to the requested session', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    const pinned = socket();
    hub.subscribe(pinned.ws, 's1');
    hub.publish('s2', sessionEvent('Karim'));
    hub.publish('s2', { type: 'stage', stage: 'LISTEN' });
    hub.publish('s1', { type: 'stage', stage: 'CHOOSE' });
    expect(messages(pinned.sent).map(({ session, event }) => [session, event.type])).toEqual([
      ['s1', 'session'], ['s1', 'stage'],
    ]);
  });

  it('buffers only the latest frame alongside non-frame events', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    hub.publish('s1', { type: 'agent_frame', image: 'data:image/png;base64,one', step: 1 });
    hub.publish('s1', { type: 'feed', kind: 'agent', text: 'Filling the form' });
    hub.publish('s1', { type: 'agent_frame', image: 'data:image/png;base64,two', step: 2 });
    const client = socket();
    hub.subscribe(client.ws, 's1');
    const events = messages(client.sent).map(({ event }) => event);
    expect(events).toContainEqual({ type: 'agent_frame', image: 'data:image/png;base64,two', step: 2 });
    expect(events.some((event) => event.type === 'agent_frame' && event.step === 1)).toBe(false);
    expect(events.map(({ type }) => type)).toEqual(['session', 'feed', 'agent_frame']);
  });

  it('clears prior monitor history when the session is reset', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    hub.publish('s1', {
      type: 'profile',
      profile: { name: 'Amina', phone: '+33612345678', email: 'amina@example.com', language: 'en', guide_dog: true },
    });
    hub.publish('s1', { type: 'say', text: 'Your number is +33612345678.' });
    hub.publish('s1', { type: 'agent_frame', image: 'data:image/png;base64,private-frame', step: 1 });

    hub.publish('s1', sessionEvent('User'));
    hub.publish('s1', { type: 'profile', profile: { language: 'en' } });
    hub.publish('s1', { type: 'stage', stage: 'LISTEN' });

    const client = socket();
    hub.subscribe(client.ws);
    const received = messages(client.sent);
    expect(received.map(({ event }) => event.type)).toEqual(['session', 'profile', 'stage']);
    expect(received[0]?.event).toEqual(sessionEvent('User'));
    expect(JSON.stringify(received)).not.toContain('Amina');
    expect(JSON.stringify(received)).not.toContain('+33612345678');
    expect(JSON.stringify(received)).not.toContain('private-frame');
  });

  it('skips frames for clients over the backpressure limit', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    hub.publish('s1', { type: 'agent_frame', image: 'data:image/png;base64,frame', step: 1 });
    const backedUp = socket(8 * 1024 * 1024 + 1);
    hub.subscribe(backedUp.ws, 's1');
    expect(messages(backedUp.sent).map(({ event }) => event.type)).toEqual(['session']);
  });

  it('retains only the 300 latest non-frame messages', () => {
    const hub = new MonitorHub();
    hub.publish('s1', sessionEvent('Amina'));
    for (let index = 0; index < 301; index++) {
      hub.publish('s1', { type: 'error', message: `error ${index}` } satisfies ServerEvent);
    }
    const client = socket();
    hub.subscribe(client.ws, 's1');
    const events = messages(client.sent).map(({ event }) => event);
    expect(events).toHaveLength(300);
    expect(events[0]).toEqual({ type: 'error', message: 'error 1' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'error 300' });
  });

  it('evicts the least recently active session buffers at the 20-session cap', () => {
    const hub = new MonitorHub();
    for (let index = 0; index < 21; index++) hub.publish(`s${index}`, sessionEvent(`Person ${index}`));
    const evicted = socket();
    hub.subscribe(evicted.ws, 's0');
    expect(messages(evicted.sent)).toEqual([]);
    const retained = socket();
    hub.subscribe(retained.ws, 's1');
    expect(messages(retained.sent)).toHaveLength(1);
  });
});
