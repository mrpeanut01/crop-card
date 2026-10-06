import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import { getRegistry } from '$lib/server/registry';
import { toSprayProduct } from '$lib/server/cardSnapshot';
import { RULES_VERSION } from '$lib/safety/version';
import { buildSprayCard, sprayCardId } from '$lib/cards/build/spray';
import { sampleGearSnapshot } from '$lib/cards/build/fixturesGear';
import type { CardModel, CardPrintLayout } from '$lib/cards/model';
import type { SnapshotEquipment, SnapshotSprayProduct } from '$lib/cards/snapshot';
import type { PageServerLoad } from './$types';

const LAYOUTS: CardPrintLayout[] = ['index-4x6', 'index-3x5', 'letter-4up'];

// Every shipped spray product as a printed Spray Card on one paper, with the
// sprayer's last load from `?last=` (#581). The print-fit e2e test measures
// these for clipped content. Same gate as /_dev/cards.
export const load: PageServerLoad = async ({ locals, url }) => {
  const enabled = dev || locals.user?.isSuperadmin || process.env.ENABLE_DEV_ROUTES === '1';
  if (!enabled) throw error(404, 'Not found');
  const asked = url.searchParams.get('layout') as CardPrintLayout | null;
  const layout = asked && LAYOUTS.includes(asked) ? asked : 'index-4x6';
  const last = url.searchParams.get('last') || null;
  const only = url.searchParams.get('only');
  const registry = await getRegistry();
  const products = registry
    .all()
    .map((r) => toSprayProduct(r.plugin))
    .filter((p): p is SnapshotSprayProduct => !!p && (!only || p.pluginId === only));
  const sprayer: SnapshotEquipment = {
    id: 'eq_boom',
    type: 'sprayer',
    label: '50-gal boom',
    tankGal: 50,
    state: {
      calibratedGpa: 15,
      calibrationDate: Date.parse('2026-04-02T12:00:00Z'),
      lastDeconAt: null,
      lastUsedAt: last ? Date.parse('2026-09-01T12:00:00Z') : null,
      lastChemistryClass: last,
      winterizedAt: null
    }
  };
  const snapshot = sampleGearSnapshot({
    rulesVersion: RULES_VERSION,
    origin: 'https://app.cropcard.io',
    equipment: [sprayer],
    sprayProducts: Object.fromEntries(products.map((p) => [p.pluginId, p]))
  });
  const cards: CardModel[] = products
    .map((p) => buildSprayCard(snapshot, sprayCardId(sprayer.id, p.pluginId)))
    .filter((c): c is CardModel => !!c);
  return { cards, layout, origin: snapshot.origin, now: snapshot.generatedAt };
};
