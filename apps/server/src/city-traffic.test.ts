import { afterEach, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@voila/shared';
import { VoilaSession } from './session.js';

const sessions: VoilaSession[] = [];
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); });
it.each([
  ['fr', 'Saint-Michel', 'Gare du Nord', false], ['en', 'Saint-Michel', 'Gare du Nord', false],
  ['fr', 'Gare du Nord', 'Saint-Michel', false], ['en', 'Gare du Nord', 'Saint-Michel', false],
  ['fr', 'Saint-Michel', 'CDG', true],
] as const)('uses destination-aware recorded RER B narration: %s %s → %s', async (language, origin, destination, airport) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T10:00:00+01:00'));
  const events: ServerEvent[] = [];
  const session = new VoilaSession((event) => events.push(event), { understand: async () => ({ trip: { origin, destination }, missing: [] }) }); sessions.push(session);
  session.handle({ type: 'hello', profile: { language }, gps: null, scenario: 'demo' }); session.handle({ type: 'final_transcript', text: `${origin} vers ${destination}` });
  await vi.waitFor(() => expect(session.stage).toBe('CHOOSE'));
  const speech = events.filter((event) => event.type === 'say').map((event) => event.text).join('\n');
  expect(speech).toContain('RER B'); expect(speech).toContain(origin);
  if (airport) expect(speech).toMatch(/aéroport|airport/); else expect(speech).not.toMatch(/aéroport|airport|CDG/);
});
