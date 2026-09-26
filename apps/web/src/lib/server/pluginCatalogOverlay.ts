import { isVersionAhead, type PluginVersionRow } from '$lib/db/pluginVersions';

/** Rows that only mirror the files shipped in the image. */
function mirrorsDisk(reason: string | undefined): boolean {
  return reason === 'initial-import' || !!reason?.startsWith('rescan:');
}

/**
 * Shared-library edits made at runtime (superadmin upload, rollback, retire,
 * uninstall) are written to `plugin_versions` and to the container's plugin
 * directory, which is rebuilt from the image on every restart. This replays
 * the database side on top of the image so those edits survive:
 *   - a retired or uninstalled current row hides the plugin;
 *   - an uploaded or rolled-back current row replaces the image's copy when
 *     its version is ahead of it (a later image that bumps the plugin wins),
 *     or when the image does not ship that plugin at all.
 * Rows seeded from, or rescanned against, the image's files are ignored.
 * Payloads still go through schema validation and the bypass check when the
 * overlay is registered (Invariant 2).
 */
export function runtimeCatalogOverlay(
  rows: readonly PluginVersionRow[],
  diskVersions: ReadonlyMap<string, string>
): { hidden: string[]; payloads: unknown[] } {
  const hidden: string[] = [];
  const payloads: unknown[] = [];
  for (const row of rows) {
    if (row.supersededAt) continue;
    if (row.retiredAt) {
      hidden.push(row.pluginId);
      continue;
    }
    if (mirrorsDisk(row.changeReason) || !row.payloadJson) continue;
    const disk = diskVersions.get(row.pluginId);
    if (disk !== undefined && !isVersionAhead(row.version, disk)) continue;
    try {
      payloads.push(JSON.parse(row.payloadJson));
    } catch {
      continue;
    }
  }
  return { hidden, payloads };
}
