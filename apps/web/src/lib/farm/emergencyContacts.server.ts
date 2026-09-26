import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import {
  EMERGENCY_CONTACTS_KEY,
  decodeEmergencyContacts,
  emergencyContactsSchema,
  type EmergencyContact
} from './emergencyContacts';

export function loadEmergencyContacts(): EmergencyContact[] {
  return decodeEmergencyContacts(getSetting(EMERGENCY_CONTACTS_KEY));
}

export function saveEmergencyContacts(contacts: readonly EmergencyContact[]): void {
  const parsed = emergencyContactsSchema.parse(contacts);
  if (parsed.length === 0) {
    deleteSetting(EMERGENCY_CONTACTS_KEY);
    return;
  }
  setSetting(EMERGENCY_CONTACTS_KEY, JSON.stringify(parsed));
}
