/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import EmergencyContactsEditor from './EmergencyContactsEditor.svelte';
import { POISON_CONTROL_CONTACT } from '$lib/farm/emergencyContacts';

const vet = { name: 'Dr. Reyes', role: 'Vet', phone: '540-555-0101' };
const poisonLabel = 'Add Poison Control (1-800-222-1222)';

describe('EmergencyContactsEditor', () => {
  it('offers Poison Control as a one-tap submit when it is missing', () => {
    render(EmergencyContactsEditor, { initial: [] });
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
    const suggest = screen.getByRole('button', { name: poisonLabel });
    expect(suggest).toHaveAttribute('type', 'submit');
    expect(suggest).toHaveAttribute('name', 'intent');
    expect(suggest).toHaveAttribute('value', 'add-poison-control');
  });

  it('hides the suggestion once the number is saved', () => {
    render(EmergencyContactsEditor, { initial: [POISON_CONTROL_CONTACT] });
    expect(screen.queryByRole('button', { name: poisonLabel })).toBeNull();
    expect(screen.getByLabelText('Contact 1 phone')).toHaveValue('1-800-222-1222');
  });

  it('adds and removes rows up to five', async () => {
    const { container } = render(EmergencyContactsEditor, { initial: [vet] });
    const add = screen.getByRole('button', { name: 'Add a contact' });
    for (let i = 0; i < 4; i++) await fireEvent.click(add);
    expect(container.querySelectorAll('input[name="contactName"]')).toHaveLength(5);
    expect(add).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove contact 1' }));
    expect(container.querySelectorAll('input[name="contactName"]')).toHaveLength(4);
    expect(add).not.toBeDisabled();
    expect(container.querySelector('input[name="contactsPresent"]')).toHaveValue('1');
  });

  it('shows a save error', () => {
    render(EmergencyContactsEditor, { initial: [vet], error: 'Contact 1: Add a phone number.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Contact 1: Add a phone number.');
  });
});
