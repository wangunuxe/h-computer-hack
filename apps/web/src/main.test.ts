// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labels } from './labels.js';

const mocks = vi.hoisted(() => ({ recorders: [] as { callbacks: Function[]; stop: ReturnType<typeof vi.fn>; cancel(): void }[], resume: vi.fn(), enqueue: vi.fn(), hold: vi.fn(), unlock: vi.fn(), bargeIn: vi.fn() }));
vi.mock('./recorder.js', () => ({ Recorder: class {
  callbacks: Function[];
  constructor(...callbacks: Function[]) { this.callbacks = callbacks; mocks.recorders.push(this); }
  async start() {}
  stop = vi.fn();
  cancel() { this.callbacks[2]!(); }
} }));
vi.mock('./speech.js', () => ({ BrowserSpeech: class {}, SpeechQueue: class {
  idle = true; enqueue = mocks.enqueue; unlock = mocks.unlock; hold = mocks.hold; bargeIn = mocks.bargeIn; resume = mocks.resume;
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
async function boot(open = true) { await import('./main.js'); await flush(); const socket = Socket.instances[0]!; if (open) socket.open(); socket.send.mockClear(); return socket; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules(); mocks.recorders = []; mocks.resume.mockClear(); mocks.enqueue.mockClear(); Socket.instances = [];
  mocks.hold.mockClear(); mocks.unlock.mockClear(); mocks.bargeIn.mockClear();
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
  it.each(['fr', 'en'] as const)('retries an early activation without queuing capture in %s', async (language) => {
    const vibrate = vi.fn(); vi.stubGlobal('navigator', { language, vibrate });
    const stale = await boot(false), talk = document.getElementById('talk')!;
    mocks.enqueue.mockClear(); talk.click();
    expect(vibrate).not.toHaveBeenCalled();
    expect(stale.readyState).toBe(3); expect(Socket.instances).toHaveLength(2);
    expect(mocks.recorders).toHaveLength(0);
    expect(talk.getAttribute('aria-pressed')).toBe('false');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(document.getElementById('errors')!.textContent).toBe('');
    const socket = Socket.instances[1]!;
    socket.open();
    expect(mocks.recorders).toHaveLength(0);
    expect(document.getElementById('errors')!.textContent).toBe('');
    talk.click(); expect(mocks.recorders).toHaveLength(1);
    expect(talk.getAttribute('aria-label')).toBe(labels[language].stopListening);
    expect(vibrate).toHaveBeenCalledWith(35);
  });
  it('retries before credentials exist without starting when the replacement session connects', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; })).mockImplementation(async () => new Response(JSON.stringify({ id: 'replacement', resume_token: 'token' }))));
    await import('./main.js'); await flush();
    document.getElementById('talk')!.click();
    expect(fetch).toHaveBeenCalledTimes(2); expect(mocks.recorders).toHaveLength(0);
    resolve(new Response(JSON.stringify({ id: 'issued', resume_token: 'token' }))); await flush();
    expect(Socket.instances).toHaveLength(1); expect(Socket.instances[0]!.url).toContain('/replacement?');
    Socket.instances[0]!.open(); await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.recorders).toHaveLength(0);
    document.getElementById('talk')!.click(); expect(mocks.recorders).toHaveLength(1);
  });
  it('preserves explicit connection retry after failure rather than arming a stale start', async () => {
    const socket = await boot(false); socket.close();
    expect(document.getElementById('errors')!.textContent).toBe('');
    expect(mocks.enqueue).not.toHaveBeenCalledWith(labels.en.connectionRetry);
    document.getElementById('talk')!.click(); await flush();
    expect(Socket.instances).toHaveLength(2);
    Socket.instances[1]!.open(); expect(mocks.recorders).toHaveLength(0);
    expect(document.getElementById('errors')!.textContent).toBe('');
  });
  it('ignores touch/pen pointer sequences and toggles only on click', async () => {
    await boot(); const talk = document.getElementById('talk')!;
    for (const pointerType of ['touch', 'pen']) {
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) talk.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 40 }));
      expect(mocks.recorders).toHaveLength(0);
    }
    for (const detail of [0, 1]) {
      talk.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
      expect(mocks.recorders).toHaveLength(detail + 1);
      const recorder = mocks.recorders[detail]!;
      expect(recorder.stop).not.toHaveBeenCalled();
      talk.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(recorder.stop).toHaveBeenCalledOnce(); recorder.cancel();
    }
  });
  it.each(['background', 'socket close', 'pagehide'])('ignores focus/blur but still cancels recording on %s', async (kind) => {
    const socket = await boot(), talk = document.getElementById('talk')!;
    talk.click(); const recorder = mocks.recorders[0]!, cancel = vi.spyOn(recorder, 'cancel');
    talk.focus(); talk.blur();
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur'));
    expect(cancel).not.toHaveBeenCalled(); expect(recorder.stop).not.toHaveBeenCalled();
    if (kind === 'background') { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1000); }
    else if (kind === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else socket.close();
    expect(cancel).toHaveBeenCalledOnce(); expect(recorder.stop).not.toHaveBeenCalled();
    expect(talk.getAttribute('aria-pressed')).toBe('false');
  });
  it('preserves active capture across a transient hidden event', async () => {
    await boot(); const talk = document.getElementById('talk')!;
    talk.click();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(999);
    expect(talk.getAttribute('aria-pressed')).toBe('true');
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1001);
    expect(talk.getAttribute('aria-pressed')).toBe('true'); expect(Socket.instances).toHaveLength(1);
    expect(mocks.recorders).toHaveLength(1); expect(mocks.recorders[0]!.stop).not.toHaveBeenCalled();
  });
  it('cancels and holds speech before unlocking a first recording, without resuming the queue', async () => {
    await boot(); document.getElementById('talk')!.click();
    expect(mocks.bargeIn).toHaveBeenCalledBefore(mocks.hold);
    expect(mocks.hold).toHaveBeenCalledBefore(mocks.unlock);
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenLastCalledWith(labels.en.welcome);
    mocks.recorders[0]!.callbacks[5]!(); expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it.each(['fr', 'en'] as const)('toggles the microphone only on activation and submits once after stopping in %s', async (language) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    const socket = await boot();
    const talk = document.getElementById('talk') as HTMLButtonElement;
    expect(talk.type).toBe('button');
    expect(talk.getAttribute('aria-pressed')).toBe('false');
    expect(talk.getAttribute('aria-label')).toBe(labels[language].tap);
    for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend']) talk.dispatchEvent(new Event(type, { bubbles: true }));
    expect(mocks.recorders).toHaveLength(0);
    talk.click();
    const recorder = mocks.recorders[0]!;
    expect(talk.getAttribute('aria-pressed')).toBe('true');
    expect(talk.getAttribute('aria-label')).toBe(labels[language].stopListening);
    for (const type of ['pointerup', 'touchend', 'pointercancel', 'touchcancel']) talk.dispatchEvent(new Event(type, { bubbles: true }));
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(mocks.recorders).toHaveLength(1);
    talk.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(talk.disabled).toBe(true);
    expect(talk.getAttribute('aria-pressed')).toBe('false');
    talk.click();
    expect(recorder.stop).toHaveBeenCalledOnce();
    recorder.cancel(); recorder.callbacks[0]!('Bercy');
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: 'final_transcript', text: 'Bercy' }));
    expect(talk.disabled).toBe(false);
    expect(talk.getAttribute('aria-label')).toBe(labels[language].tap);
    expect(talk.getAttribute('aria-pressed')).toBe('false');
    expect(mocks.enqueue.mock.calls.some(([text]) => [labels[language].listening, labels[language].processing].includes(text))).toBe(false);
  });
  it.each(['fr', 'en'] as const)('speaks directional hints with each question only once in %s', async (language) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    const socket = await boot(); mocks.enqueue.mockClear();
    const scenarios = [
      { stage: 'CLARIFY', type: 'clarify', question: language === 'fr' ? 'Est-ce votre départ ?' : 'Is this your pickup?' },
      { stage: 'CHOOSE', type: 'profile_request', question: language === 'fr' ? 'Ce numéro est-il correct ?' : 'Is this number correct?' },
      { stage: 'CONFIRM', type: 'confirm', question: language === 'fr' ? 'Je confirme ?' : 'Shall I confirm?' },
    ];
    for (const scenario of scenarios) {
      socket.message({ type: 'stage', stage: scenario.stage });
      const hint = scenario.stage === 'CONFIRM'
        ? language === 'fr' ? 'Confirmer en haut, annuler en bas.' : 'Confirm at the top, cancel at the bottom.'
        : language === 'fr' ? 'Oui en haut, non en bas.' : 'Yes at the top, no at the bottom.';
      socket.message(scenario.type === 'confirm' ? { type: 'confirm', summary: scenario.question } : { type: scenario.type, question: scenario.question, yes_no: true });
      socket.message({ type: 'say', text: scenario.question });
      expect(mocks.enqueue).toHaveBeenLastCalledWith(`${scenario.question} ${hint}`);
      expect(mocks.enqueue.mock.calls.filter(([text]) => text === `${scenario.question} ${hint}`)).toHaveLength(1);
      expect(document.getElementById('caption')?.textContent).toBe(`${scenario.question} ${hint}`);
      expect(document.getElementById('caption')?.getAttribute('aria-hidden')).toBe('true');
      expect(Array.from(document.querySelectorAll('.decision button'), (button) => button.id)).toEqual(['confirm-yes', 'confirm-no']);
      const reminder = language === 'fr' ? 'Je reste en attente.' : 'Still waiting.';
      socket.message({ type: 'say', text: reminder });
      expect(mocks.enqueue).toHaveBeenLastCalledWith(reminder);
    }
  });
  it('works without storage, retries a closed socket, and resumes without issuing another session', async () => {
    const unavailable = () => { throw new DOMException('Unavailable', 'SecurityError'); };
    vi.stubGlobal('localStorage', { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
    vi.stubGlobal('sessionStorage', { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
    const socket = await boot(); socket.close(); await vi.advanceTimersByTimeAsync(1499); expect(Socket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(1);
    Socket.instances[1]!.open(); expect(Socket.instances[1]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'language', language: 'en' }));
  });
  it('submits approval once and retains final Confirm/Cancel accessible names', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'CONFIRM' }); socket.message({ type: 'confirm', summary: 'Approve taxi' });
    const yes = document.getElementById('confirm-yes')!;
    expect(yes.getAttribute('aria-label')).toBe('Confirm'); expect(document.getElementById('confirm-no')?.getAttribute('aria-label')).toBe('Cancel');
    yes.click(); yes.click(); expect(socket.send).toHaveBeenCalledTimes(1);
  });
  it('observes rejected earcon audio promises rather than leaking rejections', async () => {
    const rejection = Promise.reject(new Error('Audio unavailable')); void rejection.catch(() => {});
    const handled = vi.spyOn(rejection, 'catch');
    vi.stubGlobal('AudioContext', class {
      currentTime = 0; destination = {};
      resume = () => rejection;
      createGain = () => ({ gain: { value: 0 }, connect() {} });
      createOscillator = () => ({ frequency: { value: 0 }, connect() {}, start() {}, stop() {} });
    });
    await boot(); document.getElementById('talk')!.click();
    expect(handled).toHaveBeenCalledOnce();
  });
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
    socket.message({ type: 'activity', cancellable: true });
    document.querySelector<HTMLButtonElement>('.option-card')!.click();
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
  it('does not submit a detached approval button after its stage changed', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'CONFIRM' }); socket.message({ type: 'confirm', summary: 'Approve taxi' });
    const yes = document.getElementById('confirm-yes')!;
    socket.message({ type: 'stage', stage: 'EXECUTE' }); yes.click();
    expect(socket.send).not.toHaveBeenCalled();
  });
  it.each(['HANDOFF', 'AWAIT_PAYMENT'])('opens the payment page from a spoken command in %s without sending it to the server', async (stage) => {
    const assign = vi.fn(); vi.stubGlobal('location', { ...window.location, href: window.location.href, protocol: 'http:', host: 'localhost', search: '', assign });
    const socket = await boot(); socket.message({ type: 'stage', stage });
    socket.message({ type: 'payment_handoff', url: 'https://checkout.stripe.com/c/pay/test', amount: 44, merchant: 'Taxi', summary: 'Taxi' });
    const talk = document.getElementById('talk')!; talk.click(); mocks.recorders.at(-1)!.callbacks[0]!('Payer.');
    expect(mocks.enqueue).toHaveBeenCalledWith(labels.en.openingPayment);
    vi.advanceTimersByTime(1500); expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('Payer'));
  });
  it('stacks Pay above Cancel and cancels the session from the lower button', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'HANDOFF' });
    socket.message({ type: 'payment_handoff', url: 'https://checkout.stripe.com/c/pay/test', amount: 44, merchant: 'Taxi', summary: 'Taxi' });
    expect(Array.from(document.querySelectorAll('.payment-choice > *'), (node) => node.id)).toEqual(['primary-content', 'payment-cancel']);
    expect(document.querySelector('.payment-choice .payment')?.getAttribute('href')).toBe('https://checkout.stripe.com/c/pay/test');
    expect(document.body.dataset.split).toBe('true');
    document.getElementById('payment-cancel')!.click();
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'stop' }));
  });
  it('forwards a payment command to the server when no payment page is available', async () => {
    const socket = await boot(); socket.message({ type: 'stage', stage: 'EXECUTE' });
    const talk = document.getElementById('talk')!; talk.click(); mocks.recorders.at(-1)!.callbacks[0]!('Payer');
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'user_reply', text: 'Payer' }));
  });
});
