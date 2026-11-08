import { randomUUID } from 'node:crypto';
import { estimateTaxi, type TaxiQuote } from '@voila/shared';

export const vehicles = [
  { id: 'sedan', text: 'Berline taxi — up to 3 passengers, 2 suitcases', capacity: 3, luggageCapacity: 2 },
  { id: 'estate', text: 'Taxi break confort — up to 4 passengers, 4 suitcases', capacity: 4, luggageCapacity: 4 },
  { id: 'van', text: 'Taxi van — up to 8 passengers, 8 suitcases', capacity: 8, luggageCapacity: 8 },
] as const;
export type Vehicle = { id: string; text: string; price: number; capacity: number; luggageCapacity: number };
export function vehiclesForDraft(draft: Draft): Vehicle[] {
  if (!draft.fare) return [];
  const price = estimateTaxi({ ...draft.fare, passengers: Number(draft.info?.passengers ?? draft.fare.passengers) }).price;
  return vehicles.map((vehicle) => ({ ...vehicle, price, text: `${vehicle.text} — ${price} EUR` }));
}
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
  fare?: TaxiQuote; vehicle?: Vehicle; info?: Info; orderId?: string;
}
export interface Order {
  id: string; ref: string; route: Route; vehicle: Vehicle; info: Info;
  paid: boolean; checkoutUrl?: string; checkoutSessionId?: string;
}
export function createStore() {
  return { drafts: new Map<string, Draft>(), orders: new Map<string, Order>(), quotes: new Map<string, { fare: TaxiQuote; expires: number }>() };
}
export type Store = ReturnType<typeof createStore>;
export function newDraft(difficulty: 'easy' | 'real'): Draft {
  return { id: randomUUID(), difficulty };
}
export const operatorPhone = '+33 1 84 80 00 00';
