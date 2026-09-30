import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import {
  CALENDAR_ONLY_EVENT_KINDS,
  eventsForPlanting,
  upcomingEvents,
  type SeedStartFacts
} from './engine';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 10, 12);

const tomato: CropPlugin = {
  pluginId: 'tomato-x',
  type: 'crop',
  displayName: 'Cherokee Purple',
  version: '1.0.0',
  cropFamily: 'solanaceae',
  harvestStyle: 'continuous-fruit',
  bloomWindow: { continuous: true, beeAttractive: true },
  daysToMaturity: { min: 70, max: 80 }
};

const p: PlantingRecord = {
  id: 'c1',
  blockId: 'b1',
  cropPluginId: tomato.pluginId,
  varietyDisplayName: 'Cherokee Purple',
  plantingDate: T0
};

function seedKinds(facts: SeedStartFacts) {
  return eventsForPlanting(p, tomato, { seedStart: facts }).filter((e) =>
    CALENDAR_ONLY_EVENT_KINDS.has(e.kind)
  );
}

describe('eventsForPlanting with seedStart (E3-4)', () => {
  it('emits no seed kinds unless seedStart is passed', () => {
    const events = eventsForPlanting(p, tomato, {});
    expect(events.some((e) => CALENDAR_ONLY_EVENT_KINDS.has(e.kind))).toBe(false);
  });

  it('a recorded tray gives a solid indoor bar to the transplant date', () => {
    const ev = seedKinds({ establishment: 'transplant', sownIndoorsAt: T0 - 42 * DAY, tasks: [] });
    const indoor = ev.find((e) => e.kind === 'indoor-sow')!;
    expect(indoor.startMs).toBe(T0 - 42 * DAY);
    expect(indoor.endMs).toBe(T0);
    expect(indoor.detail).toMatchObject({ recorded: true, from: 'tray' });
    expect(ev.find((e) => e.kind === 'transplant')?.startMs).toBe(T0);
    expect(ev.some((e) => e.kind === 'direct-sow')).toBe(false);
  });

  it('an open Sow task gives a planned indoor bar from its date', () => {
    const ev = seedKinds({
      establishment: 'transplant',
      sownIndoorsAt: null,
      tasks: [{ step: 'sow', scheduledFor: T0 - 49 * DAY }]
    });
    const indoor = ev.find((e) => e.kind === 'indoor-sow')!;
    expect(indoor.startMs).toBe(T0 - 49 * DAY);
    expect(indoor.detail).toMatchObject({ recorded: false, from: 'task' });
  });

  it('an aborted Sow task gives no indoor bar', () => {
    const ev = seedKinds({
      establishment: 'transplant',
      sownIndoorsAt: null,
      tasks: [{ step: 'sow', scheduledFor: T0 - 49 * DAY, abortedAt: T0 - 50 * DAY }]
    });
    expect(ev.some((e) => e.kind === 'indoor-sow')).toBe(false);
    expect(ev.some((e) => e.kind === 'transplant')).toBe(true);
  });

  it('a bought seedling (transplant, no tray, no task) gets a transplant point only', () => {
    const ev = seedKinds({ establishment: 'transplant', sownIndoorsAt: null, tasks: [] });
    expect(ev.map((e) => e.kind)).toEqual(['transplant']);
  });

  it('direct seed and null establishment give a direct-sow point', () => {
    expect(
      seedKinds({ establishment: 'direct-seed', sownIndoorsAt: null, tasks: [] }).map((e) => e.kind)
    ).toEqual(['direct-sow']);
    expect(
      seedKinds({ establishment: null, sownIndoorsAt: null, tasks: [] }).map((e) => e.kind)
    ).toEqual(['direct-sow']);
  });

  it('never recomputes an indoor date that falls after the in-ground date', () => {
    const ev = seedKinds({ establishment: 'transplant', sownIndoorsAt: T0 + DAY, tasks: [] });
    expect(ev.some((e) => e.kind === 'indoor-sow')).toBe(false);
  });
});

describe('upcomingEvents drops calendar-only kinds', () => {
  it('filters indoor-sow, transplant and direct-sow', () => {
    const events = eventsForPlanting(p, tomato, {
      seedStart: {
        establishment: 'transplant',
        sownIndoorsAt: null,
        tasks: [{ step: 'sow', scheduledFor: T0 - 3 * DAY }]
      }
    });
    const up = upcomingEvents(events, 14, T0 - 5 * DAY);
    expect(up.length).toBeGreaterThan(0);
    expect(up.some((e) => CALENDAR_ONLY_EVENT_KINDS.has(e.kind))).toBe(false);
  });
});

describe('only the sowing calendar loader passes seedStart (E3-4)', () => {
  const SRC = path.resolve(__dirname, '../..');
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
    }
    return out;
  }

  /** The argument text of every `eventsForPlanting(...)` call, so a
   *  `seedStart:` key elsewhere in the file (a planting card's guide) does
   *  not count. */
  function eventsForPlantingCalls(text: string): string[] {
    const calls: string[] = [];
    const re = /eventsForPlanting\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        i++;
      }
      calls.push(text.slice(start, i - 1));
    }
    return calls;
  }

  it('no other module sets EventContext.seedStart', () => {
    const offenders = walk(SRC).filter((f) =>
      eventsForPlantingCalls(readFileSync(f, 'utf8')).some((call) => /\bseedStart\s*:/.test(call))
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([
      path.join('lib', 'calendar', 'sowingCalendar.server.ts')
    ]);
  });
});
