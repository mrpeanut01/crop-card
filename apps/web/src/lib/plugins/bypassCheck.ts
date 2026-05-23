/**
 * Back-compat shim. The canonical bypass check lives in the shared
 * `@cropcard/plugin-validation` workspace package so the marketplace
 * (apps/marketplace) can validate uploads identically.
 *
 * The check reads CHEMISTRY_KILL_MATRIX from a generated snapshot
 * (packages/plugin-validation/src/safetySnapshot.ts) of the canonical
 * source in apps/web/src/lib/safety/. CLAUDE.md invariant 1 stays
 * intact: safety rules live in apps/web/src/lib/safety/.
 *
 * Do not add new code here — author in packages/plugin-validation/src/bypassCheck.ts.
 */
export * from '@cropcard/plugin-validation/bypass';
