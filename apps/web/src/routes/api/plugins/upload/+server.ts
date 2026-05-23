/**
 * POST /api/plugins/upload
 *
 * Accepts a JSON plugin payload (raw body or { plugin: {...} }), validates
 * via Zod + the bypass check, writes it to plugins/{type}s/, appends a
 * `plugin_versions` row, and reloads the registry.
 *
 * Phase 22 — response now includes `version`, `hash`, `noChange`, `bumped`,
 * `priorVersion`, and the key-level `diff` so the UI can show a "saved as
 * v1.2.0 (auto-bumped from 1.0.0)" toast and a diff summary chip.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginAuthorError, writePluginFile } from '$lib/server/pluginFiles';

export const POST: RequestHandler = async (event) => {
  const session = requireOwner(event);
  const { request } = event;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const candidate =
    body && typeof body === 'object' && 'plugin' in body
      ? (body as { plugin: unknown }).plugin
      : body;
  const changeReason =
    body && typeof body === 'object' && 'changeReason' in body
      ? String((body as { changeReason: unknown }).changeReason ?? '')
      : undefined;
  try {
    const result = await writePluginFile(candidate, {
      changedByUserId: session.id,
      changeReason
    });
    return json(result, { status: result.noChange ? 200 : 201 });
  } catch (e) {
    if (e instanceof PluginAuthorError) {
      return json({ error: e.message, code: e.code, issues: e.issues }, { status: 400 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
