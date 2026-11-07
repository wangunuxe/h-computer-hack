import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { runBooking } from './booking.js';

export function publicShuttleUrl(value: string | undefined): URL {
  if (!value) throw new Error('Set SHUTTLE_PUBLIC_URL to the public shuttle-clone URL; the H cloud browser cannot reach localhost.');
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]' || host === '0.0.0.0') {
    throw new Error('SHUTTLE_PUBLIC_URL must be a public HTTP(S) URL, not localhost; the H cloud browser must reach it.');
  }
  return url;
}

async function main() {
  const base = publicShuttleUrl(process.env.SHUTTLE_PUBLIC_URL);
  if (!process.env.HAI_API_KEY) throw new Error('Set HAI_API_KEY before running a real booking. Unit tests use a mocked SDK and need no key.');
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Booking interrupted'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const stdin = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const entry = new URL('/fr/reservation/', base);
    if (base.searchParams.get('difficulty') === 'easy') entry.searchParams.set('difficulty', 'easy');
    const response = await fetch(entry, { redirect: 'manual', signal: controller.signal });
    const location = response.headers.get('location');
    if (!response.ok && response.status !== 302) throw new Error(`Shuttle initialization failed: HTTP ${response.status}`);
    const route = new URL(location ?? response.url, entry);
    if (route.origin !== base.origin || !/^\/fr\/reservation\/[^/]+\/route$/.test(route.pathname)) {
      throw new Error('Shuttle did not return a direct draft route URL.');
    }
    const result = await runBooking({
      startUrl: route.href, signal: controller.signal,
      trip: { origin: 'Gare du Nord, 18 Rue de Dunkerque, Paris', destination: 'CDG Airport Terminal 2E, Roissy-en-France', passengers: 1, luggage: 1, guide_dog: true, deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() },
      profile: { name: 'Karim Demo', email: 'karim@example.com', phone: '+33612345678', language: 'fr', guide_dog: true },
      onProgress: (text) => console.log(`[H] ${text}`),
      confirm: async (summary) => {
        console.log(`Confirm booking: ${summary}`);
        const reply = process.argv.includes('--yes') ? 'yes' : await stdin.question('Approve? [y/N] ', { signal: controller.signal });
        return { approved: /^(y|yes)$/i.test(reply.trim()), reply };
      },
      onPaymentHandoff: ({ url, amount, merchant, summary }) => console.log(`Payment handoff (pay on your own device): ${url}\n${merchant}: EUR ${amount}\n${summary}`),
    });
    console.log('Booking:', JSON.stringify(result.booking, null, 2));
    console.log('Metrics:', JSON.stringify(result.metrics, null, 2));
    if (result.agentViewUrl) console.log('Agent View:', result.agentViewUrl);
  } finally {
    stdin.close();
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
