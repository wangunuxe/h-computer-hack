import { OptionSchema, type Option } from '@voila/shared';
import { z } from 'zod';
import { presetOptions } from '../options.js';

const httpUrl = z.url().refine((url) => ['https:', 'http:'].includes(new URL(url).protocol));
const resultSchema = z.object({ results: z.array(z.object({
  type: z.enum(['text', 'image']), name: z.string(), url: httpUrl, content: z.string().optional(),
})) });

export async function searchDisruptionAndAlternatives({ query, context, signal, apiKey = process.env.LINKUP_API_KEY, fetch: fetcher = globalThis.fetch, timeoutMs = 8000 }: {
  query: string; context?: string; signal?: AbortSignal; apiKey?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number;
}): Promise<{ corroboration: { text: string; sources: string[] }[]; extraOptions: Option[] }> {
  if (!apiKey) throw new Error('LINKUP_API_KEY is required.');
  if (!query.trim()) throw new Error('A Linkup search query is required.');
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { reject(new Error('Linkup search aborted.')); controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { reject(new Error('Linkup search timed out.')); controller.abort(); }, timeoutMs);
  });
  try {
    const request = async () => {
      const response = await fetcher('https://api.linkup.so/v1/search', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: [query, context].filter(Boolean).join('\n'), depth: 'fast', outputType: 'searchResults', maxResults: 5 }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Linkup search HTTP ${response.status}.`);
      const data = resultSchema.parse(await response.json());
      const corroboration: { text: string; sources: string[] }[] = [];
      const modes = new Map<string, Option>();
      for (const result of data.results) {
        if (result.type !== 'text' || !result.content?.trim()) continue;
        corroboration.push({ text: `${result.name}: ${result.content}`, sources: [result.url] });
        // Only operator/station sources identify catalogue modes; snippets never supply fares or availability.
        const host = new URL(result.url).hostname.replace(/^www\./, '');
        const text = `${result.name} ${result.content}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        const id = host === 'paris-airport-shuttle.com' && /paris airport shuttle/.test(text) ? 'paris-airport-shuttle'
          : host === 'rerb-leblog.fr' && /\bbus\b/.test(text) && /remplacement|replacement|substitution/.test(text) ? 'rer-b-replacement-bus' : undefined;
        const preset = presetOptions.find((option) => option.id === id);
        if (preset) modes.set(preset.id, OptionSchema.parse({ ...preset, source: result.url }));
      }
      return { corroboration, extraOptions: [...modes.values()] };
    };
    return await Promise.race([request(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
