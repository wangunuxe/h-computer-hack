import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from './session-registry.js';
import { VoilaSession } from './session.js';
import { createApp } from './index.js';

const registries: SessionRegistry[] = [];
const setup = () => { const registry = new SessionRegistry(new Map(), globalThis); registries.push(registry); return registry; };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { for (const registry of registries.splice(0)) registry.dispose(); vi.useRealTimers(); });

describe('session lifetimes', () => {
  it('expires unclaimed tokens after two minutes without allowing invalid connects to renew them', async () => {
    const registry = setup(); const issued = registry.issue()!;
    await vi.advanceTimersByTimeAsync(119_999);
    expect(registry.connect(issued.id, 'wrong')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(registry.connect(issued.id, issued.resume_token)).toBe(false);
  });
  it('keeps connected sessions and resets the thirty-minute idle deadline on reconnect', async () => {
    const registry = setup(); const issued = registry.issue()!;
    expect(registry.connect(issued.id, issued.resume_token)).toBe(true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(registry.connect(issued.id, issued.resume_token)).toBe(true);
    const dispose = vi.fn(); registry.sessions.set(issued.id, { dispose } as unknown as VoilaSession);
    registry.disconnect(issued.id); await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(registry.connect(issued.id, issued.resume_token)).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000); expect(dispose).not.toHaveBeenCalled();
    registry.disconnect(issued.id); await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect(dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledOnce(); expect(registry.sessions.size).toBe(0);
    expect(registry.connect(issued.id, issued.resume_token)).toBe(false);
  });
  it('returns 503 at one hundred reservations, and recovers capacity after expiry', async () => {
    const registry = setup(); const app = createApp({ registry });
    for (let i = 0; i < 100; i++) expect((await app.request('/session', { method: 'POST' })).status).toBe(201);
    expect((await app.request('/session', { method: 'POST' })).status).toBe(503);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await app.request('/session', { method: 'POST' })).status).toBe(201);
  });
  it('disposes an idle session and aborts its pending H booking operation', async () => {
    const registry = setup(); const issued = registry.issue()!;
    registry.connect(issued.id, issued.resume_token);
    let signal: AbortSignal | undefined;
    const session = new VoilaSession(() => {}, {
      understand: async () => ({ trip: { origin: 'Gare du Nord', destination: 'CDG', deadline: '2099-01-01T00:00:00Z', passengers: 1, luggage: 0, guide_dog: true }, missing: [] }),
      trafficH: async () => ({ status: 'normal', mode: 'live', cause: '', summary: 'Normal', source: 'https://www.ratp.fr/infos-trafic/rer/b', recorded: false }),
      linkup: async () => ({ corroboration: [], extraOptions: [] }), shuttlePublicUrl: () => 'https://shuttle.example',
      runBooking: (input) => { signal = input.signal; return new Promise(() => {}); },
    });
    registry.sessions.set(issued.id, session);
    session.handle({ type: 'hello', scenario: 'live', gps: null, profile: { name: 'Karim', phone: '+33612345678', email: 'karim@example.com', language: 'fr', guide_dog: true } });
    session.handle({ type: 'final_transcript', text: 'CDG' });
    for (let i = 0; i < 60; i++) await Promise.resolve();
    session.handle({ type: 'user_reply', text: 'shuttle' });
    expect(signal?.aborted).toBe(false);
    registry.disconnect(issued.id); await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(signal?.aborted).toBe(true); expect(registry.sessions.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
