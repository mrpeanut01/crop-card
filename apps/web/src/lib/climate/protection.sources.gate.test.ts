import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceEntrySchema } from '$lib/plugins/sourceCoverage';
import { PROTECTION_DEFAULTS, PROTECTION_KINDS } from './protection';

const FILE = path.resolve(__dirname, '../../../scripts/protection-sources.json');
const sources = JSON.parse(readFileSync(FILE, 'utf8')) as {
  entries: Record<string, Record<string, unknown>>;
};

describe('protection default shifts are sourced (E0-2, E2-1)', () => {
  it('every non-null default has a quote whose value matches', () => {
    const gaps: string[] = [];
    for (const kind of PROTECTION_KINDS) {
      for (const side of ['springShiftDays', 'fallShiftDays'] as const) {
        const v = PROTECTION_DEFAULTS[kind][side];
        if (v === null) continue;
        const entry = sources.entries[kind]?.[side] as Record<string, unknown> | undefined;
        if (!entry || !sourceEntrySchema.safeParse(entry).success)
          gaps.push(`${kind}.${side}: missing`);
        else if (entry.value !== v)
          gaps.push(`${kind}.${side}: value ${String(entry.value)} != ${v}`);
      }
    }
    expect(
      gaps,
      'add a quote to apps/web/scripts/protection-sources.json, or leave the default null'
    ).toEqual([]);
  });

  it('no entry is left for a kind or side that ships no default', () => {
    const stale: string[] = [];
    for (const [kind, sides] of Object.entries(sources.entries)) {
      for (const side of Object.keys(sides)) {
        const d = PROTECTION_DEFAULTS[kind as keyof typeof PROTECTION_DEFAULTS];
        if (!d || d[side as keyof typeof d] === null || d[side as keyof typeof d] === undefined) {
          stale.push(`${kind}.${side}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it('defaults stay inside 0 to 120 days', () => {
    for (const kind of PROTECTION_KINDS) {
      for (const v of Object.values(PROTECTION_DEFAULTS[kind])) {
        if (v !== null) expect(v >= 0 && v <= 120 && Number.isInteger(v)).toBe(true);
      }
    }
  });
});
