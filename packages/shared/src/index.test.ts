import { describe, expect, it } from 'vitest';
import { BookingSchema, OptionSchema, ProfileSchema, ServerEventSchema, TripSchema, WatchPayloadSchema, WebEventSchema } from './index.js';

const profile = { name: 'Karim', phone: '+33123456789', email: 'karim@example.com', guide_dog: true, language: 'fr' };
const option = { id: 'shuttle', name: 'Airport shuttle', pickup_wait_minutes: 5, journey_minutes: 45, price: 65, guide_dog_status: 'unknown' };
const booking = { ref: 'DEMO-1', pickup_time: '2026-11-07T12:00:00+01:00', pickup_point: 'Gare du Nord', price: 65, operator_phone: '+33123456789', payment_url: 'https://checkout.stripe.com/example', guide_dog_status: 'unknown' };

describe('server events', () => {
  it('accepts a three-minute transcript within the server WebSocket size limit', () => {
    const event = { type: 'final_transcript', text: 'é'.repeat(3000) };
    expect(WebEventSchema.parse(event)).toEqual(event);
    expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThan(64 * 1024);
  });
  const events = [
    { type: 'activity', cancellable: true },
    { type: 'stage', stage: 'LISTEN' },
    { type: 'say', text: 'Bonjour' },
    { type: 'feed', kind: 'research', text: 'Checking trains', source: 'https://example.com' },
    { type: 'clarify', question: 'What time is your flight?' },
    { type: 'options', items: [option] },
    { type: 'confirm', summary: 'Shuttle for 65 EUR' },
    { type: 'payment_handoff', url: booking.payment_url, amount: 65, merchant: 'Demo shuttle', expires_at: '2026-11-07T13:00:00Z' },
    { type: 'booking_card', booking },
    { type: 'error', message: 'Service unavailable' },
  ];
  it.each(events)('parses $type', (event) => {
    expect(ServerEventSchema.parse(event)).toEqual(event);
  });
  it('allows empty options', () => {
    expect(ServerEventSchema.parse({ type: 'options', items: [] })).toEqual({ type: 'options', items: [] });
  });
});

describe('web events', () => {
  it('accepts deferred profile fields but still validates supplied contacts', () => {
    expect(WebEventSchema.safeParse({ type: 'hello', profile: { language: 'fr' }, gps: null }).success).toBe(true);
    expect(WebEventSchema.safeParse({ type: 'hello', profile: { language: 'fr', email: 'invalid' }, gps: null }).success).toBe(false);
    expect(ServerEventSchema.safeParse({ type: 'profile', profile: { language: 'en', guide_dog: false } }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ type: 'profile_request', question: 'Your name?' }).success).toBe(true);
  });
  const events = [
    { type: 'hello', profile, gps: { latitude: 48.88, longitude: 2.35 } },
    { type: 'final_transcript', text: 'Take me to CDG' },
    { type: 'user_reply', text: 'Oui' },
    { type: 'stop' },
    { type: 'paid' },
  ];
  it.each(events)('parses $type', (event) => {
    expect(WebEventSchema.parse(event)).toEqual(event);
  });
  it('allows unavailable GPS', () => {
    expect(WebEventSchema.safeParse({ type: 'hello', profile, gps: null }).success).toBe(true);
  });
  it('accepts an optional demo/live scenario and rejects unknown values', () => {
    for (const scenario of ['demo', 'live']) expect(WebEventSchema.parse({ type: 'hello', profile, gps: null, scenario })).toMatchObject({ scenario });
    expect(WebEventSchema.safeParse({ type: 'hello', profile, gps: null, scenario: 'staging' }).success).toBe(false);
  });
});

describe('domain validation', () => {
  it('parses a trip, option, booking and profile', () => {
    expect(TripSchema.parse({ origin: 'Gare du Nord', destination: 'CDG 2E', deadline: '2026-11-07T14:00:00Z', passengers: 1, guide_dog: true, luggage: 1 }).passengers).toBe(1);
    expect(OptionSchema.parse(option)).toEqual(option);
    expect(BookingSchema.parse(booking)).toEqual(booking);
    expect(ProfileSchema.parse(profile)).toEqual(profile);
  });
  it('rejects empty domain objects', () => {
    for (const schema of [TripSchema, OptionSchema, BookingSchema, ProfileSchema]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });
  it('rejects unknown events, missing payloads and invalid values', () => {
    expect(ServerEventSchema.safeParse({ type: 'unknown' }).success).toBe(false);
    expect(ServerEventSchema.safeParse({ type: 'say', text: '' }).success).toBe(false);
    expect(ServerEventSchema.safeParse({ type: 'payment_handoff', url: 'invalid', amount: -1, merchant: 'Demo' }).success).toBe(false);
    expect(WebEventSchema.safeParse({ type: 'final_transcript' }).success).toBe(false);
    expect(WebEventSchema.safeParse({ type: 'hello', profile, gps: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(BookingSchema.safeParse({ ...booking, guide_dog_status: 'confirmed' }).success).toBe(false);
  });
});

describe('watch payloads', () => {
  it('accepts traveler, H metrics, and HTTPS Agent View payloads', () => {
    expect(WatchPayloadSchema.parse({ type: 'traveler', name: 'Amina Benali' })).toEqual({ type: 'traveler', name: 'Amina Benali' });
    expect(WatchPayloadSchema.parse({ type: 'traveler' })).toEqual({ type: 'traveler' });
    expect(WatchPayloadSchema.parse({ type: 'agent_metrics', steps: 7, cost_usd: 0.021 })).toEqual({ type: 'agent_metrics', steps: 7, cost_usd: 0.021 });
    expect(WatchPayloadSchema.parse({ type: 'agent_metrics', steps: 7, cost_usd: null })).toEqual({ type: 'agent_metrics', steps: 7, cost_usd: null });
    expect(WatchPayloadSchema.safeParse({ type: 'agent_metrics', steps: -1, cost_usd: 0.021 }).success).toBe(false);
    expect(WatchPayloadSchema.safeParse({ type: 'agent_metrics', steps: 7, cost_usd: -0.001 }).success).toBe(false);
    expect(WatchPayloadSchema.parse({ type: 'agent_view', url: 'https://h.example/session/123?view=private' })).toEqual({ type: 'agent_view', url: 'https://h.example/session/123?view=private' });
    expect(WatchPayloadSchema.safeParse({ type: 'agent_view', url: 'http://h.example/session/123' }).success).toBe(false);
  });
});
