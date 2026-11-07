import type { Option, Trip } from '@voila/shared';

export function matchesPresetRoute(trip: Pick<Trip, 'origin' | 'destination'>): boolean {
  const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\bgare du nord\b/.test(normalize(trip.origin)) && /\b(cdg|roissy|charles de gaulle)\b/.test(normalize(trip.destination));
}

export const presetOptions: readonly Option[] = [
  { id: 'gare-du-nord-taxi', name: 'Gare du Nord taxi rank', pickup_wait_minutes: 10, journey_minutes: 45, price: 56, guide_dog_status: 'accepted', source: 'https://www.garesetconnexions.sncf/fr/gares-services/paris-gare-du-nord' },
  { id: 'g7-phone', name: 'G7 by phone', pickup_wait_minutes: 20, journey_minutes: 45, price: 63, guide_dog_status: 'accepted', source: 'https://www.g7.fr/' },
  { id: 'paris-airport-shuttle', name: 'Paris Airport Shuttle', pickup_wait_minutes: 30, journey_minutes: 50, price: 65, guide_dog_status: 'unknown', source: 'https://paris-airport-shuttle.com/fr/reservation/' },
  { id: 'rer-b-replacement-bus', name: 'RER B replacement bus', pickup_wait_minutes: 25, journey_minutes: 90, price: 13, guide_dog_status: 'unknown', source: 'https://www.rerb-leblog.fr/' },
];

export type BookingMethod = { kind: 'h_agent'; playbook: 'paris-airport-shuttle' } | { kind: 'manual'; instructions: string };
export const bookingMethods: Readonly<Record<string, BookingMethod>> = {
  'gare-du-nord-taxi': { kind: 'manual', instructions: 'Go to the official Gare du Nord taxi rank. Ask staff for help locating the queue; mention the guide dog and confirm the fare.' },
  'g7-phone': { kind: 'manual', instructions: 'Call G7 on 3607 in France. Give the pickup point, CDG terminal, passenger count and guide-dog requirement; confirm availability and fare.' },
  'paris-airport-shuttle': { kind: 'h_agent', playbook: 'paris-airport-shuttle' },
  'rer-b-replacement-bus': { kind: 'manual', instructions: 'Ask station staff whether an RER B replacement bus is operating to CDG and where to board. Confirm the terminal, accessibility and departure time before travelling.' },
};

export function mergeOptions(preset: readonly Option[], extra: readonly Option[]): Option[] {
  return [...new Map([...preset, ...extra].map((option) => [option.id, option])).values()];
}
