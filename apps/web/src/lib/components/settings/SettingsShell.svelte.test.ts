/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SettingsShell from './SettingsShell.svelte';

const body = createRawSnippet(() => ({ render: () => '<p>section body</p>' }));

describe('SettingsShell footer (#202 flow 15)', () => {
  it('renders a live Save inside the form when saveAction is set', () => {
    const { container } = render(SettingsShell, {
      title: 'Account',
      kicker: 'Owner profile',
      saveAction: '?/save',
      children: body
    });
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).not.toBeDisabled();
    expect(save.closest('form')?.getAttribute('action')).toBe('?/save');
    expect(container.querySelector('form')).toContainElement(screen.getByText('section body'));
  });

  it('renders no dead Save button on read-only pages', () => {
    render(SettingsShell, { title: 'Records', kicker: 'Compliance', children: body });
    expect(screen.getByText('section body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull();
  });

  it('honours hideFooter even when a saveAction is set', () => {
    render(SettingsShell, {
      title: 'Advanced',
      kicker: 'Danger zone',
      saveAction: '?/save',
      hideFooter: true,
      children: body
    });
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
