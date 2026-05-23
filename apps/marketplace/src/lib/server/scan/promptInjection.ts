/**
 * Heuristic prompt-injection sweep. Plugin fields like `notes` and
 * `displayName` flow into Claude prompts (label scan, web-search lookup,
 * input planner). A malicious plugin author could try to slip instructions
 * past the consuming app's prompt boundaries.
 *
 * Unlike the XSS sweep (which rejects), this one FLAGS the upload — the
 * version still persists, but with `review_status = 'pending_review'`
 * regardless of the calling credential's trust tier. Admin can approve
 * after eyeballing.
 *
 * False positives are acceptable here; false negatives are not.
 */

export interface PromptInjectionFlag {
  pattern: string;
  path: string;
  excerpt: string;
}

const PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: 'ignore_previous', rx: /\bignore\s+(?:all\s+)?(?:previous|prior|the\s+above|above)\b/i },
  { name: 'system_role_marker', rx: /\b(?:system|assistant|developer)\s*[:>]/i },
  { name: 'chatml_marker', rx: /<\|im_(?:start|end)\|>/i },
  { name: 'anthropic_marker', rx: /\\n\\n(?:Human|Assistant):/ },
  { name: 'role_json', rx: /"role"\s*:\s*"(?:system|assistant|user)"/i },
  { name: 'new_instructions', rx: /\b(?:from now on|new\s+(?:instructions?|rules?)|forget\s+everything)\b/i },
  { name: 'exfil_request', rx: /\b(?:print|display|reveal|show)\s+(?:your|the|all)\s+(?:system|prompt|instructions?)\b/i },
  { name: 'long_base64', rx: /\b[A-Za-z0-9+/]{200,}={0,2}\b/ }
];

export function promptInjectionScan(value: unknown): PromptInjectionFlag[] {
  const out: PromptInjectionFlag[] = [];
  walk(value, '$', out);
  return out;
}

function walk(v: unknown, path: string, out: PromptInjectionFlag[]): void {
  if (typeof v === 'string') {
    for (const p of PATTERNS) {
      const m = v.match(p.rx);
      if (m) {
        const start = Math.max(0, (m.index ?? 0) - 10);
        const end = Math.min(v.length, (m.index ?? 0) + m[0].length + 20);
        out.push({ pattern: p.name, path, excerpt: v.slice(start, end) });
      }
    }
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`, out);
    return;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      walk((v as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
  }
}
