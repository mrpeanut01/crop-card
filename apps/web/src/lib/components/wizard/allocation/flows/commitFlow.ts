import type { InputsPlanApplication, InputsPlanScoutTask } from '$lib/plan/inputsPlan';
import { fmtDateMs } from '../format';
import { establishmentPayload } from '$lib/schedule/seedStart';
import type { AllocationWizardState } from '../wizardState.svelte';
import type { AllocationResponse, ScheduledPlanting } from '../types';
import { apportionLotQuantity, splitGroupIds } from '$lib/plan/splitGroup';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

/** One planting the commit step posts, kept in wizard state so a retry
 *  sends the same body, client record id and split group id. */
export interface CommitRow {
  key: string;
  stockItemId: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plants: number;
  plantingDateMs?: number;
  /** Seed drawn; undefined for a fill-to-bed seed. */
  quantity?: number;
  unit: string;
  splitGroupId?: string;
  sourceProvenance: 'ai' | 'fallback';
  clientRecordId: string;
  label: string;
}

export interface AcceptedInputs {
  applications: InputsPlanApplication[];
  scoutTasks: InputsPlanScoutTask[];
  aiRefined: boolean;
}

/** Step 5 → 6: persist plantings (dated when the scheduler ran, undated
 *  otherwise), then the accepted Inputs Plan tasks, then clear the draft. */
export class CommitFlow {
  #w: AllocationWizardState;

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  /** The grower's "Seed or seedling?" answer for a crop, as request fields.
   *  The server writes any seed-start tasks (E1-10). */
  answerFor(cropPluginId: string) {
    const a = this.#w.establishmentByCrop[cropPluginId];
    return a ? establishmentPayload(a.establishment, a.startIndoors, a.sowIndoorsOn) : {};
  }

  async handleInputsAccepted(accepted: AcceptedInputs) {
    this.#w.acceptedInputs = accepted;
    await this.commit();
  }

  async commit() {
    const response = this.#w.response;
    if (!response) return;
    this.#w.step = 'commit';
    this.#w.error = null;

    // Phase B5 — if the scheduler ran, commit one dated row per scheduled
    // planting (successions are already split). Otherwise commit one undated
    // row per assignment.
    if (this.#w.scheduleResponse && this.#w.scheduleResponse.scheduled.length > 0) {
      await this.commitScheduled(this.#w.scheduleResponse.scheduled);
      return;
    }
    // #212 — every wizard-committed planting carries a provenance flag so
    // PlantingCard's footer reads "AI plan" / "Fallback" instead of
    // "Manual entry".
    const planProvenance: 'ai' | 'fallback' = response.meta.fallback ? 'fallback' : 'ai';
    this.#w.commitRows = this.buildRows(
      response.assignments.map((a) => ({ ...a, plantingDateMs: undefined })),
      planProvenance
    );
    await this.postRows(this.#w.commitRows);
  }

  /** Phase B5 — dated commit: one planting per scheduled row, successions
   *  included. */
  async commitScheduled(plantings: ScheduledPlanting[]) {
    // #212 — 'fallback' when either the allocator or the scheduler fell back.
    const planProvenance: 'ai' | 'fallback' =
      this.#w.response?.meta.fallback || this.#w.scheduleResponse?.meta.fallback
        ? 'fallback'
        : 'ai';
    this.#w.commitRows = this.buildRows(plantings, planProvenance);
    await this.postRows(this.#w.commitRows);
  }

  /** Phase 35 (R-19): posts only the rows that did not save, with the same
   *  client record ids and split group ids, so a row that saved on the
   *  server but looked failed in the browser is never saved twice. */
  async retryFailed() {
    const failed = new Set(this.#w.commitFailedKeys);
    const rows = this.#w.commitRows.filter((r) => failed.has(r.key));
    if (rows.length === 0) return;
    this.#w.commitRetrying = true;
    try {
      await this.postRows(rows);
    } finally {
      this.#w.commitRetrying = false;
    }
  }

  /** One commit row per planting: the seed drawn is apportioned over the
   *  lot's rows so it adds up to the selected quantity (R-18), and every
   *  row of a lot on two or more blocks carries one split group id (R-12). */
  buildRows(
    plantings: ReadonlyArray<{
      stockItemId: string;
      blockId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      plants: number;
      plantingDateMs?: number;
    }>,
    sourceProvenance: 'ai' | 'fallback'
  ): CommitRow[] {
    const keyed = plantings.map((p, i) => ({ ...p, key: `r${i}` }));
    const groupIds = splitGroupIds(keyed);
    const quantities = new Map<string, number>();
    const byLot = new Map<string, typeof keyed>();
    for (const p of keyed) {
      const list = byLot.get(p.stockItemId) ?? [];
      list.push(p);
      byLot.set(p.stockItemId, list);
    }
    for (const [stockItemId, rows] of byLot) {
      if (this.#w.isFillToBed(stockItemId)) continue;
      const unit = this.unitFor(stockItemId);
      const selected = this.#w.selectedSeeds.get(stockItemId) ?? 0;
      for (const [k, v] of apportionLotQuantity(selected, unit, rows)) quantities.set(k, v);
    }
    return keyed.map((p) => {
      const dated = p.plantingDateMs !== undefined;
      return {
        key: p.key,
        stockItemId: p.stockItemId,
        blockId: p.blockId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plants: p.plants,
        plantingDateMs: p.plantingDateMs,
        quantity: quantities.get(p.key),
        unit: this.unitFor(p.stockItemId),
        splitGroupId: groupIds.get(p.stockItemId),
        sourceProvenance,
        clientRecordId: newClientRecordId(),
        label: dated
          ? `${p.varietyDisplayName} → ${this.#w.blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs!)})`
          : `${p.varietyDisplayName} → ${this.#w.blockNameFor(p.blockId)}`
      };
    });
  }

  unitFor(stockItemId: string): string {
    return (
      this.#w.props.seedStock.find((s) => s.stockItemId === stockItemId)?.defaultUnit ?? 'seeds'
    );
  }

  async postRows(rows: ReadonlyArray<CommitRow>) {
    const stillFailed = new Set(this.#w.commitFailedKeys);
    for (const r of rows) stillFailed.delete(r.key);
    const failedNow: string[] = [];
    this.#w.commitProgress = {
      done: this.#w.commitRows.length - rows.length,
      total: this.#w.commitRows.length,
      failed: []
    };
    for (const r of rows) {
      let ok: boolean;
      try {
        const res = await fetch(`/api/blocks/${r.blockId}/plantings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [CLIENT_RECORD_HEADER]: r.clientRecordId
          },
          body: JSON.stringify({
            cropPluginId: r.cropPluginId,
            varietyDisplayName: r.varietyDisplayName,
            // #471 — a fill-to-bed seed has no counted quantity to record.
            quantityPlanted: r.quantity,
            quantityUnit: r.unit,
            // #555: a crop sown by area has no plant count to record.
            plannedPlants:
              r.plants > 0 && !this.#w.isAreaCrop(r.cropPluginId)
                ? Math.round(r.plants)
                : undefined,
            stockItemId: r.stockItemId,
            ...(r.plantingDateMs !== undefined ? { plantingDate: r.plantingDateMs } : {}),
            sourceProvenance: r.sourceProvenance,
            ...(r.splitGroupId ? { splitGroupId: r.splitGroupId } : {}),
            ...this.answerFor(r.cropPluginId)
          })
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (!ok) failedNow.push(r.key);
      this.#w.commitProgress = {
        ...this.#w.commitProgress,
        done: this.#w.commitProgress.done + 1
      };
    }
    for (const k of failedNow) stillFailed.add(k);
    const order = this.#w.commitRows.map((r) => r.key).filter((k) => stillFailed.has(k));
    this.#w.commitFailedKeys = order;
    const labels = new Map(this.#w.commitRows.map((r) => [r.key, r.label]));
    this.#w.commitProgress = {
      ...this.#w.commitProgress,
      done: this.#w.commitRows.length - order.length,
      failed: order.map((k) => labels.get(k) ?? k)
    };
    if (order.length === 0) {
      await this.commitAcceptedInputs();
      await this.#w.discardDraft();
      this.#w.props.onCommitted();
    }
  }

  /** POST the operator-accepted Inputs Plan rows as tasks (Phase 21 /
   *  B-28). Runs after plantings persist so the commit endpoint can
   *  resolve cropId via the (blockId, cropPluginId) lookup. A failure
   *  here doesn't block the planting commit — the operator can rerun
   *  the wizard or build tasks manually. */
  async commitAcceptedInputs(): Promise<void> {
    const acceptedInputs = this.#w.acceptedInputs;
    if (!acceptedInputs) return;
    if (acceptedInputs.applications.length === 0 && acceptedInputs.scoutTasks.length === 0) {
      return;
    }
    try {
      const res = await fetch('/api/plan/inputs/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applications: acceptedInputs.applications,
          scoutTasks: acceptedInputs.scoutTasks,
          aiRefined: acceptedInputs.aiRefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        this.#w.inputsCommitError = body.error ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      this.#w.inputsCommitError = e instanceof Error ? e.message : String(e);
    }
  }

  /** The seed drawn per assignment (keys `stockItemId:blockId`), adding up
   *  to the selected quantity per lot (R-18). */
  buildCommitQuantities(assignments: AllocationResponse['assignments']): Map<string, number> {
    const out = new Map<string, number>();
    const byStock = new Map<string, AllocationResponse['assignments']>();
    for (const a of assignments) {
      const list = byStock.get(a.stockItemId) ?? [];
      list.push(a);
      byStock.set(a.stockItemId, list);
    }
    for (const [stockItemId, items] of byStock) {
      const entry = this.#w.props.seedStock.find((s) => s.stockItemId === stockItemId);
      if (!entry) continue;
      const selectedQty = this.#w.selectedSeeds.get(stockItemId) ?? 0;
      if (selectedQty <= 0) continue;
      if (items.reduce((s, x) => s + x.plants, 0) <= 0) continue;
      const parts = apportionLotQuantity(
        selectedQty,
        entry.defaultUnit,
        items.map((a) => ({ key: `${stockItemId}:${a.blockId}`, plants: a.plants }))
      );
      for (const [k, v] of parts) out.set(k, v);
    }
    return out;
  }
}

/** A client record id for one commit row (R-19). */
function newClientRecordId(): string {
  return crypto.randomUUID();
}
