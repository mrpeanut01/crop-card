/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import FeedbackSheet from './FeedbackSheet.svelte';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function ok() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'fb_1' }), { status: 201 }));
}

describe('FeedbackSheet', () => {
  it('sends the kind, the text and the path only, then thanks the person', async () => {
    const fetcher = ok();
    render(FeedbackSheet, {
      open: true,
      pathname: '/plan',
      onClose: vi.fn(),
      fetcher: fetcher as never
    });
    expect(screen.getByText('/plan')).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText('Idea or request'));
    const send = screen.getByRole('button', { name: 'Send feedback' });
    expect(send).toBeDisabled();
    await fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Let me print the map' }
    });
    await fireEvent.click(send);
    await vi.waitFor(() => expect(screen.getByTestId('feedback-sent')).toBeInTheDocument());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/feedback');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'idea',
      message: 'Let me print the map',
      pagePath: '/plan'
    });
  });

  it('keeps the text and explains when offline', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(FeedbackSheet, {
      open: true,
      pathname: '/today',
      onClose: vi.fn(),
      fetcher: fetcher as never
    });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Broken thing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/offline/));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Broken thing');
  });

  it('shows the server message on a rate limit', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'You have sent a lot of feedback.' }), { status: 429 })
    );
    render(FeedbackSheet, {
      open: true,
      pathname: '/today',
      onClose: vi.fn(),
      fetcher: fetcher as never
    });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Another one' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You have sent a lot of feedback.')
    );
  });

  it('offers three kinds of feedback', () => {
    render(FeedbackSheet, { open: true, pathname: '/today', onClose: vi.fn() });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
