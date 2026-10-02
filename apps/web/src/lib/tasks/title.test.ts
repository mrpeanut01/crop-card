import { describe, expect, it } from 'vitest';
import { taskDisplayTitle } from './title';
import { taskStart } from './start';
import { taskStatusLabel } from './status';

describe('taskDisplayTitle', () => {
  it('returns the stored title in English', () => {
    const task = { title: 'Sow Kale indoors', pluginTemplateKey: 'seedstart:c1:sow' };
    expect(taskDisplayTitle(task)).toBe('Sow Kale indoors');
    expect(taskDisplayTitle(task, 'en')).toBe('Sow Kale indoors');
  });

  it('rebuilds seed-start titles in Spanish', () => {
    expect(
      taskDisplayTitle({ title: 'Sow Kale indoors', pluginTemplateKey: 'seedstart:c1:sow' }, 'es')
    ).toBe('Sembrar Kale bajo techo');
    expect(
      taskDisplayTitle(
        { title: 'Start hardening off Kale', pluginTemplateKey: 'seedstart:c1:harden' },
        'es'
      )
    ).toBe('Empezar a aclimatar Kale');
    expect(
      taskDisplayTitle(
        { title: 'Transplant Kale to Bed 3', pluginTemplateKey: 'seedstart:c1:transplant' },
        'es'
      )
    ).toBe('Trasplantar Kale a Bed 3');
  });

  it('leaves other stored titles alone', () => {
    expect(
      taskDisplayTitle({ title: 'Sow Kale indoors', pluginTemplateKey: 'crop:kale:pre:x' }, 'es')
    ).toBe('Sow Kale indoors');
    expect(taskDisplayTitle({ title: 'Fix the fence' }, 'es')).toBe('Fix the fence');
  });
});

describe('task labels by locale', () => {
  it('translates start and status labels', () => {
    expect(taskStart({ id: 't1', category: 'harvest' })?.label).toBe('Start harvest');
    expect(taskStart({ id: 't1', category: 'harvest' }, 'es')?.label).toBe('Empezar cosecha');
    expect(taskStatusLabel('late')).toBe('Late');
    expect(taskStatusLabel('late', 'es')).not.toBe('Late');
  });
});
