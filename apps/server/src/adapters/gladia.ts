import { z } from 'zod';

export async function createGladiaSession(language: string, { apiKey = process.env.GLADIA_API_KEY, fetch: fetcher = globalThis.fetch }: { apiKey?: string; fetch?: typeof fetch } = {}) {
  if (!apiKey) throw new Error('Gladia is not configured');
  const response = await fetcher('https://api.gladia.io/v2/live', {
    method: 'POST', headers: { 'x-gladia-key': apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ encoding: 'wav/pcm', bit_depth: 16, sample_rate: 16000, channels: 1, endpointing: 0.5, maximum_duration_without_endpointing: 30,
      language_config: { languages: [language.toLowerCase().startsWith('fr') ? 'fr' : 'en'], code_switching: false },
      messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true, receive_lifecycle_events: true },
    }),
  });
  if (!response.ok) throw new Error('Gladia session initialization failed');
  const parsed = z.object({ url: z.url().refine((value) => new URL(value).protocol === 'wss:') }).parse(await response.json());
  return { url: parsed.url };
}
