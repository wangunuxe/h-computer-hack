import { describe, expect, it, vi } from 'vitest';
import { readRerBTraffic, rerBTrafficPage, TrafficAnswerSchema, type TrafficClient } from './traffic-h.js';

const answer = { status: 'disrupted', summary: 'RER B interrompu.', cause: 'Signalisation.', source: rerBTrafficPage };
function setup() {
  const session = { cancel: vi.fn(async () => {}), waitForCompletion: vi.fn(async (): Promise<{ status: string; answer?: unknown }> => ({ status: 'completed', answer })), get: vi.fn(async () => ({ latestAnswer: answer })) };
  const startSession = vi.fn(async () => session);
  return { session, startSession, client: { startSession } as unknown as TrafficClient };
}
describe('H text traffic reader', () => {
  it.each(['normal', 'disrupted'])('uses read-only text mode and validates a structured %s answer, then cancels', async (status) => {
    const s = setup(); s.session.waitForCompletion.mockResolvedValue({ status: 'completed', answer: { ...answer, status } });
    expect(await readRerBTraffic({}, s.client)).toMatchObject({ ...answer, status, mode: 'live-h', recorded: false });
    expect(s.startSession).toHaveBeenCalledWith(expect.objectContaining({ answerSchema: TrafficAnswerSchema, maxTimeS: 45, queue: false, agent: expect.objectContaining({ environments: [expect.objectContaining({ kind: 'web', startUrl: rerBTrafficPage, mode: { type: 'text' } })] }) }));
    expect(s.session.cancel).toHaveBeenCalledOnce();
  });
  it('cancels promptly on stop even if completion ignores cancellation', async () => {
    const s = setup(); s.session.waitForCompletion.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = readRerBTraffic({ signal: controller.signal }, s.client);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(s.session.cancel).toHaveBeenCalledOnce();
  });
  it('cancels a late-created session after a stop during creation', async () => {
    const s = setup(); let resolve!: (value: typeof s.session) => void;
    s.startSession.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const controller = new AbortController();
    const pending = readRerBTraffic({ signal: controller.signal }, s.client);
    controller.abort(); await expect(pending).rejects.toThrow('cancelled');
    resolve(s.session); await Promise.resolve(); await Promise.resolve();
    expect(s.session.cancel).toHaveBeenCalledOnce();
    expect(s.session.waitForCompletion).not.toHaveBeenCalled();
  });
  it('does not create a session for an already-aborted request', async () => {
    const s = setup(); await expect(readRerBTraffic({ signal: AbortSignal.abort() }, s.client)).rejects.toThrow();
    expect(s.startSession).not.toHaveBeenCalled();
  });
  it('times out after 45 seconds and releases the H slot', async () => {
    vi.useFakeTimers();
    try {
      const s = setup(); s.session.waitForCompletion.mockImplementation(() => new Promise(() => {}));
      const pending = readRerBTraffic({}, s.client); const rejected = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(45_000); await rejected;
      expect(s.session.cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it.each([undefined, { ...answer, status: 'unknown' }, { ...answer, source: 'https://untrusted.example/traffic' }])('rejects an absent or invalid answer', async (value) => {
    const s = setup(); s.session.waitForCompletion.mockResolvedValue({ status: 'completed', answer: value });
    s.session.get.mockResolvedValue({ latestAnswer: value as typeof answer });
    await expect(readRerBTraffic({}, s.client)).rejects.toThrow();
    expect(s.session.cancel).toHaveBeenCalledOnce();
  });
  it('does not accept an answer from a failed H session', async () => {
    const s = setup(); s.session.waitForCompletion.mockResolvedValue({ status: 'failed', answer });
    await expect(readRerBTraffic({}, s.client)).rejects.toThrow('did not complete');
    expect(s.session.cancel).toHaveBeenCalledOnce();
  });
});
