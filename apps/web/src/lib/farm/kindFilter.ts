/** Parses a `?kind=a,b` query value. Null means no filter; any unknown
 *  value makes the whole filter invalid rather than silently dropping it. */
export function parseKindFilter<K extends string>(
  raw: string | null,
  allowed: readonly K[]
): K[] | null | 'invalid' {
  if (raw === null) return null;
  const parts = [...new Set(raw.split(',').map((s) => s.trim()))].filter(Boolean);
  if (parts.length === 0) return null;
  const known = new Set<string>(allowed);
  if (!parts.every((p) => known.has(p))) return 'invalid';
  return parts as K[];
}
