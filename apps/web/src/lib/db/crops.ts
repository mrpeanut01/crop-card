/**
 * Crops repository (Phase 12). A "Crop" = an active planting on a block,
 * analogous to a Brewfather Batch. The legacy `plantingRecords` export is
 * kept as a deprecated alias in schema.ts; new code uses `crops`.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from './client';
import { crops, tasks as tasksTable } from './schema';
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
  /** Phase 15: planting-group membership. */
  groupId?: string;
  groupRole?: GroupRole;
  groupOffsetDays?: number;
  groupSystemKind?: GroupSystemKind;
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

  let q = db.select().from(crops).$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));
  q = q.orderBy(desc(crops.plantingDate));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map(rowToCrop);
}

export function getCrop(id: string): Crop | undefined {
  const row = db.select().from(crops).where(eq(crops.id, id)).get();
  return row ? rowToCrop(row) : undefined;
}

/** Phase 14: drag-drop on swim-lane → set plantingDate (and optionally
 *  move to a different block). Setting plantingDate from null lifts the
 *  crop out of the "to schedule" tray and flips status to 'active'.
 *  Setting it to null returns the crop to the tray and flips back to
 *  'planned' so future drags can re-place it. */
export function setSchedule(
  id: string,
  patch: { plantingDate: number | null; blockId?: string }
): Crop {
  const updates: Record<string, unknown> = {
    plantingDate: patch.plantingDate !== null ? new Date(patch.plantingDate) : null
  };
  if (patch.blockId) updates.blockId = patch.blockId;
  // Status auto-transition: tray ↔ active.
  const cur = db.select().from(crops).where(eq(crops.id, id)).get();
  if (!cur) throw new Error(`unknown crop id: ${id}`);
  if (patch.plantingDate === null && cur.status === 'active') {
    updates.status = 'planned';
  } else if (patch.plantingDate !== null && cur.status === 'planned') {
    updates.status = 'active';
  }
  const row = db.update(crops).set(updates).where(eq(crops.id, id)).returning().get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

/** Phase 15c — edit operator-visible details on a planting (variety name +
 *  quantity). Plugin id is intentionally NOT mutable here; that goes through
 *  the change-plugin guard on the API layer. */
export function updateDetails(
  id: string,
  patch: { varietyDisplayName?: string; quantityPlanted?: number | null; quantityUnit?: string | null }
): Crop {
  const updates: Record<string, unknown> = {};
  if (patch.varietyDisplayName !== undefined) updates.varietyDisplayName = patch.varietyDisplayName;
  if (patch.quantityPlanted !== undefined) {
    updates.quantityPlantedHundredths =
      patch.quantityPlanted == null ? null : Math.round(patch.quantityPlanted * 100);
  }
  if (patch.quantityUnit !== undefined) updates.quantityUnit = patch.quantityUnit ?? null;
  if (Object.keys(updates).length === 0) {
    const cur = getCrop(id);
    if (!cur) throw new Error(`unknown crop id: ${id}`);
    return cur;
  }
  const row = db.update(crops).set(updates).where(eq(crops.id, id)).returning().get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

export function updateStatus(id: string, status: CropStatus, occurredAt?: number): Crop {
  const updates: Record<string, unknown> = { status };
  const now = occurredAt ?? Date.now();
  if (status === 'harvested') updates.harvestedAt = new Date(now);
  if (status === 'archived') updates.archivedAt = new Date(now);
  const row = db.update(crops).set(updates).where(eq(crops.id, id)).returning().get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

/**
 * Backfill helper used by the migration script and as an event-API fallback.
 * Picks the most-recently-planted active/harvested crop on `blockId` whose
 * `plantingDate <= occurredAt`. Returns undefined if no crop matches.
 */
export function inferCropForEvent(blockId: string, occurredAt: number): Crop | undefined {
  const rows = db
    .select()
    .from(crops)
    .where(and(eq(crops.blockId, blockId), lte(crops.plantingDate, new Date(occurredAt))))
    .orderBy(desc(crops.plantingDate))
    .limit(1)
    .all();
  return rows[0] ? rowToCrop(rows[0]) : undefined;
}

/** Year list for the filter dropdown. */
export function listYearsWithCrops(): number[] {
  const all = db.select().from(crops).orderBy(asc(crops.plantingDate)).all();
  const years = new Set<number>();
  for (const r of all) if (r.plantingDate) years.add(new Date(r.plantingDate).getFullYear());
  return [...years].sort((a, b) => b - a);
}

/** Phase 14a: create a planned-status crop with no planting date. Used by the
 *  Schedule-tab seed-to-block auto-assign flow — committed crops land in the
 *  "To schedule" tray awaiting drag-drop to set a date. */
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
    .values({
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
  /** Days from anchor's plantingDate. Set to 0 (or omit) on the anchor. */
  offsetDays?: number;
  quantityPlanted?: number;
  quantityUnit?: string;
  /** Phase 15d — when set, promote the existing draft crop with this id
   *  into a group member (UPDATE in place) instead of INSERTing a new row.
   *  Used by the wizard + auto-schedule path so unscheduled drafts are
   *  consumed rather than duplicated. */
  existingCropId?: string;
}

export interface CreateGroupInput {
  blockId: string;
  anchor: GroupMemberInput;
  companions: GroupMemberInput[];
  /** Anchor's plantingDate in ms epoch. Companions derive from offsetDays. */
  anchorPlantingDateMs: number;
  systemKind: GroupSystemKind;
  /** Plugin lookup callback so this module stays free of registry I/O. */
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

/** Insert a single crop row plus its primary "Plant" task and all template
 *  materialization. Internal helper shared by group commit + preview. */
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
      .where(eq(crops.id, member.existingCropId))
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
    cropRow = db.update(crops).set(updates).where(eq(crops.id, cropId)).returning().get();
  } else {
    cropId = randomUUID();
    cropRow = db
      .insert(crops)
      .values({
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

/** Commit a planting group in a single transaction. Each member gets a crop
 *  row, a primary "Plant" task, materialized pre/post + seasonal tasks, and
 *  (companions only) a "companion-check" advisory task scheduled
 *  COMPANION_CHECK_LEAD_DAYS before the companion's plantingDate. */
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

/** Dry-run preview: runs the same materialization inside a transaction that
 *  always rolls back, so step 4 of the wizard can show the operator the full
 *  set of plantings + tasks before committing. */
export function previewPlantingGroup(input: CreateGroupInput): GroupCommitResult {
  let result: GroupCommitResult | null = null;
  try {
    db.transaction(() => {
      result = createPlantingGroup(input);
      // Force rollback by throwing a sentinel error after capture.
      throw PREVIEW_ROLLBACK;
    });
  } catch (err) {
    if (err !== PREVIEW_ROLLBACK) throw err;
  }
  if (!result) throw new Error('preview: transaction did not produce a result');
  return result;
}
const PREVIEW_ROLLBACK = Symbol('preview-rollback');

/** List all crops in a group (anchor first, then companions ordered by offset). */
export function listGroupMembers(groupId: string): Crop[] {
  const rows = db
    .select()
    .from(crops)
    .where(eq(crops.groupId, groupId))
    .orderBy(asc(crops.groupOffsetDays))
    .all();
  // Drizzle nulls-first ordering varies by SQLite version; force anchor first.
  return rows
    .map(rowToCrop)
    .sort((a, b) => {
      if (a.groupRole === 'anchor') return -1;
      if (b.groupRole === 'anchor') return 1;
      return (a.groupOffsetDays ?? 0) - (b.groupOffsetDays ?? 0);
    });
}

/** Disband a group: clear the four group fields on every member. The crop
 *  rows survive as singletons; their materialized tasks are untouched. */
export function disbandGroup(groupId: string): number {
  const result = db
    .update(crops)
    .set({ groupId: null, groupRole: null, groupOffsetDays: null, groupSystemKind: null })
    .where(eq(crops.groupId, groupId))
    .run();
  return result.changes;
}

/** Phase 15 — companion nudge. Operator confirms anchor's stage in field
 *  and shifts the companion's planting date ±N days. Updates the crop row,
 *  shifts the companion's primary "Plant" task by the same delta, and runs
 *  reanchorPluginPrePost so all dependent pre/post/seasonal tasks follow
 *  (overridden ones flag staleAnchor instead). Operator-overridden tasks
 *  retain their dates with stale flags so the operator can resolve them
 *  manually on /today. */
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
    const cropRow = db.select().from(crops).where(eq(crops.id, companionCropId)).get();
    if (!cropRow) throw new Error(`unknown crop: ${companionCropId}`);
    if (cropRow.groupRole !== 'companion') {
      throw new Error('only companion crops can be nudged');
    }
    if (!cropRow.plantingDate) throw new Error('companion has no planting date');

    const oldMs = cropRow.plantingDate.getTime();
    const newMs = oldMs + deltaDays * DAY_MS;
    db.update(crops)
      .set({ plantingDate: new Date(newMs) })
      .where(eq(crops.id, companionCropId))
      .run();

    const primaryRow = db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.cropId, companionCropId),
          eq(tasksTable.kind, 'primary'),
          eq(tasksTable.pluginTemplateKey, `crop:${cropRow.cropPluginId}:plant`)
        )
      )
      .get();

    let reanchored = { shifted: 0, flaggedStale: 0 };
    if (primaryRow) {
      const oldPrimaryMs = primaryRow.scheduledFor.getTime();
      const newPrimaryMs = oldPrimaryMs + deltaDays * DAY_MS;
      db.update(tasksTable)
        .set({ scheduledFor: new Date(newPrimaryMs) })
        .where(eq(tasksTable.id, primaryRow.id))
        .run();
      reanchored = reanchorPluginPrePost(primaryRow.id, oldPrimaryMs, newPrimaryMs);
    }

    return { newPlantingDateMs: newMs, reanchored };
  });
}

/** Phase 15 — anchor-swap guard. Returns true if cropId is the anchor of a
 *  multi-member group; the API/UI should reject plugin swaps in that case
 *  and ask the operator to disband the group first. */
export function isGroupAnchorWithMembers(cropId: string): boolean {
  const row = db.select().from(crops).where(eq(crops.id, cropId)).get();
  if (!row || row.groupRole !== 'anchor' || !row.groupId) return false;
  const siblings = db
    .select()
    .from(crops)
    .where(and(eq(crops.groupId, row.groupId), isNotNull(crops.groupId)))
    .all();
  return siblings.length > 1;
}

/** Phase 15d — un-schedule a single crop. Mirrors `clearSchedule` but
 *  scoped to one row: cascade-deletes the crop's tasks, nulls plantingDate,
 *  clears its group binding, flips status back to 'planned'. The crop row
 *  itself stays attached to its block as a draft — operator can re-schedule
 *  it later via auto-schedule, the wizard, or drag-from-catalog.
 *
 *  Edge case: if the crop is part of a group, disband the *entire* group
 *  first so we don't leave companion rows pointing at a phantom anchor.
 *  Companions keep their plantingDates (they're real plantings); they just
 *  lose the group binding. */
export function unscheduleCrop(
  cropId: string
): { tasksDeleted: number; disbandedGroupId?: string } {
  return db.transaction(() => {
    const row = db.select().from(crops).where(eq(crops.id, cropId)).get();
    if (!row) throw new Error(`unknown crop: ${cropId}`);

    let disbandedGroupId: string | undefined;
    if (row.groupId) {
      disbandedGroupId = row.groupId;
      db.update(crops)
        .set({ groupId: null, groupRole: null, groupOffsetDays: null, groupSystemKind: null })
        .where(eq(crops.groupId, row.groupId))
        .run();
    }

    const tasksDeleted = cascadeDeleteForCrop(cropId);

    db.update(crops)
      .set({ plantingDate: null, status: 'planned' })
      .where(eq(crops.id, cropId))
      .run();

    return { tasksDeleted, disbandedGroupId };
  });
}

/** Phase 15d — clear the entire season's schedule in one transaction. For
 *  every non-harvested crop with a planting date or group binding: cascade-
 *  delete its tasks (primary, pre/post, seasonal, companion-check), null the
 *  plantingDate, clear the four group columns, and flip status back to
 *  'planned' so it shows up as a draft. Crops themselves stay attached to
 *  their blocks for a fresh auto-schedule or wizard pass. */
export function clearSchedule(
  blockIdFilter?: Set<string> | null
): { unscheduled: number; tasksDeleted: number } {
  return db.transaction(() => {
    const rows = db.select().from(crops).all();
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
        .where(eq(crops.id, row.id))
        .run();
      unscheduled++;
    }
    return { unscheduled, tasksDeleted };
  });
}

/** List groups present on a block, with member counts. Used by the schedule
 *  read model to draw group brackets over the swim-lane. */
export function listGroupsOnBlock(
  blockId: string
): Array<{ groupId: string; systemKind: GroupSystemKind; memberCount: number }> {
  const rows = db
    .select()
    .from(crops)
    .where(and(eq(crops.blockId, blockId), isNotNull(crops.groupId)))
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
