/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SearchPanel from './SearchPanel.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(name: string) {
  return new Response(
    JSON.stringify({
      source: 'local',
      candidates: [
        { source: 'local', score: 0.9, candidate: { pluginId: name, displayName: name } }
      ]
    }),
    { status: 200 }
  );
}

describe('SearchPanel typeahead', () => {
  it('drops a slow answer for an older query', async () => {
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const q = JSON.parse(String(init.body)).query as string;
        await new Promise<void>((r) => releases.push(r));
        return answer(q === 'tom' ? 'Old answer' : 'New answer');
      })
    );
    render(SearchPanel, { props: { onSubmit: vi.fn() } });
    const box = screen.getByPlaceholderText(/Engenia/);
    await fireEvent.input(box, { target: { value: 'tom' } });
    await waitFor(() => expect(releases).toHaveLength(1));
    await fireEvent.input(box, { target: { value: 'tomato' } });
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await screen.findByText('New answer');
    releases[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Old answer')).toBeNull();
    expect(screen.getByText('New answer')).toBeTruthy();
  });

  it('keeps the list empty when the box is cleared while a search is out', async () => {
    let release!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise<void>((r) => (release = r));
        return answer('Late answer');
      })
    );
    render(SearchPanel, { props: { onSubmit: vi.fn() } });
    const box = screen.getByPlaceholderText(/Engenia/);
    await fireEvent.input(box, { target: { value: 'tom' } });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    await fireEvent.input(box, { target: { value: '' } });
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Late answer')).toBeNull();
  });
});
