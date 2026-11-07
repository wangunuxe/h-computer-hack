import { describe, expect, it } from 'vitest';
import type { Trip } from '@voila/shared';
import { pickupWindow, pickupProblem } from './pickup-window.js';
const now = new Date('2026-11-07T21:42:12Z');
const fare = { total_price: 65, currency: 'EUR' as const };
const trip: Trip = { origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2026-11-08T00:41:46+01:00', passengers: 1, luggage: 0, guide_dog: true };
describe('Paris pickup safety window', () => {
  it('rejects PAS-2FC83035 wrong-day pickup despite the correct arrival deadline', () => {
    const window = pickupWindow(trip, now);
    expect(pickupProblem({ ...fare, pickup_date: '2026-11-08', pickup_time: '23:30' }, window, now)).toContain('Correct the date');
    expect(pickupProblem({ ...fare, pickup_date: '2026-11-07', pickup_time: '23:30' }, window, now)).toBeUndefined();
  });
  it('permits valid midnight rollovers without assuming the deadline date is the pickup date', () => {
    const window = pickupWindow({ ...trip, deadline: '2026-11-08T02:00:00+01:00' }, now);
    expect(pickupProblem({ ...fare, pickup_date: '2026-11-08', pickup_time: '00:45' }, window, now)).toBeUndefined();
  });
  it('rejects missing facts, past pickups, infeasible deadlines and Paris DST gaps or ambiguous times', () => {
    expect(pickupProblem({}, pickupWindow(trip, now), now)).toContain('Read the pickup');
    expect(pickupProblem({ ...fare, pickup_date: '2026-11-07', pickup_time: '21:00' }, pickupWindow(trip, now), now)).toContain('Correct the date');
    expect(() => pickupWindow({ ...trip, deadline: now.toISOString() }, now)).toThrow('No pickup window');
    for (const [date, time] of [['2027-03-28', '02:30'], ['2027-10-31', '02:30']]) expect(pickupProblem({ ...fare, pickup_date: date, pickup_time: time }, pickupWindow(trip, now), now)).toContain('invalid or ambiguous');
  });
});
