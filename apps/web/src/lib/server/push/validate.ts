import { z } from 'zod';
import { PUSH_ALERT_KINDS } from '$lib/push/prefs';

const MAX_ENDPOINT_LENGTH = 2048;

function decodedLength(value: string): number {
  return Buffer.from(value, 'base64url').length;
}

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url');

export const endpointSchema = z
  .string()
  .max(MAX_ENDPOINT_LENGTH)
  .url()
  .refine((v) => v.startsWith('https://'), 'push endpoint must be https');

export const prefsPatchSchema = z
  .object(
    Object.fromEntries(PUSH_ALERT_KINDS.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof PUSH_ALERT_KINDS)[number],
      z.ZodOptional<z.ZodBoolean>
    >
  )
  .strict();

export const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema,
    keys: z.object({
      p256dh: b64url.refine((v) => decodedLength(v) === 65, 'p256dh must be a P-256 point'),
      auth: b64url.refine((v) => decodedLength(v) === 16, 'auth must be 16 bytes')
    })
  }),
  prefs: prefsPatchSchema.optional()
});

export const unsubscribeSchema = z.object({ endpoint: endpointSchema });

export const prefsSchema = z.object({ endpoint: endpointSchema, prefs: prefsPatchSchema });

export const testSchema = z.object({ endpoint: endpointSchema.optional() });
