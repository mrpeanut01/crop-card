/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupProtection from './SetupProtection.svelte';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
const RESPONSE = {
  protection: { id: 'p1' },
  protections: [],
  seasonYear: 2027,
  effectiveFrost: {},
  frost: {
    lastSpring: '2027-03-30',
    firstFall: '2027-10-15',
    frostFree: false,
    farmLastSpring: '2027-04-20',
    farmFirstFall: '2027-10-15',
    summary: 'Covered: frost ends Mar 30'
  }
};

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 201 }));
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const props = { blockId: 'b1', blockName: 'Bed 3', seasonYear: 2027 };

describe('SetupProtection', () => {
  it('asks a helper to go to the owner', () => {
    render(SetupProtection, { ...props, canEdit: false, onDone: vi.fn() });
    expect(screen.getByText('Ask the owner to add a cover to Bed 3.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add cover' })).toBeNull();
  });

  it('says the shift is not known instead of guessing, and saves typed days as the owner’s', async () => {
    const onDone = vi.fn();
    render(SetupProtection, { ...props, canEdit: true, onDone });
    expect(
      screen.getByText("Cover shift not known. Enter the days from your cover's instructions.")
    ).toBeInTheDocument();
    await fireEvent.change(screen.getByLabelText('Kind of cover'), {
      target: { value: 'low-tunnel' }
    });
    await fireEvent.input(screen.getByLabelText('Spring: days earlier'), {
      target: { value: '21' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add cover' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/blocks/b1/protections?year=2027');
    expect(JSON.parse(init.body as string)).toMatchObject({
      kind: 'low-tunnel',
      springShiftDays: 21,
      seasonYear: 2027
    });
  });

  it('refuses a shift past 120 days before saving', async () => {
    render(SetupProtection, { ...props, canEdit: true, onDone: vi.fn() });
    await fireEvent.input(screen.getByLabelText('Spring: days earlier'), {
      target: { value: '200' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add cover' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a heated greenhouse asks for no days', async () => {
    render(SetupProtection, { ...props, canEdit: true, onDone: vi.fn() });
    await fireEvent.change(screen.getByLabelText('Kind of cover'), {
      target: { value: 'greenhouse-heated' }
    });
    expect(screen.queryByLabelText('Spring: days earlier')).toBeNull();
    expect(screen.getByText(/no frost limit/)).toBeInTheDocument();
  });
});
