// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Soil survey data is reference data for the reader. It must never feed a
 * safety verdict, the Inputs Plan or fertility math, and it must never ride
 * in the offline Card snapshot. This scan fails on any import that would
 * let it.
 */

const SRC = resolve(process.cwd(), 'src');
const SOIL_IMPORT =
  /(['"`])[^'"`\n]*(?:lib\/(?:server\/)?soil|\.\.?\/(?:server\/)?soil)\/[^'"`\n]*\1/;
const SOIL_SYMBOL =
  /\b(soilSurveyAt|soilSurveyForArea|parseSdaTable|describeSoil|soilSitingFlags|SoilSurvey|SoilLookup)\b/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|js|mjs|svelte)$/.test(name)) out.push(path);
  }
  return out;
}

function offenders(paths: string[]): string[] {
  return paths.filter((p) => {
    const text = readFileSync(p, 'utf8');
    return SOIL_IMPORT.test(text) || SOIL_SYMBOL.test(text);
  });
}

describe('soil survey data stays out of safety, planning and fertility math', () => {
  it('the import pattern catches the ways a module could reach it', () => {
    for (const line of [
      "import { soilSurveyAt } from '$lib/server/soil/ssurgo.server';",
      "import type { SoilSurvey } from '$lib/soil/types';",
      "import { x } from '../soil/siting';",
      "const m = await import('$lib/soil/describe');",
      "import { y } from '../../lib/server/soil/ssurgo.server';"
    ]) {
      expect(SOIL_IMPORT.test(line), line).toBe(true);
    }
    for (const line of [
      "import { soilTestLine } from '$lib/fertility/soilLine';",
      "import { interpret } from './soilInterpret';",
      "import type { SetupSoilTestResult } from '$lib/fertility/soilTestForm';"
    ]) {
      expect(SOIL_IMPORT.test(line), line).toBe(false);
    }
  });

  it('nothing in lib/safety imports or names it', () => {
    const scanned = files(join(SRC, 'lib/safety'));
    expect(scanned.length).toBeGreaterThan(20);
    expect(offenders(scanned)).toEqual([]);
  });

  it('the Inputs Plan and its server layer do not import or name it', () => {
    const plan = files(join(SRC, 'lib/plan')).filter((p) => /inputsPlan|inputsChoice/i.test(p));
    expect(plan.some((p) => p.endsWith('lib/plan/inputsPlan.ts'))).toBe(true);
    const server = files(join(SRC, 'lib/server')).filter((p) => /inputsPlan|inputsChoice/i.test(p));
    expect(offenders([...plan, ...server])).toEqual([]);
  });

  it('fertility math does not import or name it', () => {
    const scanned = [...files(join(SRC, 'lib/fertility')), join(SRC, 'lib/db/fertility.ts')].filter(
      (p) => !p.endsWith('.test.ts')
    );
    expect(scanned.length).toBeGreaterThan(3);
    expect(offenders(scanned)).toEqual([]);
  });

  it('the offline Card snapshot and card builders do not carry it', () => {
    expect(offenders(files(join(SRC, 'lib/cards')))).toEqual([]);
  });
});
