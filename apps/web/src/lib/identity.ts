/**
 * Sign-in identifiers: an email address or a phone number, recognised from
 * one free-text field. Client-safe (the login form uses `parseIdentifier`
 * to relabel its button as the user types).
 *
 * Phones normalize to E.164. A bare 10-digit number (or 11 digits with a
 * leading 1) is read as US/Canada, matching the primary persona; anything
 * else must be typed with a leading `+` and country code.
 */

export type Identifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 32 || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
    return `+${digits}`;
  }
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && /^1[2-9]\d{2}[2-9]/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

export function parseIdentifier(input: unknown): Identifier | null {
  if (typeof input !== 'string') return null;
  if (input.includes('@')) {
    const email = normalizeEmail(input);
    return email ? { kind: 'email', value: email } : null;
  }
  const phone = normalizePhone(input);
  return phone ? { kind: 'phone', value: phone } : null;
}

/** US numbers read as (571) 555-0123; others stay E.164. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Human label for a user who may have only one of the two identities. */
export function identityLabel(u: { email: string | null; phone: string | null }): string {
  if (u.email) return u.email;
  if (u.phone) return formatPhone(u.phone);
  return 'unknown user';
}

/** Short display name: email local-part, else the formatted phone. */
export function identityName(u: { email: string | null; phone: string | null }): string {
  if (u.email) return u.email.split('@')[0];
  return identityLabel(u);
}
