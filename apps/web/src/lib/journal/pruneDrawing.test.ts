import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '$lib/i18n';
import {
  NO_DRAWING_STEPS,
  PRUNE_DRAWINGS,
  drawingCaption,
  drawingTopic,
  isPruneDrawing,
  pruneDrawingFor,
  pruneDrawingSrc
} from './pruneDrawing';

const STATIC = path.resolve(__dirname, '../../../static');

describe('pruneDrawingFor', () => {
  it('picks a drawing from a sourced growth habit first, then the archetype', () => {
    expect(pruneDrawingFor({ archetype: 'cut-and-come-again-leafy' })).toBe(
      'cut-and-come-again-leafy'
    );
    expect(pruneDrawingFor({ archetype: 'perennial-vine-quality' })).toBe('vining');
    expect(pruneDrawingFor({ archetype: 'tree-fruit-multi-pick' })).toBe('tree');
    expect(pruneDrawingFor({ archetype: 'cut-and-come-again-leafy', growthHabit: 'woody' })).toBe(
      'woody-perennial-herb'
    );
    expect(pruneDrawingFor({ growthHabit: 'clumping' })).toBe('clumping-herb');
    expect(pruneDrawingFor({ archetype: 'winter-squash-cure' })).toBeNull();
    expect(pruneDrawingFor(null)).toBeNull();
  });

  it('only draws for pruning and harvest questions', () => {
    expect(drawingTopic('prune')).toBe(true);
    expect(drawingTopic('harvest')).toBe(true);
    expect(drawingTopic('problems')).toBe(false);
    expect(drawingTopic('general')).toBe(false);
    expect(isPruneDrawing('tree')).toBe(true);
    expect(isPruneDrawing('../x')).toBe(false);
  });

  it('ships every drawing as a wordless SVG with an alt text in both languages', () => {
    for (const id of PRUNE_DRAWINGS) {
      const file = path.join(STATIC, pruneDrawingSrc(id));
      expect(existsSync(file), id).toBe(true);
      const svg = readFileSync(file, 'utf8');
      expect(svg.startsWith('<svg'), id).toBe(true);
      expect(svg, id).not.toMatch(/<text|<script|<foreignObject|href=/i);
      const key = `herbsf.drawing.alt.${id}` as const;
      expect(t('en', key)).not.toBe(key);
      expect(t('es', key)).not.toBe(t('en', key));
    }
  });
});

describe('drawingCaption', () => {
  it('uses only the answer’s own Care Guide prune or harvest text', () => {
    expect(
      drawingCaption([
        { title: 'Water', items: ['Water deeply.'], provenance: 'fallback' },
        { title: 'Stake and prune', items: ['Pinch the tips.'], provenance: 'plugin' }
      ])
    ).toEqual({ items: ['Pinch the tips.'], provenance: 'plugin' });
    expect(
      drawingCaption([{ title: 'Harvest cues', items: ['8 in tall'], provenance: 'plugin' }])
    ).toEqual({ items: ['8 in tall'], provenance: 'plugin' });
  });

  it('says none is sourced yet, byte for byte in English without a locale', () => {
    const none = drawingCaption([{ title: 'Care guide', items: ['x'], provenance: 'fallback' }]);
    expect(none).toEqual({ items: [NO_DRAWING_STEPS], provenance: 'fallback' });
    expect(t('en', 'herbsf.drawing.noSteps')).toBe(NO_DRAWING_STEPS);
    expect(drawingCaption([], 'es').items[0]).toBe(t('es', 'herbsf.drawing.noSteps'));
  });
});
