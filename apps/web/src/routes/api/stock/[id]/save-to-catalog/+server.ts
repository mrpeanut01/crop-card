/**
 * POST /api/stock/:id/save-to-catalog
 *
 * Owner-only. Builds a minimal crop plugin from the stock item's display
 * name, Type (mapped → cropFamily), and seed metadata, validates it, writes
 * it to plugins/crops/, and links the new pluginId back to the stock item.
 *
 * Used by the inventory form's "Save to crop catalog" prompt — lets users
 * grow the catalog from what they're actually buying so future similar
 * products auto-match.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, updateStockItem } from '$lib/db/stock';
import { getTaxonomyTerm } from '$lib/db/taxonomy';
import {
  PluginAuthorError,
  PluginShortensHoldError,
  writeOwnerPlugin
} from '$lib/server/pluginFiles';
import { AnimalRuleError } from '$lib/server/animals';
import { requireOwner } from '$lib/server/auth';
import { prefsFor } from '$lib/db/userProfile';
import { todayYmd } from '$lib/prefs';
import { t } from '$lib/i18n';

const TYPE_NAME_TO_CROP_FAMILY: Record<string, string> = {
  Corn: 'corn',
  Cucurbits: 'cucurbit',
  Legumes: 'legume',
  'Broadleaf companion': 'broadleaf-companion',
  Orchard: 'orchard',
  'Cover crop — grass': 'cover-grass',
  'Cover crop — legume': 'cover-legume',
  Solanaceae: 'solanaceae',
  Brassicas: 'brassica',
  Alliums: 'allium',
  'Leafy greens': 'leafy-green',
  'Root crops': 'root',
  Apiaceae: 'apiaceae',
  'Small fruit': 'small-fruit',
  Brambles: 'bramble',
  'Vine fruit': 'vine-fruit',
  'Stone fruit': 'stone-fruit',
  'Cereal grain': 'cereal-grain',
  Forage: 'forage',
  'Culinary herbs': 'herb-culinary'
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export const POST: RequestHandler = async (event) => {
  const owner = requireOwner(event);
  if (!event.params.id)
    return json({ error: t(event.locals?.locale, 'stockui.api.idRequired') }, { status: 400 });
  const item = getStockItem(event.params.id);
  if (!item)
    return json({ error: t(event.locals?.locale, 'stockui.api.unknownItem') }, { status: 404 });
  if (item.category !== 'seed') {
    return json({ error: t(event.locals?.locale, 'api.errB.catalogSeedOnly') }, { status: 400 });
  }
  if (item.pluginId) {
    return json({ error: t(event.locals?.locale, 'api.errB.alreadyLinked') }, { status: 400 });
  }
  if (!item.typeId) {
    return json({ error: t(event.locals?.locale, 'api.errB.setTypeFirst') }, { status: 400 });
  }
  const term = getTaxonomyTerm(item.typeId);
  if (!term)
    return json({ error: t(event.locals?.locale, 'api.errB.unknownTypeOnItem') }, { status: 400 });
  const cropFamily = TYPE_NAME_TO_CROP_FAMILY[term.name];
  if (!cropFamily) {
    return json(
      {
        error: t(event.locals?.locale, 'api.errB.typeNoFamily', { name: term.name })
      },
      { status: 400 }
    );
  }

  const seed = item.metadataJson ? safeJson(item.metadataJson) : {};
  const dtm = typeof seed.daysToMaturity === 'number' ? seed.daysToMaturity : undefined;
  const soilMin = typeof seed.plantingTempMinF === 'number' ? seed.plantingTempMinF : undefined;
  const spacing = typeof seed.spacingInches === 'number' ? seed.spacingInches : undefined;
  const depth = typeof seed.depthInches === 'number' ? seed.depthInches : undefined;

  const plantingGuide: Record<string, unknown> = {};
  if (soilMin !== undefined) plantingGuide.soilTempMinF = soilMin;
  if (spacing !== undefined) plantingGuide.rowSpacingIn = spacing;
  if (depth !== undefined) plantingGuide.seedDepthIn = { min: depth, max: depth };

  const plugin: Record<string, unknown> = {
    pluginId: slugify(item.displayName) || `seed-${item.id.slice(0, 8)}`,
    type: 'crop',
    displayName: item.displayName,
    version: '1.0.0',
    cropFamily,
    notes: item.notes ?? `User-authored from inventory on ${todayYmd(prefsFor(owner.id))}.`
  };
  if (dtm !== undefined) plugin.daysToMaturity = { min: dtm, max: dtm };
  if (Object.keys(plantingGuide).length > 0) plugin.plantingGuide = plantingGuide;

  try {
    const written = await writeOwnerPlugin(plugin, { event, user: owner });
    const updated = updateStockItem(item.id, { pluginId: written.pluginId });
    return json({ ok: true, pluginId: written.pluginId, path: written.path, item: updated });
  } catch (e) {
    if (e instanceof PluginAuthorError) {
      return json({ error: e.message, code: e.code, issues: e.issues }, { status: 400 });
    }
    if (e instanceof PluginShortensHoldError) {
      return json({ error: e.message, code: e.code, changes: e.changes }, { status: 422 });
    }
    if (e instanceof AnimalRuleError) return e.toResponse();
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
