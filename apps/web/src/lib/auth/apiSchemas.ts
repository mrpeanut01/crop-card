import { z } from 'zod';

/** Phase 38 passkey request bodies. Client-safe, so the OpenAPI generator
 *  and the browser share them. The WebAuthn objects are checked loosely
 *  here and fully by @simplewebauthn/server. */
const b64url = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/);

const extensionResults = z.record(z.string(), z.unknown()).default({});

export const passkeyRegistrationSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: extensionResults,
  response: z.looseObject({
    clientDataJSON: b64url,
    attestationObject: z.string().min(1).max(16384),
    transports: z.array(z.string().max(32)).max(8).optional()
  })
});

export const passkeyAuthenticationSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: extensionResults,
  response: z.looseObject({
    clientDataJSON: b64url,
    authenticatorData: b64url,
    signature: b64url,
    userHandle: b64url.optional()
  })
});

export const PASSKEY_NAME_MAX = 60;

export const passkeyRenameSchema = z.object({
  name: z.string().trim().max(PASSKEY_NAME_MAX).nullable()
});
