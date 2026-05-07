/**
 * POST /api/spray/record
 *
 * The persistence-side gate (FR-09, NFR-07). Re-runs the safety kernel
 * server-side regardless of the client's prior call, then writes the event
 * to spray_events. Updates sprayer state so the cross-contamination gate
 * is correct on the next spray.
 *
 * Refuses to commit if the kernel says ok=false. Helper-role tampering or
 * client-side bypass cannot reach the database.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { ensureSystemUser } from '$lib/db/users';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import {
  evaluateSpray,
  RULES_VERSION,
  type ChemistryClass,
  type HerbicideProduct,
  type SprayContext
} from '$lib/safety';
import { currentUser } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { getSprayer, recordSpray } from '$lib/server/sprayers';

const cropStageInput = z.object({
  cropPluginId: z.string().min(1),
  cropFamily: z.enum(CROP_FAMILIES).optional(),
  heightInches: z.number().nonnegative().optional()
});

const requestSchema = z.object({
  blockId: z.string().min(1),
  occurredAt: z.number().int().optional(),
  blockCrops: z.object({
    primary: cropStageInput,
    coPlanted: z.array(cropStageInput).optional()
  }),
  productPluginIds: z.array(z.string().min(1)).min(1),
  sprayer: z.object({ id: z.string().min(1) }),
  conditions: z.object({
    windMph: z.number().nonnegative(),
    tempF: z.number(),
    rainForecastMmNext24h: z.number().nonnegative()
  }),
  customRateOverride: z.boolean().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const registry = await getRegistry();
  const occurredAt = parsed.data.occurredAt ?? Date.now();

  const products: HerbicideProduct[] = [];
  const fullProducts: HerbicidePlugin[] = [];
  const pluginHashes: Record<string, string> = {};
  const missing: string[] = [];

  for (const id of parsed.data.productPluginIds) {
    const record = registry.get(id);
    if (!record || record.plugin.type !== 'herbicide') {
      missing.push(id);
      continue;
    }
    fullProducts.push(record.plugin);
    products.push({
      pluginId: record.plugin.pluginId,
      displayName: record.plugin.displayName,
      activeIngredients: record.plugin.activeIngredients,
      labelClaims: record.plugin.labelClaims
    });
    pluginHashes[id] = record.hash;
  }

  if (missing.length > 0) {
    return json({ error: 'unknown herbicide pluginIds', missing }, { status: 404 });
  }

  const stored = getSprayer(parsed.data.sprayer.id);
  if (!stored) {
    return json({ error: `unknown sprayer: ${parsed.data.sprayer.id}` }, { status: 404 });
  }

  // Helper-role gate (FR-09 / NFR-09): only owners may apply a custom rate.
  const auth = currentUser(event);
  if (parsed.data.customRateOverride && auth?.role !== 'owner') {
    return json(
      { error: 'custom rate override requires owner role' },
      { status: 403 }
    );
  }

  const enrichCrop = (c: z.infer<typeof cropStageInput>) => ({
    ...c,
    cropFamily: c.cropFamily ?? registry.cropFamilyOf(c.cropPluginId)
  });

  const ctx: SprayContext = {
    occurredAt,
    products,
    crop: enrichCrop(parsed.data.blockCrops.primary),
    coPlantedCrops: parsed.data.blockCrops.coPlanted?.map(enrichCrop),
    sprayer: {
      id: stored.id,
      lastChemistryClass: stored.lastChemistryClass,
      lastSprayedAt: stored.lastSprayedAt,
      lastDeconAt: stored.lastDeconAt
    },
    conditions: parsed.data.conditions
  };

  const kernel = evaluateSpray(ctx);
  if (!kernel.ok) {
    return json(
      {
        error: 'kernel rejected spray; refusing to persist',
        ...kernel,
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  // Use the signed-in user as performer; fall back to system if unauthenticated.
  const performer = auth ?? (await ensureSystemUser());

  // Persist event (`event` is the request context; use a separate name).
  const persisted = insertSprayEvent({
    blockId: parsed.data.blockId,
    sprayerId: stored.id,
    performedById: performer.id,
    occurredAt,
    products: fullProducts.map((p) => ({
      pluginId: p.pluginId,
      chemistryClasses: Array.from(new Set(p.activeIngredients.map((ai) => ai.chemistryClass))),
      rate: p.ratePerAcre
    })),
    conditions: parsed.data.conditions,
    rulesVersion: RULES_VERSION,
    pluginHashes,
    customRateOverride: parsed.data.customRateOverride ?? false,
    notes: parsed.data.notes
  });

  // Update sprayer chemistry history (most-aggressive class wins on the kernel's
  // future evaluations; we record the union below as a sequence of updates).
  const newClasses: ChemistryClass[] = Array.from(
    new Set(fullProducts.flatMap((p) => p.activeIngredients.map((ai) => ai.chemistryClass)))
  );
  for (const cls of newClasses) recordSpray(stored.id, cls, occurredAt);

  return json({ event: persisted, ruleVersion: RULES_VERSION });
};
