// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FAMILY_CARE_TIPS } from '$lib/cards/build/careTips';
import { careGuideSections } from '$lib/cards/build/careGuide';
import { NO_SECTION_TEXT, asksForSprayAdvice, isSprayAdvice } from '$lib/journal/photoHelp';
import { eventsForPlanting } from '$lib/calendar/engine';
import type { SnapshotPlanting } from '$lib/cards/snapshot';
import { engineHarvestWindow, toCropPlugin } from './cardSnapshot';
import { getRegistry } from './registry';
import { sprayTermsFor } from './sprayTerms';

describe('sprayTermsFor (the real plugin library)', () => {
  it('catches every brand the evidence named, in answers and in questions', async () => {
    const terms = sprayTermsFor(await getRegistry());
    for (const s of [
      'Entrust will clean up those caterpillars fast.',
      'Actara or Admire Pro would knock the aphids back.',
      'Coragen is the one to use.',
      'Radiant works on thrips.',
      'Serenade is a good biological choice here.',
      'I would go with Warrior.',
      'Assail is good for aphids.'
    ]) {
      expect(isSprayAdvice(s, terms), s).toBe(true);
    }
    expect(asksForSprayAdvice('Would Entrust fix the worms?', terms)).toBe(true);
  });

  it('never flags the general care tips or the plain Care Guide lines', async () => {
    const terms = sprayTermsFor(await getRegistry());
    for (const tips of Object.values(FAMILY_CARE_TIPS)) {
      for (const line of [...tips.water, ...tips.feed, ...tips.prune, ...tips.problems]) {
        expect(isSprayAdvice(line, terms), line).toBe(false);
      }
    }
    for (const line of Object.values(NO_SECTION_TEXT)) {
      expect(isSprayAdvice(line, terms), line).toBe(false);
    }
  });

  it('is cached per registry view', async () => {
    const registry = await getRegistry();
    expect(sprayTermsFor(registry)).toBe(sprayTermsFor(registry));
  });

  it('keeps every real crop Care Guide free of library brand names', async () => {
    const registry = await getRegistry();
    const terms = sprayTermsFor(registry);
    for (const crop of registry.crops()) {
      const plugin = toCropPlugin(crop)!;
      for (const section of careGuideSections(plugin, terms).sections) {
        for (const item of section.items) {
          expect(isSprayAdvice(item, terms), `${crop.pluginId}: ${item}`).toBe(false);
          expect(item, crop.pluginId).not.toMatch(/\bPhase \d+|trait override|family-kill/);
        }
      }
    }
  });
});

describe('engineHarvestWindow', () => {
  it('matches the harvest date /plan shows for a seeded corn planting', async () => {
    const registry = await getRegistry();
    const corn = registry.crops().find((c) => c.pluginId === 'corn-feed-dent-pioneer');
    expect(corn).toBeTruthy();
    const planting: SnapshotPlanting = {
      id: 'pl_corn',
      blockId: 'b1',
      cropPluginId: corn!.pluginId,
      varietyDisplayName: 'Corn',
      status: 'active',
      plantingDate: '2026-08-27',
      harvestedAt: null,
      quantityPlanted: null,
      quantityUnit: null,
      spacingIn: null,
      rowSpacingIn: null,
      plantCount: null,
      plantCountProvenance: null,
      sourceProvenance: null
    };
    const window = engineHarvestWindow(planting, corn!);
    const events = eventsForPlanting(
      {
        id: planting.id,
        blockId: 'b1',
        cropPluginId: corn!.pluginId,
        varietyDisplayName: 'Corn',
        plantingDate: Date.parse('2026-08-27')
      },
      corn!
    );
    expect(window).not.toBeNull();
    const starts = events.filter((e) => e.kind === 'harvest-window').map((e) => e.startMs);
    expect(window!.start).toBe(new Date(Math.min(...starts)).toISOString().slice(0, 10));
  });
});
