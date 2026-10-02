import { z } from 'zod';
import { t, type TranslateKey } from '$lib/i18n';

export const EMERGENCY_CONTACTS_KEY = 'farm_emergency_contacts';
export const MAX_EMERGENCY_CONTACTS = 5;

export const EMERGENCY_CONTACT_TYPES = ['vet', 'other'] as const;
export type EmergencyContactType = (typeof EMERGENCY_CONTACT_TYPES)[number];

export interface EmergencyContact {
  name: string;
  role: string;
  phone: string;
  /** 32D (D2-13): a vet is shown on Animal and Flock Cards. Absent means
   *  other; only `vet` is stored. */
  type?: 'vet';
}

export const POISON_CONTROL_CONTACT: EmergencyContact = {
  name: 'Poison Control',
  role: 'Poisoning or chemical exposure',
  phone: '1-800-222-1222'
};

const PHONE_CHARS = /^[0-9+().\-\s#*xX]+$/;

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1, 'Add a name.').max(60, 'Keep the name under 60 characters.'),
  role: z.string().trim().max(60, 'Keep the role under 60 characters.').default(''),
  phone: z
    .string()
    .trim()
    .min(1, 'Add a phone number.')
    .max(30, 'Keep the phone number under 30 characters.')
    .refine((v) => PHONE_CHARS.test(v), 'Use only digits, spaces and + ( ) - . in a phone number.')
    .refine((v) => {
      const n = digits(v).length;
      return n >= 3 && n <= 20;
    }, 'A phone number needs between 3 and 20 digits.'),
  type: z
    .enum(EMERGENCY_CONTACT_TYPES)
    .optional()
    .transform((t) => (t === 'vet' ? ('vet' as const) : undefined))
});

export const emergencyContactsSchema = z
  .array(emergencyContactSchema)
  .max(MAX_EMERGENCY_CONTACTS, `Save up to ${MAX_EMERGENCY_CONTACTS} contacts.`);

export interface ContactRowInput {
  name: string;
  role: string;
  phone: string;
  type?: string;
}

export type ContactsParse =
  { ok: true; contacts: EmergencyContact[] } | { ok: false; error: string };

export function isBlankRow(row: ContactRowInput): boolean {
  return !row.name.trim() && !row.role.trim() && !row.phone.trim();
}

const CONTACT_MESSAGE_KEYS: Readonly<Record<string, TranslateKey>> = {
  'Add a name.': 'farm.contacts.addName',
  'Keep the name under 60 characters.': 'farm.contacts.nameLong',
  'Keep the role under 60 characters.': 'farm.contacts.roleLong',
  'Add a phone number.': 'farm.contacts.addPhone',
  'Keep the phone number under 30 characters.': 'farm.contacts.phoneLong',
  'Use only digits, spaces and + ( ) - . in a phone number.': 'farm.contacts.phoneChars',
  'A phone number needs between 3 and 20 digits.': 'farm.contacts.phoneDigits',
  [`Save up to ${MAX_EMERGENCY_CONTACTS} contacts.`]: 'farm.contacts.max'
};

export function parseContactRows(
  rows: readonly ContactRowInput[],
  locale?: string | null
): ContactsParse {
  const filled = rows.filter((r) => !isBlankRow(r));
  const parsed = emergencyContactsSchema.safeParse(
    filled.map(({ type, ...rest }) => (type === 'vet' ? { ...rest, type } : rest))
  );
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[0] === 'number' ? issue.path[0] : null;
    const english = issue?.message ?? 'Check the contacts.';
    const key = issue?.message ? CONTACT_MESSAGE_KEYS[issue.message] : 'farm.contacts.check';
    const message = locale && key ? t(locale, key, { max: MAX_EMERGENCY_CONTACTS }) : english;
    const prefix =
      index === null
        ? ''
        : locale
          ? t(locale, 'farm.contacts.prefix', { n: index + 1 })
          : `Contact ${index + 1}: `;
    return { ok: false, error: `${prefix}${message}` };
  }
  return { ok: true, contacts: parsed.data };
}

export function decodeEmergencyContacts(raw: string | undefined | null): EmergencyContact[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: EmergencyContact[] = [];
  for (const item of value) {
    if (out.length >= MAX_EMERGENCY_CONTACTS) break;
    const parsed = emergencyContactSchema.safeParse(item);
    if (parsed.success) out.push(withoutEmptyType(parsed.data));
  }
  return out;
}

function withoutEmptyType(c: EmergencyContact): EmergencyContact {
  if (c.type === 'vet') return c;
  const { type: _type, ...rest } = c;
  return rest;
}

const VET_ROLE = /\b(vet|vets|veterinarian|veterinary|animal hospital)\b/i;

/** The farm's vet for Animal and Flock Cards: the first contact marked as
 *  a vet, else the first whose role or name says vet. */
export function firstVetContact(
  contacts: readonly EmergencyContact[] | null | undefined
): EmergencyContact | null {
  if (!contacts?.length) return null;
  return (
    contacts.find((c) => c.type === 'vet') ??
    contacts.find((c) => VET_ROLE.test(c.role) || VET_ROLE.test(c.name)) ??
    null
  );
}

function nationalDigits(phone: string): string {
  return digits(phone).replace(/^1(?=\d{10}$)/, '');
}

export function hasPoisonControl(contacts: readonly { phone: string }[]): boolean {
  const target = nationalDigits(POISON_CONTROL_CONTACT.phone);
  return contacts.some((c) => nationalDigits(c.phone) === target);
}

export function formatEmergencyContact(contact: EmergencyContact): string {
  const name = contact.name.trim();
  const role = contact.role.trim() || (contact.type === 'vet' ? 'Vet' : '');
  const who = role && role.toLowerCase() !== name.toLowerCase() ? `${name} (${role})` : name;
  return `${who}: ${contact.phone.trim()}`;
}

export const ADD_POISON_CONTROL_INTENT = 'add-poison-control';

export function contactRowsFromForm(form: FormData): ContactRowInput[] {
  const names = form.getAll('contactName').map(String);
  const roles = form.getAll('contactRole').map(String);
  const phones = form.getAll('contactPhone').map(String);
  const types = form.getAll('contactType').map(String);
  const count = Math.max(names.length, roles.length, phones.length);
  return Array.from({ length: count }, (_, i) => ({
    name: names[i] ?? '',
    role: roles[i] ?? '',
    phone: phones[i] ?? '',
    ...(types[i] === 'vet' ? { type: 'vet' } : {})
  }));
}

export function withPoisonControl(rows: readonly ContactRowInput[]): ContactRowInput[] {
  const filled = rows.filter((r) => !isBlankRow(r));
  if (hasPoisonControl(filled) || filled.length >= MAX_EMERGENCY_CONTACTS) return [...rows];
  return [...filled, { ...POISON_CONTROL_CONTACT }];
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+*#]/g, '')}`;
}
