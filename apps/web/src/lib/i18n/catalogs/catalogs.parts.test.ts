// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EN_PARTS } from './en';
import { ES_PARTS } from './es';

describe('catalog parts', () => {
  it('never define the same English key twice', () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    EN_PARTS.forEach((part, i) => {
      for (const key of Object.keys(part)) {
        if (seen.has(key)) dupes.push(`${key} (parts ${seen.get(key)} and ${i})`);
        seen.set(key, i);
      }
    });
    expect(dupes).toEqual([]);
  });

  it('never define the same Spanish key twice', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const part of ES_PARTS) {
      for (const key of Object.keys(part)) {
        if (seen.has(key)) dupes.push(key);
        seen.add(key);
      }
    }
    expect(dupes).toEqual([]);
  });
});
