// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatchPage } from './showcase-live.js';
import QRCode from 'qrcode';
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => {}) } }));
class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  close(code = 1000) { this.onclose?.({ code }); }
  message(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = [];
  document.body.innerHTML = '<p id="showcase-status"></p><div id="pairing"><canvas id="pairing-qr"></canvas><strong id="pairing-code"></strong></div><a id="phone-client-link" href="/?client=phone"></a><span id="phone-client-url"></span>';
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.clearAllMocks(); });
describe('live showcase pairing DOM', () => {
  it('shows a local QR alongside mock mode, switches on pair, returns to mock on disconnect, and reconnects read-only', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'ABC234', watch_id: 'id', watch_token: 'private-token' }), { status: 201 }));
    const modes = vi.fn(), events = vi.fn(); window.addEventListener('showcase-mode', modes); window.addEventListener('showcase-event', events);
    try {
      stop = startWatchPage({ fetcher, Socket: Socket as unknown as typeof WebSocket }); await vi.advanceTimersByTimeAsync(0);
      const ws = Socket.instances[0]!; ws.onopen?.(); ws.message({ type: 'unpaired' });
      expect(document.getElementById('pairing')!.hidden).toBe(false);
      expect(document.getElementById('pairing-code')!.textContent).toBe('ABC234');
      expect(QRCode.toCanvas).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/?client=phone&scenario=live&watch=ABC234'), expect.anything());
      ws.message({ type: 'paired', stage: 'LISTEN' }); expect(document.getElementById('pairing')!.hidden).toBe(true);
      expect(document.getElementById('showcase-status')!.textContent).toBe('Connected to phone');
      ws.message({ type: 'watch', event: { type: 'say', text: 'Real narration' } }); expect(events.mock.calls.at(-1)![0].detail.text).toBe('Real narration');
      const count = events.mock.calls.length; ws.message({ type: 'watch', event: { type: 'profile', profile: { language: 'fr', name: 'private' } } }); expect(events).toHaveBeenCalledTimes(count);
      ws.close(1006); expect(document.getElementById('pairing')!.hidden).toBe(false); expect(document.getElementById('showcase-status')!.textContent).toContain('Disconnected');
      expect(modes.mock.calls.at(-1)![0].detail.paired).toBe(false);
      await vi.advanceTimersByTimeAsync(1000); expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1]!.url).toBe(ws.url); expect(fetcher).toHaveBeenCalledOnce();
      Socket.instances[1]!.message({ type: 'unpaired' }); expect(document.getElementById('showcase-status')!.textContent).toContain('sample replay');
    } finally { window.removeEventListener('showcase-mode', modes); window.removeEventListener('showcase-event', events); }
  });
  it('reports API failure and retries instead of showing a false connected state', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429 }));
    stop = startWatchPage({ fetcher }); await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('showcase-status')!.textContent).toContain('pairing unavailable'); expect(document.getElementById('pairing')!.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refreshes the code, QR and phone link after an expired ticket', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ABC234', watch_id: 'old', watch_token: 'old-token' }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'NEW234', watch_id: 'new', watch_token: 'new-token' })));
    stop = startWatchPage({ fetcher, Socket: Socket as unknown as typeof WebSocket }); await vi.advanceTimersByTimeAsync(0);
    Socket.instances[0]!.close(4401); await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById('pairing-code')!.textContent).toBe('NEW234'); expect(document.getElementById('phone-client-link')!.getAttribute('href')).toContain('watch=NEW234');
    expect(QRCode.toCanvas).toHaveBeenLastCalledWith(expect.anything(), expect.stringContaining('watch=NEW234'), expect.anything()); expect(Socket.instances[1]!.url).toContain('/ws/watch/new');
  });
});
