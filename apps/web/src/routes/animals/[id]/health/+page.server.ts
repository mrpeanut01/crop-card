import type { PageServerLoad } from './$types';
import { evaluateHealthLock, listHealthEvents } from '$lib/db/animalHealth';
import { listStockItems } from '$lib/db/stock';
import { healthPlugins, toTreatment } from '$lib/server/animalRecords';
import { getDataKinds } from '$lib/server/registry';
import { loadRecordPageBase } from '$lib/animals/recordPages.server';
import { daysLate } from '$lib/server/animalProductionGate';
import { carriesHold, computeWithdrawalClear, FOODS } from '$lib/safety/animalWithdrawal';

export const load: PageServerLoad = async (event) => {
  const base = await loadRecordPageBase(event);
  const plugins = await healthPlugins();
  const library = (await getDataKinds()).animalHealth.all();
  const { subject, timeZone } = base;
  const events = listHealthEvents(subject.type, subject.id)
    .reverse()
    .map((e) => {
      const holds = carriesHold(e);
      const locked =
        evaluateHealthLock(e, { carriesHold: holds, foodProducingNow: subject.foodProducing }) !==
        undefined;
      const treatment = toTreatment(e, { speciesId: subject.speciesId, sex: null });
      const clear = holds ? computeWithdrawalClear(treatment, plugins, { timeZone }) : null;
      const entries = treatment.entries === 'invalid' ? [] : treatment.entries;
      return {
        id: e.id,
        kind: e.kind,
        product: clear?.product ?? e.productName ?? null,
        administeredAt: e.administeredAt,
        courseEndAt: e.courseEndAt,
        courseOpen: treatment.courseOpen === true,
        dose: e.dose,
        doseUnit: e.doseUnit,
        route: e.route,
        labelUse: e.labelUse,
        vetName: e.vetName,
        lotNumber: e.lotNumber,
        notes: e.notes,
        carriesHold: holds,
        locked,
        foods: clear
          ? FOODS.filter((food) => base.foods.includes(food)).map((food) => ({
              food,
              hold: clear.foods[food]
            }))
          : [],
        entryCount: entries.length,
        daysLate: daysLate(e.administeredAt, e.createdAt),
        rulesVersion: e.rulesVersion
      };
    });
  return {
    ...base,
    events,
    products: library
      .map((p) => ({ id: p.pluginId, name: p.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stock: listStockItems().map((s) => ({ id: s.id, name: s.displayName, unit: s.defaultUnit }))
  };
};
