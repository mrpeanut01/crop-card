import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The animal surfaces serve garden households too, so their copy never
 *  says "livestock", and paragraphs use plain punctuation. */

const ROOTS = ['src/routes/animals', 'src/lib/components/animals', 'src/lib/animals'];
const SETUP = [
  'src/lib/components/setup/SetupAnimal.svelte',
  'src/lib/components/setup/SetupAnimalHousing.svelte'
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
}

const files = [...ROOTS.flatMap(walk), ...SETUP];

describe('animal surface copy', () => {
  it('covers the pages, components and setup sheets', () => {
    expect(files.some((f) => f.endsWith('routes/animals/+page.svelte'))).toBe(true);
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files)('%s never says livestock and has no em or en dashes', (file) => {
    const text = readFileSync(file, 'utf-8');
    expect(text.toLowerCase()).not.toContain('livestock');
    expect(text).not.toMatch(/[–—]/);
  });
});
