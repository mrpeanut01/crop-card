import type { PageServerLoad } from './$types';
import { getRegistry, getRegistryStats } from '$lib/server/registry';
import { currentVersionOf, historyOf } from '$lib/db/pluginVersions';
import { hracGroupOf } from '$lib/safety/cropFamilyLethality';
import type { Plugin } from '$lib/plugins/schemas';

type GroupChip = { kind: 'HRAC' | 'IRAC' | 'FRAC'; group: string };

function groupCodesFor(plugin: Plugin): GroupChip[] {
  const out: GroupChip[] = [];
  if (plugin.type === 'herbicide') {
    for (const ai of plugin.activeIngredients ?? []) {
      const g = hracGroupOf(ai.chemistryClass);
      if (g !== undefined) out.push({ kind: 'HRAC', group: String(g) });
    }
  } else if (plugin.type === 'insecticide') {
    for (const ai of plugin.activeIngredients ?? []) {
      if (ai.iracGroup) out.push({ kind: 'IRAC', group: ai.iracGroup });
    }
  } else if (plugin.type === 'fungicide') {
    for (const ai of plugin.activeIngredients ?? []) {
      if (ai.fracCode) out.push({ kind: 'FRAC', group: ai.fracCode });
    }
  }
  return dedupe(out);
}

function dedupe(chips: GroupChip[]): GroupChip[] {
  const seen = new Set<string>();
  const out: GroupChip[] = [];
  for (const c of chips) {
    const key = `${c.kind}:${c.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** One-line summary surfaced under each row. Per-kind so the operator can
 *  recognize the product without opening the detail page. */
function summaryFor(plugin: Plugin): string {
  switch (plugin.type) {
    case 'crop': {
      const parts: string[] = [`${plugin.cropFamily}`];
      if (plugin.daysToMaturity) {
        parts.push(`${plugin.daysToMaturity.min}-${plugin.daysToMaturity.max}d to maturity`);
      }
      if (plugin.preHarvestIntervalDays != null)
        parts.push(`PHI ${plugin.preHarvestIntervalDays}d`);
      return parts.join(' · ');
    }
    case 'herbicide': {
      const parts: string[] = [];
      const ai = plugin.activeIngredients.map((x) => x.name).join(' + ');
      if (ai) parts.push(ai);
      if (plugin.ratePerAcre)
        parts.push(`${plugin.ratePerAcre.amount} ${plugin.ratePerAcre.unit}/A`);
      if (plugin.applicationTiming) parts.push(plugin.applicationTiming);
      if (plugin.deconRequired) parts.push('decon required');
      return parts.join(' · ');
    }
    case 'insecticide': {
      const parts: string[] = [];
      const ai = (plugin.activeIngredients ?? []).map((x) => x.name).join(' + ');
      if (ai) parts.push(ai);
      if (plugin.preHarvestIntervalDays != null)
        parts.push(`PHI ${plugin.preHarvestIntervalDays}d`);
      if (plugin.targetPests?.length) {
        parts.push(
          `vs ${plugin.targetPests.slice(0, 2).join(', ')}${plugin.targetPests.length > 2 ? '…' : ''}`
        );
      }
      return parts.join(' · ');
    }
    case 'fungicide': {
      const parts: string[] = [];
      const ai = plugin.activeIngredients.map((x) => x.name).join(' + ');
      if (ai) parts.push(ai);
      if (plugin.applicationTiming) parts.push(plugin.applicationTiming);
      if (plugin.targetDiseases?.length) {
        parts.push(
          `vs ${plugin.targetDiseases.slice(0, 2).join(', ')}${plugin.targetDiseases.length > 2 ? '…' : ''}`
        );
      }
      return parts.join(' · ');
    }
    case 'fertilizer': {
      const { n, p, k } = plugin.analysis;
      const parts: string[] = [`${n}-${p}-${k}`, plugin.form];
      if (plugin.organic) parts.push('organic');
      return parts.join(' · ');
    }
    case 'companion': {
      const parts: string[] = [];
      if (plugin.primaryFamily) parts.push(`anchor: ${plugin.primaryFamily}`);
      if (plugin.members?.length)
        parts.push(`${plugin.members.length} member${plugin.members.length === 1 ? '' : 's'}`);
      if (plugin.goodWith?.length) parts.push(`${plugin.goodWith.length} good-with`);
      return parts.join(' · ');
    }
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  const registry = await getRegistry();
  const stats = getRegistryStats();
  const records = registry.all().map((r) => {
    const current = currentVersionOf(r.plugin.pluginId);
    const history = historyOf(r.plugin.pluginId);
    return {
      pluginId: r.plugin.pluginId,
      type: r.plugin.type,
      displayName: r.plugin.displayName,
      version: r.plugin.version,
      hash: r.hash,
      historyCount: history.length,
      lastChangedAt: current?.createdAt ?? null,
      retiredAt: current?.retiredAt ?? null,
      groupCodes: groupCodesFor(r.plugin),
      summary: summaryFor(r.plugin)
    };
  });
  return {
    records,
    failures: stats.failures,
    loadedAt: stats.loadedAt ?? null,
    canEdit: locals.user?.role === 'owner'
  };
};
