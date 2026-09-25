const BRANDED = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*tenantScoped\s*\(/gm;
const ALIAS = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gm;

/**
 * Returns the sorted export names of every tenant-scoped table in a Drizzle
 * schema source: each `export const X = tenantScoped(` plus any
 * `export const Y = X;` alias of one.
 * @param {string} schemaSource
 * @returns {string[]}
 */
export function extractTenantScopedTables(schemaSource) {
  const names = new Set();
  for (const m of schemaSource.matchAll(BRANDED)) names.add(m[1]);
  for (const m of schemaSource.matchAll(ALIAS)) {
    if (names.has(m[2])) names.add(m[1]);
  }
  return [...names].sort();
}
