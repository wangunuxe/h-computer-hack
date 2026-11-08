import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, HaiAgents } from 'hai-agents';
import { bookingAction, bookingErrorMessage, registerFareQuote, runBooking, type BookingClient, type BookingInput } from './booking.js';
import { publicShuttleUrl } from './booking-cli.js';
import { estimateTaxi } from '@voila/shared';

const answer = { ref: 'PAS-123', pickup_time: '2027-01-15T12:15:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33184800000', guide_dog_status: 'unknown' };
const stub = 'https://shuttle.example/stub-payment/order-123?mode=no-stripe-key';
const stripe = 'https://checkout.stripe.com/c/pay/cs_test_123#long-fragment';
const observation = (url?: string): HaiAgents.SessionEvent => ({ type: 'AgentEvent', timestamp: new Date(), data: { kind: 'observation_event', metadata: url ? { url } : {} } });
const call = async (tools: readonly Tool[], name: string, args: Record<string, unknown>) => tools.find((item) => item.name === name)!.fn(args);
const confirmationFields = { pickup_date: '2027-01-15', pickup_time: '12:15', total_price: 65, currency: 'EUR' };
const confirm = (tools: readonly Tool[]) => call(tools, 'confirm_with_user', { summary: 'Karim to CDG, EUR 65, guide dog', ...confirmationFields });
const handoff = (tools: readonly Tool[]) => call(tools, 'handoff_payment', { amount: 65, merchant: 'Paris Airport Shuttle', summary: 'PAS-123' });

function setup(scenario: (tools: readonly Tool[]) => AsyncGenerator<HaiAgents.SessionEvent> = async function* (tools) {
  await confirm(tools);
  yield observation(stub);
  await handoff(tools);
}) {
  const cancel = vi.fn(async () => {});
  const handle = {
    get: vi.fn(async (): Promise<{ agentViewUrl: string; latestAnswer?: unknown }> => ({ agentViewUrl: 'https://h.example/view/123' })),
    stream: vi.fn(({ tools }: { tools: readonly Tool[] }) => scenario(tools)),
    waitForCompletion: vi.fn(async (): Promise<{ status: string; answer?: unknown; finalChanges?: { answer?: unknown; metrics?: { steps: number; totalCost: number } } }> => ({ status: 'completed', answer, finalChanges: { metrics: { steps: 12, totalCost: 0.03 } } })),
    cancel,
  };
  const startSession = vi.fn(async () => handle);
  const getSessionQuota = vi.fn(async () => ({ available: 3 }));
  const client = { startSession, sessions: { getSessionQuota } } as unknown as BookingClient;
  const input: BookingInput = {
    startUrl: 'https://shuttle.example/fr/reservation/draft/route',
    trip: { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2027-01-15T16:00:00+01:00', passengers: 1, luggage: 1, guide_dog: true },
    profile: { name: 'Karim', email: 'karim@example.com', phone: '+33612345678', guide_dog: true, language: 'fr' },
    onProgress: vi.fn(), confirm: vi.fn(async () => ({ approved: true, reply: 'oui' })), onPaymentHandoff: vi.fn(),
  };
  return { client, input, handle, startSession, getSessionQuota, cancel };
}

describe('H booking runner', () => {
  it('stops promptly while the H quota request is pending', async () => {
    const mock = setup();
    let resolve!: (value: { available: number }) => void;
    mock.getSessionQuota.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const controller = new AbortController(); mock.input.signal = controller.signal;
    let settled = false;
    const result = runBooking(mock.input, mock.client).catch((error: unknown) => { settled = true; return error; });
    await vi.waitFor(() => expect(mock.getSessionQuota).toHaveBeenCalledOnce());
    controller.abort(new Error('stop'));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const stoppedPromptly = settled;
    resolve({ available: 3 });
    expect(await result).toEqual(new Error('stop'));
    expect(mock.startSession).not.toHaveBeenCalled();
    expect(stoppedPromptly).toBe(true);
  });
  it('stops promptly during H creation and cancels a late-created session', async () => {
    const mock = setup();
    let created!: (value: typeof mock.handle) => void;
    mock.startSession.mockImplementation(() => new Promise((resolve) => { created = resolve; }));
    const controller = new AbortController(); mock.input.signal = controller.signal;
    let settled = false;
    const result = runBooking(mock.input, mock.client).catch((error: unknown) => { settled = true; return error; });
    await vi.waitFor(() => expect(mock.startSession).toHaveBeenCalledOnce());
    controller.abort(new Error('stop'));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const stoppedPromptly = settled;
    created(mock.handle);
    expect(await result).toEqual(new Error('stop'));
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.handle.stream).not.toHaveBeenCalled();
    expect(stoppedPromptly).toBe(true);
  });
  it('exposes observation URLs and action descriptions, but not screenshot payloads or typed values', async () => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'observation_event', metadata: { url: 'https://shuttle.example/fr/reservation/draft/route' }, image: { type: 'url', source: 'https://images.example/private-screenshot' } } };
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'policy_event', content: 'Selecting vehicle', toolReqs: [{ toolName: 'write', args: { element: 'Name', text: 'private typed value' } }] } };
      await confirm(tools); yield observation(stub); await handoff(tools);
    });
    mock.input.onStep = vi.fn(); await runBooking(mock.input, mock.client);
    expect(mock.input.onStep).toHaveBeenCalledWith({ type: 'agent_step', action: 'Observed booking page', url: 'https://shuttle.example/fr/reservation/draft/route' });
    expect(mock.input.onStep).toHaveBeenCalledWith({ type: 'agent_step', action: 'Selecting vehicle', url: 'https://shuttle.example/fr/reservation/draft/route' });
    expect(JSON.stringify(vi.mocked(mock.input.onStep).mock.calls)).not.toMatch(/private-screenshot|private typed value/);
  });
  it('checks the observed pickup tariff, rejects the stale fare, and reads the updated amount for approval', async () => {
    const quote = { origin: 'Châtelet', destination: 'Montparnasse', at: '2027-01-15T05:00:00Z', passengers: 1 };
    const stale = estimateTaxi(quote).price, actual = estimateTaxi({ ...quote, at: '2027-01-15T11:15:00Z' }).price;
    expect(stale).not.toBe(actual);
    vi.stubEnv('INTERNAL_CALLBACK_TOKEN', 'test-token'); vi.stubEnv('SHUTTLE_PUBLIC_URL', 'https://shuttle.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }))));
    try {
      const mock = setup(async function* (tools) {
        expect(await call(tools, 'confirm_with_user', { summary: 'Stale fare', ...confirmationFields, total_price: stale })).toContain('differs from the route estimate');
        expect(mock.input.confirm).not.toHaveBeenCalled();
        await call(tools, 'confirm_with_user', { summary: `Updated fare EUR ${actual}`, ...confirmationFields, total_price: actual });
      });
      mock.input.fareQuote = quote; mock.input.trip = { ...mock.input.trip, origin: quote.origin, destination: quote.destination };
      await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
      expect(mock.input.confirm).toHaveBeenCalledWith(`Updated fare EUR ${actual}`, expect.objectContaining({ total_price: actual }));
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('retries a transient clone wake failure once, but never retries authentication or cancellation', async () => {
    const input = { startUrl: 'https://shuttle.example/fr/reservation/', fareQuote: { origin: 'Gare du Nord', destination: 'CDG', at: '2027-01-15T10:00:00Z', passengers: 1 } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' })));
    expect(await registerFareQuote(input, fetcher, 'test-token', 'https://shuttle.example')).toContain('quote='); expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockResolvedValue(new Response('', { status: 401 }));
    await expect(registerFareQuote(input, fetcher, 'test-token', 'https://shuttle.example')).rejects.toThrow('Could not register'); expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear(); const controller = new AbortController(); controller.abort();
    await expect(registerFareQuote({ ...input, signal: controller.signal }, fetcher, 'test-token', 'https://shuttle.example')).rejects.toBeDefined(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('starts H after a ten-second clone wake instead of failing registration at three seconds', async () => {
    vi.useFakeTimers();
    vi.stubEnv('INTERNAL_CALLBACK_TOKEN', 'test-token'); vi.stubEnv('SHUTTLE_PUBLIC_URL', 'https://shuttle.example');
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms); return controller.signal; });
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      setTimeout(() => resolve(new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }))), 10_000);
    })));
    try {
      const mock = setup(async function* () {});
      mock.input.fareQuote = { origin: 'Gare du Nord', destination: 'CDG', at: '2027-01-15T10:00:00Z', passengers: 1 };
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toBeInstanceOf(Error); expect(mock.startSession).toHaveBeenCalledOnce();
    } finally { vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('registers the route quote and rejects a mismatched H fare before asking the traveler', async () => {
    vi.stubEnv('INTERNAL_CALLBACK_TOKEN', 'test-token');
    vi.stubEnv('SHUTTLE_PUBLIC_URL', 'https://shuttle.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }))));
    try {
      const mock = setup(async function* (tools) {
        expect(await confirm(tools)).toContain('differs from the route estimate');
      });
      mock.input.fareQuote = { origin: 'Gare du Nord', destination: 'CDG', at: '2027-01-15T10:00:00Z', passengers: 1 };
      await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
      expect(mock.input.confirm).not.toHaveBeenCalled();
      expect(JSON.stringify(mock.startSession.mock.calls)).toContain('quote=00000000-0000-0000-0000-000000000000');
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('briefs H with a non-airport dropoff and ASAP window without inventing a flight deadline', async () => {
    const mock = setup(async function* () {});
    mock.input.trip = { ...mock.input.trip, origin: 'La Défense', destination: 'Bercy', deadline: undefined };
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    const params = mock.startSession.mock.calls[0] as unknown as [{ agent: { instructions: string } }];
    expect(params[0].agent.instructions).toContain('Dropoff address: "Bercy". Enter this exact trip destination');
    expect(params[0].agent.instructions).toContain('No arrival deadline was supplied: this is an ASAP trip.');
    expect(params[0].agent.instructions).toContain('Do not ask for an arrival deadline or flight.');
  });
  describe('stall watchdog', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00Z')); });
    const hung = async function* (): AsyncGenerator<HaiAgents.SessionEvent> { await new Promise(() => {}); };
    const ready = async (mock: ReturnType<typeof setup>) => { await vi.waitFor(() => expect(mock.handle.stream).toHaveBeenCalled()); };
    it('cancels a zero-step session at 45 seconds and retries only once', async () => {
      const mock = setup(hung); mock.input.onRetry = vi.fn();
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await ready(mock);
      await vi.advanceTimersByTimeAsync(44_000); expect(mock.cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(mock.startSession).toHaveBeenCalledTimes(2));
      expect(mock.cancel).toHaveBeenCalledOnce(); expect(mock.input.onRetry).toHaveBeenCalledOnce();
      const tools = (mock.startSession.mock.calls[0] as unknown as [{ tools: Tool[] }])[0].tools;
      await expect(confirm(tools)).rejects.toThrow('no longer active'); expect(mock.input.confirm).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await result).toBeInstanceOf(Error); expect(mock.cancel).toHaveBeenCalledTimes(2); expect(mock.startSession).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
    it('can complete the second attempt without reusing the first attempt tools or approval', async () => {
      const mock = setup(hung), good = setup();
      mock.startSession.mockResolvedValueOnce(mock.handle).mockResolvedValueOnce(good.handle);
      const result = runBooking(mock.input, mock.client);
      await ready(mock); await vi.advanceTimersByTimeAsync(45_000);
      const completed = await result;
      expect(completed.booking.ref).toBe(answer.ref); expect(mock.cancel).toHaveBeenCalledOnce(); expect(good.cancel).toHaveBeenCalledOnce();
      expect(completed.metrics.durationMs).toBeGreaterThanOrEqual(45_000); expect(completed.metrics.costUsd).toBeNull();
      expect(mock.input.confirm).toHaveBeenCalledOnce(); expect(mock.input.onPaymentHandoff).toHaveBeenCalledOnce();
    });
    it('waits 60 seconds after the last increasing metric, not after initial observation', async () => {
      const mock = setup(async function* () {
        yield { type: 'MetricsUpdateEvent', timestamp: new Date(), data: { metrics: { steps: 1 } } };
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        yield { type: 'MetricsUpdateEvent', timestamp: new Date(), data: { metrics: { steps: 2 } } };
        await new Promise(() => {});
      });
      const controller = new AbortController(); mock.input.signal = controller.signal;
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await ready(mock); await vi.advanceTimersByTimeAsync(89_000); expect(mock.cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000); await vi.waitFor(() => expect(mock.startSession).toHaveBeenCalledTimes(2));
      controller.abort(); await result;
    });
    it('does not count waiting for the human confirmation as a stall', async () => {
      let release!: (value: { approved: boolean; reply: string }) => void;
      const mock = setup(); mock.input.confirm = vi.fn(() => new Promise((resolve) => { release = resolve; }));
      const controller = new AbortController(); mock.input.signal = controller.signal;
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await vi.waitFor(() => expect(mock.input.confirm).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(180_000); expect(mock.cancel).not.toHaveBeenCalled(); expect(mock.startSession).toHaveBeenCalledOnce();
      controller.abort(); release({ approved: false, reply: 'stop' }); await result;
    });
    it.each([true, false])('never automatically rebooks after a confirmation decision (%s), even if no further step arrives', async (approved) => {
      const mock = setup(async function* (tools) { await confirm(tools); await new Promise(() => {}); });
      mock.input.confirm = vi.fn(async () => ({ approved, reply: approved ? 'oui' : 'non' }));
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await vi.waitFor(() => expect(mock.input.confirm).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await result).toBeInstanceOf(Error); expect(mock.startSession).toHaveBeenCalledOnce(); expect(mock.cancel).toHaveBeenCalledOnce();
    });
    it('does not retry if cancellation fails', async () => {
      const mock = setup(hung); mock.cancel.mockRejectedValue(new Error('cancel failed'));
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await ready(mock); await vi.advanceTimersByTimeAsync(45_000);
      expect(await result).toBeInstanceOf(AggregateError); expect(mock.startSession).toHaveBeenCalledOnce();
    });
    it('stops immediately on external cancellation without automatic retry', async () => {
      const mock = setup(hung), controller = new AbortController(); mock.input.signal = controller.signal;
      const result = runBooking(mock.input, mock.client).catch((error: unknown) => error);
      await ready(mock); controller.abort(new Error('stop')); expect(await result).toEqual(new Error('stop')); expect(mock.startSession).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });
    it.each([['Pickup address input', 'pickup'], ['Dropoff address', 'dropoff'], ['Pickup date calendar', 'date'], ['Pickup time', 'time'], ['Vehicle class', 'vehicle'], ['Email', 'passenger'], ['Notes for the driver', 'notes'], ['Unrelated private text', undefined]])('maps only known element descriptions: %s', (element, expected) => {
      expect(bookingAction(element!)).toBe(expected);
    });
  });
  it('briefs H with the stated pickup instead of a station example', async () => {
    const mock = setup(); mock.input.trip.origin = 'Étoile'; await runBooking(mock.input, mock.client);
    const params = mock.startSession.mock.calls[0] as unknown as [{ agent: { instructions: string } }];
    expect(params[0].agent.instructions).toContain('Pickup address: "Étoile". Enter this trip origin in the pickup field');
    expect(params[0].agent.instructions).toContain('Never substitute a station or an example address');
  });
  it.each([{ total_price: undefined }, { currency: undefined }, { currency: 'USD' }])('rejects missing or unsupported fare facts before asking the user: %j', async (missing) => {
    const mock = setup(async function* (tools) {
      expect(await call(tools, 'confirm_with_user', { summary: 'Shuttle', ...confirmationFields, ...missing })).toContain('REJECTED');
      yield observation(stub); expect(await handoff(tools)).toContain('ERROR');
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.input.confirm).not.toHaveBeenCalled(); expect(mock.input.onPaymentHandoff).not.toHaveBeenCalled();
  });
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-01-15T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('does not ask for approval or hand off payment for a wrong-day pickup', async () => {
    const mock = setup(async function* (tools) {
      const result = await call(tools, 'confirm_with_user', { summary: 'Shuttle tomorrow', ...confirmationFields, pickup_date: '2027-01-16' });
      expect(result).toContain('REJECTED');
      yield observation(stub); expect(await handoff(tools)).toContain('ERROR');
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.input.confirm).not.toHaveBeenCalled(); expect(mock.input.onPaymentHandoff).not.toHaveBeenCalled(); expect(mock.cancel).toHaveBeenCalledOnce();
  });
  it('briefs H with explicit Paris pickup dates and a deadline minus journey-time window', async () => {
    const mock = setup(); await runBooking(mock.input, mock.client);
    const params = mock.startSession.mock.calls[0] as unknown as [{ agent: { instructions: string } }];
    expect(params[0].agent.instructions).toContain('2027-01-15T11:15:00+01:00 through 2027-01-15T15:10:00+01:00');
    expect(params[0].agent.instructions).toContain('Recommended pickup date: 2027-01-15, time: 11:15');
  });
  it.each([{}, { pickup_date: '2027-02-30', pickup_time: '24:00', total_price: '65', currency: 'USD' }])('rejects missing or invalid pickup fields without reading the summary: %j', async (fields) => {
    const mock = setup(async function* (tools) {
      await call(tools, 'confirm_with_user', { summary: 'Flight Price: 400 EUR. Time: 23:00', ...fields });
      yield observation(stub); await handoff(tools);
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.input.confirm).not.toHaveBeenCalled();
    const params = mock.startSession.mock.calls[0] as unknown as [{ tools: Tool[] }];
    const schema = params[0].tools.find((item) => item.name === 'confirm_with_user')!.inputSchema;
    expect(schema).toMatchObject({ properties: { pickup_date: expect.any(Object), pickup_time: expect.any(Object), total_price: expect.any(Object), currency: expect.any(Object) } });
  });
  it('reports observed booking page changes once, without trusting policy text or unrelated URLs', async () => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'policy_event', content: 'Now on the payment page' } };
      for (const url of [undefined, 'not a URL', 'https://other.example/fr/reservation/draft/info',
        'https://shuttle.example/fr/reservation/draft/route', 'https://shuttle.example/fr/reservation/draft/route?x=1',
        'https://shuttle.example/fr/reservation/draft/vehicle', 'https://shuttle.example/fr/reservation/draft/info',
        'https://shuttle.example/fr/reservation/draft/vehicle', 'https://shuttle.example/fr/reservation/draft/info',
        'https://shuttle.example/fr/reservation/payment/order-123', stub, stripe,
      ]) yield observation(url);
      await confirm(tools); await handoff(tools);
    });
    mock.input.onPage = vi.fn();
    await runBooking(mock.input, mock.client);
    expect(mock.input.onPage).toHaveBeenCalledTimes(6);
    expect(vi.mocked(mock.input.onPage).mock.calls.flat()).toEqual(['route', 'vehicle', 'info', 'vehicle', 'info', 'payment']);
    expect(mock.input.onProgress).toHaveBeenCalledWith('Now on the payment page');
  });
  it('cancels the H session if the optional page callback fails', async () => {
    const mock = setup(async function* () { yield observation('https://shuttle.example/fr/reservation/draft/route'); });
    mock.input.onPage = () => { throw new Error('Page callback failed'); };
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('Page callback failed');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
  it('includes the complete playbook and safety rules, configures H and returns a shared booking', async () => {
    const mock = setup();
    const result = await runBooking(mock.input, mock.client);
    const params = mock.startSession.mock.calls[0] as unknown as [{ agent: { instructions: string } }];
    const playbook = await readFile(new URL('../../../playbooks/paris-airport-shuttle.md', import.meta.url), 'utf8');
    expect(params[0].agent.instructions).toContain(playbook);
    expect(params[0].agent.instructions).toContain('Never enter payment details or pay');
    expect(params[0].agent.instructions).toContain(JSON.stringify(mock.input.trip));
    expect(params[0].agent.instructions).toContain(JSON.stringify(mock.input.profile));
    expect(mock.startSession).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 60, maxTimeS: 240, timezone: 'Europe/Paris', answerSchema: expect.anything(), agent: expect.objectContaining({ reasoningEffort: 'disabled', environments: [expect.objectContaining({ startUrl: mock.input.startUrl, settleS: 0.3, mode: { type: 'visual', width: 1280, height: 800 } })] }) }));
    expect(result.booking).toEqual({ ...answer, payment_url: stub });
    expect(result.metrics).toEqual({ steps: 12, costUsd: 0.03, durationMs: expect.any(Number) });
    expect(result.agentViewUrl).toBe('https://h.example/view/123');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['2026-11-07T17:46:00Z', '07/11/2026, 18:46:00'],
    ['2026-07-15T22:30:00Z', '16/07/2026, 00:30:00'],
  ])('includes current Paris date/time at %s and future pickup guidance', async (now, paris) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(now));
      const mock = setup();
      await runBooking(mock.input, mock.client);
      expect(mock.startSession).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ instructions: expect.stringContaining(`Current Europe/Paris date and time: ${paris}`) }) }));
      expect(mock.startSession).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ instructions: expect.stringContaining('Pickup must be strictly after now in Europe/Paris') }) }));
      expect(mock.startSession).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ instructions: expect.stringContaining('leave enough travel time') }) }));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['result', 'changes', 'envelope'])('accepts an idle answer from %s and releases the session', async (source) => {
    const mock = setup();
    mock.handle.waitForCompletion.mockResolvedValue({ status: 'idle', ...(source === 'result' ? { answer } : source === 'changes' ? { finalChanges: { answer: JSON.stringify(answer) } } : {}) });
    if (source === 'envelope') mock.handle.get.mockResolvedValue({ agentViewUrl: 'https://h.example/view/123', latestAnswer: answer });
    expect((await runBooking(mock.input, mock.client)).booking.ref).toBe(answer.ref);
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it.each(['completed', 'idle'])('rejects %s without an answer and releases its slot', async (status) => {
    const mock = setup();
    mock.handle.waitForCompletion.mockResolvedValue({ status });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('no booking answer returned');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('does not accept an answer on a failed session', async () => {
    const mock = setup();
    mock.handle.waitForCompletion.mockResolvedValue({ status: 'failed', answer });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('H booking failed');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('releases the session on an invalid answer', async () => {
    const mock = setup();
    mock.handle.waitForCompletion.mockResolvedValue({ status: 'idle', answer: {} });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('reports cancellation failure without cancelling twice', async () => {
    const mock = setup();
    mock.cancel.mockRejectedValue(new Error('cancel failed'));
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('cancel failed');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, '', 'undefined', new Error('')])('has a useful CLI error for %s', (error) => {
    expect(bookingErrorMessage(error)).toBe('Booking failed: unknown error.');
  });

  it.each([stub, stripe])('uses only the observed payment URL: %s', async (url) => {
    const mock = setup(async function* (tools) {
      await confirm(tools);
      yield observation(url);
      const response = await call(tools, 'handoff_payment', { amount: 65, merchant: 'Shuttle', summary: 'PAS-123', url: 'https://evil.example' });
      expect(response).toContain('STOP');
    });
    const result = await runBooking(mock.input, mock.client);
    expect(result.booking.payment_url).toBe(url);
    expect(mock.input.onPaymentHandoff).toHaveBeenCalledWith({ url, amount: 65, merchant: 'Shuttle', summary: 'PAS-123' });
  });

  it.each([undefined, 'https://evil.example/pay', 'https://checkout.stripe.com.evil.example/pay', 'http://checkout.stripe.com/pay', 'https://shuttle.example/fr/reservation/payment/123', 'https://other.example/stub-payment/123', 'https://checkout.stripe.com@evil.example/pay'])('rejects unsafe or missing observed URL: %s', async (url) => {
    const mock = setup(async function* (tools) {
      await confirm(tools);
      yield observation(url);
      expect(await handoff(tools)).toContain('ERROR');
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.input.onPaymentHandoff).not.toHaveBeenCalled();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('does not reuse a URL when the latest observation has no URL', async () => {
    const mock = setup(async function* (tools) {
      await confirm(tools);
      yield observation(stripe);
      yield observation();
      expect(await handoff(tools)).toContain('ERROR');
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
  });

  it.each([true, false])('passes the confirmation decision back to H: %s', async (approved) => {
    const mock = setup(async function* (tools) {
      const decision = await confirm(tools);
      expect(decision).toContain(approved ? 'APPROVED' : 'REJECTED');
      expect(decision).toContain('user words');
      yield observation(stub);
      expect(await handoff(tools)).toContain(approved ? 'STOP' : 'ERROR');
    });
    mock.input.confirm = vi.fn(async () => ({ approved, reply: 'user words' }));
    if (approved) await runBooking(mock.input, mock.client);
    else await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.input.confirm).toHaveBeenCalledWith('Karim to CDG, EUR 65, guide dog', confirmationFields);
  });

  it('fails if the agent finishes without handing off', async () => {
    const mock = setup(async function* () {});
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('without payment handoff');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('emits short policy progress lines', async () => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'message_event', callerId: 'user', content: ['Book this trip'] } };
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'policy_event', content: 'Selecting\n  vehicle' } };
      await confirm(tools);
      yield observation(stub);
      await handoff(tools);
    });
    await runBooking(mock.input, mock.client);
    expect(mock.input.onProgress).toHaveBeenCalledWith('Selecting vehicle');
  });
  it('reports known action categories without speaking arbitrary policy or entered values', async () => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'policy_event', content: 'untrusted policy text', toolReqs: [{ toolName: 'write', args: { element: 'Pickup address input field', text: 'private address' } }, { toolName: 'unknown_tool', args: { element: 'Vehicle' } }] } };
      await confirm(tools); yield observation(stub); await handoff(tools);
    });
    mock.input.onAction = vi.fn(); await runBooking(mock.input, mock.client);
    expect(mock.input.onAction).toHaveBeenCalledExactlyOnceWith('pickup');
  });

  it('reports tool-only policy steps like the recorded real H stream', async () => {
    const mock = setup(async function* (tools) {
      yield observation('https://shuttle.example/fr/reservation/draft/route');
      yield {
        type: 'AgentEvent', timestamp: new Date('2026-11-07T18:00:01Z'),
        data: {
          kind: 'policy_event', reasoningContent: null, content: '', validationErrors: [],
          toolReqs: [{ toolName: 'write', id: 'chatcmpl-tool-write', args: { x: 0.492, y: 0.485, text: 'Gare du Nord', enter: true, element: 'Pickup address input field', overwrite: true } }],
        },
      };
      yield observation('https://shuttle.example/fr/reservation/draft/route');
      yield {
        type: 'AgentEvent', timestamp: new Date('2026-11-07T18:00:02Z'),
        data: {
          kind: 'policy_event', reasoningContent: null, content: '', validationErrors: [],
          toolReqs: [{ toolName: 'click_web', id: 'chatcmpl-tool-click', args: { x: 0.492, y: 0.54, element: 'Gare du Nord dropdown suggestion' } }],
        },
      };
      await confirm(tools);
      yield observation(stub);
      await handoff(tools);
    });
    await runBooking(mock.input, mock.client);
    expect(vi.mocked(mock.input.onProgress).mock.calls).toEqual([
      ['Step 1: write — Pickup address input field'],
      ['Step 2: click_web — Gare du Nord dropdown suggestion'],
    ]);
  });

  it.each([null, undefined, '   '])('emits bounded fallback progress with content %s and no tool descriptions', async (content) => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'policy_event', content } };
      yield { type: 'AgentEvent', timestamp: new Date(), data: {
        kind: 'policy_event', content, toolReqs: [{ toolName: 'write', args: { text: 'private user input' } }],
      } };
      yield { type: 'AgentEvent', timestamp: new Date(), data: {
        kind: 'policy_event', content, toolReqs: [{ toolName: 'click_web', args: { element: 'X'.repeat(300) } }],
      } };
      await confirm(tools);
      yield observation(stub);
      await handoff(tools);
    });
    await runBooking(mock.input, mock.client);
    const lines = vi.mocked(mock.input.onProgress).mock.calls.map(([text]) => text);
    expect(lines[0]).toBe('Step 1: Working on booking');
    expect(lines[1]).toBe('Step 2: write');
    expect(lines[2]).toHaveLength(240);
    expect(lines.join(' ')).not.toContain('private user input');
  });

  it('cancels on a stream error', async () => {
    const mock = setup(async function* () { throw new Error('stream broke'); });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('stream broke');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('reports recoverable step errors and continues to a booking', async () => {
    const mock = setup(async function* (tools) {
      yield { type: 'AgentEvent', timestamp: new Date(), data: { kind: 'error_event', error: 'Click\n failed', origin: 'browser' } };
      await confirm(tools);
      yield observation(stub);
      await handoff(tools);
    });
    expect((await runBooking(mock.input, mock.client)).booking.ref).toBe(answer.ref);
    expect(mock.input.onProgress).toHaveBeenCalledWith('H step error (recoverable): Click failed');
    expect(mock.input.onPaymentHandoff).toHaveBeenCalledOnce();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('treats AgentErrorEvent as fatal and cancels', async () => {
    const mock = setup(async function* () {
      yield { type: 'AgentErrorEvent', timestamp: new Date(), data: { error: 'browser unavailable' } };
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('browser unavailable');
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.input.onPaymentHandoff).not.toHaveBeenCalled();
  });

  it('cancels on callback errors even if SDK tool dispatch catches them', async () => {
    const mock = setup(async function* (tools) {
      await confirm(tools).catch(() => {});
      yield observation(stub);
    });
    mock.input.confirm = async () => { throw new Error('confirm broke'); };
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('confirm broke');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('cancels on abort even when the stream is waiting', async () => {
    const controller = new AbortController();
    const mock = setup(async function* () {
      controller.abort(new Error('user stopped'));
      await new Promise(() => {});
    });
    mock.input.signal = controller.signal;
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('user stopped');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  it('returns a never-yielding stream on abort without waiting for its pending next', async () => {
    const controller = new AbortController();
    const mock = setup();
    mock.input.signal = controller.signal;
    const returned = vi.fn(async () => ({ done: true, value: undefined }));
    const next = vi.fn(() => {
      controller.abort(new Error('stop pending stream'));
      return new Promise<IteratorResult<HaiAgents.SessionEvent>>(() => {});
    });
    mock.handle.stream.mockReturnValue({ next, return: returned } as unknown as AsyncGenerator<HaiAgents.SessionEvent>);
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('stop pending stream');
    expect(returned).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.handle.waitForCompletion).not.toHaveBeenCalled();
  });

  it('does not create a session when already aborted or out of quota', async () => {
    const mock = setup();
    mock.getSessionQuota.mockResolvedValue({ available: 0 });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('No H session quota');
    expect(mock.startSession).not.toHaveBeenCalled();
    mock.input.signal = AbortSignal.abort(new Error('already stopped'));
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('already stopped');
    expect(mock.startSession).not.toHaveBeenCalled();
  });

  it('cancels a session if abort happens during creation', async () => {
    const mock = setup();
    const controller = new AbortController();
    mock.input.signal = controller.signal;
    mock.startSession.mockImplementation(async () => {
      controller.abort(new Error('stopped during create'));
      return mock.handle;
    });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('stopped during create');
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.handle.stream).not.toHaveBeenCalled();
  });

  it('cancels when the handoff callback throws', async () => {
    const mock = setup();
    mock.input.onPaymentHandoff = async () => { throw new Error('handoff failed'); };
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('handoff failed');
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
});

describe('CLI public URL validation', () => {
  it.each([
    '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.10',
    '169.254.0.1', '169.254.255.255', '0.1.2.3', '0.255.255.255',
    '[fc00::1]', '[fdff:ffff::1]', '[fe80::1]', '[febf:ffff::1]', '[::]',
    'shuttle.local', 'shuttle.internal', 'shuttle.local.', 'shuttle.internal.', 'localhost.',
  ])('rejects private shuttle host %s', (host) => {
    expect(() => publicShuttleUrl(`http://${host}:3001`)).toThrow('public HTTP(S) URL');
  });

  it.each(['172.15.255.255', '172.32.0.1', '169.253.255.255', '192.169.0.1', '[2001:4860:4860::8888]', 'shuttle.example'])('accepts public host %s', (host) => {
    expect(publicShuttleUrl(`https://${host}`).protocol).toBe('https:');
  });
  it.each([undefined, 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001', 'ftp://shuttle.example'])('rejects missing or unreachable cloud URL %s', (url) => {
    expect(() => publicShuttleUrl(url)).toThrow();
  });
  it('accepts a public URL', () => expect(publicShuttleUrl('https://shuttle.example').origin).toBe('https://shuttle.example'));
});
