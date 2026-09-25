/**
 * POST /api/plugins/upload
 *
 * Accepts a JSON plugin payload (raw body or { plugin: {...} }) and
 * validates it via Zod + the bypass check. By default (owner) it is saved
 * to the active Owner's `plugin_overrides` and replaces the shared plugin
 * for that farm only. `?scope=global` (superadmin, interactive session)
 * writes it to the shared library instead: plugins/{type}s/ + a
 * `plugin_versions` row + registry reload.
 *
 * Phase 22 — response now includes `version`, `hash`, `noChange`, `bumped`,
 * `priorVersion`, and the key-level `diff` so the UI can show a "saved as
 * v1.2.0 (auto-bumped from 1.0.0)" toast and a diff summary chip.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireSuperadmin } from '$lib/server/auth';
import { PluginAuthorError, writeOwnerPlugin, writePluginFile } from '$lib/server/pluginFiles';

export const POST: RequestHandler = async (event) => {
  const global = event.url.searchParams.get('scope') === 'global';
  const session = global ? requireSuperadmin(event) : requireOwner(event);
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
    const result = global
      ? await writePluginFile(candidate, { changedByUserId: session.id, changeReason })
      : await writeOwnerPlugin(candidate);
    return json(result, { status: result.noChange ? 200 : 201 });
  } catch (e) {
    if (e instanceof PluginAuthorError) {
      return json({ error: e.message, code: e.code, issues: e.issues }, { status: 400 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
