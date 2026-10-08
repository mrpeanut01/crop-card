/** Demo farms (try-before-signup). Each visitor gets a throwaway Owner whose
 *  id starts with DEMO_OWNER_PREFIX and a user whose email sits on a
 *  reserved `.invalid` domain, so nothing can ever be delivered to it. Both
 *  are deleted on reset or once DEMO_TTL_MS has passed since creation. */
export const DEMO_EMAIL_DOMAIN = 'demo.cropcard.invalid';
export const DEMO_OWNER_PREFIX = 'owner_demo_';
export const DEMO_TTL_MS = 4 * 60 * 60 * 1000;
/** Query flag a refused plain form is sent back with; the demo banner shows
 *  the refusal when it sees it (#717). */
export const DEMO_BLOCKED_PARAM = 'demoBlocked';

export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

export function isDemoOwnerId(ownerId: string | null | undefined): boolean {
  return (
    !!ownerId && ownerId.startsWith(DEMO_OWNER_PREFIX) && ownerId.length > DEMO_OWNER_PREFIX.length
  );
}

export function demoExpiresAt(createdAtMs: number): number {
  return createdAtMs + DEMO_TTL_MS;
}
