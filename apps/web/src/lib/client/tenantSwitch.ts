/**
 * Tenant-switch client-side cache reset (Phase 18d/18h).
 *
 * Called from the top-nav Owner chip after a successful POST to
 * /api/session/switch-owner. Clears the Workbox runtime cache buckets
 * that are namespaced per-tenant so the new Owner's responses don't
 * collide with the old Owner's. The Dexie queue is intentionally
 * preserved — a helper who recorded offline at Farm A then switches
 * to Farm B mid-drive should not lose A's records; they drain when A
 * is active again.
 *
 * Best-effort: failures are swallowed so a stale cache doesn't block
 * the switch. The server is the source of truth.
 */

const TENANT_NAMESPACED_CACHES = ['cropcard-plugins', 'cropcard-sprayers'];

export async function resetTenantCaches(newOwnerId: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => TENANT_NAMESPACED_CACHES.some((root) => n.startsWith(root)))
        .map((n) => caches.delete(n))
    );
  } catch {
    // service worker not registered yet → nothing to clean.
  }
  // Force a refresh of any module that cached the previous owner id at
  // module scope.
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('cropcard.activeOwnerId', newOwnerId);
    } catch {
      /* private mode → skip */
    }
  }
}
