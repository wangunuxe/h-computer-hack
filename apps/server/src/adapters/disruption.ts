import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { trafficPage } from '../stations.js';

export const rerBTrafficPage = 'https://www.ratp.fr/infos-trafic/rer/b';
export interface Disruption { line?: string; status: 'normal' | 'disrupted' | 'unknown'; mode: 'demo' | 'live'; summary: string; cause: string; source: string; recorded: boolean }

const text = z.object({ value: z.string().min(1) });
const fixtureSchema = z.object({
  source: z.literal(rerBTrafficPage),
  Siri: z.object({ ServiceDelivery: z.object({
    GeneralMessageDelivery: z.array(z.object({
      InfoMessage: z.array(z.object({ Content: z.object({ Message: z.array(z.object({ MessageText: text })).min(1) }) })).min(1),
    })).min(1),
  }) }),
});

export async function getDemoDisruption(line = 'RER B'): Promise<Disruption> {
  if (line !== 'RER B') return { line, status: 'unknown', mode: 'demo', summary: `Aucune donnée enregistrée pour ${line}.`, cause: '', source: trafficPage(line), recorded: false };
  const fixture = fixtureSchema.parse(JSON.parse(await readFile(new URL('../../../../scripts/fixtures/prim-rer-b.json', import.meta.url), 'utf8')));
  const cause = [...new Set(fixture.Siri.ServiceDelivery.GeneralMessageDelivery.flatMap((delivery) => delivery.InfoMessage.flatMap((info) => info.Content.Message.map((message) => message.MessageText.value))))].join(' ');
  return { status: 'disrupted', mode: 'demo', summary: `RER B — ${cause}`, cause, source: fixture.source, recorded: true };
}
