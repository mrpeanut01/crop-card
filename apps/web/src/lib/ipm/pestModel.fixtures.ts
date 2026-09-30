/**
 * TEST FIXTURES ONLY. Pest models registered by the e2e preview server when
 * `E2E_DEGREE_DAY_FIXTURE=1`, and by unit tests through the registry test
 * hook. Every number is made up and is not extension data. Never copy these
 * into plugins/.
 */

export const E2E_TRAP_MODEL = {
  pluginId: 'test-e2e-trap-borer',
  displayName: 'Test trap borer model',
  version: '0.0.0-test',
  type: 'pest-model',
  pest: { commonName: 'Test trap borer' },
  hostCropFamilies: ['cucurbit'],
  method: 'simple-average',
  baseTempF: 50,
  biofix: { kind: 'first-trap-catch' },
  stages: [
    {
      key: 'eggs',
      label: 'Eggs on stems',
      gddFrom: 100,
      gddTo: 400,
      action: 'scout',
      message: 'Check stems near the soil line for eggs.'
    },
    {
      key: 'larvae',
      label: 'Larvae in stems',
      gddFrom: 400,
      action: 'hand-pick',
      message: 'Look for sawdust-like frass at the base of vines.'
    }
  ],
  notes: 'Test fixture, not extension data.'
} as const;

export const E2E_PEST_MODELS: ReadonlyArray<{ readonly pluginId: string }> = [E2E_TRAP_MODEL];

/** The fixture model and synthetic weather only run on a dev-routes server
 *  that asked for them, never in production. Server-only callers. */
export function degreeDayFixtureEnabled(env: Record<string, string | undefined>): boolean {
  return env.E2E_DEGREE_DAY_FIXTURE === '1' && env.ENABLE_DEV_ROUTES === '1';
}
