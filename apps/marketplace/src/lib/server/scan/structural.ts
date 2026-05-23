/**
 * JSON structural sanity check. Runs after size cap, before schema/bypass.
 *
 * Catches:
 *   - excessive nesting (depth bombs)
 *   - too many keys per object (hash collision DoS)
 *   - over-long string values (a 100 KB displayName would render poorly + ruin UI)
 *   - NULL bytes / non-printable control chars in any string (smuggling)
 *
 * Strings shorter than 10 KB, depth ≤ 8, ≤ 200 keys per object are all
 * comfortable headroom over the largest legitimate plugin we've seen
 * (~30 KB total, depth 5, ~40 keys at deepest object).
 */

export interface StructuralCaps {
  maxDepth: number;
  maxKeysPerObject: number;
  maxStringLength: number;
}

export const DEFAULT_CAPS: StructuralCaps = {
  maxDepth: 8,
  maxKeysPerObject: 200,
  maxStringLength: 10_000
};

export interface StructuralIssue {
  kind: 'depth' | 'keys' | 'string_length' | 'control_char' | 'null_byte';
  path: string;
  detail?: string;
}

export function structuralScan(value: unknown, caps: StructuralCaps = DEFAULT_CAPS): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  walk(value, '$', 0, issues, caps);
  return issues;
}

function walk(
  v: unknown,
  path: string,
  depth: number,
  out: StructuralIssue[],
  caps: StructuralCaps
): void {
  if (depth > caps.maxDepth) {
    out.push({ kind: 'depth', path, detail: `> ${caps.maxDepth}` });
    return;
  }
  if (typeof v === 'string') {
    if (v.length > caps.maxStringLength) {
      out.push({ kind: 'string_length', path, detail: `${v.length} > ${caps.maxStringLength}` });
    }
    if (v.includes('\x00')) {
      out.push({ kind: 'null_byte', path });
    }
    // Reject ASCII control chars except common whitespace.
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
        out.push({ kind: 'control_char', path, detail: `char ${c} at offset ${i}` });
        return;
      }
    }
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      walk(v[i], `${path}[${i}]`, depth + 1, out, caps);
    }
    return;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length > caps.maxKeysPerObject) {
      out.push({
        kind: 'keys',
        path,
        detail: `${keys.length} > ${caps.maxKeysPerObject}`
      });
    }
    for (const k of keys) {
      walk((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1, out, caps);
    }
  }
}
