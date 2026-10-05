/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BlockSwimlane from './BlockSwimlane.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

const savedTz = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'Europe/Madrid';
});

afterEach(() => {
  process.env.TZ = savedTz;
});

describe('BlockSwimlane drop dates', () => {
  it('drops on the UTC calendar day of the row, east of UTC too', async () => {
    const onDrop = vi.fn();
    render(BlockSwimlane, {
      props: {
        blocks: [
          {
            id: 'b1',
            name: 'North',
            eastWestIndex: null,
            northSouthIndex: null,
            sunExposure: null
          }
        ],
        plantings: [],
        shadeMarkers: [],
        overlaps: [],
        rotations: [],
        year: 2026,
        dragPayload: { kind: 'palette', pluginId: 'tomato', cropFamily: 'solanaceae' },
        kbCarry: null,
        onDrop,
        onKbCommit: vi.fn(),
        onKbCancel: vi.fn()
      }
    });
    const column = screen.getByRole('region', { name: /North/ });
    column.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'clientY', { value: 1 });
    await fireEvent(column, drop);
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0][1]).toBe(Date.UTC(2026, 0, 1));
  });
});
