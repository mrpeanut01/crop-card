import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { getRegistry } from '$lib/server/registry';
import { listSprayers } from '$lib/server/sprayers';

/**
 * Load real blocks from DB. Deep-link query params:
 *   ?block=<blockId>             — pre-select that block
 *   ?product=<pluginId>          — repeat to pre-select multiple herbicides
 *   ?fromScout=1                 — UI hint: showed up via the scout flow
 *   ?windowStage=V2-V3 | V4-V6 | BURNDOWN | PRE | POST — filter herbicide list
 */
export const load: PageServerLoad = async ({ url }) => {
  const registry = await getRegistry();

  const cropById = new Map(
    registry
      .all()
      .filter((r) => r.plugin.type === 'crop')
      .map((r) => [
        r.plugin.pluginId,
        {
          pluginId: r.plugin.pluginId,
          displayName: r.plugin.displayName,
          cropFamily: r.plugin.type === 'crop' ? r.plugin.cropFamily : undefined
        }
      ])
  );

  const { findRecentEditableEventForBlock } = await import('$lib/db/sprayEvents');
  const dbBlocks = listBlocks();
  // Phase 21b follow-up — pre-plant detection. A block is "pre-plant"
  // when none of its plantings are CURRENTLY IN THE GROUND
  // (plantingDate is null or > now). The crop kill-matrix check
  // (CROP_INCOMPATIBLE STOP) should not fire on a block that has no
  // crop in the ground yet — that's exactly the burndown use case
  // (Glyphosate before planting corn, etc.). When pre-plant, the UI
  // surfaces a banner and the request body omits the crop tox check.
  const now = Date.now();
  const blocks = dbBlocks
    .filter((b) => b.plantings.length > 0)
    .map((b) => {
      const activePlantings = b.plantings.filter(
        (p) => p.plantingDate != null && p.plantingDate <= now
      );
      const isPreplant = activePlantings.length === 0;
      // Crops list reflects ONLY plantings already in the ground.
      // The kernel evaluates against this set, so a pre-plant block
      // has an empty `crops` list and the form sends a burndown body.
      const crops = activePlantings
        .map((p) => cropById.get(p.cropPluginId))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      // Future-planted varieties still show in a hint banner so the
      // operator knows what's planned — important context for choosing
      // a burndown product that won't leave residue affecting them.
      const plannedCropNames = b.plantings
        .filter((p) => p.plantingDate == null || p.plantingDate > now)
        .map((p) => p.varietyDisplayName);
      // Phase 21b follow-up — find a still-editable (within 48h lock
      // window) spray_event on this block. When set, the multi-block
      // record loop PATCHes that event instead of POSTing a new one,
      // so the operator can refine a recent record without creating a
      // duplicate.
      const editable = findRecentEditableEventForBlock(b.id);
      return {
        id: b.id,
        label: b.name,
        description: b.acres ? `${b.acres} acres` : '',
        // Phase 21b follow-up — surface numeric acres so the dilution
        // calculator can scale to the FULL pass (all selected blocks),
        // not just one tank-load. `b.acres` is already the effective
        // acres (geometry-derived when present, else stored value).
        acres: b.acres ?? null,
        crops,
        preplant: isPreplant,
        plannedCropNames,
        existingEvent: editable
          ? {
              id: editable.id,
              occurredAt: editable.occurredAt,
              productPluginIds: editable.products.map((p) => p.pluginId)
            }
          : null
      };
    });

  const { hracGroupOf } = await import('$lib/safety/cropFamilyLethality');

  const allHerbicides = registry
    .all()
    .filter((r) => r.plugin.type === 'herbicide')
    .map((r) => {
      if (r.plugin.type !== 'herbicide') throw new Error('unreachable');
      const h = r.plugin;
      const chemistryClasses = Array.from(
        new Set(h.activeIngredients.map((ai) => ai.chemistryClass))
      );
      const hracGroups = Array.from(
        new Set(chemistryClasses.map((c) => String(hracGroupOf(c))).filter((g) => g.length > 0))
      );
      return {
        pluginId: h.pluginId,
        displayName: h.displayName,
        applicationTiming: h.applicationTiming,
        chemistryClasses,
        hracGroups,
        ratePerAcre: h.ratePerAcre,
        gpaCalibration: h.gpaCalibration,
        requiresAMS: h.requiresAMS ?? false,
        deconRequired: h.deconRequired ?? false
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Pre-fill from query params.
  const requestedCropId = url.searchParams.get('crop');
  let requestedBlockId = url.searchParams.get('block');
  // ?crop=<id> wins when present — resolve through to its block.
  if (requestedCropId) {
    const { getCrop } = await import('$lib/db/crops');
    const c = getCrop(requestedCropId);
    if (c) requestedBlockId = c.blockId;
  }
  const requestedProducts = url.searchParams.getAll('product');
  const windowStage = url.searchParams.get('windowStage');
  const fromScout = url.searchParams.get('fromScout') === '1';
  // Phase 21b follow-up — deep-link from the swim-lane pip popover.
  // On a successful record, the page redirects back to /plan and the
  // POST sets the task's completedAt + relatedEventId.
  const taskId = url.searchParams.get('task');

  // Filter herbicides by stage when the calendar deep-link tells us which window
  // we're in. V2-V3 corn = POST broadleaf; V4-V6 = POST + sulfonylurea/HPPD;
  // BURNDOWN = pre-plant non-selectives.
  let herbicides = allHerbicides;
  let filteredByStage: string | null = null;
  if (windowStage) {
    filteredByStage = windowStage;
    if (windowStage === 'V2-V3') {
      herbicides = allHerbicides.filter(
        (h) =>
          h.applicationTiming === 'POST' &&
          h.chemistryClasses.some((c) => c === 'synthetic-auxin' || c === 'sulfonylurea')
      );
    } else if (windowStage === 'V4-V6') {
      herbicides = allHerbicides.filter(
        (h) =>
          h.applicationTiming === 'POST' &&
          h.chemistryClasses.some(
            (c) => c === 'hppd-inhibitor' || c === 'sulfonylurea' || c === 'accase-inhibitor'
          )
      );
    } else if (windowStage === 'BURNDOWN') {
      herbicides = allHerbicides.filter((h) => h.applicationTiming === 'BURNDOWN');
    } else if (windowStage === 'PRE') {
      herbicides = allHerbicides.filter((h) => h.applicationTiming === 'PRE');
    }
    // Always include the unfiltered list so the user can override if needed.
    if (herbicides.length === 0) herbicides = allHerbicides;
  }

  return {
    blocks,
    herbicides,
    allHerbicides,
    sprayers: listSprayers(),
    preselect: {
      blockId: requestedBlockId,
      cropId: requestedCropId,
      productPluginIds: requestedProducts,
      windowStage: filteredByStage,
      fromScout,
      taskId
    }
  };
};
