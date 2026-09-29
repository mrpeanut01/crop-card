const MARKED =
  /^\/\/ @hold-fact\b[^\n]*\n(?:\/\*\*[\s\S]*?\*\/\n)?export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*tenantScoped\s*\(/gm;

/**
 * Returns the sorted export names of every hold-fact table in a Drizzle
 * schema source: each tenant-scoped table whose `export const` is preceded
 * by a `// @hold-fact` line (C-35). These are the tables whose rows open,
 * close or declare against a hold, so the hold guard must see every write.
 * @param {string} schemaSource
 * @returns {string[]}
 */
export function extractHoldFactTables(schemaSource) {
  const names = new Set();
  for (const m of schemaSource.matchAll(MARKED)) names.add(m[1]);
  return [...names].sort();
}
