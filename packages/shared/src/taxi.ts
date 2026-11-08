import { z } from 'zod';
import { distanceMeters, normalizePlace, stationForPlace } from './places.js';

const PointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), paris: z.boolean().optional() });
export const TaxiQuoteSchema = z.object({ origin: z.string().min(1), destination: z.string().min(1), from: PointSchema.optional(), to: PointSchema.optional(), at: z.iso.datetime({ offset: true }), passengers: z.number().int().min(1).max(8).default(1) });
export type TaxiQuote = z.infer<typeof TaxiQuoteSchema>;
export type TaxiPoint = z.infer<typeof PointSchema>;
export function parisPickupTime(date: string, time: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return;
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const candidates = ['+01:00', '+02:00'].map((offset) => new Date(date + 'T' + time + ':00' + offset)).filter((value) => Number.isFinite(value.getTime()) && format.format(value) === date + ' ' + time);
  return candidates.length === 1 ? candidates[0] : undefined;
}
const parisStations = new Set(['Bercy', 'Gare de Lyon', 'Gare du Nord', 'Châtelet–Les Halles', 'Charles de Gaulle–Étoile', 'Gare Montparnasse', 'Gare de l’Est', 'Saint-Michel–Notre-Dame', 'Luxembourg', 'Port-Royal', 'Denfert-Rochereau', 'Cité Universitaire']);
function taxiStation(place: string) {
  const station = stationForPlace(place);
  const text = normalizePlace(place.replace(/^près (?:du|de)\s+/iu, '')).replace(/^(?:(?:paris|aeroport(?: de paris)?|airport|metro|station)\s+)+/, '');
  if (/\b\d{5}\b/.test(text) && station?.name !== 'CDG' && station?.name !== 'Orly') return;
  if (station && parisStations.has(station.name) && ![station.name, ...station.aliases].some((name) => text === normalizePlace(name)) && !/\bparis$/.test(text)) return;
  return station && [station.name, ...station.aliases].some((name) => text === normalizePlace(name) || text.startsWith(normalizePlace(name) + ' ')) ? station : undefined;
}
export function taxiPlaceKey(place: string): string {
  const station = taxiStation(place);
  return station?.name ?? normalizePlace(place.replace(/^près (?:du|de)\s+/iu, '').replace(/,\s*à\s+/giu, ', '));
}
export function taxiPoint(place: string): TaxiPoint | undefined {
  const station = taxiStation(place);
  return station ? { latitude: station.latitude, longitude: station.longitude, paris: parisStations.has(station.name) } : undefined;
}
export function taxiPlacesEquivalent(quoted: string, selected: string): boolean {
  return normalizePlace(taxiPlaceKey(quoted)) === normalizePlace(taxiPlaceKey(selected));
}
export async function geocodeTaxiPlace(place: string, { fetch: fetcher = globalThis.fetch, signal }: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<TaxiPoint | undefined> {
  const station = taxiPoint(place);
  if (station && !/^\d/.test(place.trim())) return station;
  signal?.throwIfAborted();
  try {
    const timeout = AbortSignal.timeout(3000);
    const query = place.replace(/^près (?:du|de)\s+/iu, '').replace(/,\s*à\s+/giu, ', ');
    const response = await fetcher(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return;
    const body = await response.json(), feature = body?.features?.[0], coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || (feature.properties?.score ?? 0) < .5) return;
    const parsed = PointSchema.safeParse({ longitude: coordinates[0], latitude: coordinates[1], paris: feature.properties?.citycode === '75056' || /^751(?:0[1-9]|1\d|20)$/.test(feature.properties?.citycode ?? '') });
    return parsed.success ? parsed.data : undefined;
  } catch { signal?.throwIfAborted(); return; }
}
export async function resolveTaxiQuote(trip: { origin: string; destination: string; passengers?: number }, { now = new Date(), gps, fetch, signal }: { now?: Date; gps?: { latitude: number; longitude: number }; fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<TaxiQuote> {
  const [from, to] = await Promise.all([gps ? Promise.resolve({ ...gps, paris: taxiPoint(trip.origin)?.paris ?? /,\s*(?:à\s+)?Paris$/iu.test(trip.origin) }) : geocodeTaxiPlace(trip.origin, { fetch, signal }), geocodeTaxiPlace(trip.destination, { fetch, signal })]);
  return TaxiQuoteSchema.parse({ origin: trip.origin, destination: trip.destination, from, to, at: now.toISOString(), passengers: trip.passengers ?? 1 });
}
const airport = (place: string): 'cdg' | 'orly' | undefined => {
  const name = taxiStation(place)?.name;
  return name === 'CDG' ? 'cdg' : name === 'Orly' ? 'orly' : undefined;
};
function bank(point: TaxiPoint): 'right' | 'left' {
  // Approximate Seine centreline; only used after Paris municipality membership is established.
  const river = [[2.24, 48.84], [2.29, 48.861], [2.32, 48.863], [2.35, 48.853], [2.38, 48.834], [2.42, 48.815]];
  const found = river.findIndex(([longitude]) => longitude! >= point.longitude), i = found < 0 ? river.length - 1 : Math.max(1, found);
  const [x1, y1] = river[i - 1]!, [x2, y2] = river[i]!;
  return point.latitude >= y1! + (point.longitude - x1!) / (x2! - x1!) * (y2! - y1!) ? 'right' : 'left';
}
function holiday(date: string, year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const h = (19 * a + b - d - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * e + 2 * Math.floor(c / 4) - h - c % 4) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114, easter = Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1);
  return ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].includes(date.slice(5)) || [1, 39, 50].some((days) => new Date(easter + days * 86400000).toISOString().slice(0, 10) === date);
}
export function estimateTaxi(input: TaxiQuote) {
  const quote = TaxiQuoteSchema.parse(input);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(quote.at)).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour), sunday = parts.weekday === 'Sun', publicHoliday = holiday(`${parts.year}-${parts.month}-${parts.day}`, Number(parts.year));
  const peak = !['Sat', 'Sun'].includes(parts.weekday!) && !publicHoliday && (hour >= 7 && hour < 10 || hour >= 17 && hour < 20);
  const from = quote.from ?? taxiPoint(quote.origin), to = quote.to ?? taxiPoint(quote.destination);
  const urban = !!from?.paris && !!to?.paris, port = airport(quote.origin) ?? airport(quote.destination);
  const paris = airport(quote.origin) ? to : airport(quote.destination) ? from : undefined;
  const speed = urban ? peak ? 18 : 25 : peak ? 28 : 40;
  const zones: readonly [RegExp, number][] = [[/\b(etoile|arc de triomphe|porte maillot|75008|75016|75017)\b/, 35], [/\b(gare du nord|gare de l est|75010)\b/, 50], [/\b(la chapelle|75018|75019)\b/, 35], [/\b(chatelet|les halles|louvre|75001|75002|75003|75004)\b/, 45], [/\b(montparnasse|denfert|75013|75014|75015)\b/, 55]];
  // Preserve coarse zone journey assumptions only when an endpoint cannot be resolved.
  const fallbackMinutes = port === 'cdg' ? zones.find(([zone]) => zone.test(normalizePlace(quote.origin)))?.[1] ?? 50 : port ? 50 : 35;
  const fallbackKm = fallbackMinutes / 60 * speed;
  const distanceKm = from && to ? distanceMeters(from, to) / 1000 * 1.3 : fallbackKm;
  const tariff = urban ? sunday && hour < 7 ? 'C' : !sunday && !publicHoliday && hour >= 10 && hour < 17 ? 'A' : 'B' : sunday || publicHoliday || hour < 7 || hour >= 19 ? 'C' : 'B';
  // 2026 Paris order 2026-00088, 21 Jan, art.1: €3 pickup; A/B/C €1.30/1.66/1.76 per km; minimum €8.
  // Primary prefectural document (mirror): https://www.taxis-de-france.com/arretesprefectoraux/2026/75.pdf
  // Official airport forfaits: https://www.service-public.gouv.fr/particuliers/actualites/A15396
  // CDG right/left €56/65; Orly right/left €45/36, both directions, Paris municipality only.
  // Simulation excludes reservation/waiting/toll extras; passenger supplement is €5.50 from passenger five.
  const forfait = port && paris?.paris ? (port === 'cdg' ? bank(paris) === 'right' ? 56 : 65 : bank(paris) === 'right' ? 45 : 36) : undefined;
  const base = forfait ?? Math.round(3 + distanceKm * { A: 1.30, B: 1.66, C: 1.76 }[tariff]);
  const price = Math.max(8, base + Math.max(0, quote.passengers - 4) * 5.5);
  // Planning averages, not live traffic: intramuros 18/25 km/h peak/off-peak, mixed suburban 28/40.
  // Dispatch assumption: eight minutes at rush hour, five otherwise; not live vehicle availability.
  return { price, journey_minutes: Math.max(5, Math.ceil(distanceKm / speed * 60 / 5) * 5), pickup_wait_minutes: peak ? 8 : 5, distance_km: Math.round(distanceKm * 10) / 10, tariff: forfait === undefined ? tariff : 'forfait', fallback: !(from && to) };
}
