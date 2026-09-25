/**
 * Secondary custom hostnames (the bare zone apex, www) are bound to the app
 * only so they can send visitors to the canonical ORIGIN. The list comes from
 * REDIRECT_HOSTS, which infra sets once ORIGIN itself serves valid TLS.
 */
export function parseRedirectHosts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function hostRedirectTarget(input: {
  host: string | null;
  url: URL;
  redirectHosts: Set<string>;
  origin: string | undefined;
}): string | null {
  if (!input.host || !input.origin || input.redirectHosts.size === 0) return null;
  const hostname = input.host.toLowerCase().replace(/:\d+$/, '');
  if (!input.redirectHosts.has(hostname)) return null;
  let canonical: URL;
  try {
    canonical = new URL(input.origin);
  } catch {
    return null;
  }
  if (canonical.hostname === hostname) return null;
  return new URL(input.url.pathname + input.url.search, canonical).toString();
}
