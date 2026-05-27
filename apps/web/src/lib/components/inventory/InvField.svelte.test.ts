/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import InvField from './InvField.svelte';

const inputSnippet = createRawSnippet(() => ({
  render: () => '<input id="test-input" type="text" />'
}));

describe('InvField — Phase 27A labeled form field with chip taxonomy', () => {
  it('renders the label and the input slot', () => {
    const { getByText, container } = render(InvField, {
      id: 'test-input',
      label: 'Manufacturer',
      children: inputSnippet
    });
    expect(getByText('Manufacturer')).toBeInTheDocument();
    expect(container.querySelector('input#test-input')).toBeInTheDocument();
  });

  it('renders REQUIRED chip', () => {
    const { getByText } = render(InvField, {
      id: 'x',
      label: 'Lot #',
      chip: 'required',
      children: inputSnippet
    });
    expect(getByText('REQUIRED')).toBeInTheDocument();
  });

  it('renders FROM PLUGIN chip', () => {
    const { getByText } = render(InvField, {
      id: 'x',
      label: 'Active ingredients',
      chip: 'from-plugin',
      children: inputSnippet
    });
    expect(getByText('FROM PLUGIN')).toBeInTheDocument();
  });

  it('renders KERNEL-LOCKED chip with the lock icon', () => {
    const { getByText, container } = render(InvField, {
      id: 'x',
      label: 'EPA Reg',
      chip: 'kernel-locked',
      children: inputSnippet
    });
    expect(getByText(/KERNEL-LOCKED/)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows hint text when no error', () => {
    const { getByText } = render(InvField, {
      id: 'x',
      label: 'Acres',
      hint: 'Optional — used for rate calculation',
      children: inputSnippet
    });
    expect(getByText(/Optional/)).toBeInTheDocument();
  });

  it('error replaces hint and gets role alert + has-error class', () => {
    const { getByRole, queryByText, container } = render(InvField, {
      id: 'x',
      label: 'Acres',
      hint: 'Optional hint',
      error: 'Acres must be positive',
      children: inputSnippet
    });
    expect(getByRole('alert')).toHaveTextContent('Acres must be positive');
    expect(queryByText(/Optional hint/)).toBeNull();
    expect(container.querySelector('.inv-field.has-error')).toBeInTheDocument();
  });
});
