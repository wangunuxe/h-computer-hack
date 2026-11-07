import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { HaiAgentsClient, type SessionHandle } from 'hai-agents';
import { WebSocket } from 'ws';
import { ServerEventSchema } from '@voila/shared';
import { runBooking } from './booking.js';
import { createSessionServer } from './index.js';

export function finishOnce(complete: (reason: string) => void) {
  let finished = false;
  return (reason: string) => {
    if (finished) return;
    finished = true;
    complete(reason);
  };
}

export async function smokeSession() {
  const started = performance.now();
  const log = (value: unknown) => console.log(`[+${((performance.now() - started) / 1000).toFixed(3)}s] ${JSON.stringify(value)}`);
  const client = new HaiAgentsClient();
  let handle: SessionHandle<unknown> | undefined;
  const observedClient = new Proxy(client, {
    get(target, key) {
      if (key === 'startSession') return async (...args: unknown[]) => {
        const session: SessionHandle<unknown> = await Reflect.apply(target.startSession, target, args);
        handle = session;
        log({ hSessionId: session.id });
        return session;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  let bookingTask: ReturnType<typeof runBooking> | undefined;
  const running = createSessionServer({ port: 0, hostname: '127.0.0.1', ports: {
    runBooking: (input) => {
      bookingTask = runBooking(input, observedClient).then((result) => {
        log({ hMetrics: result.metrics, agentViewUrl: result.agentViewUrl });
        return result;
      }, (error: unknown) => { log({ hError: error instanceof Error ? error.message : 'Booking failed' }); throw error; });
      return bookingTask;
    },
  } });
  let ws: WebSocket | undefined;
  let firstSayMs: number | undefined;
  let presentMs: number | undefined;
  let handoff = false;
  let awaitingPayment = false;
  let chosen = false;
  let outcome = 'timeout';
  let totalMs = 0;
  try {
    if (!running.server.listening) await once(running.server, 'listening');
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listening port');
    const issued = await (await running.app.request('/session', { method: 'POST' })).json() as { id: string; resume_token: string };
    ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${issued.id}?token=${encodeURIComponent(issued.resume_token)}`);
    const socket = ws;
    await new Promise<void>((resolve) => {
      const finish = finishOnce((reason) => { outcome = reason; totalMs = Math.round(performance.now() - started); clearTimeout(timer); resolve(); });
      const timer = setTimeout(() => finish('timeout'), 6 * 60_000);
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'hello', profile: { name: 'Karim Demo', language: 'fr', guide_dog: true, phone: '+33612345678', email: 'karim@example.com' }, gps: null }));
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
        const transcript = `Je suis à Gare du Nord, mon vol part de CDG terminal 2E ${hour >= 20 ? 'demain' : 'ce soir'} à 23h, j'ai un chien guide et une valise`;
        log({ transcript });
        socket.send(JSON.stringify({ type: 'final_transcript', text: transcript }));
      });
      socket.on('message', (raw) => {
        const parsed = ServerEventSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) { log({ invalidEvent: true }); finish('invalid_event'); return; }
        const event = parsed.data;
        log(event);
        if (event.type === 'say' && firstSayMs === undefined) firstSayMs = Math.round(performance.now() - started);
        if (event.type === 'stage' && event.stage === 'PRESENT' && presentMs === undefined) presentMs = Math.round(performance.now() - started);
        if (event.type === 'stage' && event.stage === 'CHOOSE' && !chosen) {
          chosen = true; socket.send(JSON.stringify({ type: 'user_reply', text: 'la navette' }));
        }
        if (event.type === 'confirm') socket.send(JSON.stringify({ type: 'user_reply', text: 'oui' }));
        if (event.type === 'payment_handoff') handoff = true;
        if (event.type === 'stage' && event.stage === 'AWAIT_PAYMENT') awaitingPayment = true;
        if (event.type === 'error') finish('error');
        else if (handoff && awaitingPayment) finish('handoff_and_await_payment');
      });
      socket.on('error', () => { log({ socketError: true }); finish('socket_error'); });
      socket.on('close', () => finish('socket_closed'));
    });
  } finally {
    log({ outcome, firstSayMs, presentMs, totalMs });
    ws?.terminate();
    await running.close();
    if (bookingTask) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([bookingTask.catch(() => {}), new Promise<void>((resolve) => { timer = setTimeout(resolve, 20_000); })]);
      clearTimeout(timer);
    }
    if (handle) {
      try { log({ hSessionId: handle.id, hStatus: await handle.status() }); }
      catch { log({ hStatusError: true }); }
    }
    try { log({ hQuota: await client.sessions.getSessionQuota() }); }
    catch { log({ hQuotaError: true }); }
  }
  if (outcome !== 'handoff_and_await_payment') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeSession().catch(() => { console.error('Session smoke failed.'); process.exitCode = 1; });
}
