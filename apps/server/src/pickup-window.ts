import type { Trip } from '@voila/shared';
import type { ConfirmationFields } from './confirmation.js';
import { parisIso } from './understand.js';
export function pickupWindow(trip: Trip, now: Date, journeyMinutes = 50) {
  const earliest = new Date(Math.ceil((now.getTime() + 5 * 60_000) / 900_000) * 900_000);
  const latest = new Date(trip.deadline ? Date.parse(trip.deadline) - journeyMinutes * 60_000 : now.getTime() + 60 * 60_000);
  if (earliest > latest) throw new Error('No pickup window remains before the arrival deadline.');
  return { earliest, latest };
}
export function pickupProblem(details: ConfirmationFields, window: ReturnType<typeof pickupWindow>, now: Date): string | undefined {
  if (!details.pickup_date || !details.pickup_time) return 'Read the pickup date and time before asking for approval.';
  if (details.total_price === undefined || !Number.isFinite(details.total_price) || details.total_price < 0 || details.currency !== 'EUR') return 'Read the transfer total price and EUR currency before asking for approval.';
  const local = `${details.pickup_date}T${details.pickup_time}:00`;
  const candidates = ['+01:00', '+02:00'].map((offset) => new Date(local + offset)).filter((date) => Number.isFinite(date.getTime()) && parisIso(date).startsWith(local));
  if (candidates.length !== 1) return 'Pickup time is invalid or ambiguous in Europe/Paris. Ask for another time.';
  const pickup = candidates[0]!;
  if (pickup <= now || pickup < window.earliest || pickup > window.latest) return `Pickup must be within ${parisIso(window.earliest)} and ${parisIso(window.latest)} in Europe/Paris, leaving travel time before the arrival deadline. Correct the date and time; do not create an order.`;
}
