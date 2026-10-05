/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { ShadeSource } from '$lib/db/shadeSources';

const state = vi.hoisted(() => ({ locale: 'es' as string | undefined }));

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}), goto: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return { locale: state.locale };
    },
    url: new URL('http://localhost/plan/farm')
  }
}));

const { default: FarmMapEditor } = await import('./FarmMapEditor.svelte');

const treeRow: ShadeSource = {
  id: 'sh1',
  name: 'North windbreak',
  kind: 'tree-row',
  heightFt: 30,
  opacity: 0.7,
  isDeciduous: false,
  leafOnDayOfYear: 105,
  leafOffDayOfYear: 305
} as ShadeSource;

describe('FarmMapEditor shade list', () => {
  it('names the shade kind in the reader language, never as its code', () => {
    const { container } = render(FarmMapEditor, {
      props: {
        blocks: [],
        fields: [
          { id: 'f1', name: 'Home field', kind: 'field', blockAcresTotal: 0, blocks: [] }
        ] as never,
        shadeSources: [treeRow],
        canEdit: false,
        initialMode: 'sketch',
        exportHref: null
      }
    });
    const row = container.querySelector('.shade-row .block-stats');
    expect(row?.textContent).toContain('Hilera de árboles');
    expect(row?.textContent).not.toContain('tree-row');
  });
});
