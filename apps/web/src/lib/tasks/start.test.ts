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

  it('every flow carries the task, block and planting so the record closes it', () => {
    expect(taskStart({ id: 'h', relatedEventTable: 'harvest_event' })?.href).toBe(
      '/harvest?task=h'
    );
    expect(
      taskStart({ id: 'h2', relatedEventTable: 'harvest_event', blockId: 'b1', cropId: 'c1' })?.href
    ).toBe('/harvest?task=h2&block=b1&crop=c1');
    expect(taskStart({ id: 'y', relatedEventTable: 'hay_cutting', blockId: 'b2' })?.href).toBe(
      '/hay?task=y&block=b2'
    );
    expect(taskStart({ id: 'f', relatedEventTable: 'fertility_application' })?.href).toBe(
      '/fertility?task=f'
    );
    expect(taskStart({ id: 's', category: 'scout', blockId: 'b1' })).toEqual({
      href: '/scout?task=s&block=b1',
      label: 'Start scouting'
    });
    expect(taskStart({ id: 'cc', category: 'companion-check', cropId: 'c9' })?.href).toBe(
      '/scout?task=cc&crop=c9'
    );
    expect(taskStart({ id: 'c', category: 'hay-cutting' })?.href).toBe('/hay?task=c');
    expect(taskStart({ id: 'g', category: 'fertilize' })?.href).toBe('/fertility?task=g');
    expect(taskStart({ id: 'r', category: 'harvest' })?.href).toBe('/harvest?task=r');
  });

  it('spray hrefs carry the planting too', () => {
    expect(
      taskStart({ id: 'sp', relatedEventTable: 'spray_event', blockId: 'b1', cropId: 'c1' })?.href
    ).toBe('/spray?task=sp&block=b1&crop=c1');
  });

  it('the linked event wins over the category', () => {
    expect(
      taskStart({ id: 'x', relatedEventTable: 'harvest_event', category: 'spray' })?.href
    ).toBe('/harvest?task=x');
  });

  it('plain jobs have nothing to start: Done and Skip are enough', () => {
    expect(taskStart({ id: 'p', category: 'prune' })).toBeNull();
    expect(taskStart({ id: 'o', category: 'other' })).toBeNull();
    expect(taskStart({ id: 'n' })).toBeNull();
  });
});
