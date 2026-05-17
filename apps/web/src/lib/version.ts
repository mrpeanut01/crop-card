/**
 * Application version constant — surfaced in compliance exports (PDF + CSV)
 * so an inspector (P4) can identify exactly which build of CropCard
 * produced a given record. Bump when shipping a release.
 *
 * Distinct from `RULES_VERSION` at `lib/safety/version.ts`, which versions
 * the safety-kernel rule set only.
 */
export const APP_VERSION = '0.0.1' as const;
