import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { listApprovedPlugins } from '$lib/server/plugins';
import { scanUpload, ScannerUnavailableError, MAX_PAYLOAD_BYTES } from '$lib/server/scan';
import { persistVersion } from '$lib/server/persist';
import { audit } from '$lib/server/audit';

export const GET: RequestHandler = async (event) => {
  requireApp(event);
  const type = event.url.searchParams.get('type') ?? undefined;
  const q = event.url.searchParams.get('q') ?? undefined;
  const cursor = event.url.searchParams.get('cursor') ?? undefined;
  const limitStr = event.url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitStr) {
    const n = Number(limitStr);
    if (!Number.isFinite(n) || n < 1) throw error(400, 'limit must be a positive integer');
    limit = Math.min(n, 200);
  }
  const result = listApprovedPlugins({ type, q, cursor, limit });
  return json(result);
};

/** Upload a new plugin version. Runs the full scan pipeline (Sub-task E)
 *  then persists. Trusted credentials publish immediately; community
 *  credentials and prompt-injection-flagged uploads land in pending_review. */
export const POST: RequestHandler = async (event) => {
  const cred = requireApp(event);
  const contentLength = Number(event.request.headers.get('content-length') ?? '0');
  if (contentLength && contentLength > MAX_PAYLOAD_BYTES) {
    audit({
      actorType: 'app',
      actorId: cred.id,
      action: 'plugin.uploaded.rejected',
      payload: { reason: `content-length ${contentLength} > ${MAX_PAYLOAD_BYTES}` }
    });
    throw error(400, `payload too large: ${contentLength} > ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const bytes = Buffer.from(await event.request.arrayBuffer());
  let scan;
  try {
    scan = await scanUpload(bytes);
  } catch (err) {
    if (err instanceof ScannerUnavailableError) {
      audit({
        actorType: 'app',
        actorId: cred.id,
        action: 'plugin.uploaded.scanner_unavailable',
        payload: { error: err.message }
      });
      throw error(503, `virus scanner unavailable: ${err.message}`);
    }
    throw err;
  }

  if (scan.verdict === 'reject') {
    audit({
      actorType: 'app',
      actorId: cred.id,
      action: 'plugin.uploaded.rejected',
      payload: { reasons: scan.rejectReasons, scanResults: scan.scanResults }
    });
    throw error(400, scan.rejectReasons[0] ?? 'rejected');
  }

  if (!scan.plugin || !scan.hash) {
    // Defense in depth — verdict='pass' should always have these set.
    throw error(500, 'scan succeeded but produced no plugin payload');
  }

  const outcome = persistVersion({
    scan: { ...scan, plugin: scan.plugin, hash: scan.hash },
    credential: cred
  });
  const status = outcome.status === 'noChange' ? 200 : 201;
  return json(outcome, { status });
};
