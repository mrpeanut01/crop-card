/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Input from './Input.svelte';

describe('Input', () => {
  it('associates label with the input via htmlFor+id', () => {
    render(Input, { label: 'Field name' });
    // getByLabelText only succeeds if the <label>'s htmlFor matches the input's id.
    expect(screen.getByLabelText('Field name')).toBeInTheDocument();
  });

  it('renders a hint with aria-describedby pointing at it', () => {
    render(Input, { label: 'Acres', hint: 'In whole numbers' });
    const input = screen.getByLabelText('Acres');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hintEl = document.getElementById(describedBy!);
    expect(hintEl).toHaveTextContent('In whole numbers');
  });

  it('error sets aria-invalid and renders role=alert', () => {
    render(Input, { label: 'EPA #', error: 'Required for kernel evaluation.' });
    const input = screen.getByLabelText('EPA #');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required for kernel evaluation.');
  });

  it('error replaces hint in aria-describedby', () => {
    render(Input, { label: 'X', hint: 'a hint', error: 'an error' });
    const input = screen.getByLabelText('X');
    // Error takes precedence — hint isn't rendered when error present, so
    // aria-describedby should only contain the error id.
    expect(screen.queryByText('a hint')).not.toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toMatch(/-err$/);
  });

  it('respects the type prop', () => {
    render(Input, { label: 'Count', type: 'number' });
    expect(screen.getByLabelText('Count')).toHaveAttribute('type', 'number');
  });
});
