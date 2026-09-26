/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import QueuedBadge from './QueuedBadge.svelte';

describe('QueuedBadge', () => {
  it('says the item will save when online by default', () => {
    const { getByText, container } = render(QueuedBadge);
    expect(getByText('Will save when online')).toBeInTheDocument();
    expect(container.querySelector('[data-queued]')).not.toBeNull();
  });

  it('takes a custom label', () => {
    const { getByText } = render(QueuedBadge, { label: 'Queued on this phone' });
    expect(getByText('Queued on this phone')).toBeInTheDocument();
  });
});
