import type { PageServerLoad } from './$types';
import { getBaseRegistry, getRegistry, getRegistryStats } from '$lib/server/registry';
import { HIDDEN_PAYLOAD, listEffectiveOverrides } from '$lib/db/pluginOverrides';
import { currentOwnerId } from '$lib/db/tenant';
import { currentVersionOf, historyOf } from '$lib/db/pluginVersions';
import { hracGroupOf } from '$lib/safety/cropFamilyLethality';
import type { Plugin } from '$lib/plugins/schemas';
import { t, type MessageKey } from '$lib/i18n';
import { cropFamilyLabel } from '$lib/plugins/familyLabel';

const FORM_KEYS: Record<string, MessageKey> = {
  granular: 'plugins.new.formGranular',
  liquid: 'plugins.new.formLiquid',
  soluble: 'plugins.new.formSoluble',
  compost: 'plugins.new.formCompost',
  'slow-release': 'plugins.new.formSlow',
  meal: 'plugins.new.formMeal'
};

type GroupChip = { kind: 'HRAC' | 'IRAC' | 'FRAC'; group: string };

function groupCodesFor(plugin: Plugin): GroupChip[] {
  const out: GroupChip[] = [];
  if (plugin.type === 'herbicide') {
    for (const ai of plugin.activeIngredients ?? []) {
      const g = hracGroupOf(ai.chemistryClass);
      if (g != null) out.push({ kind: 'HRAC', group: String(g) });
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
function summaryFor(plugin: Plugin, locale?: string | null): string {
  switch (plugin.type) {
    case 'crop': {
      const parts: string[] = [cropFamilyLabel(plugin.cropFamily, locale)];
      if (plugin.daysToMaturity) {
        parts.push(
          t(locale, 'pluginui.summary.maturity', {
            min: plugin.daysToMaturity.min,
            max: plugin.daysToMaturity.max
          })
        );
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
          t(locale, 'pluginui.summary.vs', {
            list: `${plugin.targetPests.slice(0, 2).join(', ')}${plugin.targetPests.length > 2 ? '…' : ''}`
          })
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
          t(locale, 'pluginui.summary.vs', {
            list: `${plugin.targetDiseases.slice(0, 2).join(', ')}${plugin.targetDiseases.length > 2 ? '…' : ''}`
          })
        );
      }
      return parts.join(' · ');
    }
    case 'fertilizer': {
      const { n, p, k } = plugin.analysis;
      const formKey = FORM_KEYS[plugin.form];
      const parts: string[] = [`${n}-${p}-${k}`, formKey ? t(locale, formKey) : plugin.form];
      if (plugin.organic) parts.push(t(locale, 'pluginui.summary.organic'));
      return parts.join(' · ');
    }
    case 'companion': {
      const parts: string[] = [];
      if (plugin.primaryFamily)
        parts.push(
          t(locale, 'pluginui.summary.anchor', {
            family: cropFamilyLabel(plugin.primaryFamily, locale)
          })
        );
      if (plugin.members?.length)
        parts.push(t(locale, 'pluginui.summary.members', { count: plugin.members.length }));
      if (plugin.goodWith?.length)
        parts.push(t(locale, 'pluginui.summary.goodWith', { count: plugin.goodWith.length }));
      return parts.join(' · ');
    }
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  const registry = await getRegistry();
  const base = await getBaseRegistry();
  const stats = getRegistryStats();
  const overrides = currentOwnerId() ? listEffectiveOverrides() : new Map();
  const farmRetired = [...overrides.values()]
    .filter((o) => o.payloadJson === HIDDEN_PAYLOAD)
    .map((o) => base.get(o.pluginId))
    .filter((r) => r !== undefined);
  const records = [...registry.all(), ...farmRetired].map((r) => {
    const current = currentVersionOf(r.plugin.pluginId);
    const history = historyOf(r.plugin.pluginId);
    const own = overrides.get(r.plugin.pluginId);
    return {
      farmOverride: !!own && own.payloadJson !== HIDDEN_PAYLOAD,
      farmRetired: own?.payloadJson === HIDDEN_PAYLOAD,
      pluginId: r.plugin.pluginId,
      type: r.plugin.type,
      displayName: r.plugin.displayName,
      version: r.plugin.version,
      hash: r.hash,
      historyCount: history.length,
      lastChangedAt: current?.createdAt ?? null,
      retiredAt: current?.retiredAt ?? null,
      groupCodes: groupCodesFor(r.plugin),
      summary: summaryFor(r.plugin, locals.locale)
    };
  });
  return {
    records,
    failures: stats.failures,
    loadedAt: stats.loadedAt ?? null,
    canEdit: locals.user?.role === 'owner',
    isSuperadmin: !!locals.user?.isSuperadmin && locals.authVia !== 'bearer'
  };
};
