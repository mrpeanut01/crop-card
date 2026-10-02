/**
 * Loads the forage advisory for one Area or hay cutting (Phase 33C, M-53 to
 * M-56). Called only from `GET /api/forage/advisory`, never from a page
 * loader, because the frost check can reach NOAA.
 */

import { farmTimeZone } from '$lib/db/userProfile';
import {
  forageFactsForArea,
  forageFactsForBlock,
  frostAlertTimes,
  listForageTests,
  type ForageAreaFacts
} from '$lib/db/forageTests';
import { getCutting } from '$lib/db/hayCuttings';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import { resolveWeatherLocation } from '$lib/server/weatherHourly';
import {
  getObservedHours,
  OBSERVED_MAX_SPAN_DAYS,
  stationLabel,
  type ObservedWeather
} from '$lib/server/weatherObserved';
import {
  buildForageAdvisory,
  frostFrom,
  frostWindow,
  type AdvisoryTarget,
  type ForageAdvisory,
  type FrostFacts
} from '$lib/forage/advisory';
import type { CropPlugin, ForageHazard } from '$lib/plugins/schemas';

const DAY_MS = 86_400_000;
/** M-55: the weather read gets three seconds. */
export const FROST_READ_BUDGET_MS = 3_000;

export interface ForageAdvisoryDeps {
  observe?: (lat: number, lon: number, fromMs: number, now: number) => Promise<ObservedWeather>;
  budgetMs?: number;
}

export type ForageTarget = { fieldId: string } | { hayCuttingId: string };

export class ForageTargetNotFound extends Error {}

async function readFrost(
  blockId: string | null,
  window: { fromMs: number; toMs: number },
  now: number,
  deps: ForageAdvisoryDeps
): Promise<FrostFacts> {
  const alerts = frostAlertTimes(window.fromMs);
  const location = resolveWeatherLocation(blockId);
  const tooOld = window.fromMs < now - OBSERVED_MAX_SPAN_DAYS * DAY_MS;
  if (!location || location.source === 'farm-default' || tooOld) {
    return frostFrom(window, { hours: [], failed: true }, alerts);
  }
  const observe = deps.observe ?? getObservedHours;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = await Promise.race([
      observe(location.lat, location.lon, window.fromMs, now),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.budgetMs ?? FROST_READ_BUDGET_MS);
      })
    ]);
    if (!observed) return frostFrom(window, { hours: [], failed: true }, alerts);
    const covered = observed.hours.some((h) => h.t >= window.fromMs && h.t <= window.toMs);
    return frostFrom(
      window,
      {
        hours: observed.hours,
        failed: !covered,
        where: observed.station ? `the ${stationLabel(observed.station)} station` : null
      },
      alerts
    );
  } catch {
    return frostFrom(window, { hours: [], failed: true }, alerts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The active Owner's advisory. Throws `ForageTargetNotFound` for an Area
 *  or cutting this farm does not have. */
export async function loadForageAdvisory(
  target: ForageTarget,
  now: number = Date.now(),
  deps: ForageAdvisoryDeps = {}
): Promise<ForageAdvisory> {
  const [base, registry] = await Promise.all([getBaseRegistry(), getRegistry()]);
  const hazardsFor = (pluginId: string) => {
    const shipped = base.get(pluginId)?.plugin;
    if (shipped?.type !== 'crop') return null;
    const hazards = (shipped as CropPlugin).forageHazards as ForageHazard[] | undefined;
    if (!hazards?.length) return null;
    const own = registry.get(pluginId)?.plugin;
    return { name: own?.displayName ?? shipped.displayName, hazards };
  };

  let facts: ForageAreaFacts;
  let advisoryTarget: AdvisoryTarget;
  let untilMs = now;
  if ('hayCuttingId' in target) {
    const cutting = getCutting(target.hayCuttingId);
    if (!cutting) throw new ForageTargetNotFound('hay cutting not found');
    facts = forageFactsForBlock(cutting.blockId, now);
    untilMs = cutting.mowAt ?? cutting.createdAt;
    advisoryTarget = {
      kind: 'hay',
      cuttingId: cutting.id,
      blockId: cutting.blockId,
      cropPluginId: cutting.cropPluginId,
      cutAt: untilMs
    };
  } else {
    facts = forageFactsForArea(target.fieldId, now);
    if (!facts.area) throw new ForageTargetNotFound('area not found');
    advisoryTarget = { kind: 'area', fieldId: target.fieldId };
  }

  const pluginIds =
    advisoryTarget.kind === 'hay'
      ? [advisoryTarget.cropPluginId]
      : facts.plantings.map((p) => p.cropPluginId);
  const needsFrost = pluginIds.some((id) =>
    hazardsFor(id)?.hazards.some((h) => h.triggers.includes('frost'))
  );
  const window = frostWindow(untilMs);
  const frost: FrostFacts = needsFrost
    ? await readFrost(facts.blocks[0]?.id ?? null, window, now, deps)
    : { seen: [], unknown: false };

  const tests = listForageTests({
    blockIds: facts.blocks.map((b) => b.id),
    hayCuttingIds: facts.cuts.map((c) => c.id)
  });

  return buildForageAdvisory({
    target: advisoryTarget,
    blocks: facts.blocks,
    plantings: facts.plantings,
    cuts: facts.cuts,
    nitrogen: facts.nitrogen,
    tests,
    frost,
    hazardsFor,
    timeZone: farmTimeZone(),
    now
  });
}
