import { describe, expect, it, vi } from 'vitest';
import { searchDisruptionAndAlternatives } from './linkup.js';

const result = (url: string, name: string, content: string) => ({ type: 'text', name, content, url, favicon: '' });
const fetchWith = (results: unknown[]) => vi.fn<typeof fetch>(async () => Response.json({ results }));
describe('Linkup search', () => {
  it('uses the documented POST contract and preserves source URLs', async () => {
    const fetcher = fetchWith([result('https://www.rerb-leblog.fr/incident', 'RER B', 'Incident de signalisation.')]);
    const response = await searchDisruptionAndAlternatives({ query: 'RER B today', context: 'Gare du Nord to CDG', apiKey: 'fake', fetch: fetcher });
    expect(fetcher).toHaveBeenCalledWith('https://api.linkup.so/v1/search', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'RER B today\nGare du Nord to CDG', depth: 'fast', outputType: 'searchResults', maxResults: 5 }) }));
    expect(response).toEqual({ corroboration: [{ text: 'RER B: Incident de signalisation.', sources: ['https://www.rerb-leblog.fr/incident'] }], extraOptions: [] });
  });
  it('maps only known transport modes from matching official sources, using catalogue estimates', async () => {
    const fetcher = fetchWith([
      result('https://www.g7.fr/book', 'G7', 'Taxi to CDG for 1 euro'),
      result('https://paris-airport-shuttle.com/fr/reservation/', 'Paris Airport Shuttle', 'Book a transfer'),
      result('https://www.garesetconnexions.sncf/nord', 'Gare du Nord', 'Taxi rank'),
      result('https://www.rerb-leblog.fr/travaux', 'RER B', 'Bus de remplacement CDG'),
      result('https://blog.example/taxi', 'G7 taxi', 'Taxi option'),
    ]);
    const response = await searchDisruptionAndAlternatives({ query: 'alternatives', apiKey: 'fake', fetch: fetcher });
    expect(response.extraOptions.map((o) => o.id)).toEqual(['g7-phone', 'paris-airport-shuttle', 'gare-du-nord-taxi', 'rer-b-replacement-bus']);
    expect(response.extraOptions[0]).toMatchObject({ price: 63, source: 'https://www.g7.fr/book' });
    expect(response.corroboration).toHaveLength(5);
  });
  it('handles empty results and images without inventing options', async () => {
    for (const results of [[], [{ type: 'image', name: 'Taxi', url: 'https://example.com/image.png' }]]) {
      expect(await searchDisruptionAndAlternatives({ query: 'travel', apiKey: 'fake', fetch: fetchWith(results) })).toEqual({ corroboration: [], extraOptions: [] });
    }
  });
  it('rejects HTTP and malformed responses', async () => {
    for (const response of [new Response('bad', { status: 401 }), Response.json({ bad: true }), Response.json({ results: [{ type: 'text', name: 'X', url: 'javascript:bad', content: 'bad' }] })]) {
      await expect(searchDisruptionAndAlternatives({ query: 'travel', apiKey: 'fake', fetch: async () => response })).rejects.toThrow();
    }
  });
  it('rejects missing credentials and empty queries before fetching', async () => {
    const fetcher = fetchWith([]);
    await expect(searchDisruptionAndAlternatives({ query: 'travel', apiKey: '', fetch: fetcher })).rejects.toThrow('LINKUP_API_KEY');
    await expect(searchDisruptionAndAlternatives({ query: '  ', apiKey: 'fake', fetch: fetcher })).rejects.toThrow('query');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('times out even if fetch ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const pending = searchDisruptionAndAlternatives({ query: 'travel', apiKey: 'fake', timeoutMs: 50, fetch: () => new Promise(() => {}) });
      const assertion = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
  it('honours abort before and during search', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    await expect(searchDisruptionAndAlternatives({ query: 'travel', apiKey: 'fake', signal: AbortSignal.abort(), fetch: fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = searchDisruptionAndAlternatives({ query: 'travel', apiKey: 'fake', signal: controller.signal, fetch: fetcher });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});
