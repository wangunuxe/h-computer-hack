import { z } from 'zod';

const fields = {
  pickup_date: z.iso.date().optional().describe('Observed pickup date in Europe/Paris, YYYY-MM-DD; never the flight date.'),
  pickup_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().describe('Observed pickup time in Europe/Paris, HH:MM; never the flight time.'),
  total_price: z.number().nonnegative().optional().describe('Observed total price of this transfer, not the flight fare.'),
  currency: z.literal('EUR').optional().describe('Observed transfer currency; this shuttle charges EUR.'),
};
export const ConfirmationToolSchema = z.object({ summary: z.string().min(1), ...fields });
export type ConfirmationFields = z.infer<z.ZodObject<typeof fields>>;

export function sanitizeConfirmationFields(value: unknown): ConfirmationFields {
  const raw = z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
  return {
    pickup_date: fields.pickup_date.safeParse(raw.pickup_date).data,
    pickup_time: fields.pickup_time.safeParse(raw.pickup_time).data,
    total_price: fields.total_price.safeParse(raw.total_price).data,
    currency: fields.currency.safeParse(raw.currency).data,
  };
}
