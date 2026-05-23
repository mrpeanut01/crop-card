import { error, type Actions, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listStockItems, getStockItem, updateStockItem } from '$lib/db/stock';
import { getTaxonomyTerm } from '$lib/db/taxonomy';
import { requireOwner, requireUser } from '$lib/server/auth';
import { getPlatesCatalog } from '$lib/planterPlate/catalog';
import { inferSeedTypeFromName } from '$lib/planterPlate/match';
import type { PlateSeedType } from '$lib/planterPlate/types';
import { getSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';

export const load: PageServerLoad = (event) => {
  requireUser(event);
  // Phase 21 (B-29): planter-plate selector off by default for new owners.
  // Opt-in via Settings → Display ("Show planter setup"). Redirect deep-
  // links to /tools so the index renders without the now-hidden card.
  if (getSetting(SETTINGS_KEYS.displayPlanterSetup) !== 'true') {
    throw redirect(303, '/tools');
  }
  const stockId = event.url.searchParams.get('stockId') ?? null;

  // Seed items the Owner can save to (typed as 'seed' only).
  const allItems = listStockItems().filter((i) => i.category === 'seed');
  const seedItems = allItems.map((i) => ({ id: i.id, displayName: i.displayName }));

  // Optional pre-fill from a specific stock item via ?stockId=...
  let contextItem: {
    id: string;
    displayName: string;
    metadataJson?: string;
    typeName: string | null;
    inferredSeedType: PlateSeedType | null;
  } | null = null;
  if (stockId) {
    const item = getStockItem(stockId);
    if (item && item.category === 'seed') {
      const typeName = item.typeId ? (getTaxonomyTerm(item.typeId)?.name ?? null) : null;
      contextItem = {
        id: item.id,
        displayName: item.displayName,
        metadataJson: item.metadataJson,
        typeName,
        inferredSeedType: inferSeedTypeFromName(typeName)
      };
    }
  }

  return {
    plates: getPlatesCatalog(),
    seedItems,
    contextItem,
    canEdit: event.locals.user?.role === 'owner'
  };
};

export const actions: Actions = {
  saveToStock: async (event) => {
    requireOwner(event);
    const fd = await event.request.formData();
    const stockId = String(fd.get('stockId') ?? '').trim();
    if (!stockId) return fail(400, { error: 'stockId required' });
    const item = getStockItem(stockId);
    if (!item) throw error(404, `unknown stock item: ${stockId}`);
    if (item.category !== 'seed') return fail(400, { error: 'target item is not a seed' });

    const plateNumber = String(fd.get('plateNumber') ?? '').trim();
    if (!plateNumber) return fail(400, { error: 'plateNumber required' });

    const num = (k: string): number | undefined => {
      const v = fd.get(k);
      if (v === null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const str = (k: string): string | undefined => {
      const v = fd.get(k);
      if (v === null) return undefined;
      const s = String(v).trim();
      return s.length ? s : undefined;
    };

    const planterPlateConfig = {
      plateNumber,
      series: str('series') ?? '',
      brand: str('brand') ?? '',
      cells: num('cells'),
      color: str('color') ?? '',
      dimensions: str('dimensions') ?? '',
      L: num('L'),
      D: num('D'),
      T: num('T'),
      shape: str('shape') ?? '',
      seedType: str('seedType') ?? '',
      gradeSize: str('gradeSize') ?? '',
      seedDimensions: {
        L: num('seedL'),
        D: num('seedD'),
        T: num('seedT'),
        tolerance: num('tolerance'),
        unit: (str('dimUnit') === 'mm' ? 'mm' : '64ths') as 'mm' | '64ths',
        displayL: num('seedLDisplay'),
        displayD: num('seedDDisplay'),
        displayT: num('seedTDisplay'),
        displayTolerance: num('toleranceDisplay')
      },
      density: {
        inRowInches: num('inRowInches'),
        rowInches: num('rowInches'),
        plantsPerAcre: num('plantsPerAcre')
      },
      source: 'manual' as const,
      savedAt: new Date().toISOString()
    };

    let existing: Record<string, unknown> = {};
    if (item.metadataJson) {
      try {
        const parsed = JSON.parse(item.metadataJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        existing = {};
      }
    }
    const merged = { ...existing, planterPlateConfig };
    updateStockItem(stockId, { metadataJson: JSON.stringify(merged) });

    throw redirect(303, `/stock/${encodeURIComponent(stockId)}`);
  }
};
