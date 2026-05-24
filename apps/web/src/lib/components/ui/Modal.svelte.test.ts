/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Modal from './Modal.svelte';
import { createRawSnippet } from 'svelte';

const bodySnippet = createRawSnippet(() => ({
  render: () => '<p>Body content</p>'
}));

// jsdom doesn't implement HTMLDialogElement; stub showModal/close so the
// component's $effect bridge doesn't throw. Each test gets a fresh stub.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

describe('Modal', () => {
  it('renders title via aria-labelledby on the dialog', () => {
    render(Modal, { open: true, title: 'Confirm spray', onClose: vi.fn(), children: bodySnippet });
    const heading = screen.getByText('Confirm spray');
    expect(heading.id).toBe('modal-title');
    const dialog = document.querySelector('dialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('modal-title');
  });

  it('renders a close button with aria-label and fires onClose when clicked', async () => {
    const onClose = vi.fn();
    render(Modal, { open: true, title: 'x', onClose, children: bodySnippet });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the body content slot', () => {
    render(Modal, { open: true, title: 't', onClose: vi.fn(), children: bodySnippet });
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('cancel event (Esc) calls onClose', async () => {
    const onClose = vi.fn();
    render(Modal, { open: true, title: 't', onClose, children: bodySnippet });
    const dialog = document.querySelector('dialog')!;
    // Esc fires a native 'cancel' event on <dialog>.
    await fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
