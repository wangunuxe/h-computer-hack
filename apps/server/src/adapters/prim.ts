import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const primRerBEndpoint = 'https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=STIF:Line::C01743:';
export interface Disruption { status: 'normal' | 'disrupted' | 'unknown'; mode: 'demo' | 'live-prim' | 'live-h'; summary: string; cause: string; source: string; recorded: boolean }

const text = z.object({ value: z.string().min(1) });
const responseSchema = z.object({ Siri: z.object({ ServiceDelivery: z.object({
  GeneralMessageDelivery: z.array(z.object({
    Status: z.boolean().optional(),
    InfoMessage: z.array(z.object({ Content: z.object({ Message: z.array(z.object({ MessageText: text })).min(1) }) })).default([]),
  })).min(1),
}) }) });

function parseResponse(value: unknown): string {
  const deliveries = responseSchema.parse(value).Siri.ServiceDelivery.GeneralMessageDelivery;
  if (deliveries.some((delivery) => delivery.Status === false)) throw new Error('PRIM delivery failed');
  const messages = [...new Set(deliveries.flatMap((delivery) => delivery.InfoMessage.flatMap((info) => info.Content.Message.map((message) => message.MessageText.value))))];
  if (!messages.length && deliveries.some((delivery) => delivery.Status !== true)) throw new Error('PRIM status missing');
  return messages.join(' ');
}

export async function getRerBDisruption({ apiKey, fetch: fetcher = globalThis.fetch, signal, timeoutMs = 5000 }: {
  apiKey?: string; fetch?: typeof globalThis.fetch; signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<Disruption> {
  signal?.throwIfAborted();
  if (!apiKey) throw new Error('PRIM_API_KEY is not configured');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new Error('PRIM request interrupted')); };
    timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    const request = async () => {
      const response = await fetcher(primRerBEndpoint, { headers: { apikey: apiKey }, signal: controller.signal });
      if (!response.ok) throw new Error(`PRIM HTTP ${response.status}`);
      const cause = parseResponse(await response.json());
      const normal = !cause || /^(?:RER B\s*[:—-]?\s*)?(?:trafic normal|aucune perturbation|traffic is normal|no current alerts)[.!]?$/i.test(cause.trim());
      return { status: normal ? 'normal' as const : 'disrupted' as const, mode: 'live-prim' as const, summary: cause ? `RER B — ${cause}` : 'RER B: no traffic alerts reported.', cause, source: primRerBEndpoint, recorded: false };
    };
    return await Promise.race([request(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

export async function getDemoDisruption(): Promise<Disruption> {
  const fixture: unknown = JSON.parse(await readFile(new URL('../../../../scripts/fixtures/prim-rer-b.json', import.meta.url), 'utf8'));
  const cause = parseResponse(fixture);
  return { status: 'disrupted', mode: 'demo', summary: `RER B — ${cause}`, cause, source: primRerBEndpoint, recorded: true };
}
