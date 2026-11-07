import { randomUUID } from 'node:crypto';

export const vehicles = [
  { id: 'sedan', text: 'Private Sedan — up to 3 passengers, 2 suitcases — 65 EUR', price: 65, capacity: 3, luggageCapacity: 2 },
  { id: 'estate', text: 'Comfort Estate — up to 4 passengers, 4 suitcases — 85 EUR', price: 85, capacity: 4, luggageCapacity: 4 },
  { id: 'van', text: 'Private Minivan — up to 8 passengers, 8 suitcases — 110 EUR', price: 110, capacity: 8, luggageCapacity: 8 },
] as const;
export const passengerOptions = Array.from({ length: 8 }, (_, i) => ({
  value: String(i + 1), text: `${i + 1} passenger${i === 0 ? '' : 's'} — including children and infants`,
}));
export const luggageOptions = Array.from({ length: 9 }, (_, i) => ({
  value: String(i), text: `${i} suitcase${i === 1 ? '' : 's'} — standard checked luggage (max 23 kg each)`,
}));
export const timeOptions = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

export interface Route {
  pickup: string; dropoff: string; pickup_lat: string; pickup_lng: string;
  dropoff_lat: string; dropoff_lng: string; date: string; time: string;
}
export interface Info {
  name: string; email: string; phone: string; passengers: string; luggage: string; notes: string;
}
export interface Draft {
  id: string; difficulty: 'easy' | 'real'; route?: Route;
  vehicle?: typeof vehicles[number]; info?: Info; orderId?: string;
}
export interface Order {
  id: string; ref: string; route: Route; vehicle: typeof vehicles[number]; info: Info;
  paid: boolean; checkoutUrl?: string; checkoutSessionId?: string;
}
export function createStore() {
  return { drafts: new Map<string, Draft>(), orders: new Map<string, Order>() };
}
export type Store = ReturnType<typeof createStore>;
export function newDraft(difficulty: 'easy' | 'real'): Draft {
  return { id: randomUUID(), difficulty };
}
export const operatorPhone = '+33 1 84 80 00 00';
