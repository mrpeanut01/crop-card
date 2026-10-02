/**
 * 33B facts beside each block's status (plan item 2, B-41, O-03, O-04):
 * inputs whose library entry is not marked organic-allowed, plantings from
 * seed recorded as treated, and the last such input on file. Facts only;
 * the derived transition line stays null while `NOP_RULES` has no
 * verified month count.
 */

import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listFertilityApplicationsInWindow, listTreatedSeedPlantings } from '$lib/db/organicFacts';
import { listApplicationTombstones } from '$lib/db/admin';
import { getRegistry } from '$lib/server/registry';
import { NOP_RULES, type NopRules } from './nopRules';
import { organicInputClass, type OrganicInputClass } from './inputCompliance';

export type OrganicPluginLookup = (
  pluginId: string
) => { type: string; displayName?: string; complianceFlags?: Record<string, unknown> } | undefined;

export interface BlockOrganicFacts {
  blockId: string;
  applications: {
    kind: 'spray' | 'insecticide' | 'fungicide' | 'fertility';
    id: string;
    occurredAt: number;
    product: string;
    pluginId: string | null;
    inputClass: 'not-allowed' | 'not-marked';
    /** The record was deleted but the dose still counts as applied. */
    deleted: boolean;
  }[];
  treatedSeedPlantings: { cropId: string; stockLotId: string; at: number }[];
  lastNonAllowedAt: number | null;
  /** Null while NOP_RULES.landTransitionMonths is null (O-03, B-04). */
  transitionLine: string | null;
}

type Application = BlockOrganicFacts['applications'][number] & { blockId: string };

function classOf(plugin: ReturnType<OrganicPluginLookup>): OrganicInputClass {
  return organicInputClass(plugin as Parameters<typeof organicInputClass>[0]);
}

function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  target.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return target.getTime();
}

/** O-03: only with a verified month count, and always "Your certifier
 *  decides." */
export function transitionLine(
  lastAt: number | null,
  fmtDate: (ms: number) => string,
  rules: Readonly<NopRules> = NOP_RULES
): string | null {
  if (rules.landTransitionMonths === null || lastAt === null) return null;
  const months = rules.landTransitionMonths;
  return `By these records, ${months} months after ${fmtDate(lastAt)} is ${fmtDate(addMonths(lastAt, months))}. Your certifier decides.`;
}

function allApplications(toMs: number, plugin: OrganicPluginLookup): Application[] {
  const out: Application[] = [];
  const push = (
    kind: Application['kind'],
    id: string,
    blockId: string | null | undefined,
    occurredAt: number,
    product: string,
    pluginId: string | null,
    deleted = false
  ) => {
    if (!blockId) return;
    const inputClass = classOf(pluginId ? plugin(pluginId) : undefined);
    if (inputClass === 'allowed') return;
    out.push({ kind, id, blockId, occurredAt, product, pluginId, inputClass, deleted });
  };
  for (const e of listSprayEvents({ toMs })) {
    for (const p of e.products) {
      push(
        'spray',
        e.id,
        e.blockId,
        e.occurredAt,
        plugin(p.pluginId)?.displayName ?? p.pluginId,
        p.pluginId
      );
    }
  }
  for (const e of listInsecticideEvents({ toMs })) {
    for (const p of e.products) {
      push('insecticide', e.id, e.blockId, e.occurredAt, p.displayName || p.pluginId, p.pluginId);
    }
  }
  for (const e of listFungicideEvents({ toMs })) {
    for (const p of e.products) {
      push('fungicide', e.id, e.blockId, e.occurredAt, p.displayName || p.pluginId, p.pluginId);
    }
  }
  for (const t of listApplicationTombstones(0)) {
    if (t.occurredAt > toMs) continue;
    for (const p of t.products) {
      const pluginId = p.pluginId ?? null;
      const name =
        (pluginId ? plugin(pluginId)?.displayName : undefined) ||
        p.displayName ||
        pluginId ||
        'Product not named';
      push(t.source, t.id, t.blockId, t.occurredAt, name, pluginId, true);
    }
  }
  for (const f of listFertilityApplicationsInWindow({ fromMs: 0, toMs })) {
    const sourcePlugin = plugin(f.source);
    const pluginId = f.stockPluginId ?? (sourcePlugin?.type === 'fertilizer' ? f.source : null);
    const name =
      f.stockItemName ?? (pluginId ? plugin(pluginId)?.displayName : undefined) ?? f.source;
    push('fertility', f.id, f.blockId, f.occurredAt, name, pluginId);
  }
  return out;
}

export function blockOrganicFacts(
  blockIds: readonly string[],
  window: { fromMs: number; toMs: number },
  plugin: OrganicPluginLookup,
  fmtDate: (ms: number) => string = (ms) => new Date(ms).toISOString().slice(0, 10)
): Map<string, BlockOrganicFacts> {
  const wanted = new Set(blockIds);
  const out = new Map<string, BlockOrganicFacts>();
  if (wanted.size === 0) return out;
  const apps = allApplications(window.toMs, plugin).filter((a) => wanted.has(a.blockId));
  const seeds = listTreatedSeedPlantings(window).filter((p) => wanted.has(p.blockId));
  for (const blockId of wanted) {
    const mine = apps.filter((a) => a.blockId === blockId);
    const last = mine.reduce<number | null>(
      (m, a) => (m === null || a.occurredAt > m ? a.occurredAt : m),
      null
    );
    out.set(blockId, {
      blockId,
      applications: mine
        .filter((a) => a.occurredAt >= window.fromMs && a.occurredAt <= window.toMs)
        .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
        .map(({ blockId: _b, ...a }) => a),
      treatedSeedPlantings: seeds
        .filter((p) => p.blockId === blockId)
        .map(({ cropId, stockLotId, at }) => ({ cropId, stockLotId, at })),
      lastNonAllowedAt: last,
      transitionLine: transitionLine(last, fmtDate)
    });
  }
  return out;
}

/** The facts with the farm's current library view (B-19). */
export async function loadBlockOrganicFacts(
  blockIds: readonly string[],
  window: { fromMs: number; toMs: number },
  fmtDate?: (ms: number) => string
): Promise<Map<string, BlockOrganicFacts>> {
  const registry = await getRegistry();
  const lookup: OrganicPluginLookup = (id) => {
    const p = registry.get(id)?.plugin as
      { type: string; displayName?: string; complianceFlags?: Record<string, unknown> } | undefined;
    return p;
  };
  return blockOrganicFacts(blockIds, window, lookup, fmtDate);
}
