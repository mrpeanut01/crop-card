import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { scanUpload, ScannerUnavailableError, MAX_PAYLOAD_BYTES } from '$lib/server/scan';

/**
 * Dry-run scan. Returns the verdict + per-stage detail without persisting.
 * Useful for clients that want to surface "this plugin will be approved /
 * quarantined / rejected" before committing.
 */
export const POST: RequestHandler = async (event) => {
  requireApp(event);
  const contentLength = Number(event.request.headers.get('content-length') ?? '0');
  if (contentLength && contentLength > MAX_PAYLOAD_BYTES) {
    throw error(400, `payload too large: ${contentLength} > ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const bytes = Buffer.from(await event.request.arrayBuffer());
  try {
    const scan = await scanUpload(bytes);
    return json({
      verdict: scan.verdict,
      rejectReasons: scan.rejectReasons,
      pluginId: scan.plugin?.pluginId,
      version: scan.plugin?.version,
      hash: scan.hash,
      scanResults: scan.scanResults
    });
  } catch (err) {
    if (err instanceof ScannerUnavailableError) {
      throw error(503, `virus scanner unavailable: ${err.message}`);
    }
    throw err;
  }
};
