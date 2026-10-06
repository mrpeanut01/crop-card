import { describe, expect, it } from 'vitest';
import { buildTaskCard, buildTaskCardFromSnapshot } from '$lib/cards/build/task';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { isTypicalTimingEvent, isTypicalTimingTask } from './typicalTiming';

describe('isTypicalTimingTask (OP-22)', () => {
  it.each([
    'crop:blueberry-bluecrop:seasonal:winter-prune',
    'crop:apple-orchard:seasonal:post-bloom-thinning',
    'derived:seasonal-task:b_1:1780000000000',
    'derived:orchard-task:b_1:1780000000000'
  ])('labels %s', (key) => {
    expect(isTypicalTimingTask({ pluginTemplateKey: key })).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'crop:tomato:pre:stake',
    'equipment:sprayer:decon',
    'derived:spray-window:b_1:1',
    'derived:stage-window:b_1:1',
    'derived:harvest-window:b_1:1',
    'seedstart:c_1:sow',
    'xcrop:apple:seasonal:thin',
    'crop::seasonal:thin',
    'crop:apple:seasonal:'
  ])('leaves %s alone', (key) => {
    expect(isTypicalTimingTask({ pluginTemplateKey: key })).toBe(false);
  });
});

describe('isTypicalTimingEvent (OP-22)', () => {
  it('labels seasonal and orchard rows and perennial template stages', () => {
    expect(isTypicalTimingEvent({ kind: 'seasonal-task' })).toBe(true);
    expect(isTypicalTimingEvent({ kind: 'orchard-task' })).toBe(true);
    expect(
      isTypicalTimingEvent({ kind: 'stage-window', detail: { system: 'perennial-calendar' } })
    ).toBe(true);
  });

  it('leaves the other kinds alone, including stage tables from a planting date', () => {
    for (const kind of ['planting', 'spray-window', 'harvest-window', 'cover-termination']) {
      expect(isTypicalTimingEvent({ kind })).toBe(false);
    }
    expect(isTypicalTimingEvent({ kind: 'stage-window', detail: { stageCode: 'V6' } })).toBe(false);
    expect(isTypicalTimingEvent({ kind: 'stage-window', detail: null })).toBe(false);
  });
});

describe('the task card shows typical timing as fallback', () => {
  const prefs = { timeZone: 'America/New_York', units: 'us' as const };
  const now = Date.parse('2026-06-04T16:00:00Z');
  const base = {
    id: 't1',
    title: 'Winter prune',
    scheduledFor: Date.parse('2026-06-10T14:00:00Z'),
    pluginTemplateKey: 'crop:blueberry-bluecrop:seasonal:winter-prune'
  };

  it('an open seasonal task: fallback When with the line, in English and Spanish', () => {
    const en = buildTaskCard(base, { asOf: now }, { now, prefs });
    expect(en.facts[0]).toMatchObject({
      label: 'When',
      provenance: 'fallback',
      note: 'Typical timing. Adjust to your farm.'
    });
    const es = buildTaskCard(base, { asOf: now }, { now, prefs: { ...prefs, locale: 'es' } });
    expect(es.facts[0].note).toBe('Fecha habitual. Ajústala a tu finca.');
  });

  it('done or skipped tasks show their real date with no label', () => {
    const done = buildTaskCard({ ...base, completedAt: now }, { asOf: now }, { now, prefs });
    expect(done.facts[0].note).toBeUndefined();
    expect(done.facts[0].provenance).toBeUndefined();
    const skipped = buildTaskCard({ ...base, abortedAt: now }, { asOf: now }, { now, prefs });
    expect(skipped.facts[0].note).toBeUndefined();
  });

  it('other tasks are untouched', () => {
    const card = buildTaskCard(
      { ...base, pluginTemplateKey: 'crop:tomato:pre:stake' },
      { asOf: now },
      { now, prefs }
    );
    expect(card.facts[0]).toEqual({ label: 'When', value: expect.any(String) });
  });

  it('the offline card reads the key from the snapshot', () => {
    const snap = sampleSnapshot();
    const task = snap.tasks[0];
    const withKey = {
      ...snap,
      tasks: [{ ...task, pluginTemplateKey: 'derived:orchard-task:b_1:1' }, ...snap.tasks.slice(1)]
    };
    const card = buildTaskCardFromSnapshot(withKey, task.id, { now: snap.generatedAt });
    expect(card?.facts[0].note).toBe('Typical timing. Adjust to your farm.');
    expect(buildTaskCardFromSnapshot(snap, task.id, { now: snap.generatedAt })?.facts[0].note).toBe(
      undefined
    );
  });
});
