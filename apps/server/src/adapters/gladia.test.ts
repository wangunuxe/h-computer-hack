import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGladiaSession } from './gladia.js';
import { createApp } from '../index.js';
import { SessionRegistry } from '../session-registry.js';
import { VoilaSession } from '../session.js';

afterEach(() => vi.unstubAllEnvs());
describe('Gladia live initialization', () => {
  it.each(['fr', 'en'])('sends documented PCM and language config for %s and exposes only url', async (language) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ url: 'wss://api.gladia.io/live?token=test', id: 'internal' }), { status: 201 }));
    expect(await createGladiaSession(language, { apiKey: 'test-key', fetch: fetcher })).toEqual({ url: 'wss://api.gladia.io/live?token=test' });
    expect(fetcher).toHaveBeenCalledWith('https://api.gladia.io/v2/live', expect.objectContaining({ method: 'POST', headers: { 'x-gladia-key': 'test-key', 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal) }));
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ encoding: 'wav/pcm', bit_depth: 16, sample_rate: 16000, channels: 1, endpointing: 0.5, language_config: { languages: [language] } });
  });
  it.each([new Response('no', { status: 500 }), new Response('{}'), new Response('{'), new Response('{"url":"https://not-a-websocket.example"}')])('rejects bad upstream responses', async (response) => {
    await expect(createGladiaSession('fr', { apiKey: 'test-key', fetch: vi.fn().mockResolvedValue(response) })).rejects.toThrow();
  });
  it('fails closed without a key or on fetch rejection', async () => {
    vi.stubEnv('GLADIA_API_KEY', ''); const fetcher = vi.fn();
    await expect(createGladiaSession('fr', { fetch: fetcher })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    await expect(createGladiaSession('en', { apiKey: 'test', fetch: vi.fn().mockRejectedValue(new Error('timeout')) })).rejects.toThrow();
  });
  it('requires valid claimed credentials and uses the authenticated profile language', async () => {
    let now = 0;
    const registry = new SessionRegistry(undefined, undefined, 100, () => now); const issued = registry.issue(); if ('error' in issued) throw new Error('capacity');
    const gladia = vi.fn().mockResolvedValue({ url: 'wss://api.gladia.io/live' }); const app = createApp({ registry, gladia });
    const post = (body: unknown) => app.request('/gladia/session', { method: 'POST', body: JSON.stringify(body) });
    try {
      for (const body of [{}, issued, { ...issued, resume_token: 'wrong' }, { id: 'unissued', resume_token: issued.resume_token }]) expect((await post(body)).status).toBe(401);
      expect(gladia).not.toHaveBeenCalled();
      expect(registry.connect(issued.id, issued.resume_token)).toBe(true);
      const session = new VoilaSession(() => {}); registry.sessions.set(issued.id, session);
      session.handle({ type: 'hello', profile: { name: 'Karim', email: 'k@example.com', phone: '+33123456789', language: 'en', guide_dog: true }, gps: null });
      const response = await post(issued); expect(response.status).toBe(200); expect(await response.json()).toEqual({ url: 'wss://api.gladia.io/live' }); expect(gladia).toHaveBeenCalledWith('en');
      now = 3000; gladia.mockRejectedValue(new Error('secret upstream response')); expect((await post(issued)).status).toBe(502);
      expect((await post(issued)).status).toBe(429);
      expect((await app.request('/gladia/session', { method: 'POST', body: '{' })).status).toBe(400);
    } finally { registry.dispose(); }
  });
  it('atomically limits each claimed session to one attempt per 3 seconds and 30 per rolling hour', async () => {
    let now = 0;
    const registry = new SessionRegistry(undefined, undefined, 100, () => now);
    const first = registry.issue(); const second = registry.issue();
    if ('error' in first || 'error' in second) throw new Error('capacity');
    registry.connect(first.id, first.resume_token); registry.connect(second.id, second.resume_token);
    const gladia = vi.fn().mockResolvedValue({ url: 'wss://api.gladia.io/live' }); const app = createApp({ registry, gladia });
    const post = (body = first) => app.request('/gladia/session', { method: 'POST', body: JSON.stringify(body) });
    try {
      expect((await Promise.all([post(), post()])).map((response) => response.status).sort()).toEqual([200, 429]);
      expect((await post(second)).status).toBe(200);
      now = 2999; expect((await post()).status).toBe(429);
      for (let i = 1; i < 30; i++) { now = i * 3000; expect((await post()).status).toBe(200); }
      now = 90_000; expect((await post()).status).toBe(429);
      registry.disconnect(first.id); registry.connect(first.id, first.resume_token);
      expect((await post()).status).toBe(429);
      now = 3_599_999; expect((await post()).status).toBe(429);
      now = 3_600_000; expect((await post()).status).toBe(200);
      expect(gladia).toHaveBeenCalledTimes(32);
    } finally { registry.dispose(); }
  });
  it('does not claim or extend an unclaimed reservation when Gladia credentials are rejected', async () => {
    vi.useFakeTimers();
    const registry = new SessionRegistry(); const issued = registry.issue(); if ('error' in issued) throw new Error('capacity');
    const gladia = vi.fn(); const app = createApp({ registry, gladia });
    try {
      vi.advanceTimersByTime(119_000);
      expect((await app.request('/gladia/session', { method: 'POST', body: JSON.stringify(issued) })).status).toBe(401);
      vi.advanceTimersByTime(1000);
      expect(registry.connect(issued.id, issued.resume_token)).toBe(false);
      expect(gladia).not.toHaveBeenCalled();
    } finally { registry.dispose(); vi.useRealTimers(); }
  });
});
