import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_EMERGENCY_CONTACTS,
  contactRowsFromForm,
  withPoisonControl,
  POISON_CONTROL_CONTACT,
  decodeEmergencyContacts,
  formatEmergencyContact,
  hasPoisonControl,
  parseContactRows,
  telHref
} from './emergencyContacts';

const blank = { name: '', role: '', phone: '' };

describe('parseContactRows', () => {
  it('drops blank rows and trims what is kept', () => {
    const r = parseContactRows([
      blank,
      { name: '  Dr. Reyes ', role: ' Vet ', phone: ' 540-555-0101 ' },
      { name: ' ', role: ' ', phone: '  ' }
    ]);
    expect(r).toEqual({
      ok: true,
      contacts: [{ name: 'Dr. Reyes', role: 'Vet', phone: '540-555-0101' }]
    });
  });

  it('accepts no contacts at all', () => {
    expect(parseContactRows([])).toEqual({ ok: true, contacts: [] });
    expect(parseContactRows([blank, blank])).toEqual({ ok: true, contacts: [] });
  });

  it('names the contact that needs fixing', () => {
    const r = parseContactRows([POISON_CONTROL_CONTACT, { name: 'Neighbor', role: '', phone: '' }]);
    expect(r).toEqual({ ok: false, error: 'Contact 2: Add a phone number.' });
    expect(parseContactRows([{ name: '', role: 'Vet', phone: '911' }])).toEqual({
      ok: false,
      error: 'Contact 1: Add a name.'
    });
  });

  it('rejects letters and too few digits in a phone number', () => {
    expect(parseContactRows([{ name: 'A', role: '', phone: 'call me' }]).ok).toBe(false);
    expect(parseContactRows([{ name: 'A', role: '', phone: '12' }]).ok).toBe(false);
    expect(parseContactRows([{ name: 'A', role: '', phone: '911' }]).ok).toBe(true);
    expect(parseContactRows([{ name: 'A', role: '', phone: '+1 (540) 555-0101 x12' }]).ok).toBe(
      true
    );
  });

  it(`caps the list at ${MAX_EMERGENCY_CONTACTS}`, () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      name: `C${i}`,
      role: '',
      phone: `540-555-010${i}`
    }));
    expect(parseContactRows(six)).toEqual({ ok: false, error: 'Save up to 5 contacts.' });
    expect(parseContactRows(six.slice(0, 5)).ok).toBe(true);
  });

  it('never keeps more than the cap or a blank name or phone (property)', () => {
    const row = fc.record({
      name: fc.string({ maxLength: 70 }),
      role: fc.string({ maxLength: 70 }),
      phone: fc.string({ maxLength: 35 })
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 8 }), (rows) => {
        const r = parseContactRows(rows);
        if (!r.ok) return true;
        expect(r.contacts.length).toBeLessThanOrEqual(MAX_EMERGENCY_CONTACTS);
        for (const c of r.contacts) {
          expect(c.name.length).toBeGreaterThan(0);
          expect(c.phone.replace(/\D/g, '').length).toBeGreaterThanOrEqual(3);
        }
        return true;
      })
    );
  });
});

describe('decodeEmergencyContacts', () => {
  it('reads what was saved and skips junk', () => {
    expect(decodeEmergencyContacts(undefined)).toEqual([]);
    expect(decodeEmergencyContacts('not json')).toEqual([]);
    expect(decodeEmergencyContacts('{"name":"x"}')).toEqual([]);
    expect(
      decodeEmergencyContacts(
        JSON.stringify([POISON_CONTROL_CONTACT, { name: 'Bad', phone: 'nope' }, 7])
      )
    ).toEqual([POISON_CONTROL_CONTACT]);
  });

  it('fills a missing role and caps the list', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, phone: '911' }));
    const out = decodeEmergencyContacts(JSON.stringify(many));
    expect(out).toHaveLength(MAX_EMERGENCY_CONTACTS);
    expect(out[0]).toEqual({ name: 'C0', role: '', phone: '911' });
  });
});

describe('Poison Control suggestion', () => {
  it('uses the national US line', () => {
    expect(POISON_CONTROL_CONTACT.phone).toBe('1-800-222-1222');
  });

  it('spots the number however it was typed', () => {
    expect(hasPoisonControl([])).toBe(false);
    expect(hasPoisonControl([{ phone: '(800) 222-1222' }])).toBe(true);
    expect(hasPoisonControl([{ phone: '+1 800 222 1222' }])).toBe(true);
    expect(hasPoisonControl([{ phone: '800-222-1223' }])).toBe(false);
  });
});

describe('formatting', () => {
  it('shows the role only when it adds something', () => {
    expect(formatEmergencyContact(POISON_CONTROL_CONTACT)).toBe(
      'Poison Control (Poisoning or chemical exposure): 1-800-222-1222'
    );
    expect(formatEmergencyContact({ name: 'Vet', role: 'vet', phone: '911' })).toBe('Vet: 911');
    expect(formatEmergencyContact({ name: 'Sam', role: '', phone: '540-555-0101' })).toBe(
      'Sam: 540-555-0101'
    );
  });

  it('builds a dialable tel link', () => {
    expect(telHref('1-800-222-1222')).toBe('tel:18002221222');
    expect(telHref('+1 (540) 555-0101')).toBe('tel:+15405550101');
  });
});

describe('form helpers', () => {
  it('zips the repeated inputs into rows', () => {
    const fd = new FormData();
    fd.append('contactName', 'A');
    fd.append('contactRole', 'Vet');
    fd.append('contactPhone', '911');
    fd.append('contactName', 'B');
    expect(contactRowsFromForm(fd)).toEqual([
      { name: 'A', role: 'Vet', phone: '911' },
      { name: 'B', role: '', phone: '' }
    ]);
  });

  it('appends Poison Control once and only while there is room', () => {
    const vet = { name: 'Vet', role: '', phone: '540-555-0101' };
    expect(withPoisonControl([vet, blank])).toEqual([vet, POISON_CONTROL_CONTACT]);
    expect(withPoisonControl([POISON_CONTROL_CONTACT])).toEqual([POISON_CONTROL_CONTACT]);
    const five = Array.from({ length: 5 }, () => vet);
    expect(withPoisonControl(five)).toEqual(five);
  });
});
