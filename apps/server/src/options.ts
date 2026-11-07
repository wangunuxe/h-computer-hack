import type { Option, Trip } from '@voila/shared';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
export function matchesPresetRoute(trip: Pick<Trip, 'origin' | 'destination'>): boolean {
  const destination = normalize(trip.destination);
  return Boolean(trip.origin.trim()) && (/\b(cdg|roissy)\b/.test(destination) || /\bcharles de gaulle\b/.test(destination) && !/\betoile\b/.test(destination));
}
export function isRerBOrigin(origin: string): boolean {
  return /\b(gare du nord|chatelet|les halles|saint michel|luxembourg|port royal|denfert rochereau|cite universitaire)\b/.test(normalize(origin));
}

export const presetOptions: readonly Option[] = [
  { id: 'paris-airport-shuttle', name: 'Airport taxi', pickup_wait_minutes: 5, journey_minutes: 50, price: 65, guide_dog_status: 'unknown', source: 'https://paris-airport-shuttle.com/fr/reservation/' },
  { id: 'rer-b-replacement-bus', name: 'RER B replacement bus', pickup_wait_minutes: 25, journey_minutes: 90, price: 13, guide_dog_status: 'unknown', source: 'https://www.rerb-leblog.fr/' },
];

export function optionsForTrip(trip: Pick<Trip, 'origin' | 'destination'>, disrupted: boolean): Option[] {
  if (!matchesPresetRoute(trip)) return [];
  const origin = normalize(trip.origin);
  const zones: readonly [RegExp, number][] = [
    [/\b(etoile|arc de triomphe|champs elysees|porte maillot|75008|75016|75017)\b/, 35],
    [/\b(gare du nord|gare de l est|75010)\b/, 50],
    [/\b(la chapelle|porte de la chapelle|75018|75019)\b/, 35],
    [/\b(chatelet|les halles|louvre|rivoli|hotel de ville|75001|75002|75003|75004)\b/, 45],
    [/\b(montparnasse|denfert|75013|75014|75015)\b/, 55],
  ];
  const journey_minutes = zones.find(([zone]) => zone.test(origin))?.[1] ?? 50;
  const taxi = { ...presetOptions[0]!, name: `Airport taxi — ${trip.origin}`, journey_minutes };
  return [taxi, ...(disrupted && isRerBOrigin(trip.origin) ? [{ ...presetOptions[1]! }] : [])];
}

export type BookingMethod = { kind: 'h_agent'; playbook: 'paris-airport-shuttle' } | { kind: 'manual'; instructions: string };
export const bookingMethods: Readonly<Record<string, BookingMethod>> = {
  'paris-airport-shuttle': { kind: 'h_agent', playbook: 'paris-airport-shuttle' },
  'rer-b-replacement-bus': { kind: 'manual', instructions: 'Ask station staff whether an RER B replacement bus is operating to CDG and where to board. Confirm the terminal, accessibility and departure time before travelling.' },
};

export function mergeOptions(preset: readonly Option[], extra: readonly Option[]): Option[] {
  return [...new Map([...preset, ...extra].map((option) => [option.id, option])).values()];
}
