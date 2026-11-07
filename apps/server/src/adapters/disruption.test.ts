import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { getDemoDisruption, rerBTrafficPage } from './disruption.js';

describe('getDemoDisruption', () => {
  it('loads the fixed recorded fixture deterministically without HTTP', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const fixture = JSON.parse(await readFile(new URL('../../../../scripts/fixtures/prim-rer-b.json', import.meta.url), 'utf8'));
      const result = await getDemoDisruption();
      expect(result).toEqual(await getDemoDisruption());
      expect(result).toMatchObject({ mode: 'demo', status: 'disrupted', recorded: true, source: rerBTrafficPage });
      expect(fixture.source).toBe(rerBTrafficPage);
      expect(result.cause).toBe(fixture.Siri.ServiceDelivery.GeneralMessageDelivery[0].InfoMessage[0].Content.Message[0].MessageText.value);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
