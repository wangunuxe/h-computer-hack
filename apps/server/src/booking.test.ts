import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Tool, HaiAgents } from 'hai-agents';
import { runBooking, type BookingClient, type BookingInput } from './booking.js';
import { publicShuttleUrl } from './booking-cli.js';

const answer = { ref: 'PAS-123', pickup_time: '2027-01-15T12:15:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33184800000', guide_dog_status: 'unknown' };
const stub = 'https://shuttle.example/stub-payment/order-123?mode=no-stripe-key';
const stripe = 'https://checkout.stripe.com/c/pay/cs_test_123#long-fragment';
const observation = (url?: string): HaiAgents.SessionEvent => ({ type: 'AgentEvent', timestamp: new Date(), data: { kind: 'observation_event', metadata: url ? { url } : {} } });
const call = async (tools: readonly Tool[], name: string, args: Record<string, unknown>) => tools.find((item) => item.name === name)!.fn(args);
const confirm = (tools: readonly Tool[]) => call(tools, 'confirm_with_user', { summary: 'Karim to CDG, EUR 65, guide dog' });
const handoff = (tools: readonly Tool[]) => call(tools, 'handoff_payment', { amount: 65, merchant: 'Paris Airport Shuttle', summary: 'PAS-123' });

function setup(scenario: (tools: readonly Tool[]) => AsyncGenerator<HaiAgents.SessionEvent> = async function* (tools) {
  await confirm(tools);
  yield observation(stub);
  await handoff(tools);
}) {
  const cancel = vi.fn(async () => {});
  const handle = {
    get: vi.fn(async () => ({ agentViewUrl: 'https://h.example/view/123' })),
    stream: vi.fn(({ tools }: { tools: readonly Tool[] }) => scenario(tools)),
    waitForCompletion: vi.fn(async () => ({ status: 'completed', answer, finalChanges: { metrics: { steps: 12, totalCost: 0.03 } } })),
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
    expect(mock.cancel).not.toHaveBeenCalled();
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
    expect(mock.input.confirm).toHaveBeenCalledWith('Karim to CDG, EUR 65, guide dog');
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

  it('cancels on a stream error', async () => {
    const mock = setup(async function* () { throw new Error('stream broke'); });
    await expect(runBooking(mock.input, mock.client)).rejects.toThrow('stream broke');
    expect(mock.cancel).toHaveBeenCalledOnce();
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
  it.each([undefined, 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001', 'ftp://shuttle.example'])('rejects missing or unreachable cloud URL %s', (url) => {
    expect(() => publicShuttleUrl(url)).toThrow();
  });
  it('accepts a public URL', () => expect(publicShuttleUrl('https://shuttle.example').origin).toBe('https://shuttle.example'));
});
