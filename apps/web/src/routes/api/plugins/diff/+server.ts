/**
 * POST /api/plugins/diff
 *
 * Preview the diff between a candidate plugin payload and the current
 * version on disk. Drives the upload form's "pre-flight" diff chip + the
 * version-bump suggestion ("auto-bump to 1.0.1; supply 1.1.0 yourself to
 * mark a minor change").
 *
 * Does NOT validate via Zod or run the bypass check — the diff is purely
 * structural so authors can preview a draft even when it still has
 * validation errors. Use POST /api/plugins/upload to commit, which runs
 * the full validation pipeline.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { diffPlugins } from '$lib/plugins/diff';
import { bumpPatch, currentVersionOf } from '$lib/db/pluginVersions';

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const candidate =
    body && typeof body === 'object' && 'plugin' in body
      ? (body as { plugin: unknown }).plugin
      : body;
  if (!candidate || typeof candidate !== 'object') {
    return json({ error: 'candidate is required' }, { status: 400 });
  }
  const pluginId = (candidate as { pluginId?: unknown }).pluginId;
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    return json({ error: 'candidate.pluginId is required' }, { status: 400 });
  }

  const prior = currentVersionOf(pluginId);
  let priorPayload: unknown = null;
  if (prior) {
    try {
      priorPayload = JSON.parse(prior.payloadJson);
    } catch {
      priorPayload = null;
    }
  }
  const diff = diffPlugins(priorPayload, candidate);
  const candidateVersion =
    typeof (candidate as { version?: unknown }).version === 'string'
      ? (candidate as { version: string }).version
      : '';

  return json({
    pluginId,
    existing: prior
      ? { version: prior.version, hash: prior.hash, retiredAt: prior.retiredAt ?? null }
      : null,
    candidate: { version: candidateVersion },
    diff,
    suggestedVersion: prior ? bumpPatch(prior.version) : '1.0.0',
    isNew: !prior
  });
};
