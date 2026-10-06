import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { orchardCalendarPluginSchema, orchardCopyProblems } from '$lib/plugins/schemas';
import { en } from './catalogs/en';
import { es } from './catalogs/es';
import {
  orchardDescriptionKey,
  orchardNoteKey,
  orchardStageDescription,
  orchardStageName,
  orchardStageNameKey,
  orchardTargetKey,
  orchardTargetLabel,
  orchardWindowNote
} from './orchardCalendarText';

// OP-29 gate: every string an orchard calendar shows has an English catalog
// entry equal to the plugin text and a Spanish entry that passes the
// calendar copy guard.

const DIR = path.resolve(__dirname, '../../../../../plugins/orchard-calendars');
const calendars = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) =>
    orchardCalendarPluginSchema.parse(JSON.parse(readFileSync(path.join(DIR, f), 'utf8')))
  );
const EN = en as Record<string, string | undefined>;
const ES = es as Record<string, string | undefined>;

function shownKeys(): { key: string; english: string }[] {
  const out: { key: string; english: string }[] = [];
  for (const c of calendars) {
    for (const s of c.stages) {
      out.push({ key: orchardStageNameKey(c.pluginId, s.id, s.name), english: s.name });
      out.push({
        key: orchardDescriptionKey(c.pluginId, s.id),
        english: s.recognise.description
      });
      for (const w of s.windows) {
        if (w.note) out.push({ key: orchardNoteKey(c.pluginId, w.id), english: w.note });
        for (const tg of w.targets) out.push({ key: orchardTargetKey(tg.id), english: '' });
      }
    }
  }
  return out;
}

describe('orchard calendar text (OP-29 gate)', () => {
  it('there are shipped calendars to check', () => {
    expect(calendars.length).toBeGreaterThanOrEqual(6);
  });

  it('every shown string has English equal to the plugin and a Spanish entry', () => {
    const problems: string[] = [];
    for (const { key, english } of shownKeys()) {
      if (EN[key] === undefined) problems.push(`${key}: no English entry`);
      else if (english && EN[key] !== english) problems.push(`${key}: English differs from plugin`);
      if (!ES[key]?.trim()) problems.push(`${key}: no Spanish entry`);
    }
    expect(problems).toEqual([]);
  });

  it('every orchard catalog string passes the copy guard in both languages', () => {
    const problems: string[] = [];
    for (const [k, v] of Object.entries(EN)) {
      if (!k.startsWith('orchard.') || !v) continue;
      for (const r of orchardCopyProblems(v)) problems.push(`en ${k}: ${r}`);
      const s = ES[k];
      if (s) for (const r of orchardCopyProblems(s)) problems.push(`es ${k}: ${r}`);
    }
    expect(problems).toEqual([]);
  });

  it('no orchard catalog key is left over from a calendar that is gone', () => {
    const used = new Set(shownKeys().map((k) => k.key));
    const orphans = Object.keys(EN).filter((k) => k.startsWith('orchard.cal.') && !used.has(k));
    expect(orphans).toEqual([]);
  });

  it('spongy moth reads with its old name too (OP-11)', () => {
    expect(orchardTargetLabel('spongy-moth')).toBe('Spongy moth (gypsy moth)');
  });

  it('Spanish shows only while the plugin English is unchanged', () => {
    const c = calendars.find((x) => x.pluginId === 'pome-va-2026')!;
    const stage = c.stages.find((s) => s.id === 'pink')!;
    expect(orchardStageName(c.pluginId, stage, 'es')).toBe('Botón rosado');
    expect(orchardStageName(c.pluginId, { ...stage, name: 'Pink (edited)' }, 'es')).toBe(
      'Pink (edited)'
    );
    expect(orchardStageDescription(c.pluginId, stage, 'en')).toBe(stage.recognise.description);
    expect(
      orchardStageDescription(
        c.pluginId,
        { ...stage, recognise: { description: 'New text.' } },
        'es'
      )
    ).toBe('New text.');
    const w = stage.windows.find((x) => x.note)!;
    expect(orchardWindowNote(c.pluginId, w, 'es')).not.toBe(w.note);
    expect(orchardWindowNote(c.pluginId, { ...w, note: 'Changed.' }, 'es')).toBe('Changed.');
    expect(orchardTargetLabel('not-a-target', 'es')).toBe('not a target');
  });

  it('pear keeps its own petal fall name', () => {
    const c = calendars.find((x) => x.pluginId === 'pear-va-2026')!;
    const stage = c.stages.find((s) => s.id === 'petal-fall')!;
    expect(orchardStageName(c.pluginId, stage, 'es')).toBe(
      'De la caída de pétalos a la quinta cobertura'
    );
  });
});
