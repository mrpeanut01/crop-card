import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { buildPlanInput } from '$lib/layout/buildInput';
import { planLayout } from '$lib/layout/engine';

const seedSchema = z.object({
  stockItemId: z.string().min(1),
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160),
  quantityPlants: z.number().positive(),
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

  return json(result);
};
