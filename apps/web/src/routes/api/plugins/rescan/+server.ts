/**
 * POST /api/plugins/rescan
 *
 * Owner-only bulk import. Walks plugins/{kind}s/, registers every valid
 * file, and appends a plugin_versions row for any pluginId whose
 * canonical hash isn't already current. Returns counts of added /
 * updated / unchanged / collapsed / failed.
 *
 * Also runs a pre-flight bind-mount staleness check. When the macOS
 * Docker VirtioFS layer pins a stale inode for a source file, the
 * symptom is a 500 with "Cannot find module" from inside our own src/
 * tree. We turn that into a structured 503 with the recovery command
 * so the UI can surface a clear path back instead of a generic crash.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { rescanPluginsFromDisk } from '$lib/server/pluginRescan';
import {
  diagnoseBindMount,
  isStaleBindMountError,
  STALE_BIND_MOUNT_RECOVERY
} from '$lib/server/bindMountHealth';

export const POST: RequestHandler = async (event) => {
  const session = requireOwner(event);

  const diag = diagnoseBindMount();
  if (diag.schemasLooksTruncated) {
    return json(
      {
        error: 'bind-mount-stale',
        message:
          'The dev container is seeing a truncated source file. Container needs a full recreate (down + up).',
        diagnostic: diag,
        recovery: STALE_BIND_MOUNT_RECOVERY
      },
      { status: 503 }
    );
  }

  try {
    const result = await rescanPluginsFromDisk({ changedByUserId: session.id });
    return json(result, { status: 200 });
  } catch (e) {
    if (isStaleBindMountError(e)) {
      return json(
        {
          error: 'bind-mount-stale',
          message:
            'An import in the source tree failed with a missing-module error — the container is out of sync with the host.',
          rawError: e instanceof Error ? e.message : String(e),
          diagnostic: diag,
          recovery: STALE_BIND_MOUNT_RECOVERY
        },
        { status: 503 }
      );
    }
    return json(
      { error: 'rescan-failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
};
