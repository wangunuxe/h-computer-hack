import { z } from 'zod';

const text = z.string().min(1);
const amount = z.number().nonnegative();
export const GuideDogStatusSchema = z.enum(['accepted', 'unknown', 'refused']);
export const TripSchema = z.object({
  origin: text,
  destination: text,
  deadline: z.iso.datetime({ offset: true }),
  passengers: z.number().int().positive(),
  guide_dog: z.boolean(),
  luggage: z.number().int().nonnegative(),
});
export type Trip = z.infer<typeof TripSchema>;

export const ProfileSchema = z.object({
  name: text,
  phone: text,
  email: z.email(),
  guide_dog: z.boolean(),
  language: text,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const OptionSchema = z.object({
  id: text,
  name: text,
  pickup_wait_minutes: z.number().nonnegative(),
  journey_minutes: z.number().nonnegative(),
  price: amount,
  guide_dog_status: GuideDogStatusSchema,
  source: z.url().optional(),
});
export type Option = z.infer<typeof OptionSchema>;

export const BookingSchema = z.object({
  ref: text,
  pickup_time: z.iso.datetime({ offset: true }),
  pickup_point: text,
  price: amount,
  operator_phone: text,
  payment_url: z.url(),
  guide_dog_status: GuideDogStatusSchema,
});
export type Booking = z.infer<typeof BookingSchema>;

export const StageSchema = z.enum([
  'LISTEN', 'UNDERSTAND', 'CLARIFY', 'RESEARCH', 'PRESENT', 'CHOOSE',
  'EXECUTE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT', 'DONE',
]);
export const ScenarioSchema = z.enum(['demo', 'live']);
export type Scenario = z.infer<typeof ScenarioSchema>;
export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), stage: StageSchema }),
  z.object({ type: z.literal('say'), text }),
  z.object({ type: z.literal('feed'), kind: text, text, source: z.url().optional(), mode: z.enum(['demo', 'live-prim', 'live-h']).optional(), status: z.enum(['normal', 'disrupted', 'unknown']).optional() }),
  z.object({ type: z.literal('clarify'), question: text }),
  z.object({ type: z.literal('options'), items: z.array(OptionSchema) }),
  z.object({ type: z.literal('confirm'), summary: text }),
  z.object({
    type: z.literal('payment_handoff'), url: z.url(), amount, merchant: text,
    expires_at: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({ type: z.literal('booking_card'), booking: BookingSchema }),
  z.object({ type: z.literal('error'), message: text }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;

export const WebEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'), profile: ProfileSchema,
    scenario: ScenarioSchema.optional(),
    gps: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }).nullable(),
  }),
  z.object({ type: z.literal('final_transcript'), text }),
  z.object({ type: z.literal('user_reply'), text }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('paid') }),
]);
export type WebEvent = z.infer<typeof WebEventSchema>;
