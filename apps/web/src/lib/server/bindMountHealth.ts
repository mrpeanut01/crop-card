/**
 * Bind-mount staleness detection.
 *
 * macOS Docker Desktop's VirtioFS layer occasionally pins a stale inode
 * for a source file after an editor save — the host sees the new
 * content, the container keeps serving the old. When this happens to a
 * file that everything else imports (e.g. `lib/plugins/schemas.ts`),
 * Vite's SSR module loader caches the failed evaluation, and every
 * subsequent request that touches the import chain returns a generic
 * 500. There's no app-level fix because the OS is lying to Node about
 * the file's contents; what we CAN do is detect the symptom and
 * surface a clear, actionable error instead of a generic 500.
 *
 * Detection signals:
 *   1. `schemas.ts` is suspiciously small (<2KB suggests we're seeing
 *      the back-compat shim from another worktree, not the real file).
 *   2. An import error mentioning a path under `apps/web/src/` — that's
 *      the pattern Vite emits when SSR module evaluation fails.
 *
 * Recovery is OS-level (full container recreate). We surface the exact
 * command and give a "I've restarted, retry" button in the UI.
 */

import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// from lib/server → lib/plugins/schemas.ts
const SCHEMAS_PATH = path.resolve(here, '../plugins/schemas.ts');

// The real schemas.ts is ~40KB. A back-compat shim is ~350 bytes. A
// 2KB floor reliably catches the shim while leaving room for the file
// to evolve.
const EXPECTED_SCHEMA_MIN_BYTES = 2048;

export interface MountDiagnostic {
  schemasPath: string;
  schemasSize: number | null;
  schemasMtime: number | null;
  schemasLooksTruncated: boolean;
  expectedMinBytes: number;
}

export interface MountRecovery {
  command: string;
  why: string;
  altNote: string;
}

export const STALE_BIND_MOUNT_RECOVERY: MountRecovery = {
  command:
    'docker compose -f infra/docker-compose.yml down && docker compose -f infra/docker-compose.yml up -d',
  why: "macOS Docker Desktop's VirtioFS layer occasionally pins a stale inode after editor saves. A full container recreation drops the inode cache.",
  altNote:
    '`docker compose restart` is NOT enough — that just bounces the Node process and keeps the same mount. You need `down` + `up -d`.'
};

export function diagnoseBindMount(): MountDiagnostic {
  try {
    const st = statSync(SCHEMAS_PATH);
    return {
      schemasPath: SCHEMAS_PATH,
      schemasSize: st.size,
      schemasMtime: st.mtimeMs,
      schemasLooksTruncated: st.size < EXPECTED_SCHEMA_MIN_BYTES,
      expectedMinBytes: EXPECTED_SCHEMA_MIN_BYTES
    };
  } catch {
    return {
      schemasPath: SCHEMAS_PATH,
      schemasSize: null,
      schemasMtime: null,
      schemasLooksTruncated: true,
      expectedMinBytes: EXPECTED_SCHEMA_MIN_BYTES
    };
  }
}

/** True when an error looks like a Vite SSR module-not-found triggered
 *  by stale bind-mount inodes (rather than a genuine missing
 *  dependency). The hallmark: "Cannot find module 'X' imported from
 *  '/.../apps/web/src/...'" — the importer is one of our source paths,
 *  which means the file IS on disk but Vite is reading stale bytes. */
export function isStaleBindMountError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? '';
  if (!/Cannot find module/.test(msg)) return false;
  return /imported from\s+['"][^'"]*\/apps\/web\/src\//.test(msg);
}
