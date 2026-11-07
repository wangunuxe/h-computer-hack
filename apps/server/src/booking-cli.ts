import { createInterface } from 'node:readline/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { bookingErrorMessage, runBooking } from './booking.js';

export function publicShuttleUrl(value: string | undefined): URL {
  if (!value) throw new Error('Set SHUTTLE_PUBLIC_URL to the public shuttle-clone URL; the H cloud browser cannot reach localhost.');
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const address = host.replace(/^\[|\]$/g, '');
  const [first = 0, second = 0] = address.split('.').map(Number);
  const privateIpv4 = isIP(address) === 4 && (
    first === 0 || first === 10 || first === 127 || first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168
  );
  const prefix = Number.parseInt(address.split(':')[0] || '0', 16);
  const privateIpv6 = isIP(address) === 6 && (
    address === '::' || address === '::1' || (prefix & 0xfe00) === 0xfc00 || (prefix & 0xffc0) === 0xfe80
  );
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
    privateIpv4 || privateIpv6) {
    throw new Error('SHUTTLE_PUBLIC_URL must be a public HTTP(S) URL, not a private or local address; the H cloud browser must reach it.');
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
  main().catch((error: unknown) => { console.error(bookingErrorMessage(error)); process.exitCode = 1; });
}
