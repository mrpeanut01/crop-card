import type { PageServerLoad } from './$types';
import { evaluateHealthLock, listHealthEvents } from '$lib/db/animalHealth';
import { listStockItems } from '$lib/db/stock';
import { healthPlugins, toTreatment } from '$lib/server/animalRecords';
import { getDataKinds } from '$lib/server/registry';
import { loadRecordPageBase } from '$lib/animals/recordPages.server';
import { daysLate } from '$lib/server/animalProductionGate';
import { carriesHold, computeWithdrawalClear, FOODS } from '$lib/safety/animalWithdrawal';
import { listHoldCorrections } from '$lib/db/holdCorrections';
import { listVoidedProductionLogs } from '$lib/db/animalProduction';
import { listVoidedStatusEvents } from '$lib/db/animalStatus';
import { correctionTouches } from '$lib/animals/holdGuardCopy';

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
        recordedLate: e.recordedLate === true,
        rulesVersion: e.rulesVersion
      };
    });
  const allCorrections = listHoldCorrections();
  const voidedHere = new Set(
    allCorrections.some(
      (c) => c.recordKind === 'animal-production' || c.recordKind === 'animal-status'
    )
      ? [...listVoidedProductionLogs(), ...listVoidedStatusEvents()]
          .filter((r) => r.subjectType === subject.type && r.subjectId === subject.id)
          .map((r) => r.id)
      : []
  );
  const corrections = allCorrections
    .filter(
      (c) =>
        correctionTouches(c.diffJson, `${subject.type}:${subject.id}`) ||
        ((c.recordKind === 'animal-production' || c.recordKind === 'animal-status') &&
          voidedHere.has(c.recordId))
    )
    .map((c) => ({ id: c.id, recordKind: c.recordKind, reason: c.reason, createdAt: c.createdAt }));
  return {
    ...base,
    events,
    corrections,
    products: library
      .map((p) => ({ id: p.pluginId, name: p.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stock: listStockItems()
      .filter((s) => s.category !== 'feed' && s.category !== 'bedding')
      .sort(
        (a, b) =>
          Number(b.category === 'animal-health') - Number(a.category === 'animal-health') ||
          a.displayName.localeCompare(b.displayName)
      )
      .map((s) => ({ id: s.id, name: s.displayName, unit: s.defaultUnit }))
  };
};
