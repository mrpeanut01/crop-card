/**
 * Injection-pattern sweep. Recursively scans every string value in the
 * candidate plugin for XSS-like content. Match → reject upload (400).
 *
 * Plugin fields like `displayName`, `notes`, and `productPageUrl` flow
 * into the CropCard UI; an unescaped <script> tag would execute in the
 * consuming app's DOM (even though Svelte escapes by default, plugin
 * authors may opt into {@html} for product descriptions someday).
 * Treat plugins as untrusted at this boundary.
 */

export interface InjectionMatch {
  pattern: string;
  path: string;
  excerpt: string;
}

const PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: 'script_tag', rx: /<script\b/i },
  { name: 'iframe_tag', rx: /<iframe\b/i },
  { name: 'object_tag', rx: /<object\b/i },
  { name: 'embed_tag', rx: /<embed\b/i },
  { name: 'js_url', rx: /javascript:/i },
  { name: 'vbs_url', rx: /vbscript:/i },
  { name: 'data_html', rx: /data:text\/html/i },
  { name: 'on_event', rx: /\bon(?:error|click|load|mouse\w*|focus|blur|submit|change|key\w*)\s*=/i },
  { name: 'css_expression', rx: /expression\s*\(/i },
  { name: 'svg_script', rx: /<svg[^>]*on/i }
];

export function injectionScan(value: unknown): InjectionMatch[] {
  const out: InjectionMatch[] = [];
  walk(value, '$', out);
  return out;
}

function walk(v: unknown, path: string, out: InjectionMatch[]): void {
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
