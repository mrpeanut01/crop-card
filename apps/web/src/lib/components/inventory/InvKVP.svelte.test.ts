/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import InvKVP from './InvKVP.svelte';

describe('InvKVP — Phase 27A read-only key/value pair', () => {
  it('renders the label and value', () => {
    const { getByText } = render(InvKVP, { label: 'EPA Reg', value: '524-549-100' });
    expect(getByText('EPA Reg')).toBeInTheDocument();
    expect(getByText('524-549-100')).toBeInTheDocument();
  });

  it('shows em-dash when value is null/undefined', () => {
    const { getByText } = render(InvKVP, { label: 'Notes', value: null });
    expect(getByText('—')).toBeInTheDocument();
  });

  it('applies mono class when tone is mono', () => {
    const { container } = render(InvKVP, { label: 'Lot #', value: 'A123', tone: 'mono' });
    expect(container.querySelector('.inv-kvp-value.mono')).toBeInTheDocument();
  });

  it('renders the locked treatment when tone is locked', () => {
    const { container } = render(InvKVP, {
      label: 'EPA Reg',
      value: '524-549-100',
      tone: 'locked'
    });
    expect(container.querySelector('.inv-kvp.locked')).toBeInTheDocument();
    // Lock icon should be present in the label.
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
