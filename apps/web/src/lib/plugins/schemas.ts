/**
 * Back-compat shim. The canonical plugin Zod schemas live in the
 * shared `@cropcard/plugin-validation` workspace package so the
 * marketplace (apps/marketplace) can validate uploads identically.
 *
 * Do not add new code here — author in packages/plugin-validation/src/schemas.ts.
 */
export * from '@cropcard/plugin-validation/schemas';
