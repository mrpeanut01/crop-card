/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { designerDataFromSnapshot } from '$lib/garden/offlineDesign';
import type { DesignerPageData } from '$lib/garden/api';

const snap = vi.hoisted(() => ({ row: null as unknown }));
const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}), goto: vi.fn() }));

vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/plan/areas/f_garden/design'), data: {} }
}));
vi.mock('$lib/client/cardStore', () => ({ loadSnapshot: async () => snap.row }));
vi.mock('$lib/client/cardSync', () => ({ syncCardSnapshot: async () => null }));

const { default: DesignerPage } = await import('./DesignerPage.svelte');

function onlineData(): DesignerPageData {
  const offline = designerDataFromSnapshot(sampleSnapshot(), 'f_garden', {
    seasonYear: 2026,
    role: 'owner'
  })!;
  return {
    ...offline,
    offline: false,
    canEdit: true,
    design: {
      ...offline.design,
      readOnly: false,
      readOnlyReason: null,
      asOf: Date.parse('2026-05-01T00:00:00Z')
    }
  };
}

describe('DesignerPage going offline and back', () => {
  it('lets the owner edit again once the signal returns after the offline copy was shown', async () => {
    snap.row = { bundle: sampleSnapshot({ generatedAt: Date.parse('2026-06-02T00:00:00Z') }) };
    const data = onlineData();
    const { queryByTestId } = render(DesignerPage, { props: { data } });
    await waitFor(() => expect(queryByTestId('preset-bar')).toBeInTheDocument());

    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(queryByTestId('offline-banner')).toBeInTheDocument());
    await waitFor(() => expect(queryByTestId('preset-bar')).not.toBeInTheDocument());

    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(queryByTestId('preset-bar')).toBeInTheDocument());
    expect(queryByTestId('offline-banner')).not.toBeInTheDocument();
    expect(nav.invalidateAll).toHaveBeenCalled();
  });
});
