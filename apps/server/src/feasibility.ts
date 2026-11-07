import type { Option, Trip } from '@voila/shared';

export function assessOptions(options: readonly Option[], trip: Trip, now: Date, { bufferMinutes = 15 } = {}) {
  const deadline = Date.parse(trip.deadline);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(deadline) || !Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
    throw new Error('A valid clock, deadline and nonnegative buffer are required.');
  }
  const feasible: Option[] = [];
  const rejected: { option: Option; reason: 'too_late' | 'guide_dog_refused'; detail: string }[] = [];
  const arrival = (option: Option) => now.getTime() + (option.pickup_wait_minutes + option.journey_minutes) * 60_000;
  for (const option of options) {
    if (trip.guide_dog && option.guide_dog_status === 'refused') {
      rejected.push({ option, reason: 'guide_dog_refused', detail: 'This operator refuses guide dogs.' });
    } else if (arrival(option) + bufferMinutes * 60_000 > deadline) {
      rejected.push({ option, reason: 'too_late', detail: `Arrival plus ${bufferMinutes} minutes buffer exceeds the check-in cutoff ${trip.deadline}.` });
    } else feasible.push(option);
  }
  const rank = { accepted: 0, unknown: 1, refused: 2 };
  feasible.sort((a, b) => rank[a.guide_dog_status] - rank[b.guide_dog_status] || arrival(a) - arrival(b));
  return { feasible, rejected };
}
