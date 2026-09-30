import { z } from 'zod';
import { isYmd } from '$lib/climate/degreeDays';

const year = z.number().int().min(2000).max(2100);

/** Body of `PUT /api/pest-models/[id]/biofix`: the grower's first trap catch
 *  for a year, or null to clear it and go back to the model's date. */
export const biofixPutSchema = z
  .object({
    year,
    date: z.string().refine(isYmd, 'use YYYY-MM-DD').nullable()
  })
  .refine((b) => b.date === null || b.date.startsWith(`${b.year}-`), {
    message: 'the catch date must fall in the year given',
    path: ['date']
  });

/** Query of `GET /api/weather/degree-days`. */
export const degreeDaysQuerySchema = z.object({
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional()
});
