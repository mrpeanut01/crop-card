/**
 * Crops repository (Phase 12). A "Crop" = an active planting on a block,
 * analogous to a Brewfather Batch. The legacy `plantingRecords` export is
 * kept as a deprecated alias in schema.ts; new code uses `crops`.
 *
 * Phase 18a: tenant-scoped. Group operations and the seasonal-task
 * materialization called via tasks.ts inherit the active Owner from the
 * AsyncLocalStorage context — the inner repo calls don't need to thread it
 * explicitly.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from './client';
import { crops, tasks as tasksTable } from './schema';
import { splitQuantityForSuccession } from '$lib/schedule/succession';
import { tenantValues, tenantWhere, withTenant } from './tenant';
import {
  cascadeDeleteForCrop,
  createTask,
  materializePluginPrePost,
  materializeSeasonalTasks,
  reanchorPluginPrePost
} from './tasks';
import type { CropPlugin } from '$lib/plugins/schemas';

export type CropStatus = 'planned' | 'active' | 'harvested' | 'failed' | 'archived';
export type GroupRole = 'anchor' | 'companion';
export type GroupSystemKind = 'three-sisters' | 'succession' | 'manual';

export interface Crop {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
  status: CropStatus;
  harvestedAt?: number;
  archivedAt?: number;
  quantityPlanted?: number;
  quantityUnit?: string;
  groupId?: string;
  groupRole?: GroupRole;
  groupOffsetDays?: number;
  groupSystemKind?: GroupSystemKind;
  /** Phase 21b follow-up — operator's chosen harvest use cases for
   *  this planting. Used to filter the plugin's growthStageTable
   *  harvestTargets in the swim-lane render (e.g. show only the
   *  fresh-eating window, not the dent/grain window, for a dual-
   *  purpose corn crop). Undefined / null = show all. */
  harvestUseCases?: string[];
}

function rowToCrop(row: typeof crops.$inferSelect): Crop {
  const out: Crop = {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    varietyDisplayName: row.varietyDisplayName,
    plantingDate: row.plantingDate?.getTime() ?? null,
    status: row.status as CropStatus,
    harvestedAt: row.harvestedAt?.getTime(),
    archivedAt: row.archivedAt?.getTime()
  };
  if (row.quantityPlantedHundredths != null) {
    out.quantityPlanted = row.quantityPlantedHundredths / 100;
  }
  if (row.quantityUnit) out.quantityUnit = row.quantityUnit;
  if (row.groupId) out.groupId = row.groupId;
  if (row.groupRole) out.groupRole = row.groupRole as GroupRole;
  if (row.groupOffsetDays != null) out.groupOffsetDays = row.groupOffsetDays;
  if (row.groupSystemKind) out.groupSystemKind = row.groupSystemKind as GroupSystemKind;
  if (row.harvestUseCases) {
    try {
      const parsed = JSON.parse(row.harvestUseCases);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        out.harvestUseCases = parsed;
      }
    } catch {
      /* malformed JSON — treat as null (show all targets) */
    }
  }
  return out;
}

export interface ListFilters {
  blockId?: string;
  status?: CropStatus;
  year?: number;
  limit?: number;
}

export function listCrops(filters: ListFilters = {}): Crop[] {
  const conds = [];
  if (filters.blockId) conds.push(eq(crops.blockId, filters.blockId));
  if (filters.status) conds.push(eq(crops.status, filters.status));
  if (filters.year !== undefined) {
    const start = new Date(filters.year, 0, 1);
    const end = new Date(filters.year + 1, 0, 1);
    conds.push(gte(crops.plantingDate, start));
    conds.push(lte(crops.plantingDate, end));
  }

  let q = db
    .select()
    .from(crops)
    .where(withTenant(crops, conds.length ? and(...conds) : undefined))
    .$dynamic();
  q = q.orderBy(desc(crops.plantingDate));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map(rowToCrop);
}

export function getCrop(id: string): Crop | undefined {
  const row = db
    .select()
    .from(crops)
    .where(withTenant(crops, eq(crops.id, id)))
    .get();
  return row ? rowToCrop(row) : undefined;
}

export function setSchedule(
  id: string,
  patch: { plantingDate: number | null; blockId?: string }
): Crop {
  const updates: Record<string, unknown> = {
    plantingDate: patch.plantingDate !== null ? new Date(patch.plantingDate) : null
  };
  if (patch.blockId) updates.blockId = patch.blockId;
  const cur = db
    .select()
    .from(crops)
    .where(withTenant(crops, eq(crops.id, id)))
    .get();
  if (!cur) throw new Error(`unknown crop id: ${id}`);
  if (patch.plantingDate === null && cur.status === 'active') {
    updates.status = 'planned';
  } else if (patch.plantingDate !== null && cur.status === 'planned') {
    updates.status = 'active';
  }
  const row = db
    .update(crops)
    .set(updates)
    .where(withTenant(crops, eq(crops.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

export function updateDetails(
  id: string,
  patch: {
    varietyDisplayName?: string;
    quantityPlanted?: number | null;
    quantityUnit?: string | null;
    /** Phase 21b follow-up — explicit `null` clears the filter
     *  (show all harvest targets); an array writes the selection;
     *  `undefined` (default) leaves the column untouched. */
    harvestUseCases?: string[] | null;
  }
): Crop {
  const updates: Record<string, unknown> = {};
  if (patch.varietyDisplayName !== undefined) updates.varietyDisplayName = patch.varietyDisplayName;
  if (patch.quantityPlanted !== undefined) {
    updates.quantityPlantedHundredths =
      patch.quantityPlanted == null ? null : Math.round(patch.quantityPlanted * 100);
  }
  if (patch.quantityUnit !== undefined) updates.quantityUnit = patch.quantityUnit ?? null;
  if (patch.harvestUseCases !== undefined) {
    updates.harvestUseCases =
      patch.harvestUseCases == null ? null : JSON.stringify(patch.harvestUseCases);
  }
  if (Object.keys(updates).length === 0) {
    const cur = getCrop(id);
    if (!cur) throw new Error(`unknown crop id: ${id}`);
    return cur;
  }
  const row = db
    .update(crops)
    .set(updates)
    .where(withTenant(crops, eq(crops.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

export function updateStatus(id: string, status: CropStatus, occurredAt?: number): Crop {
  const updates: Record<string, unknown> = { status };
  const now = occurredAt ?? Date.now();
  if (status === 'harvested') updates.harvestedAt = new Date(now);
  if (status === 'archived') updates.archivedAt = new Date(now);
  const row = db
    .update(crops)
    .set(updates)
    .where(withTenant(crops, eq(crops.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

export function inferCropForEvent(blockId: string, occurredAt: number): Crop | undefined {
  const rows = db
    .select()
    .from(crops)
    .where(
      withTenant(
        crops,
        and(eq(crops.blockId, blockId), lte(crops.plantingDate, new Date(occurredAt)))
      )
    )
    .orderBy(desc(crops.plantingDate))
    .limit(1)
    .all();
  return rows[0] ? rowToCrop(rows[0]) : undefined;
}

export function listYearsWithCrops(): number[] {
  const all = db
    .select()
    .from(crops)
    .where(tenantWhere(crops))
    .orderBy(asc(crops.plantingDate))
    .all();
  const years = new Set<number>();
  for (const r of all) if (r.plantingDate) years.add(new Date(r.plantingDate).getFullYear());
  return [...years].sort((a, b) => b - a);
}

/**
 * Phase 21b follow-up — split a crop into N parts.
 *
 * Takes one existing crop and produces N total crops on the same
 * block + plugin + variety + plantingDate, with the original's
 * quantity divided evenly across the parts via largest-remainder
 * rounding (so the sum exactly matches the input — no off-by-one
 * losses for integer units like 'seeds' / 'count' / 'packets').
 *
 * The first part is the UPDATED original (id preserved), so any
 * event already tied to that cropId stays linked. The remaining
 * (N - 1) parts are fresh inserts that inherit the original's
 * status + non-quantity metadata. Group fields (groupId, groupRole,
 * etc.) are NOT propagated to the new parts — splitting a group
 * anchor would break the companion offsets, so each new part starts
 * as a standalone planting that the operator can join to a group
 * separately if they want.
 *
 * Caller is expected to drag the new parts to their target dates
 * (or blocks) afterwards. By default all parts share the source
 * date so the UI stacks them on top of each other and the operator
 * can spread them out via drag.
 */
export function splitCrop(id: string, parts: number): Crop[] {
  if (parts < 2 || !Number.isInteger(parts)) {
    throw new Error(`splitCrop requires parts >= 2 integer (got ${parts})`);
  }
  const original = getCrop(id);
  if (!original) throw new Error(`unknown crop id: ${id}`);
  if (original.status === 'harvested' || original.status === 'archived') {
    throw new Error(`cannot split a ${original.status} crop`);
  }

  const totalHundredths = (() => {
    const row = db
      .select({ q: crops.quantityPlantedHundredths })
      .from(crops)
      .where(withTenant(crops, eq(crops.id, id)))
      .get();
    return row?.q ?? null;
  })();
  const shares =
    totalHundredths != null
      ? splitQuantityForSuccession(totalHundredths, parts)
      : new Array(parts).fill(null);

  // Update the original to its share.
  const updated = db
    .update(crops)
    .set({ quantityPlantedHundredths: shares[0] as number | null })
    .where(withTenant(crops, eq(crops.id, id)))
    .returning()
    .get();

  const out: Crop[] = [rowToCrop(updated)];

  for (let i = 1; i < parts; i++) {
    const newId = randomUUID();
    const row = db
      .insert(crops)
      .values(
        tenantValues({
          id: newId,
          blockId: original.blockId,
          cropPluginId: original.cropPluginId,
          varietyDisplayName: original.varietyDisplayName,
          plantingDate: original.plantingDate != null ? new Date(original.plantingDate) : null,
          status: original.status,
          quantityPlantedHundredths: shares[i] as number | null,
          quantityUnit: original.quantityUnit ?? null
          // Intentionally NOT copying group fields — see docstring.
        })
      )
      .returning()
      .get();
    out.push(rowToCrop(row));
  }

  return out;
}

export function createPlanned(input: {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  quantityPlanted?: number;
  quantityUnit?: string;
}): Crop {
  const id = randomUUID();
  const row = db
    .insert(crops)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropPluginId: input.cropPluginId,
        varietyDisplayName: input.varietyDisplayName,
        plantingDate: null,
        status: 'planned',
        quantityPlantedHundredths:
          input.quantityPlanted !== undefined ? Math.round(input.quantityPlanted * 100) : null,
        quantityUnit: input.quantityUnit ?? null
      })
    )
    .returning()
    .get();
  return rowToCrop(row);
}

// ─── Phase 15: planting groups ──────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPANION_CHECK_LEAD_DAYS = 5;

export interface GroupMemberInput {
  cropPluginId: string;
  varietyDisplayName: string;
  offsetDays?: number;
  quantityPlanted?: number;
  quantityUnit?: string;
  existingCropId?: string;
}

export interface CreateGroupInput {
  blockId: string;
  anchor: GroupMemberInput;
  companions: GroupMemberInput[];
  anchorPlantingDateMs: number;
  systemKind: GroupSystemKind;
  resolvePlugin: (pluginId: string) => CropPlugin | undefined;
}

export interface GroupMemberOutput {
  crop: Crop;
  primaryTaskId: string;
  preTaskIds: string[];
  postTaskIds: string[];
  seasonalTaskIds: string[];
  companionCheckTaskId?: string;
}

export interface GroupCommitResult {
  groupId: string;
  members: GroupMemberOutput[];
}

function materializeMember(
  groupId: string,
  blockId: string,
  member: GroupMemberInput,
  role: GroupRole,
  systemKind: GroupSystemKind,
  plantingDateMs: number,
  plugin: CropPlugin
): GroupMemberOutput {
  const offsetDays = role === 'anchor' ? null : (member.offsetDays ?? 0);
  let cropId: string;
  let cropRow: typeof crops.$inferSelect;

  if (member.existingCropId) {
    const existing = db
      .select()
      .from(crops)
      .where(withTenant(crops, eq(crops.id, member.existingCropId)))
      .get();
    if (!existing) throw new Error(`unknown crop id: ${member.existingCropId}`);
    if (existing.groupId) {
      throw new Error(`crop ${member.existingCropId} already belongs to a group`);
    }
    cropId = existing.id;
    const updates: Record<string, unknown> = {
      blockId,
      cropPluginId: member.cropPluginId,
      varietyDisplayName: member.varietyDisplayName,
      plantingDate: new Date(plantingDateMs),
      status: 'active',
      groupId,
      groupRole: role,
      groupOffsetDays: offsetDays,
      groupSystemKind: systemKind
    };
    if (member.quantityPlanted !== undefined) {
      updates.quantityPlantedHundredths = Math.round(member.quantityPlanted * 100);
    }
    if (member.quantityUnit !== undefined) {
      updates.quantityUnit = member.quantityUnit ?? null;
    }
    cropRow = db
      .update(crops)
      .set(updates)
      .where(withTenant(crops, eq(crops.id, cropId)))
      .returning()
      .get();
  } else {
    cropId = randomUUID();
    cropRow = db
      .insert(crops)
      .values(
        tenantValues({
          id: cropId,
          blockId,
          cropPluginId: member.cropPluginId,
          varietyDisplayName: member.varietyDisplayName,
          plantingDate: new Date(plantingDateMs),
          status: 'active',
          quantityPlantedHundredths:
            member.quantityPlanted !== undefined ? Math.round(member.quantityPlanted * 100) : null,
          quantityUnit: member.quantityUnit ?? null,
          groupId,
          groupRole: role,
          groupOffsetDays: offsetDays,
          groupSystemKind: systemKind
        })
      )
      .returning()
      .get();
  }

  const primary = createTask({
    title: `Plant ${member.varietyDisplayName}`,
    body: `Anchor task for ${member.varietyDisplayName} on block ${blockId}.`,
    kind: 'primary',
    cropId,
    blockId,
    scheduledFor: plantingDateMs,
    pluginTemplateKey: `crop:${plugin.pluginId}:plant`
  });

  const { preTaskIds, postTaskIds } = materializePluginPrePost({
    primaryTaskId: primary.id,
    scheduledFor: plantingDateMs,
    cropPlugin: plugin
  });

  const seasonalTaskIds = materializeSeasonalTasks({
    cropId,
    blockId,
    plantingDateMs,
    cropPlugin: plugin
  });

  return {
    crop: rowToCrop(cropRow),
    primaryTaskId: primary.id,
    preTaskIds,
    postTaskIds,
    seasonalTaskIds
  };
}

export function createPlantingGroup(input: CreateGroupInput): GroupCommitResult {
  const groupId = randomUUID();
  return db.transaction(() => {
    const anchorPlugin = input.resolvePlugin(input.anchor.cropPluginId);
    if (!anchorPlugin) throw new Error(`unknown crop plugin: ${input.anchor.cropPluginId}`);

    const anchorOut = materializeMember(
      groupId,
      input.blockId,
      input.anchor,
      'anchor',
      input.systemKind,
      input.anchorPlantingDateMs,
      anchorPlugin
    );

    const memberOuts: GroupMemberOutput[] = [anchorOut];
    for (const c of input.companions) {
      const plugin = input.resolvePlugin(c.cropPluginId);
      if (!plugin) throw new Error(`unknown crop plugin: ${c.cropPluginId}`);
      const offsetDays = c.offsetDays ?? 0;
      const companionPlantingMs = input.anchorPlantingDateMs + offsetDays * DAY_MS;
      const out = materializeMember(
        groupId,
        input.blockId,
        c,
        'companion',
        input.systemKind,
        companionPlantingMs,
        plugin
      );

      const checkScheduled = companionPlantingMs - COMPANION_CHECK_LEAD_DAYS * DAY_MS;
      const checkTask = createTask({
        title: `Confirm ${input.anchor.varietyDisplayName} stage — ${c.varietyDisplayName} due in ${COMPANION_CHECK_LEAD_DAYS}d`,
        body: `Companion check for ${input.systemKind}. Verify ${input.anchor.varietyDisplayName} has reached the expected growth stage; nudge ${c.varietyDisplayName} planting ±N days if the anchor is ahead or behind.`,
        kind: 'primary',
        cropId: anchorOut.crop.id,
        blockId: input.blockId,
        scheduledFor: checkScheduled,
        pluginTemplateKey: `companion-check:${groupId}:${out.crop.id}`
      });
      out.companionCheckTaskId = checkTask.id;
      memberOuts.push(out);
    }

    return { groupId, members: memberOuts };
  });
}

export function previewPlantingGroup(input: CreateGroupInput): GroupCommitResult {
  let result: GroupCommitResult | null = null;
  try {
    db.transaction(() => {
      result = createPlantingGroup(input);
      throw PREVIEW_ROLLBACK;
    });
  } catch (err) {
    if (err !== PREVIEW_ROLLBACK) throw err;
  }
  if (!result) throw new Error('preview: transaction did not produce a result');
  return result;
}
const PREVIEW_ROLLBACK = Symbol('preview-rollback');

export function listGroupMembers(groupId: string): Crop[] {
  const rows = db
    .select()
    .from(crops)
    .where(withTenant(crops, eq(crops.groupId, groupId)))
    .orderBy(asc(crops.groupOffsetDays))
    .all();
  return rows.map(rowToCrop).sort((a, b) => {
    if (a.groupRole === 'anchor') return -1;
    if (b.groupRole === 'anchor') return 1;
    return (a.groupOffsetDays ?? 0) - (b.groupOffsetDays ?? 0);
  });
}

export function disbandGroup(groupId: string): number {
  const result = db
    .update(crops)
    .set({ groupId: null, groupRole: null, groupOffsetDays: null, groupSystemKind: null })
    .where(withTenant(crops, eq(crops.groupId, groupId)))
    .run();
  return result.changes;
}

export function nudgeCompanionPlanting(
  companionCropId: string,
  deltaDays: number
): {
  newPlantingDateMs: number;
  reanchored: { shifted: number; flaggedStale: number };
} {
  if (deltaDays === 0) {
    throw new Error('nudge requires non-zero deltaDays');
  }
  return db.transaction(() => {
    const cropRow = db
      .select()
      .from(crops)
      .where(withTenant(crops, eq(crops.id, companionCropId)))
      .get();
    if (!cropRow) throw new Error(`unknown crop: ${companionCropId}`);
    if (cropRow.groupRole !== 'companion') {
      throw new Error('only companion crops can be nudged');
    }
    if (!cropRow.plantingDate) throw new Error('companion has no planting date');

    const oldMs = cropRow.plantingDate.getTime();
    const newMs = oldMs + deltaDays * DAY_MS;
    db.update(crops)
      .set({ plantingDate: new Date(newMs) })
      .where(withTenant(crops, eq(crops.id, companionCropId)))
      .run();

    const primaryRow = db
      .select()
      .from(tasksTable)
      .where(
        withTenant(
          tasksTable,
          and(
            eq(tasksTable.cropId, companionCropId),
            eq(tasksTable.kind, 'primary'),
            eq(tasksTable.pluginTemplateKey, `crop:${cropRow.cropPluginId}:plant`)
          )
        )
      )
      .get();

    let reanchored = { shifted: 0, flaggedStale: 0 };
    if (primaryRow) {
      const oldPrimaryMs = primaryRow.scheduledFor.getTime();
      const newPrimaryMs = oldPrimaryMs + deltaDays * DAY_MS;
      db.update(tasksTable)
        .set({ scheduledFor: new Date(newPrimaryMs) })
        .where(withTenant(tasksTable, eq(tasksTable.id, primaryRow.id)))
        .run();
      reanchored = reanchorPluginPrePost(primaryRow.id, oldPrimaryMs, newPrimaryMs);
    }

    return { newPlantingDateMs: newMs, reanchored };
  });
}

export function isGroupAnchorWithMembers(cropId: string): boolean {
  const row = db
    .select()
    .from(crops)
    .where(withTenant(crops, eq(crops.id, cropId)))
    .get();
  if (!row || row.groupRole !== 'anchor' || !row.groupId) return false;
  const siblings = db
    .select()
    .from(crops)
    .where(withTenant(crops, and(eq(crops.groupId, row.groupId), isNotNull(crops.groupId))))
    .all();
  return siblings.length > 1;
}

export function unscheduleCrop(cropId: string): {
  tasksDeleted: number;
  disbandedGroupId?: string;
} {
  return db.transaction(() => {
    const row = db
      .select()
      .from(crops)
      .where(withTenant(crops, eq(crops.id, cropId)))
      .get();
    if (!row) throw new Error(`unknown crop: ${cropId}`);

    let disbandedGroupId: string | undefined;
    if (row.groupId) {
      disbandedGroupId = row.groupId;
      db.update(crops)
        .set({ groupId: null, groupRole: null, groupOffsetDays: null, groupSystemKind: null })
        .where(withTenant(crops, eq(crops.groupId, row.groupId)))
        .run();
    }

    const tasksDeleted = cascadeDeleteForCrop(cropId);

    db.update(crops)
      .set({ plantingDate: null, status: 'planned' })
      .where(withTenant(crops, eq(crops.id, cropId)))
      .run();

    return { tasksDeleted, disbandedGroupId };
  });
}

export function clearSchedule(blockIdFilter?: Set<string> | null): {
  unscheduled: number;
  tasksDeleted: number;
} {
  return db.transaction(() => {
    const rows = db.select().from(crops).where(tenantWhere(crops)).all();
    let unscheduled = 0;
    let tasksDeleted = 0;
    for (const row of rows) {
      if (row.status === 'harvested' || row.status === 'archived' || row.status === 'failed') {
        continue;
      }
      if (blockIdFilter && !blockIdFilter.has(row.blockId)) continue;
      const hasDate = row.plantingDate != null;
      const inGroup = !!row.groupId;
      if (!hasDate && !inGroup) continue;
      tasksDeleted += cascadeDeleteForCrop(row.id);
      db.update(crops)
        .set({
          plantingDate: null,
          groupId: null,
          groupRole: null,
          groupOffsetDays: null,
          groupSystemKind: null,
          status: 'planned'
        })
        .where(withTenant(crops, eq(crops.id, row.id)))
        .run();
      unscheduled++;
    }
    return { unscheduled, tasksDeleted };
  });
}

export function listGroupsOnBlock(
  blockId: string
): Array<{ groupId: string; systemKind: GroupSystemKind; memberCount: number }> {
  const rows = db
    .select()
    .from(crops)
    .where(withTenant(crops, and(eq(crops.blockId, blockId), isNotNull(crops.groupId))))
    .all();
  const byGroup = new Map<string, { systemKind: GroupSystemKind; memberCount: number }>();
  for (const r of rows) {
    if (!r.groupId) continue;
    const existing = byGroup.get(r.groupId);
    if (existing) {
      existing.memberCount += 1;
    } else {
      byGroup.set(r.groupId, {
        systemKind: (r.groupSystemKind ?? 'manual') as GroupSystemKind,
        memberCount: 1
      });
    }
  }
  return [...byGroup.entries()].map(([groupId, v]) => ({ groupId, ...v }));
}
