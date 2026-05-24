/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Button from './Button.svelte';
import { createRawSnippet } from 'svelte';

const labelSnippet = createRawSnippet(() => ({ render: () => '<span>Save</span>' }));

describe('Button', () => {
  it('renders children content', () => {
    render(Button, { children: labelSnippet });
    expect(screen.getByRole('button')).toHaveTextContent('Save');
  });

  it('defaults to type=button (does not submit forms by accident)', () => {
    render(Button, { children: labelSnippet });
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('applies the variant class', () => {
    const { rerender } = render(Button, { children: labelSnippet, variant: 'primary' });
    expect(screen.getByRole('button').className).toMatch(/primary/);
    rerender({ children: labelSnippet, variant: 'ghost' });
    expect(screen.getByRole('button').className).toMatch(/ghost/);
    rerender({ children: labelSnippet, variant: 'danger' });
    expect(screen.getByRole('button').className).toMatch(/danger/);
  });

  it('loading sets aria-busy and the disabled attribute', () => {
    render(Button, { children: labelSnippet, loading: true });
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    // Note: jsdom's fireEvent.click DOES fire on disabled buttons (real
    // browsers don't). We assert the disabled attribute is set; runtime
    // browser behavior handles the actual click suppression.
  });

  it('disabled sets the disabled attribute', () => {
    render(Button, { children: labelSnippet, disabled: true });
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onclick when not disabled/loading', async () => {
    const onclick = vi.fn();
    render(Button, { children: labelSnippet, onclick });
    await fireEvent.click(screen.getByRole('button'));
    expect(onclick).toHaveBeenCalledOnce();
  });
});
