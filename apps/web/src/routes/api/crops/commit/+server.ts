import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { buildPlanInput } from '$lib/layout/buildInput';
import { planLayout } from '$lib/layout/engine';
import { createPlanned, type Crop } from '$lib/db/crops';

const seedSchema = z.object({
  stockItemId: z.string().min(1),
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160),
  quantityPlants: z.number().positive(),
  quantityValue: z.number().nonnegative().optional(),
  quantityUnit: z.string().min(1).max(16).optional(),
  sunRequirement: z.enum(['full', 'partial', 'shade']).optional()
});

const bodySchema = z.object({
  seeds: z.array(seedSchema)
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const registry = await getRegistry();
  const input = buildPlanInput(registry, parsed.data.seeds);
  const result = planLayout(input);

  // Index seeds by stockItemId for unit/qty lookup during commit.
  const seedsById = new Map(parsed.data.seeds.map((s) => [s.stockItemId, s]));

  const created: Crop[] = [];
  for (const a of result.assignments) {
    const seed = seedsById.get(a.stockItemId);
    const totalPlants =
      result.assignments
        .filter((x) => x.stockItemId === a.stockItemId)
        .reduce((s, x) => s + x.plants, 0) || 1;
    const portion = a.plants / totalPlants;
    const portionedQuantity =
      seed?.quantityValue !== undefined ? seed.quantityValue * portion : undefined;
    const crop = createPlanned({
      blockId: a.blockId,
      cropPluginId: a.cropPluginId,
      varietyDisplayName: a.varietyDisplayName,
      quantityPlanted: portionedQuantity,
      quantityUnit: seed?.quantityUnit
    });
    created.push(crop);
  }

  return json(
    {
      created,
      unplaced: result.unplaced,
      diagnostics: result.diagnostics
    },
    { status: 201 }
  );
};
