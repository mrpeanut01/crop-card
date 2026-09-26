/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Avatar from './Avatar.svelte';

describe('Avatar', () => {
  it('shows the first letter of a name or email', () => {
    const { container } = render(Avatar, { name: 'shawn@safehaven.farm' });
    expect(container.textContent?.trim()).toBe('S');
  });

  it('shows a person icon, not a bracket, for a phone-only user', () => {
    const { container } = render(Avatar, { name: '(540) 555-0142' });
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
