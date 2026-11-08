import QRCode from 'qrcode';
import { WatchEventSchema } from '@voila/shared';
import { ConnectionAttempt } from './connection.js';

type Ticket = { watch_id: string; watch_token: string; code: string };
export function startWatchPage({ fetcher = fetch, Socket = WebSocket }: { fetcher?: typeof fetch; Socket?: typeof WebSocket } = {}) {
  const status = document.getElementById('showcase-status')!;
  const pairing = document.getElementById('pairing')!;
  let socket: WebSocket | undefined, ticket: Ticket | undefined, retry: ReturnType<typeof setTimeout> | undefined, stopped = false, delay = 1000, generation = 0;
  let connectionAttempt: ConnectionAttempt | undefined;
  const mode = (paired: boolean, stage?: string) => { pairing.hidden = paired; window.dispatchEvent(new CustomEvent('showcase-mode', { detail: { paired, stage } })); };
  const schedule = () => { if (!stopped) { retry = setTimeout(() => void connect(), delay); delay = Math.min(15000, delay * 2); } };
  async function connect() {
    const attempt = ++generation;
    const current = connectionAttempt = new ConnectionAttempt(() => {
      if (stopped || generation !== attempt) return;
      ++generation;
      const ws = socket; socket = undefined; ws?.close();
      mode(false); status.textContent = 'Disconnected · connection timed out · retrying'; schedule();
    });
    try {
      if (!ticket) {
        const response = await fetcher('/watch', { method: 'POST', signal: current.controller.signal });
        if (!response.ok) throw new Error('Pairing unavailable');
        const issued = await response.json() as Ticket;
        if (stopped || generation !== attempt) return;
        ticket = issued;
        const url = new URL('/?client=phone&scenario=live', location.origin); url.searchParams.set('watch', ticket.code);
        document.getElementById('pairing-code')!.textContent = ticket.code;
        const link = document.getElementById('phone-client-link') as HTMLAnchorElement; link.href = url.href;
        document.getElementById('phone-client-url')!.textContent = url.href;
        await QRCode.toCanvas(document.getElementById('pairing-qr'), url.href, { width: 116, margin: 1 });
      }
      if (stopped || generation !== attempt) return;
      const url = new URL('/ws/watch/' + ticket.watch_id, location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', ticket.watch_token);
      const ws = socket = new Socket(url.href);
      ws.onopen = () => { if (socket !== ws || stopped) return; current.clear(); delay = 1000; status.textContent = 'Scan with the phone · sample replay'; };
      ws.onmessage = (message) => {
        if (socket !== ws || stopped) return;
        let event; try { event = WatchEventSchema.parse(JSON.parse(message.data)); } catch { return; }
        if (event.type === 'paired') { mode(true, event.stage); status.textContent = 'Connected to phone'; window.dispatchEvent(new CustomEvent('showcase-event', { detail: { type: 'stage', stage: event.stage } })); }
        else if (event.type === 'unpaired') { mode(false); status.textContent = 'Scan with the phone · sample replay'; }
        else window.dispatchEvent(new CustomEvent('showcase-event', { detail: event.event }));
      };
      ws.onclose = (event) => { if (socket !== ws || stopped) return; current.cancel(); mode(false); status.textContent = 'Disconnected · reconnecting · sample replay'; if (event.code === 4401) ticket = undefined; schedule(); };
      ws.onerror = () => ws.close();
    } catch { if (stopped || generation !== attempt) return; current.cancel(); mode(false); status.textContent = 'Disconnected · pairing unavailable · retrying'; schedule(); }
  }
  void connect();
  const pause = () => { stopped = true; ++generation; clearTimeout(retry); connectionAttempt?.cancel(); const ws = socket; socket = undefined; ws?.close(); };
  const resume = (event: PageTransitionEvent) => { if (event.persisted && stopped) { stopped = false; delay = 1000; mode(false); status.textContent = 'Disconnected · reconnecting · sample replay'; void connect(); } };
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  return () => { window.removeEventListener('pagehide', pause); window.removeEventListener('pageshow', resume); pause(); };
}
