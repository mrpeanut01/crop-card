/**
 * Bump on any change to safety-kernel rules. Persisted on every spray record
 * so rule updates cannot retroactively misvalidate prior decisions.
 */
export const RULES_VERSION = '0.4.0-safety-kernel' as const;
