import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { getRerBDisruption, primRerBEndpoint } from './prim.js';

const response = { Siri: { ServiceDelivery: { GeneralMessageDelivery: [{ Status: true, InfoMessage: [{ Content: { Message: [{ MessageText: { value: 'Incident de signalisation sur le RER B.' } }] } }] }] } } };

describe('getRerBDisruption', () => {
  it('queries RER B with the apikey header and parses a live response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
    const result = await getRerBDisruption({ apiKey: 'fake-key', fetch: fetcher });
    expect(fetcher).toHaveBeenCalledWith(primRerBEndpoint, { headers: { apikey: 'fake-key' }, signal: expect.any(AbortSignal) });
    expect(result).toEqual({ summary: 'RER B — Incident de signalisation sur le RER B.', cause: 'Incident de signalisation sur le RER B.', source: primRerBEndpoint, recorded: false });
  });
  it('loads the fixture without calling fetch when there is no key', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await getRerBDisruption({ fetch: fetcher });
    const fixture = JSON.parse(await readFile(new URL('../../../../scripts/fixtures/prim-rer-b.json', import.meta.url), 'utf8'));
    expect(result.recorded).toBe(true);
    expect(result.cause).toBe(fixture.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage[0].Content.Message[0].MessageText.value);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http', 'json', 'shape', 'empty', 'network', 'delivery'])('falls back on %s errors', async (failure) => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'http') return new Response('unavailable', { status: 503 });
      if (failure === 'json') return new Response('not JSON');
      if (failure === 'empty') return Response.json({ Siri: { ServiceDelivery: { GeneralMessageDelivery: [] } } });
      if (failure === 'delivery') return Response.json({ Siri: { ServiceDelivery: { GeneralMessageDelivery: [{ Status: false, InfoMessage: [] }] } } });
      return Response.json({ unexpected: true });
    });
    expect((await getRerBDisruption({ apiKey: 'fake', fetch: fetcher })).recorded).toBe(true);
  });
  it('times out and aborts even a fetch that ignores its signal', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const fetcher = vi.fn<typeof fetch>((_, init) => { requestSignal = init?.signal ?? undefined; return new Promise(() => {}); });
      const result = getRerBDisruption({ apiKey: 'fake', fetch: fetcher, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      expect((await result).recorded).toBe(true);
      expect(requestSignal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('honours a caller abort and returns labelled recorded information', async () => {
    const controller = new AbortController();
    const result = getRerBDisruption({ apiKey: 'fake', fetch: vi.fn<typeof fetch>(() => new Promise(() => {})), signal: controller.signal });
    controller.abort();
    expect((await result).recorded).toBe(true);
  });
});
