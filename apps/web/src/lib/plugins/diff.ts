/**
 * Deep-key diff for plugin JSON payloads (Phase 22).
 *
 * Lightweight, dependency-free — the repo deliberately has no JSON-diff lib.
 * Output is a flat key-path summary suitable for timeline chips:
 *   { addedKeys: ['agronomy.rotationLookback'],
 *     removedKeys: ['notes'],
 *     changedKeys: ['ratePerAcre.amount', 'labelClaims.safeForCropPluginIds'] }
 *
 * Arrays are diffed by reference equality (whole-array changed-or-not) —
 * a per-element diff for arrays of objects would generate noisy summaries
 * for the version timeline. Authors who care about per-element history can
 * read the full `payloadJson` for each version.
 */

export interface PluginDiff {
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as object).constructor === Object
  );
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function walk(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
  prefix: string,
  out: PluginDiff
): void {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const hasLeft = key in left;
    const hasRight = key in right;
    if (!hasLeft && hasRight) {
      out.addedKeys.push(path);
      continue;
    }
    if (hasLeft && !hasRight) {
      out.removedKeys.push(path);
      continue;
    }
    const lv = left[key];
    const rv = right[key];
    if (isPlainObject(lv) && isPlainObject(rv)) {
      walk(lv, rv, path, out);
      continue;
    }
    if (!shallowEqual(lv, rv)) {
      out.changedKeys.push(path);
    }
  }
}

export function diffPlugins(prev: unknown, next: unknown): PluginDiff {
  const out: PluginDiff = { addedKeys: [], removedKeys: [], changedKeys: [] };
  const a = isPlainObject(prev) ? prev : {};
  const b = isPlainObject(next) ? next : {};
  walk(a, b, '', out);
  out.addedKeys.sort();
  out.removedKeys.sort();
  out.changedKeys.sort();
  return out;
}

export function isEmptyDiff(diff: PluginDiff): boolean {
  return (
    diff.addedKeys.length === 0 &&
    diff.removedKeys.length === 0 &&
    diff.changedKeys.length === 0
  );
}
