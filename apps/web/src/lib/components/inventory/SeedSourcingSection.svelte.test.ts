/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SeedSourcingSection from './SeedSourcingSection.svelte';
import type { LotSeedSourcing } from '$lib/stock/seedSourcing';

const lot = { id: 'lot1', lotNumber: 'L-7', receivedAt: Date.UTC(2026, 2, 1), supplier: 'Fedco' };
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/seed-sourcing') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ sourcing: JSON.parse(String(init.body)) }));
    }
    if (u.startsWith('/api/documents?')) {
      return new Response(JSON.stringify({ documents: [], vault: { enabled: true } }));
    }
    return new Response('{}', { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sourcing(over: Partial<LotSeedSourcing> = {}): LotSeedSourcing {
  return { status: null, sourcesChecked: [], unavailabilityNote: null, documents: [], ...over };
}

describe('SeedSourcingSection (B-37 to B-39)', () => {
  it('shows "Seed status not recorded" for an unanswered lot', () => {
    render(SeedSourcingSection, { itemId: 'i1', lot, sourcing: sourcing(), canEdit: false });
    expect(screen.getByTestId('seed-status').textContent).toContain('Not recorded');
    expect(screen.getByTestId('seed-search-flag').textContent).toBe('Seed status not recorded');
  });

  it('flags treated seed with no search on file, and reads only for a helper', () => {
    render(SeedSourcingSection, {
      itemId: 'i1',
      lot,
      sourcing: sourcing({ status: 'treated' }),
      canEdit: false
    });
    expect(screen.getByTestId('seed-search-flag').textContent).toBe('No search on file');
    expect(screen.queryByRole('button', { name: 'Edit seed sourcing' })).toBeNull();
    expect(screen.queryByTestId('document-attach')).toBeNull();
  });

  it('lists checks and evidence without a flag', () => {
    render(SeedSourcingSection, {
      itemId: 'i1',
      lot,
      sourcing: sourcing({
        status: 'untreated',
        sourcesChecked: [{ supplier: 'Johnny', checkedAt: '2026-01-15', result: 'Out of stock' }],
        unavailabilityNote: 'None in the size needed.',
        documents: [{ id: 'd1', linkId: 'k1', title: 'Search emails', kind: 'seed-search' }]
      }),
      canEdit: false
    });
    expect(screen.queryByTestId('seed-search-flag')).toBeNull();
    expect(screen.getByTestId('seed-checks').textContent).toContain('Johnny');
    expect(screen.getByText('None in the size needed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search emails' }).getAttribute('href')).toBe(
      '/api/documents/d1/file'
    );
  });

  it('lets the owner save a status and a supplier check', async () => {
    render(SeedSourcingSection, { itemId: 'i1', lot, sourcing: sourcing(), canEdit: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit seed sourcing' }));
    await fireEvent.change(screen.getByLabelText('Seed status'), {
      target: { value: 'untreated' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add a supplier check' }));
    await fireEvent.input(screen.getByLabelText('Supplier'), { target: { value: 'Fedco' } });
    await fireEvent.input(screen.getByLabelText('What you found'), {
      target: { value: 'Out of stock' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save seed sourcing' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Seed sourcing saved.')
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/seed-sourcing'))!;
    expect(String(call[0])).toBe('/api/stock/i1/lots/lot1/seed-sourcing');
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.status).toBe('untreated');
    expect(body.sourcesChecked).toHaveLength(1);
    expect(body.sourcesChecked[0].supplier).toBe('Fedco');
    expect(body.unavailabilityNote).toBeNull();
  });

  it('asks for every part of a half-filled supplier check', async () => {
    render(SeedSourcingSection, { itemId: 'i1', lot, sourcing: sourcing(), canEdit: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit seed sourcing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add a supplier check' }));
    await fireEvent.input(screen.getByLabelText('Supplier'), { target: { value: 'Fedco' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save seed sourcing' }));
    expect(screen.getByRole('alert').textContent).toContain('needs a supplier, a date');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/seed-sourcing'))).toBe(false);
  });
});
