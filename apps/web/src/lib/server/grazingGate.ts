/**
 * Call sites of the 32C grazing rule (`lib/safety/grazingInterval.ts`):
 * the move gate that runs between `planMove` and `applyMove`, and the hay
 * cut gate at `status='mowing'`. Reads go through the tenant-scoped repos
 * behind `loadGrazingContext` and `listBlocks`. Nobody has an override;
 * the only way to lift an unknown interval is the owner's label attestation
 * (C-32). Pets and other non-food animals get a warning (Q5).
 */

import { listBlocks } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import type { Field } from '$lib/db/fields';
import type { SessionRole } from '$lib/server/session';
import type { MovePlan } from '$lib/server/animals';
import { subjectFoodProducing } from '$lib/server/animals';
import { getAnimalGroupSummary } from '$lib/db/animalGroups';
import { formatClearDate } from '$lib/safety/animalWithdrawal';
import {
  evaluateGrazing,
  evaluateHayCut,
  presumeLactating,
  type GrazingFinding,
  type GrazingSubject,
  type GrazingVerdict
} from '$lib/safety/grazingInterval';
import {
  loadGrazingContext,
  stayCutErasesExposure,
  type GrazingContext
} from '$lib/server/areaGrazing';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { isMarker } from '$lib/animals/timeline';
import { foodSubjectFor } from '$lib/server/animalRecords';
import { getDataKinds } from '$lib/server/registry';
import { exposureFloorFor, serializeExposureFloor } from '$lib/safety/grazingExposure';
import { RULES_VERSION } from '$lib/safety/version';

/** A move dated at least this far back records animals that are already
 *  there. It is saved, and their food carries the exposure hold (C-30). */
export const ALREADY_THERE_MS = 30 * 60 * 1000;

export interface GrazingStopBody {
  code: 'GRAZING_INTERVAL' | 'GRAZING_UNKNOWN' | 'GRAZING_PROHIBITED';
  error: string;
  clearsAtMs: number | null;
  /** When the stop lifts even with no date on file: the end of the
   *  lookback window for a label that forbids grazing. Null otherwise. */
  holdEndsAtMs: number | null;
  products: string[];
  askOwner: boolean;
  ownerCanAttest: boolean;
  /** The Area whose label intervals the owner can add. */
  fieldId?: string | null;
}

export type GateResult =
  | {
      ok: true;
      warnings: string[];
      /** RULES_VERSION of the gate that let the move through. */
      rulesVersion?: string;
      /** Serialized dated exposure holds to store with the move. */
      exposureFloor?: string | null;
    }
  | { ok: false; status: 422; body: GrazingStopBody };

function applicationsOn(field: Field | null, blockId: string | null, context: GrazingContext) {
  const blocks = field
    ? listBlocks({ plantings: 'none' }).filter((b) => b.fieldId === field.id)
    : [];
  const ids = new Set(blocks.map((b) => b.id));
  if (blockId) ids.add(blockId);
  return context.applications.filter((a) => ids.has(a.blockId));
}

function active(verdict: GrazingVerdict): GrazingFinding[] {
  return verdict.findings.filter((f) => f.active);
}

function productList(findings: readonly GrazingFinding[]): string[] {
  return [...new Set(findings.map((f) => f.productName))];
}

function joinProducts(products: readonly string[]): string {
  if (products.length <= 1) return products[0] ?? 'a product';
  return `${products.slice(0, -1).join(', ')} and ${products[products.length - 1]}`;
}

function sprayedLine(place: string, findings: readonly GrazingFinding[], tz: string): string {
  const latest = findings.reduce((a, b) => (b.appliedAtMs > a.appliedAtMs ? b : a));
  const others = productList(findings).filter((p) => p !== latest.productName);
  const also = others.length ? ` (also ${joinProducts(others)})` : '';
  return `${place} was sprayed with ${latest.productName} on ${formatClearDate(latest.appliedAtMs, tz)}${also}`;
}

function stopBody(
  verdict: GrazingVerdict,
  place: string,
  what: 'graze' | 'hay',
  role: SessionRole,
  tz: string
): GrazingStopBody {
  const findings = active(verdict);
  const reason = verdict.reason ?? 'GRAZING_UNKNOWN';
  const who = what === 'graze' ? 'Food animals' : 'Hay';
  const verb = what === 'graze' ? "can't go there" : "can't be cut there";
  const kind = what === 'graze' ? 'grazing' : 'haying';
  let error: string;
  let holdEndsAtMs: number | null = null;
  if (reason === 'GRAZING_PROHIBITED') {
    const prohibited = findings.filter((f) => f.reason === 'GRAZING_PROHIBITED');
    const banned = productList(prohibited);
    holdEndsAtMs = Math.max(...prohibited.map((f) => f.windowEndsAtMs));
    const instead = what === 'graze' ? 'Pick another Area for them.' : 'Cut hay somewhere else.';
    error = `The label for ${joinProducts(banned)} forbids ${kind} where it was sprayed, so ${who.toLowerCase()} ${verb} until ${formatClearDate(holdEndsAtMs, tz)}, when that spray no longer counts. ${instead}`;
  } else if (reason === 'GRAZING_UNKNOWN') {
    const unknown = findings.filter((f) => f.reason === 'GRAZING_UNKNOWN');
    error = `${sprayedLine(place, unknown, tz)}, and its ${kind} time is not on file. ${who} ${verb} until the owner adds the ${kind} time from the label.`;
    if (role !== 'owner') error += ' Ask the owner.';
  } else {
    const date = verdict.clearsAtMs ?? verdict.knownClearsAtMs;
    error = `${sprayedLine(place, findings, tz)}. ${who} ${verb} until ${date === null ? 'its interval ends' : formatClearDate(date, tz)}.`;
  }
  return {
    code: reason,
    error,
    clearsAtMs: verdict.clearsAtMs,
    holdEndsAtMs,
    products: productList(findings),
    askOwner: reason === 'GRAZING_UNKNOWN' && role !== 'owner',
    ownerCanAttest: verdict.ownerCanAttest
  };
}

async function moveSubject(plan: MovePlan): Promise<GrazingSubject & { label: string }> {
  const { species } = await getDataKinds();
  const products = (id: string) => species.get(id)?.products ?? [];
  switch (plan.kind) {
    case 'group':
    case 'group-split':
      return {
        label: 'These animals',
        speciesId: plan.group.speciesId,
        foodProducing: subjectFoodProducing('group', plan.group.id),
        lactating: presumeLactating({ speciesProducts: products(plan.group.speciesId) })
      };
    case 'animal-to-area':
    case 'animal-to-group': {
      const a = plan.animal;
      const joining =
        plan.kind === 'animal-to-group'
          ? (getAnimalGroupSummary(plan.target.id)?.effectiveFoodProducing ?? true)
          : false;
      return {
        label: 'This animal',
        speciesId: a.speciesId,
        foodProducing: subjectFoodProducing('animal', a.id) || joining,
        lactating: presumeLactating({ speciesProducts: products(a.speciesId), sex: a.sex })
      };
    }
  }
}

/**
 * The move gate (C-21, C-29, C-30). Every move that lands animals on an
 * Area runs it, including group splits and joining a group that lives on
 * one. Only Areas with recorded applications can hold anything, so barns
 * and coops pass free. A move dated well in the past is saved with a
 * warning instead: the animals are already there, and their food is held.
 */
export async function grazingMoveGate(
  plan: MovePlan,
  role: SessionRole,
  timeZone: string,
  now = Date.now()
): Promise<GateResult> {
  if (!plan.field) return { ok: true, warnings: [], rulesVersion: RULES_VERSION };
  return gateOnArea(plan.field, () => moveSubject(plan), plan.movedAt, role, timeZone, now);
}

type Covering = ReturnType<typeof listLocationsForSubject>[number];

function coversAt(fromMs: number | null, toMs: number | null, atMs: number): boolean {
  return (fromMs === null || fromMs < atMs) && (toMs === null || atMs < toMs);
}

function ownCovering(type: 'animal' | 'group', id: string, atMs: number): Covering | null {
  return (
    listLocationsForSubject(type, id).find(
      (s) => !isMarker(s) && coversAt(s.fromMs, s.toMs, atMs)
    ) ?? null
  );
}

/**
 * The stay that places this subject at `atMs`: its own, else the stay of
 * the group it was in then (an animal's membership, a split-off group's
 * parent). Ending the subject's time there at `atMs`, by a move, a split,
 * a group change or a slaughter, cuts that stay short for this subject.
 */
export function coveringStayFor(
  type: 'animal' | 'group',
  id: string,
  atMs: number
): Covering | null {
  const own = ownCovering(type, id, atMs);
  if (own) return own;
  const ctx = foodSubjectFor(type, id);
  if (!ctx) return null;
  const via = ctx.subject.type === 'animal' ? ctx.subject.memberships : (ctx.subject.lineage ?? []);
  for (const m of via) {
    if (!coversAt(m.fromMs, m.toMs, atMs)) continue;
    const stay = ownCovering('group', m.groupId, atMs);
    if (stay) return stay;
  }
  return null;
}

const CUT_REFUSAL = {
  code: 'STAY_HAS_GRAZING_HOLD' as const,
  error:
    'The Area they were on was sprayed after this time while they were still there, or its label hold counts from when they left, so their food is on hold. Date it after that spray, or record it now.'
};

/**
 * C-30: a move dated inside an earlier stay ends that stay early for the
 * animals that move. That holds for a whole group, an ungrouped animal, a
 * group split (the new group's lineage ends at the split) and a grouped
 * animal leaving or changing group (its membership ends then). It is
 * refused when cutting the stay there would drop or shorten a food hold, so
 * a backdated record cannot erase the exposure. Moving them now always works.
 */
export async function moveTruncationRefusal(
  plan: MovePlan,
  timeZone: string,
  now = Date.now()
): Promise<{ code: 'STAY_HAS_GRAZING_HOLD'; error: string } | null> {
  let covering: Covering | null = null;
  if (plan.kind === 'group' || plan.kind === 'group-split') {
    covering = coveringStayFor('group', plan.group.id, plan.movedAt);
  } else {
    covering = coveringStayFor('animal', plan.animal.id, plan.movedAt);
  }
  if (!covering) return null;
  if (!(await stayCutErasesExposure(covering, plan.movedAt, timeZone, now))) return null;
  return CUT_REFUSAL;
}

/**
 * C-17 and C-30 on the status path: a slaughter or sale for meat ends the
 * animal's time on its Area. Dated back inside a stay across a spray made
 * while it was still there, or into a running pre-slaughter removal, it
 * would clear meat the stay holds, so it is refused like a backdated move.
 */
export async function meatCutRefusal(
  subjectType: 'animal' | 'group',
  subjectId: string,
  occurredAt: number,
  timeZone: string,
  now = Date.now()
): Promise<{ code: 'STAY_HAS_GRAZING_HOLD'; error: string } | null> {
  const covering = coveringStayFor(subjectType, subjectId, occurredAt);
  if (!covering) return null;
  if (!(await stayCutErasesExposure(covering, occurredAt, timeZone, now))) return null;
  return CUT_REFUSAL;
}

/**
 * C-29: adding an animal or a group straight onto an Area runs the same
 * gate as moving it there. `joiningGroupFoodProducing` is set when the new
 * animal joins a group that lives on the Area.
 */
export async function grazingPlacementGate(
  input: {
    fieldId: string | null;
    speciesId: string;
    sex?: string | null;
    foodProducing: boolean;
    kind: 'animal' | 'group';
  },
  role: SessionRole,
  timeZone: string,
  now = Date.now()
): Promise<GateResult> {
  const field = input.fieldId ? (getField(input.fieldId) ?? null) : null;
  if (!field) return { ok: true, warnings: [], rulesVersion: RULES_VERSION };
  const subject = async (): Promise<GrazingSubject & { label: string }> => {
    const { species } = await getDataKinds();
    return {
      label: input.kind === 'animal' ? 'This animal' : 'These animals',
      speciesId: input.speciesId,
      foodProducing: input.foodProducing,
      lactating: presumeLactating({
        speciesProducts: species.get(input.speciesId)?.products ?? [],
        sex: input.sex ?? undefined
      })
    };
  };
  return gateOnArea(field, subject, now, role, timeZone, now);
}

async function gateOnArea(
  field: Field,
  who: () => Promise<GrazingSubject & { label: string }>,
  atMs: number,
  role: SessionRole,
  timeZone: string,
  now: number
): Promise<GateResult> {
  const context = await loadGrazingContext(now, { fromAtMs: atMs });
  const applications = applicationsOn(field, null, context);
  if (applications.length === 0) return { ok: true, warnings: [], rulesVersion: RULES_VERSION };
  const subject = await who();
  const verdict = evaluateGrazing({
    applications,
    subject,
    attestations: context.attestations,
    atMs,
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  });
  const floorEntries = exposureFloorFor({
    fieldId: field.id,
    arrivedAtMs: atMs,
    applications,
    attestations: context.attestations,
    speciesId: subject.speciesId,
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  });
  const saved = {
    rulesVersion: RULES_VERSION,
    exposureFloor: floorEntries.length
      ? serializeExposureFloor({ rulesVersion: RULES_VERSION, entries: floorEntries })
      : null
  };
  if (verdict.status === 'clear') return { ok: true, warnings: [], ...saved };
  const findings = active(verdict);
  if (verdict.status === 'warn') {
    return {
      ok: true,
      ...saved,
      warnings: [
        `${sprayedLine(field.name, findings, timeZone)}, inside its grazing time. That is allowed for animals not used for food, but keep them off it if you can.`
      ]
    };
  }
  if (atMs <= now - ALREADY_THERE_MS) {
    return {
      ok: true,
      ...saved,
      warnings: [
        `${sprayedLine(field.name, findings, timeZone)}, inside its grazing time. The move is saved because it already happened. ${subject.label === 'This animal' ? 'Its' : 'Their'} eggs, milk and meat are on hold until the grazing time is over.`
      ]
    };
  }
  return {
    ok: false,
    status: 422,
    body: { ...stopBody(verdict, field.name, 'graze', role, timeZone), fieldId: field.id }
  };
}

/** The hay gate at `status='mowing'` (C-28): whatever animals the farm
 *  keeps, and whatever the weather override says. */
export async function hayCutGate(
  blockId: string,
  fieldId: string | null,
  atMs: number,
  role: SessionRole,
  timeZone: string
): Promise<GateResult> {
  const field = fieldId ? (getField(fieldId) ?? null) : null;
  const context = await loadGrazingContext(Date.now(), { fromAtMs: atMs });
  const applications = applicationsOn(field, blockId, context);
  if (applications.length === 0) return { ok: true, warnings: [] };
  const verdict = evaluateHayCut({
    applications,
    attestations: context.attestations,
    atMs,
    timeZone,
    registryMaxIntervalDays: context.registryMaxIntervalDays
  });
  if (verdict.status === 'clear') return { ok: true, warnings: [] };
  return {
    ok: false,
    status: 422,
    body: {
      ...stopBody(verdict, field?.name ?? 'This block', 'hay', role, timeZone),
      fieldId: field?.id ?? null
    }
  };
}
