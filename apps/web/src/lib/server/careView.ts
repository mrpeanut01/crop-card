/**
 * Care task cards for /today and the animal pages (Phase 32D, D1). Reads
 * only; the /today loader materializes first (D0-2).
 */

import {
  careSubjectKey,
  careSubjects,
  listCarePlansForSubject,
  type CarePlan,
  type CareSubject
} from '$lib/db/animalCarePlans';
import { listOpenCareTasks } from '$lib/db/careTasks';
import { speciesCareNote } from './carePlans';
import { listStockItems } from '$lib/db/stock';
import type { Task } from '$lib/db/tasks';
import {
  careCardTitle,
  careItemStatus,
  isHoldBearingCare,
  isSurfaced,
  msToYmd,
  parseCareMeta,
  rollupCareTasks,
  type CareCardView,
  type CareItemView,
  type CarePlanView
} from '$lib/animals/carePlans';
import { getDataKinds } from './registry';

export function careCards(
  open: readonly Task[],
  plans: ReadonlyMap<string, CarePlan>,
  subjects: ReadonlyMap<string, CareSubject>,
  todayYmd: string,
  opts: { surfacedOnly?: boolean; locale?: string | null } = {}
): CareCardView[] {
  const rows: {
    taskId: string;
    meta: NonNullable<ReturnType<typeof parseCareMeta>>;
    memberOfGroupId: string | null;
    view: CareItemView;
  }[] = [];
  for (const t of open) {
    const meta = parseCareMeta(t.recurrenceJson);
    if (!meta) continue;
    const plan = plans.get(meta.planId);
    const subject = subjects.get(careSubjectKey(meta.subjectType, meta.subjectId));
    if (!plan || !subject) continue;
    const scheduledOn = msToYmd(t.scheduledFor);
    if (opts.surfacedOnly) {
      const snoozed = scheduledOn > meta.dueOn;
      if (scheduledOn > todayYmd && (snoozed || !isSurfaced(meta, todayYmd))) continue;
    }
    rows.push({
      taskId: t.id,
      meta,
      memberOfGroupId: subject.groupId,
      view: {
        taskId: t.id,
        subjectType: meta.subjectType,
        subjectId: meta.subjectId,
        subjectName: subject.name,
        planId: plan.id,
        planTitle: plan.title,
        dueOn: meta.dueOn,
        scheduledOn,
        careKind: meta.careKind,
        intervalDays: plan.intervalDays,
        productPluginId: plan.productPluginId,
        foodProducing: subject.foodProducing,
        status: careItemStatus(scheduledOn, todayYmd)
      }
    });
  }
  const rollups = rollupCareTasks(rows);
  const groupIds = rollups.flatMap((r) => (r.groupId && r.items.length > 1 ? [r.groupId] : []));
  const groups = groupIds.length
    ? careSubjects(groupIds.map((id) => ({ subjectType: 'group' as const, subjectId: id })))
    : new Map<string, CareSubject>();
  return rollups.map((r) => {
    const items = r.items.map((i) => i.view);
    const groupName =
      r.groupId && items.length > 1
        ? (groups.get(careSubjectKey('group', r.groupId))?.name ?? null)
        : null;
    return {
      key: r.key,
      careKind: r.careKind,
      dueOn: r.dueOn,
      groupId: items.length > 1 ? r.groupId : null,
      groupName,
      title: careCardTitle(r.careKind, items, groupName, opts.locale),
      items
    };
  });
}

/** What the close form offers: library products and stock bottles. Only
 *  loaded when a card needs the health form. */
export async function careCloseFormData(cards: readonly CareCardView[]): Promise<{
  products: { id: string; name: string }[];
  stock: { id: string; name: string; unit: string }[];
}> {
  if (!cards.some((c) => isHoldBearingCare(c.careKind))) return { products: [], stock: [] };
  const library = (await getDataKinds()).animalHealth.all();
  return {
    products: library
      .map((p) => ({ id: p.pluginId, name: p.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stock: listStockItems().map((s) => ({ id: s.id, name: s.displayName, unit: s.defaultUnit }))
  };
}

/** The Care section of an animal or group page. */
export async function loadCareSection(
  subjectType: 'animal' | 'group',
  subjectId: string,
  speciesId: string,
  todayYmd: string,
  locale?: string | null
): Promise<{
  plans: CarePlanView[];
  cards: CareCardView[];
  products: { id: string; name: string }[];
  stock: { id: string; name: string; unit: string }[];
}> {
  const plans = listCarePlansForSubject(subjectType, subjectId);
  if (plans.length === 0) return { plans: [], cards: [], products: [], stock: [] };
  const species = (await getDataKinds()).species.get(speciesId);
  const planIds = new Set(plans.map((p) => p.id));
  const open = listOpenCareTasks().filter((t) => {
    const meta = parseCareMeta(t.recurrenceJson);
    return !!meta && planIds.has(meta.planId);
  });
  const subjects = careSubjects([{ subjectType, subjectId }]);
  const cards = careCards(open, new Map(plans.map((p) => [p.id, p])), subjects, todayYmd, {
    locale
  });
  return {
    plans: plans.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      intervalDays: p.intervalDays,
      onceOn: p.onceOn,
      nextDueOn: p.nextDueOn,
      leadDays: p.leadDays,
      active: p.active,
      provenance: p.provenance,
      note: speciesCareNote(species, p)
    })),
    cards,
    ...(await careCloseFormData(cards))
  };
}
