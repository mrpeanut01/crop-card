import { describe, expect, it } from 'vitest';
import { taskStart } from './start';

describe('taskStart', () => {
  it('spray flows carry the task so the record closes it', () => {
    expect(taskStart({ id: 't1', relatedEventTable: 'spray_event', blockId: 'b 1' })).toEqual({
      href: '/spray?task=t1&block=b+1',
      label: 'Start spraying'
    });
    expect(taskStart({ id: 't2', relatedEventTable: 'insecticide_event' })?.href).toBe(
      '/spray/insecticide?task=t2'
    );
    expect(taskStart({ id: 't3', relatedEventTable: 'fungicide_event' })?.href).toBe(
      '/spray/fungicide?task=t3'
    );
    expect(taskStart({ id: 't4', category: 'spray' })?.href).toBe('/spray?task=t4');
  });

  it('other flows open on the right page', () => {
    expect(taskStart({ id: 'h', relatedEventTable: 'harvest_event' })?.href).toBe('/harvest');
    expect(taskStart({ id: 'y', relatedEventTable: 'hay_cutting' })?.href).toBe('/hay');
    expect(taskStart({ id: 'f', relatedEventTable: 'fertility_application' })?.href).toBe(
      '/fertility'
    );
    expect(taskStart({ id: 's', category: 'scout', blockId: 'b1' })).toEqual({
      href: '/scout?block=b1',
      label: 'Start scouting'
    });
    expect(taskStart({ id: 'c', category: 'hay-cutting' })?.href).toBe('/hay');
    expect(taskStart({ id: 'g', category: 'fertilize' })?.href).toBe('/fertility');
    expect(taskStart({ id: 'r', category: 'harvest' })?.href).toBe('/harvest');
  });

  it('the linked event wins over the category', () => {
    expect(
      taskStart({ id: 'x', relatedEventTable: 'harvest_event', category: 'spray' })?.href
    ).toBe('/harvest');
  });

  it('plain jobs have nothing to start: Done and Skip are enough', () => {
    expect(taskStart({ id: 'p', category: 'prune' })).toBeNull();
    expect(taskStart({ id: 'o', category: 'other' })).toBeNull();
    expect(taskStart({ id: 'n' })).toBeNull();
  });
});
