/**
 * Reads one season of money for the active Owner and folds it through the
 * pure `seasonProfit` (F2-7, F2-12). Every read is tenant-scoped. Owner
 * only: callers check the role before calling.
 */

import { t } from '$lib/i18n';
import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  animalGroups,
  animalHealthEvents,
  animals,
  blocks,
  crops,
  fertilityApplications,
  fields,
  fungicideEvents,
  insecticideEvents,
  sprayEvents,
  stockLots,
  stockMovements,
  taskTimeEntries,
  users
} from '$lib/db/schema';
import { unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { getSetting } from '$lib/db/settings';
import { listLedgerEntries, type LedgerEntry } from '$lib/db/ledger';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { farmTimeZone } from '$lib/db/userProfile';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { dateTimeFormat } from '$lib/intlCache';
import { membershipsFromStays } from '$lib/animals/membership';
import { parseFeedUseNote } from '$lib/stock/animalStock';
import { getRegistry } from '$lib/server/registry';
import { lotCostCentsPerUnit } from './unitCost';
import {
  NOT_TIED_LABEL,
  resolveEnterprise,
  seasonProfit,
  type GroupWindow,
  type MoneyLink,
  type SeasonProfit,
  type SeasonProfitInput,
  type StockUseRow
} from './profit';
import { personName } from './people';

export const LABOUR_RATE_SETTING = 'labour_rate_cents_per_hour';

export function readLabourRate(): number | null {
  const raw = getSetting(LABOUR_RATE_SETTING);
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** F2-3: the calendar year in the farm's time zone, as [from, to). */
export function seasonBounds(year: number): { fromMs: number; toMs: number } {
  const tz = farmTimeZone();
  return { fromMs: zonedDayStartMs(year, 1, 1, tz), toMs: zonedDayStartMs(year + 1, 1, 1, tz) };
}

export function currentSeasonYear(now = Date.now()): number {
  const parts = dateTimeFormat('en-US', { timeZone: farmTimeZone(), year: 'numeric' })
    .formatToParts(new Date(now))
    .find((p) => p.type === 'year');
  return Number(parts?.value ?? new Date(now).getUTCFullYear());
}

const HEALTH_NOTE = /^animal-health:(.+)$/;

interface MovementRow {
  occurredAt: Date;
  deltaHundredths: number;
  reason: string;
  cropId: string | null;
  notes: string | null;
  sprayEventId: string | null;
  insecticideEventId: string | null;
  fungicideEventId: string | null;
  fertilityApplicationId: string | null;
  receivedCostCents: number | null;
  receivedQuantityHundredths: number;
}

function useMovements(fromMs: number, toMs: number): MovementRow[] {
  return db
    .select({
      occurredAt: stockMovements.occurredAt,
      deltaHundredths: stockMovements.deltaHundredths,
      reason: stockMovements.reason,
      cropId: stockMovements.cropId,
      notes: stockMovements.notes,
      sprayEventId: stockMovements.sprayEventId,
      insecticideEventId: stockMovements.insecticideEventId,
      fungicideEventId: stockMovements.fungicideEventId,
      fertilityApplicationId: stockMovements.fertilityApplicationId,
      receivedCostCents: stockLots.receivedCostCents,
      receivedQuantityHundredths: stockLots.receivedQuantityHundredths
    })
    .from(stockMovements)
    .innerJoin(stockLots, and(eq(stockMovements.stockLotId, stockLots.id), withTenant(stockLots)))
    .where(
      withTenant(
        stockMovements,
        lt(stockMovements.deltaHundredths, 0),
        gte(stockMovements.occurredAt, new Date(fromMs)),
        lt(stockMovements.occurredAt, new Date(toMs))
      )
    )
    .all();
}

type EventTable =
  | typeof sprayEvents
  | typeof insecticideEvents
  | typeof fungicideEvents
  | typeof fertilityApplications;

function eventPlaces(
  table: EventTable,
  ids: string[]
): Map<string, { cropId: string | null; blockId: string }> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ id: table.id, cropId: table.cropId, blockId: table.blockId })
    .from(table)
    .where(withTenant(table, inArray(table.id, [...new Set(ids)])))
    .all();
  return new Map(rows.map((r) => [r.id, { cropId: r.cropId ?? null, blockId: r.blockId }]));
}

function healthSubjects(ids: string[]): Map<string, MoneyLink> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({
      id: animalHealthEvents.id,
      subjectType: animalHealthEvents.subjectType,
      subjectId: animalHealthEvents.subjectId
    })
    .from(animalHealthEvents)
    .where(withTenant(animalHealthEvents, inArray(animalHealthEvents.id, [...new Set(ids)])))
    .all();
  return new Map(
    rows.map((r) => [
      r.id,
      r.subjectType === 'group' ? { animalGroupId: r.subjectId } : { animalId: r.subjectId }
    ])
  );
}

const LOST_REASONS = new Set(['adjustment', 'spill', 'expiry']);

/** F2-7: where each use of stock lands. Spray and fertility uses go to the
 *  event's planting, else to its Area as "not tied to one planting"; they
 *  are never split across plantings. */
function attributeUses(rows: MovementRow[], blockField: Map<string, string>): StockUseRow[] {
  const byEvent = (
    key: 'sprayEventId' | 'insecticideEventId' | 'fungicideEventId' | 'fertilityApplicationId'
  ) => rows.map((r) => r[key]).filter((x): x is string => !!x);
  const places = new Map([
    ...eventPlaces(sprayEvents, byEvent('sprayEventId')),
    ...eventPlaces(insecticideEvents, byEvent('insecticideEventId')),
    ...eventPlaces(fungicideEvents, byEvent('fungicideEventId')),
    ...eventPlaces(fertilityApplications, byEvent('fertilityApplicationId'))
  ]);
  const healthIds = rows
    .filter((r) => r.reason === 'animal-treatment')
    .map((r) => HEALTH_NOTE.exec(r.notes ?? '')?.[1])
    .filter((x): x is string => !!x);
  const health = healthSubjects(healthIds);

  return rows.map((r) => {
    const base = {
      occurredAt: r.occurredAt.getTime(),
      units: -r.deltaHundredths / 100,
      unitCostCents: lotCostCentsPerUnit(r.receivedCostCents, r.receivedQuantityHundredths)
    };
    if (LOST_REASONS.has(r.reason)) return { ...base, link: null, lost: true };
    if (r.reason === 'animal-treatment') {
      const id = HEALTH_NOTE.exec(r.notes ?? '')?.[1];
      return { ...base, link: (id && health.get(id)) || null };
    }
    if (r.reason === 'animal-feed') {
      const s = parseFeedUseNote(r.notes);
      const link: MoneyLink | null = s
        ? s.type === 'group'
          ? { animalGroupId: s.id }
          : { animalId: s.id }
        : null;
      return { ...base, link };
    }
    if (r.cropId) return { ...base, link: { cropId: r.cropId } };
    const eventId =
      r.sprayEventId ?? r.insecticideEventId ?? r.fungicideEventId ?? r.fertilityApplicationId;
    const place = eventId ? places.get(eventId) : undefined;
    if (!place) return { ...base, link: null };
    if (place.cropId) return { ...base, link: { cropId: place.cropId } };
    const fieldId = blockField.get(place.blockId) ?? null;
    return { ...base, link: fieldId ? { fieldId } : null, notTiedToPlanting: !!fieldId };
  });
}

function timeRows(fromMs: number, toMs: number) {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  return db
    .select({ minutes: taskTimeEntries.minutes, cropId: taskTimeEntries.cropId })
    .from(taskTimeEntries)
    .where(
      withTenant(
        taskTimeEntries,
        or(
          and(
            isNotNull(taskTimeEntries.startedAt),
            gte(taskTimeEntries.startedAt, from),
            lt(taskTimeEntries.startedAt, to)
          ),
          and(
            isNull(taskTimeEntries.startedAt),
            gte(taskTimeEntries.createdAt, from),
            lt(taskTimeEntries.createdAt, to)
          )
        )
      )
    )
    .all()
    .map((r) => ({ minutes: r.minutes, cropId: r.cropId ?? null }));
}

export interface FarmNames {
  plantingPlugin: Record<string, string>;
  plantingLabel: Record<string, string>;
  crop: Record<string, string>;
  group: Record<string, string>;
  animal: Record<string, string>;
  area: Record<string, string>;
  bed: Record<string, string>;
  blockField: Map<string, string>;
}

/** Names for everything money can link to, read once per request. */
export async function farmNames(): Promise<FarmNames> {
  const registry = await getRegistry();
  const plantings = db
    .select({
      id: crops.id,
      plugin: crops.cropPluginId,
      variety: crops.varietyDisplayName,
      plantingDate: crops.plantingDate
    })
    .from(crops)
    .where(withTenant(crops))
    .all();
  const plantingPlugin: Record<string, string> = {};
  const plantingLabel: Record<string, string> = {};
  const crop: Record<string, string> = {};
  for (const p of plantings) {
    plantingPlugin[p.id] = p.plugin;
    const name = (registry.get(p.plugin)?.plugin as { displayName?: string } | undefined)
      ?.displayName;
    crop[p.plugin] = name ?? p.plugin;
    plantingLabel[p.id] = p.variety || crop[p.plugin];
  }
  const group = Object.fromEntries(
    db
      .select({ id: animalGroups.id, name: animalGroups.name })
      .from(animalGroups)
      .where(withTenant(animalGroups))
      .all()
      .map((g) => [g.id, g.name])
  );
  const animal = Object.fromEntries(
    db
      .select({ id: animals.id, name: animals.name, tag: animals.tag })
      .from(animals)
      .where(withTenant(animals))
      .all()
      .map((a) => [a.id, a.name || (a.tag ? `Tag ${a.tag}` : 'Unnamed animal')])
  );
  const area = Object.fromEntries(
    db
      .select({ id: fields.id, name: fields.name })
      .from(fields)
      .where(withTenant(fields))
      .all()
      .map((f) => [f.id, f.name])
  );
  const blockRows = db
    .select({ id: blocks.id, name: blocks.name, label: blocks.blockLabel, fieldId: blocks.fieldId })
    .from(blocks)
    .where(withTenant(blocks))
    .all();
  const bed = Object.fromEntries(blockRows.map((b) => [b.id, b.label ?? b.name]));
  const blockField = new Map(
    blockRows.filter((b) => b.fieldId).map((b) => [b.id, b.fieldId as string])
  );
  return { plantingPlugin, plantingLabel, crop, group, animal, area, bed, blockField };
}

function animalWindows(animalIds: Set<string>): Record<string, GroupWindow[]> {
  if (animalIds.size === 0) return {};
  const current = new Map(
    db
      .select({ id: animals.id, groupId: animals.groupId })
      .from(animals)
      .where(withTenant(animals, inArray(animals.id, [...animalIds])))
      .all()
      .map((a) => [a.id, a.groupId ?? null])
  );
  const out: Record<string, GroupWindow[]> = {};
  for (const id of animalIds) {
    if (!current.has(id)) continue;
    out[id] = membershipsFromStays(current.get(id) ?? null, listLocationsForSubject('animal', id));
  }
  return out;
}

export interface SeasonMoney {
  year: number;
  fromMs: number;
  toMs: number;
  entries: LedgerEntry[];
  profit: SeasonProfit;
  names: FarmNames;
}

export async function loadSeasonMoney(year: number): Promise<SeasonMoney> {
  const { fromMs, toMs } = seasonBounds(year);
  const names = await farmNames();
  const entries = listLedgerEntries({ fromMs, toMs, state: 'live' });
  const stockUses = attributeUses(useMovements(fromMs, toMs), names.blockField);
  const animalIds = new Set<string>();
  for (const e of entries) if (e.animalId) animalIds.add(e.animalId);
  for (const u of stockUses) if (u.link?.animalId) animalIds.add(u.link.animalId);

  const input: SeasonProfitInput = {
    entries,
    stockUses,
    timeRows: timeRows(fromMs, toMs),
    labourRateCentsPerHour: readLabourRate(),
    plantingPlugin: names.plantingPlugin,
    animalGroups: animalWindows(animalIds),
    labels: { crop: names.crop, group: names.group, animal: names.animal, area: names.area }
  };
  return { year, fromMs, toMs, entries, profit: seasonProfit(input), names };
}

/** "Entered by" names for the list and CSV. */
export function enteredByNames(ids: Array<string | null>): Map<string, string> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  unscopedQueryNote('users is the global identity table; names only');
  const rows = db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      displayName: users.displayName
    })
    .from(users)
    .where(inArray(users.id, unique))
    .all();
  return new Map(rows.map((r) => [r.id, personName(r)]));
}

/** The "linked to" text for an entry: "Crop: Tomatoes", "Area: North garden". */
export function linkedToText(
  e: LedgerEntry,
  names: FarmNames,
  locale?: string | null
): string | null {
  if (e.cropId) {
    return t(locale, 'finance.link.crop', {
      name: names.plantingLabel[e.cropId] ?? t(locale, 'finance.link.aPlanting')
    });
  }
  if (e.animalGroupId) {
    return t(locale, 'finance.link.group', {
      name: names.group[e.animalGroupId] ?? t(locale, 'finance.link.aGroup')
    });
  }
  if (e.animalId) {
    return t(locale, 'finance.link.animal', {
      name: names.animal[e.animalId] ?? t(locale, 'finance.link.anAnimal')
    });
  }
  if (e.fieldId) {
    const area = names.area[e.fieldId] ?? t(locale, 'finance.link.anArea');
    return e.blockId && names.bed[e.blockId]
      ? t(locale, 'finance.link.areaBed', { area, bed: names.bed[e.blockId] })
      : t(locale, 'finance.link.area', { area });
  }
  return null;
}

export interface PresentedEntry extends LedgerEntry {
  linkedTo: string | null;
  enterpriseLabel: string;
  enteredBy: string | null;
}

/** The enterprise an entry counts under, as a name (F2-6, F2-11). */
export function enterpriseLabelFor(
  e: LedgerEntry,
  names: FarmNames,
  animalGroups: Record<string, GroupWindow[]> = {}
): string {
  if (e.kind === 'expense' && e.stockLotId) return 'Stock purchase (counted as used)';
  const r = resolveEnterprise(e, e.occurredAt, {
    plantingPlugin: names.plantingPlugin,
    animalGroups,
    labels: { crop: names.crop, group: names.group, animal: names.animal, area: names.area }
  });
  return r?.label ?? NOT_TIED_LABEL;
}

export function presentEntries(
  entries: LedgerEntry[],
  names: FarmNames,
  locale?: string | null
): PresentedEntry[] {
  const people = enteredByNames(entries.map((e) => e.createdById));
  const windows = animalWindows(
    new Set(entries.map((e) => e.animalId).filter((x): x is string => !!x))
  );
  return entries.map((e) => ({
    ...e,
    linkedTo: linkedToText(e, names, locale),
    enterpriseLabel: enterpriseLabelFor(e, names, windows),
    enteredBy: e.createdById ? (people.get(e.createdById) ?? null) : null
  }));
}
