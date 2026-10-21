/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import PhotoMarksPrint from './PhotoMarksPrint.svelte';
import type { PhotoPrintJob } from '$lib/journal/photoPrintJob.svelte';

class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  set src(_: string) {
    queueMicrotask(() => {
      this.naturalWidth = 1200;
      this.naturalHeight = 900;
      this.onload?.();
    });
  }
}

beforeEach(() => vi.stubGlobal('Image', FakeImage));
afterEach(() => vi.unstubAllGlobals());

function job(extra: Partial<PhotoPrintJob> = {}): PhotoPrintJob {
  return {
    src: 'data:image/jpeg;base64,AAAA',
    marks: [
      { kind: 'cut', x: 0.3, y: 0.25, label: 'Mark one' },
      { kind: 'problem', x: 0.6, y: 0.55, w: 0.2, h: 0.2, label: '   ' }
    ],
    steps: ['Placeholder step one.', 'Placeholder problem step.'],
    title: 'Basil Genovese · Bed 1',
    takenAt: Date.UTC(2026, 5, 1, 14),
    provenance: 'ai',
    asOf: Date.UTC(2026, 5, 2, 9),
    savedCopyAt: null,
    problemTips: [],
    layout: 'letter',
    ...extra
  };
}

async function loaded() {
  await Promise.resolve();
  await tick();
  flushSync();
}

describe('PhotoMarksPrint (#869, FU869-2)', () => {
  it('draws the numbers on the photo and lists each mark by number, kind and label', async () => {
    render(PhotoMarksPrint, { job: job() });
    await loaded();
    const sheet = screen.getByTestId('photo-print-sheet');
    expect(sheet.classList.contains('printing')).toBe(true);
    expect(sheet.getAttribute('data-layout')).toBe('letter');
    const figure = screen.getByTestId('photo-print-figure');
    expect(figure.getAttribute('viewBox')).toBe('0 0 1200 900');
    expect(screen.getAllByTestId('photo-print-number').map((n) => n.textContent)).toEqual([
      '1',
      '2'
    ]);
    expect(figure.querySelectorAll('polygon')).toHaveLength(1);
    const lines = [...screen.getByTestId('photo-print-lines').querySelectorAll('li')].map((l) =>
      l.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['1 Cut: Mark one', '2 Problem: Problem']);
    expect(screen.getByTestId('photo-print-steps').querySelectorAll('li')).toHaveLength(2);
    expect(sheet.textContent).toContain('Basil Genovese · Bed 1');
    expect(sheet.textContent).toContain('Photo from');
    expect(sheet.textContent).toContain(
      'Not sure what this is? Your county extension office can help.'
    );
    expect(sheet.querySelector('[data-provenance="ai"]')).not.toBeNull();
    expect(screen.getByTestId('photo-print-asof').textContent).toMatch(/^As of /);
    expect(screen.queryByTestId('photo-print-saved')).toBeNull();
  });

  it('leaves the steps off a 4x6 card and says when it prints from a saved copy', async () => {
    render(PhotoMarksPrint, {
      job: job({ layout: 'index-4x6', savedCopyAt: Date.UTC(2026, 5, 3), problemTips: ['A tip.'] })
    });
    await loaded();
    expect(screen.getByTestId('photo-print-sheet').getAttribute('data-layout')).toBe('index-4x6');
    expect(screen.queryByTestId('photo-print-steps')).toBeNull();
    expect(screen.getByTestId('photo-print-saved').textContent).toMatch(/^Saved copy from .+\.$/);
    expect(screen.getByTestId('photo-print-sheet').textContent).not.toContain('A tip.');
  });

  it('shows the Care Guide tips on a Letter sheet with a problem mark', async () => {
    render(PhotoMarksPrint, {
      job: job({ problemTips: ['Thin, spindly growth: not enough light.'] }),
      preview: true
    });
    await loaded();
    const sheet = screen.getByTestId('photo-print-preview');
    expect(sheet.classList.contains('preview')).toBe(true);
    expect(sheet.classList.contains('printing')).toBe(false);
    expect(sheet.textContent).toContain('Thin, spindly growth: not enough light.');
    expect(sheet.textContent).not.toContain('extension office');
  });
});
