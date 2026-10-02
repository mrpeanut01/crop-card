/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import OrganicInputNotice from './OrganicInputNotice.svelte';

describe('OrganicInputNotice', () => {
  it('renders nothing without an organic block', () => {
    const { queryByTestId } = render(OrganicInputNotice, {
      organicBlocks: null,
      selectedBlockIds: ['b1'],
      products: [{ name: 'Urea', inputClass: 'not-allowed' }]
    });
    expect(queryByTestId('organic-input-notice')).toBeNull();
  });

  it('renders the product, the block and a note that the save goes ahead', () => {
    const { getByTestId } = render(OrganicInputNotice, {
      organicBlocks: { b1: 'Transitioning (owner-entered, effective Apr 1, 2025)' },
      selectedBlockIds: ['b1'],
      products: [{ name: 'Urea', inputClass: 'not-allowed' }],
      blockNames: { b1: 'North bed' }
    });
    const el = getByTestId('organic-input-notice');
    expect(el.getAttribute('role')).toBe('note');
    expect(el.textContent).toContain('Urea');
    expect(el.textContent).toContain('The library marks this product as not allowed');
    expect(el.textContent).toContain('North bed');
    expect(el.textContent).toContain('Transitioning (owner-entered');
    expect(el.textContent).toContain('You can still save.');
    expect(el.querySelector('button')).toBeNull();
  });
});
