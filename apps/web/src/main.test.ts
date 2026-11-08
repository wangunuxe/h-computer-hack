// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recorders: [] as { callbacks: Function[]; cancel(): void }[], resume: vi.fn() }));
vi.mock('./recorder.js', () => ({ Recorder: class {
  callbacks: Function[];
  constructor(...callbacks: Function[]) { this.callbacks = callbacks; mocks.recorders.push(this); }
  async start() {}
  stop() {}
  cancel() { this.callbacks[2]!(); }
} }));
vi.mock('./speech.js', () => ({ BrowserSpeech: class {}, SpeechQueue: class {
  idle = true; enqueue() {} unlock() {} hold() {} bargeIn() {} resume = mocks.resume;
} }));
class Socket {
  static OPEN = 1; static CONNECTING = 0; static instances: Socket[] = [];
  readyState = 0; send = vi.fn();
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: (event: { code: number }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
let documentEvents: ReturnType<typeof vi.spyOn>, windowEvents: ReturnType<typeof vi.spyOn>;
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function boot() { await import('./main.js'); await flush(); const socket = Socket.instances[0]!; socket.open(); socket.send.mockClear(); return socket; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules(); mocks.recorders = []; mocks.resume.mockClear(); Socket.instances = [];
  document.body.innerHTML = readFileSync('index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const key of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>();
    vi.stubGlobal(key, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  }
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'issued', resume_token: 'token' }))));
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  documentEvents = vi.spyOn(document, 'addEventListener'); windowEvents = vi.spyOn(window, 'addEventListener');
});
afterEach(() => {
  for (const [type, listener] of documentEvents?.mock.calls ?? []) if (type === 'visibilitychange') document.removeEventListener(type, listener as EventListener);
  for (const [type, listener] of windowEvents?.mock.calls ?? []) if (['pagehide', 'pageshow'].includes(type as string)) window.removeEventListener(type as string, listener as EventListener);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe('phone client lifecycle and controls', () => {
  it('focuses and labels dynamically shown GPS decision controls', async () => {
    const socket = await boot(); document.getElementById('talk')!.focus();
    socket.message({ type: 'stage', stage: 'CLARIFY' }); socket.message({ type: 'clarify', question: 'Use this origin?', yes_no: true });
    expect(document.activeElement?.getAttribute('role')).toBe('group');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Yes / No');
    expect(document.getElementById('confirm-yes')?.getAttribute('aria-label')).toBe('Yes');
  });
  it('does not resume old playback while a newer recorder is capturing', async () => {
    await boot(); const talk = document.getElementById('talk')!; talk.click();
    const first = mocks.recorders[0]!; first.cancel(); talk.click();
    mocks.resume.mockClear(); first.callbacks[5]!();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it('reconnects a restored payment tab even without visibilitychange', async () => {
    const socket = await boot(); socket.readyState = 3;
    const event = new Event('pageshow'); Object.defineProperty(event, 'persisted', { value: true }); window.dispatchEvent(event); await flush();
    expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1]!.url).toBe(socket.url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('submits an option only once before the server responds', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'CHOOSE' });
    socket.message({ type: 'options', items: [{ id: 'taxi', name: 'Taxi', price: 30, pickup_wait_minutes: 5, journey_minutes: 25, guide_dog_status: 'accepted' }] });
    const option = document.querySelector<HTMLButtonElement>('.option-card')!; option.click(); option.click();
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
  it('does not submit a detached approval button after its stage changed', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'CONFIRM' }); socket.message({ type: 'confirm', summary: 'Approve taxi' });
    const yes = document.getElementById('confirm-yes')!;
    socket.message({ type: 'stage', stage: 'EXECUTE' }); yes.click();
    expect(socket.send).not.toHaveBeenCalled();
  });
});
