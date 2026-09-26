import { z } from 'zod';

export const EMERGENCY_CONTACTS_KEY = 'farm_emergency_contacts';
export const MAX_EMERGENCY_CONTACTS = 5;

export interface EmergencyContact {
  name: string;
  role: string;
  phone: string;
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
    }, 'A phone number needs between 3 and 20 digits.')
});

export const emergencyContactsSchema = z
  .array(emergencyContactSchema)
  .max(MAX_EMERGENCY_CONTACTS, `Save up to ${MAX_EMERGENCY_CONTACTS} contacts.`);

export interface ContactRowInput {
  name: string;
  role: string;
  phone: string;
}

export type ContactsParse =
  { ok: true; contacts: EmergencyContact[] } | { ok: false; error: string };

export function isBlankRow(row: ContactRowInput): boolean {
  return !row.name.trim() && !row.role.trim() && !row.phone.trim();
}

export function parseContactRows(rows: readonly ContactRowInput[]): ContactsParse {
  const filled = rows.filter((r) => !isBlankRow(r));
  const parsed = emergencyContactsSchema.safeParse(filled);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[0] === 'number' ? issue.path[0] : null;
    const prefix = index === null ? '' : `Contact ${index + 1}: `;
    return { ok: false, error: `${prefix}${issue?.message ?? 'Check the contacts.'}` };
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
    if (parsed.success) out.push(parsed.data);
  }
  return out;
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
  const role = contact.role.trim();
  const who = role && role.toLowerCase() !== name.toLowerCase() ? `${name} (${role})` : name;
  return `${who}: ${contact.phone.trim()}`;
}

export const ADD_POISON_CONTROL_INTENT = 'add-poison-control';

export function contactRowsFromForm(form: FormData): ContactRowInput[] {
  const names = form.getAll('contactName').map(String);
  const roles = form.getAll('contactRole').map(String);
  const phones = form.getAll('contactPhone').map(String);
  const count = Math.max(names.length, roles.length, phones.length);
  return Array.from({ length: count }, (_, i) => ({
    name: names[i] ?? '',
    role: roles[i] ?? '',
    phone: phones[i] ?? ''
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
