/**
 * Server reads for the garden designer (Phase 30E). Every table read goes
 * through the tenant helpers; the result is the client-safe `GardenDesign`
 * plus the side data the page needs (bed history, crop catalog, companions).
 */

import { inArray } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { crops as cropsTable } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { getField } from '$lib/db/fields';
import { listBlocks } from '$lib/db/blocks';
import { listShadeSources } from '$lib/db/shadeSources';
import { getBedRecipes, getRegistry } from '$lib/server/registry';
import type { BedRecipePlugin } from '$lib/plugins/schemas';
import { frostDatesForYear } from '$lib/schedule/settings';
import { snapshotFrostFromSettings } from '$lib/climate/frostSettings.server';
import { rotationLookbackForFamily } from '$lib/plugins/familyDefaults';
import { resolveArchetype, type CompanionPlugin, type CropPlugin } from '$lib/plugins/schemas';
import { isDesignable, type DesignableAreaKind } from '$lib/farm/areaKinds';
import { parseFootprint } from '$lib/farm/footprint';
import {
  buildGardenDesign,
  landmarkRect,
  type DesignBlockInput,
  type DesignPlantingInput
} from '$lib/garden/design';
import type { BedHistoryEntry, GardenCrop, GardenDesign } from '$lib/garden/types';
import type { DesignerCompanion, GardenDesignResponse } from '$lib/garden/api';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import { selectablePlanningYears } from '$lib/season/planningYear';

export type { DesignerCompanion };

export interface DesignerLoad {
  design: GardenDesign;
  /** Every recorded planting per bed, all seasons. */
  history: Record<string, BedHistoryEntry[]>;
  catalog: GardenCrop[];
  companions: DesignerCompanion[];
  lookbackByFamily: Record<string, number>;
  areaKind: DesignableAreaKind;
  recipes: BedRecipePlugin[];
}

export function gardenCropOf(p: CropPlugin): GardenCrop {
  const out: GardenCrop = {
    pluginId: p.pluginId,
    displayName: p.displayName,
    cropFamily: p.cropFamily
  };
  if (p.archetype) out.archetype = p.archetype;
  if (p.daysToMaturity) out.daysToMaturity = { ...p.daysToMaturity };
  if (p.defaultRowSpacingInches) out.defaultRowSpacingInches = p.defaultRowSpacingInches;
  const guide = p.plantingGuide;
  if (guide && (guide.rowSpacingIn || guide.inRowSpacingIn || guide.soilTempMinF)) {
    out.plantingGuide = {};
    if (guide.rowSpacingIn) out.plantingGuide.rowSpacingIn = guide.rowSpacingIn;
    if (guide.inRowSpacingIn) out.plantingGuide.inRowSpacingIn = { ...guide.inRowSpacingIn };
    if (guide.soilTempMinF) out.plantingGuide.soilTempMinF = guide.soilTempMinF;
  }
  return out;
}

function utcDayOfLocal(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The farm's frost dates for a season as UTC days, the way the designer
 *  shows them, so a server recompute matches the page's preview. */
export function designFrostForYear(seasonYear: number): {
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
} {
  const frost = frostDatesForYear(seasonYear);
  return {
    lastSpringFrostMs: utcDayOfLocal(frost.lastSpringFrostMs),
    firstFallFrostMs: utcDayOfLocal(frost.firstFallFrostMs)
  };
}

/** Null when the Area is not the active Owner's or is not a garden or
 *  greenhouse. */
export async function loadGardenDesign(
  areaId: string,
  opts: { seasonYear: number; readOnlyReason: GardenDesign['readOnlyReason']; now?: number }
): Promise<DesignerLoad | null> {
  const area = getField(areaId);
  if (!area || !isDesignable(area.kind)) return null;

  const blocks = listBlocks().filter((b) => b.fieldId === area.id);
  const blockInputs: DesignBlockInput[] = blocks.map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind ?? 'block',
    widthFt: b.widthFt ?? null,
    lengthFt: b.lengthFt ?? null,
    xFt: b.xFt ?? null,
    yFt: b.yFt ?? null,
    rotationDeg: b.rotationDeg ?? null,
    bedStyle: b.bedStyle ?? null
  }));
  const blockIds = blocks.map((b) => b.id);
  const rows = blockIds.length
    ? db
        .select()
        .from(cropsTable)
        .where(withTenant(cropsTable, inArray(cropsTable.blockId, blockIds)))
        .all()
    : [];

  const registry = await getRegistry();
  const cropPlugins = registry.crops();
  const catalog = cropPlugins
    .map(gardenCropOf)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const byId: Record<string, GardenCrop> = {};
  for (const c of catalog) byId[c.pluginId] = c;
  const pluginById = new Map(cropPlugins.map((p) => [p.pluginId, p]));

  const plantings: DesignPlantingInput[] = rows.map((r) => ({
    id: r.id,
    blockId: r.blockId,
    cropPluginId: r.cropPluginId,
    varietyDisplayName: r.varietyDisplayName,
    status: r.status,
    plantingDateMs: r.plantingDate?.getTime() ?? null,
    harvestedAtMs: r.harvestedAt?.getTime() ?? null,
    footprint: parseFootprint(r.footprintJson),
    spacingIn: r.spacingIn ?? null,
    rowSpacingIn: r.rowSpacingIn ?? null,
    spacingPattern: r.spacingPattern ?? null,
    plantCount: r.plantCount ?? null,
    plantCountProvenance: r.plantCountProvenance ?? null,
    groupId: r.groupId ?? null,
    groupSystemKind: r.groupSystemKind ?? null,
    groupRole: r.groupRole ?? null,
    sourceProvenance: r.sourceProvenance ?? null
  }));

  const frost = designFrostForYear(opts.seasonYear);
  const design = buildGardenDesign({
    area: {
      id: area.id,
      name: area.name,
      kind: area.kind,
      widthFt: area.widthFt ?? null,
      lengthFt: area.lengthFt ?? null,
      geojson: area.geometryGeojson ?? null
    },
    blocks: blockInputs,
    plantings,
    crops: byId,
    frost: {
      ...frost,
      provenance: snapshotFrostFromSettings().provenance
    },
    seasonYear: opts.seasonYear,
    asOf: opts.now ?? Date.now(),
    readOnlyReason: opts.readOnlyReason
  });
  if (!design) return null;

  design.landmarks = listShadeSources()
    .filter((s) => s.fieldId === area.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      rect: landmarkRect(area.geometryGeojson ?? null, s.geometryGeojson ?? null, design.canvas)
    }));

  const history: Record<string, BedHistoryEntry[]> = {};
  for (const p of plantings) {
    if (p.status === 'archived') continue;
    const plugin = pluginById.get(p.cropPluginId);
    const when = p.plantingDateMs ?? p.harvestedAtMs;
    (history[p.blockId] ??= []).push({
      cropId: p.id,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      cropFamily: plugin?.cropFamily ?? 'unknown',
      archetype: plugin ? resolveArchetype(plugin) : 'unknown',
      status: p.status,
      plantingDateMs: p.plantingDateMs,
      harvestedAtMs: p.harvestedAtMs,
      seasonYear: when != null ? new Date(when).getUTCFullYear() : opts.seasonYear
    });
  }

  const families = new Set<string>(catalog.map((c) => c.cropFamily));
  for (const entries of Object.values(history)) for (const h of entries) families.add(h.cropFamily);
  const lookbackByFamily: Record<string, number> = {};
  for (const f of families) lookbackByFamily[f] = rotationLookbackForFamily(f);

  const companions: DesignerCompanion[] = registry
    .all()
    .map((r) => r.plugin)
    .filter((p): p is CompanionPlugin => p.type === 'companion')
    .map((c) => ({
      pluginId: c.pluginId,
      displayName: c.displayName,
      goodWith: c.goodWith,
      badWith: c.badWith,
      keepApart: c.keepApart,
      primaryFamily: c.primaryFamily,
      members: c.members,
      benefit: c.benefit
    }));

  const recipes = (await getBedRecipes()).all();
  return { design, history, catalog, companions, lookbackByFamily, areaKind: area.kind, recipes };
}

/** The whole designer page for one user and season: the design plus the
 *  seasons they can switch to. `season` is honoured only when it is one of
 *  those; otherwise the active planning year is shown. */
export async function loadDesignerResponse(
  areaId: string,
  opts: { role: string; season: string | null; now?: Date }
): Promise<GardenDesignResponse | null> {
  const canEdit = opts.role === 'owner';
  const now = opts.now ?? new Date();
  const activeYear = getActivePlanningYear(now);
  const seasons = [
    ...new Set([now.getFullYear(), ...selectablePlanningYears(now), activeYear])
  ].sort((a, b) => a - b);
  const asked = Number(opts.season);
  const seasonYear = seasons.includes(asked) ? asked : activeYear;
  const loaded = await loadGardenDesign(areaId, {
    seasonYear,
    readOnlyReason: canEdit ? null : 'role'
  });
  if (!loaded) return null;
  return { ...loaded, canEdit, role: opts.role, seasons, activeYear };
}
