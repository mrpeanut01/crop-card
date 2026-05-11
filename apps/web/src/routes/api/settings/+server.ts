/**
 * GET  /api/settings        — owner-only; returns redacted "set" booleans for secret keys
 *                              and the actual values for non-secret keys
 * POST /api/settings        — owner-only; upsert a setting key/value
 * DELETE /api/settings?key= — owner-only; remove a setting
 */
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getSetting, setSetting, deleteSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';

const SECRET_KEYS = ['anthropic_api_key'] as const;
const PLAIN_KEYS = [
  SETTINGS_KEYS.aiMonthlyUsdCap,
  SETTINGS_KEYS.aiDailyCallQuota,
  SETTINGS_KEYS.farmLatLon,
  SETTINGS_KEYS.lastFrost,
  SETTINGS_KEYS.firstFrost,
  SETTINGS_KEYS.showShadeMarkers
] as const;
const ALLOWED_KEYS = [...SECRET_KEYS, ...PLAIN_KEYS] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

const mmDdRe = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])$/;

const quotaSchema = z.object({
  suggest: z.number().int().min(0).max(1000),
  succession: z.number().int().min(0).max(1000),
  optimize: z.number().int().min(0).max(1000),
  allocate: z.number().int().min(0).max(1000)
});

const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180)
});

function validateAndSerialize(key: SettingKey, value: unknown): string {
  if (key === 'anthropic_api_key') {
    const s = z.string().min(1).max(500).parse(value);
    return s.trim();
  }
  if (key === SETTINGS_KEYS.aiMonthlyUsdCap) {
    const n = z.number().min(0).max(10_000).parse(value);
    return String(n);
  }
  if (key === SETTINGS_KEYS.aiDailyCallQuota) {
    const v = quotaSchema.parse(value);
    return JSON.stringify(v);
  }
  if (key === SETTINGS_KEYS.farmLatLon) {
    const v = latLonSchema.parse(value);
    return JSON.stringify(v);
  }
  if (key === SETTINGS_KEYS.lastFrost || key === SETTINGS_KEYS.firstFrost) {
    const s = z.string().regex(mmDdRe, 'expected MM-DD').parse(value);
    return s;
  }
  if (key === SETTINGS_KEYS.showShadeMarkers) {
    const b = z.boolean().parse(value);
    return b ? 'true' : 'false';
  }
  throw new Error(`unsupported key: ${key}`);
}

export async function GET(event) {
  requireOwner(event);
  const result: Record<string, unknown> = {};
  for (const key of SECRET_KEYS) {
    result[key] = !!getSetting(key);
  }
  for (const key of PLAIN_KEYS) {
    result[key] = getSetting(key) ?? null;
  }
  return json({ settings: result });
}

export async function POST(event) {
  requireOwner(event);
  const body = (await event.request.json().catch(() => null)) as
    | { key?: string; value?: unknown }
    | null;
  if (!body || typeof body.key !== 'string' || !ALLOWED_KEYS.includes(body.key as SettingKey)) {
    error(400, 'invalid key');
  }
  const key = body.key as SettingKey;
  let serialized: string;
  try {
    serialized = validateAndSerialize(key, body.value);
  } catch (e) {
    error(400, e instanceof Error ? e.message : 'invalid value');
  }
  setSetting(key, serialized);
  return json({ ok: true });
}

export async function DELETE(event) {
  requireOwner(event);
  const key = event.url.searchParams.get('key') as SettingKey | null;
  if (!key || !ALLOWED_KEYS.includes(key)) error(400, 'invalid key');
  deleteSetting(key);
  return json({ ok: true });
}
