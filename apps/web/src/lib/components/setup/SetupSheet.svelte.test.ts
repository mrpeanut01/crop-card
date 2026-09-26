/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import SetupSheet from './SetupSheet.svelte';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const content = createRawSnippet((done: () => (value: string) => void) => ({
  render: () =>
    '<div><input aria-label="First field" /><button type="button" data-pick>Pick it</button></div>',
  setup: (el) => {
    el.querySelector('[data-pick]')!.addEventListener('click', () => done()('picked'));
  }
}));

describe('SetupSheet', () => {
  it('labels the dialog with its title and shows the kicker', () => {
    render(SetupSheet, {
      open: true,
      title: 'Which sprayer?',
      kicker: 'Spray',
      onClose: vi.fn(),
      children: content
    });
    const dialog = document.querySelector('dialog')!;
    const heading = screen.getByRole('heading', { name: 'Which sprayer?' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByText('Spray')).toBeInTheDocument();
  });

  it('hands the value from its content back through onDone', async () => {
    const onDone = vi.fn();
    render(SetupSheet, { open: true, title: 't', onClose: vi.fn(), onDone, children: content });
    await fireEvent.click(screen.getByRole('button', { name: 'Pick it' }));
    expect(onDone).toHaveBeenCalledWith('picked');
  });

  it('closes on the close button and on Esc', async () => {
    const onClose = vi.fn();
    render(SetupSheet, { open: true, title: 't', onClose, children: content });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await fireEvent(document.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps Tab focus inside the sheet', async () => {
    render(SetupSheet, { open: true, title: 't', onClose: vi.fn(), children: content });
    await tick();
    const dialog = document.querySelector('dialog')!;
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Pick it' });
    last.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('moves focus into the content when it opens', async () => {
    render(SetupSheet, { open: true, title: 't', onClose: vi.fn(), children: content });
    await tick();
    await tick();
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
  });

  it('renders no content while closed', () => {
    render(SetupSheet, { open: false, title: 't', onClose: vi.fn(), children: content });
    expect(screen.queryByRole('button', { name: 'Pick it' })).toBeNull();
  });
});
