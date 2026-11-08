import { estimateTaxi, type Option, type Trip, type TaxiQuote } from '@voila/shared';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
export function matchesPresetRoute(trip: Pick<Trip, 'origin' | 'destination'>): boolean {
  return Boolean(trip.origin.trim() && trip.destination.trim());
}
export function isAirport(destination: string): boolean {
  const text = normalize(destination);
  return /\b(cdg|roissy|orly|airport|aeroport)\b/.test(text) || /\bcharles de gaulle\b/.test(text) && !/\betoile\b/.test(text);
}
export function isRerBOrigin(origin: string): boolean {
  return /\b(gare du nord|chatelet|les halles|saint michel|luxembourg|port royal|denfert rochereau|cite universitaire)\b/.test(normalize(origin));
}

export const presetOptions: readonly Option[] = [
  { id: 'paris-airport-shuttle', name: 'Airport taxi', pickup_wait_minutes: 5, journey_minutes: 50, price: 65, guide_dog_status: 'unknown', source: 'https://paris-airport-shuttle.com/fr/reservation/' },
  { id: 'rer-b-replacement-bus', name: 'RER B replacement bus', pickup_wait_minutes: 25, journey_minutes: 90, price: 13, guide_dog_status: 'unknown', source: 'https://www.rerb-leblog.fr/' },
];

export function optionsForTrip(trip: Pick<Trip, 'origin' | 'destination'>, disrupted: boolean, quote?: TaxiQuote): Option[] {
  if (!matchesPresetRoute(trip)) return [];
  const airport = isAirport(trip.destination);
  const { price, journey_minutes, pickup_wait_minutes } = estimateTaxi(quote ?? { ...trip, at: new Date().toISOString(), passengers: 1 });
  const taxi = { ...presetOptions[0]!, name: `${airport ? 'Airport taxi' : `Taxi to ${trip.destination}`} — ${trip.origin}`, price, journey_minutes, pickup_wait_minutes };
  return [taxi, ...(airport && /\b(cdg|roissy|charles de gaulle)\b/.test(normalize(trip.destination)) && disrupted && isRerBOrigin(trip.origin) ? [{ ...presetOptions[1]! }] : [])];
}

export type BookingMethod = { kind: 'h_agent'; playbook: 'paris-airport-shuttle' } | { kind: 'manual'; instructions: string };
export const bookingMethods: Readonly<Record<string, BookingMethod>> = {
  'paris-airport-shuttle': { kind: 'h_agent', playbook: 'paris-airport-shuttle' },
  'rer-b-replacement-bus': { kind: 'manual', instructions: 'Ask station staff whether an RER B replacement bus is operating to CDG and where to board. Confirm the terminal, accessibility and departure time before travelling.' },
};

export function mergeOptions(preset: readonly Option[], extra: readonly Option[]): Option[] {
  return [...new Map([...preset, ...extra].map((option) => [option.id, option])).values()];
}
