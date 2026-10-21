/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ locale: 'en' as string }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return { locale: state.locale };
    }
  }
}));

import LifecycleLine from './LifecycleLine.svelte';
import { lifecycleHere } from '$lib/garden/lifecycleHere';

const verdict = lifecycleHere(
  { pluginId: 'test-herb-perennial', agronomy: { lifecycle: 'perennial' } },
  { zone: '6b', provenance: 'manual' }
);

describe('LifecycleLine', () => {
  it('shows the label, the line and the provenance', () => {
    state.locale = 'en';
    render(LifecycleLine, { verdict });
    const line = screen.getByTestId('lifecycle-line');
    expect(line).toHaveTextContent('Not known');
    expect(line).toHaveTextContent('Using the zone you entered, 6b.');
    expect(line.getAttribute('data-lifecycle')).toBe('unknown');
    expect(line.querySelector('[data-provenance="fallback"]')).not.toBeNull();
  });

  it('compact keeps the line in the title', () => {
    state.locale = 'en';
    render(LifecycleLine, { verdict, compact: true });
    const line = screen.getByTestId('lifecycle-line');
    expect(line.getAttribute('title')).toContain('Not yet checked against a source.');
    expect(line).not.toHaveTextContent('Using the zone');
  });

  it('follows the page language', () => {
    state.locale = 'es';
    render(LifecycleLine, { verdict });
    expect(screen.getByTestId('lifecycle-line')).toHaveTextContent(
      'Se usa la zona que ingresaste: 6b.'
    );
  });
});
