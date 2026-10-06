import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import type { FarmSnapshot, SnapshotOrchard } from '$lib/cards/snapshot';
import { offlineOrchardRows } from './offline';
import type { OrchardCalendarView } from './calendarView';

const CAL: OrchardCalendarView = {
  pluginId: 'pome-va-2026',
  audience: 'commercial',
  edition: '2026',
  guide: {
    publisher: 'VCE',
    title: 'Spray Bulletin',
    publicationId: 'VCE 456-419',
    url: 'https://example.test/guide'
  } as OrchardCalendarView['guide'],
  stages: [
    {
      id: 'pink',
      name: 'Pink',
      description: 'Pink buds',
      windows: [
        {
          id: 'pink-scab',
          purpose: 'disease-risk',
          targets: [{ id: 'apple-scab', kind: 'disease' }] as never,
          pollinatorSensitive: true,
          labelLine: true
        }
      ]
    }
  ]
};

const MAY_2026 = Date.UTC(2026, 4, 2, 15);

function snap(orchard: Partial<SnapshotOrchard> = {}): FarmSnapshot {
  const base = sampleSnapshot();
  return {
    ...base,
    generatedAt: MAY_2026,
    areas: [{ ...base.areas[0], id: 'area-1' }] as FarmSnapshot['areas'],
    blocks: [
      { id: 'b1', areaId: 'area-1', name: 'Row 1' },
      { id: 'b2', areaId: 'area-2', name: 'Row 2' }
    ] as FarmSnapshot['blocks'],
    plantings: [
      {
        id: 'c1',
        blockId: 'b1',
        cropPluginId: 'apple-gala',
        varietyDisplayName: 'Gala',
        status: 'active'
      },
      {
        id: 'c2',
        blockId: 'b1',
        cropPluginId: 'apple-fuji',
        varietyDisplayName: 'Fuji',
        status: 'harvested'
      },
      {
        id: 'c3',
        blockId: 'b2',
        cropPluginId: 'apple-fuji',
        varietyDisplayName: 'Fuji',
        status: 'active'
      }
    ] as FarmSnapshot['plantings'],
    orchard: {
      year: 2026,
      timeZone: 'America/New_York',
      lowInput: false,
      calendars: { 'pome-va-2026': CAL },
      plantings: ['c1', 'c2', 'c3'].map((cropId) => ({
        cropId,
        status: 'calendar' as const,
        audience: {
          audience: 'commercial' as const,
          reason: 'farm-profile' as const,
          provenance: 'data' as const
        },
        calendarId: 'pome-va-2026',
        mark:
          cropId === 'c1'
            ? { stageId: 'pink', markedAt: Date.UTC(2026, 3, 20), markedByName: 'Ana' }
            : null
      })),
      ...orchard
    }
  };
}

describe('offlineOrchardRows (#593)', () => {
  it('returns null with no saved copy or no orchard part', () => {
    expect(offlineOrchardRows(null, { cropId: 'c1' }, MAY_2026)).toBeNull();
    const { orchard: _o, ...rest } = snap();
    expect(offlineOrchardRows(rest as FarmSnapshot, { cropId: 'c1' }, MAY_2026)).toBeNull();
  });

  it("shows this year's saved mark with its stage's windows and the copy's time", () => {
    const out = offlineOrchardRows(snap(), { cropId: 'c1' }, MAY_2026)!;
    expect(out.savedAt).toBe(MAY_2026);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].mark?.stage.id).toBe('pink');
    expect(out.rows[0].mark?.markedByName).toBe('Ana');
    expect(out.rows[0].mark?.stage.windows[0].labelLine).toBe(true);
  });

  it('shows no mark from an earlier farm-local year (OS-6)', () => {
    const jan = Date.UTC(2027, 0, 3, 15);
    const out = offlineOrchardRows(snap(), { cropId: 'c1' }, jan)!;
    expect(out.rows[0].mark).toBeNull();
    expect(out.rows[0].year).toBe(2027);
  });

  it('counts the year in the farm zone, not UTC', () => {
    const newYearUtc = Date.UTC(2027, 0, 1, 2);
    expect(offlineOrchardRows(snap(), { cropId: 'c1' }, newYearUtc)!.rows[0].mark).not.toBeNull();
  });

  it("lists an Area's current plantings only", () => {
    const out = offlineOrchardRows(snap(), { areaId: 'area-1' }, MAY_2026)!;
    expect(out.rows.map((r) => r.cropId)).toEqual(['c1']);
    expect(offlineOrchardRows(snap(), { areaId: 'nowhere' }, MAY_2026)).toBeNull();
  });

  it('reads a calendar missing from the copy as none, never another text', () => {
    const out = offlineOrchardRows(snap({ calendars: {} }), { cropId: 'c1' }, MAY_2026)!;
    expect(out.rows[0].calendar).toBeNull();
    expect(out.rows[0].status).toBe('none');
    expect(out.rows[0].mark).toBeNull();
  });
});

describe('OC-3 offline: a saved mark never becomes a bloom answer', () => {
  it('the offline path never touches the bloom prefill', () => {
    for (const file of [
      'src/lib/orchard/offline.ts',
      'src/lib/server/orchardSnapshot.ts',
      'src/lib/components/orchard/OrchardPanel.svelte'
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(
        /bloomPrefill|prefillBloomStatus|BLOOM_PREFILL|not-in-bloom|bloomStatus/
      );
    }
  });
});
