/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import HoldVoidPanel from './HoldVoidPanel.svelte';

const HASH = 'a'.repeat(64);
const later = () => Date.now() + 60 * 60 * 1000;

const shortenBody = {
  code: 'HOLD_WOULD_SHORTEN',
  error: 'Holds never get shorter.',
  holds: [
    {
      subject: 'area:f1',
      subjectLabel: 'North pasture',
      kind: 'graze',
      clearBefore: Date.parse('2026-10-09T04:00:00Z'),
      clearAfter: null
    }
  ],
  coverage: [
    { id: 'log:1', label: 'Eggs logged Sep 30' },
    { id: 'log:2', label: 'Eggs logged Oct 1' },
    { id: 'log:3', label: 'Eggs logged Oct 2' }
  ],
  diffHash: HASH,
  todayVersionPasses: false,
  canVoid: true,
  askOwner: false
};

function respond(...answers: Array<[number, unknown]>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const [status, body] of answers) {
    fn.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }
  return fn;
}

describe('HoldVoidPanel', () => {
  it('shows nothing to a helper or once the 48 hours are over', () => {
    const { container, unmount } = render(HoldVoidPanel, {
      url: '/api/x/void',
      canVoidHolds: false,
      voidableUntilMs: later(),
      onVoided: vi.fn()
    });
    expect(container.querySelector('[data-testid="hold-void"]')).toBeNull();
    unmount();
    const r2 = render(HoldVoidPanel, {
      url: '/api/x/void',
      canVoidHolds: true,
      voidableUntilMs: Date.now() - 1,
      onVoided: vi.fn()
    });
    expect(r2.container.querySelector('[data-testid="hold-void"]')).toBeNull();
    r2.unmount();
    const r3 = render(HoldVoidPanel, {
      url: '/api/x/void',
      canVoidHolds: true,
      voidableUntilMs: null,
      onVoided: vi.fn()
    });
    expect(r3.container.querySelector('[data-testid="hold-void"]')).toBeNull();
  });

  it('asks for a reason, shows the holds it would shorten, then voids with the hash', async () => {
    const fetcher = respond([409, shortenBody], [200, { voided: 'r1', kind: 'fungicide' }]);
    const onVoided = vi.fn();
    render(HoldVoidPanel, {
      url: '/api/fungicide/r1/void',
      canVoidHolds: true,
      voidableUntilMs: later(),
      timeZone: 'America/New_York',
      application: true,
      onVoided,
      fetcher: fetcher as unknown as typeof fetch
    });
    expect(screen.getByText(/re-entry and pre-harvest intervals/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
    expect(await screen.findByText('Say why this entry is being voided.')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText('Why is this entry being voided?'), {
      target: { value: 'Wrong paddock' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
    expect(await screen.findByText('Voiding this entry would shorten holds:')).toBeInTheDocument();
    expect(screen.getByText(/North pasture/)).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/fungicide/r1/void', expect.anything());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ reason: 'Wrong paddock' });
    await fireEvent.click(screen.getByRole('button', { name: 'Void it and shorten these holds' }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      reason: 'Wrong paddock',
      confirmShorten: HASH
    });
  });

  it('voids at once when nothing shortens, and says why a refusal happened', async () => {
    const onVoided = vi.fn();
    const ok = respond([200, { voided: 'r1', kind: 'hay' }]);
    const r = render(HoldVoidPanel, {
      url: '/api/hay/cuttings/r1/void',
      canVoidHolds: true,
      voidableUntilMs: later(),
      onVoided,
      fetcher: ok as unknown as typeof fetch
    });
    expect(screen.queryByText(/re-entry/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry…' }));
    await fireEvent.input(screen.getByLabelText('Why is this entry being voided?'), {
      target: { value: 'Typo' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledOnce());
    r.unmount();

    const refused = respond([
      409,
      { code: 'VOID_TOO_LATE', error: 'It is more than 48 hours since this was entered.' }
    ]);
    render(HoldVoidPanel, {
      url: '/api/hay/cuttings/r2/void',
      canVoidHolds: true,
      voidableUntilMs: later(),
      onVoided: vi.fn(),
      fetcher: refused as unknown as typeof fetch
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry…' }));
    await fireEvent.input(screen.getByLabelText('Why is this entry being voided?'), {
      target: { value: 'Typo' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('48 hours');
  });

  it('shows the offline message when the request cannot go out', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(HoldVoidPanel, {
      url: '/api/x/void',
      canVoidHolds: true,
      voidableUntilMs: later(),
      onVoided: vi.fn(),
      fetcher: fetcher as unknown as typeof fetch
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry…' }));
    await fireEvent.input(screen.getByLabelText('Why is this entry being voided?'), {
      target: { value: 'Typo' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach CropCard/);
  });
});
