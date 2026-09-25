import type { InputsPlanApplication, InputsPlanScoutTask } from '$lib/plan/inputsPlan';
import { fmtDateMs } from '../format';
import type { AllocationWizardState } from '../wizardState.svelte';
import type { AllocationResponse, ScheduledPlanting } from '../types';

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
    // planting (successions are already split). Otherwise (no scheduler) fall
    // back to the pre-B5 path that commits one undated row per assignment.
    if (this.#w.scheduleResponse && this.#w.scheduleResponse.scheduled.length > 0) {
      await this.commitScheduled(this.#w.scheduleResponse.scheduled);
      return;
    }

    this.#w.commitProgress = {
      done: 0,
      total: response.assignments.length,
      failed: []
    };
    const quantities = this.buildCommitQuantities(response.assignments);
    // #212 — every wizard-committed planting carries a provenance flag so
    // PlantingCard's footer reads "AI plan" / "Fallback" instead of the
    // catch-all "Manual entry". Driven by the allocate response's
    // meta.fallback (set by aiTry on no-key / over-cap / quota-exceeded /
    // engine-only AI validation failures).
    const planProvenance: 'ai' | 'fallback' = response.meta.fallback ? 'fallback' : 'ai';
    for (const a of response.assignments) {
      const seedEntry = this.#w.props.seedStock.find((s) => s.stockItemId === a.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const quantityForCommit = quantities.get(`${a.stockItemId}:${a.blockId}`) ?? 0;
      try {
        const res = await fetch(`/api/blocks/${a.blockId}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId: a.cropPluginId,
            varietyDisplayName: a.varietyDisplayName,
            quantityPlanted: quantityForCommit,
            quantityUnit: unit,
            stockItemId: a.stockItemId,
            sourceProvenance: planProvenance
          })
        });
        if (!res.ok) {
          this.#w.commitProgress.failed.push(
            `${a.varietyDisplayName} → ${this.#w.blockNameFor(a.blockId)}`
          );
        }
      } catch {
        this.#w.commitProgress.failed.push(
          `${a.varietyDisplayName} → ${this.#w.blockNameFor(a.blockId)}`
        );
      }
      this.#w.commitProgress = { ...this.#w.commitProgress, done: this.#w.commitProgress.done + 1 };
    }
    if (this.#w.commitProgress.failed.length === 0) {
      await this.commitAcceptedInputs();
      await this.#w.discardDraft();
      this.#w.props.onCommitted();
    }
  }

  /** Phase B5 — dated commit. Walks the scheduler's `scheduled[]` and posts
   *  one planting per dated row, including succession entries. Seed quantity
   *  per row = (plants_i / total_plants_per_stock) × operator's original
   *  selectedSeeds quantity so stock decrement matches what was actually
   *  consumed. */
  async commitScheduled(plantings: ScheduledPlanting[]) {
    this.#w.commitProgress = {
      done: 0,
      total: plantings.length,
      failed: []
    };
    // Pre-compute total plants per (stockItemId) and the operator's seed
    // quantity so we can apportion per-row seed accurately.
    const totalPlantsByStock = new Map<string, number>();
    for (const p of plantings) {
      totalPlantsByStock.set(
        p.stockItemId,
        (totalPlantsByStock.get(p.stockItemId) ?? 0) + p.plants
      );
    }

    for (const p of plantings) {
      const seedEntry = this.#w.props.seedStock.find((s) => s.stockItemId === p.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const selectedQty = this.#w.selectedSeeds.get(p.stockItemId) ?? 0;
      const totalPlants = totalPlantsByStock.get(p.stockItemId) ?? 0;
      const seedQty = totalPlants > 0 ? (p.plants / totalPlants) * selectedQty : 0;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const quantityForCommit = isInteger
        ? Math.max(0, Math.round(seedQty))
        : Number(seedQty.toFixed(3));
      // #212 — provenance flag derived from BOTH the allocator AND the
      // scheduler: if either fell back to deterministic, the planting
      // carries 'fallback'; otherwise 'ai'. Mirrors the per-row chip on
      // the review + schedule steps.
      const planProvenance: 'ai' | 'fallback' =
        this.#w.response?.meta.fallback || this.#w.scheduleResponse?.meta.fallback
          ? 'fallback'
          : 'ai';
      try {
        const res = await fetch(`/api/blocks/${p.blockId}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId: p.cropPluginId,
            varietyDisplayName: p.varietyDisplayName,
            quantityPlanted: quantityForCommit,
            quantityUnit: unit,
            stockItemId: p.stockItemId,
            plantingDate: p.plantingDateMs,
            sourceProvenance: planProvenance
          })
        });
        if (!res.ok) {
          this.#w.commitProgress.failed.push(
            `${p.varietyDisplayName} → ${this.#w.blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
          );
        }
      } catch {
        this.#w.commitProgress.failed.push(
          `${p.varietyDisplayName} → ${this.#w.blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
        );
      }
      this.#w.commitProgress = { ...this.#w.commitProgress, done: this.#w.commitProgress.done + 1 };
    }
    if (this.#w.commitProgress.failed.length === 0) {
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

  /** Apportion the user's original seed quantity (selectedSeeds) across the
   *  AI's per-block plant assignments. Stock decrement runs against this
   *  number, so the seed quantity actually planted is what gets debited —
   *  not the post-germination plant count. Integer-required units (`seeds`,
   *  `count`, `packets`) use largest-remainder rounding so the per-assignment
   *  values sum back to the user's original quantity. */
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
      const totalPlants = items.reduce((s, x) => s + x.plants, 0);
      if (totalPlants <= 0) continue;
      const unit = entry.defaultUnit;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const raw = items.map((a) => ({
        a,
        raw: (a.plants / totalPlants) * selectedQty
      }));
      if (!isInteger) {
        for (const { a, raw: r } of raw) {
          out.set(`${stockItemId}:${a.blockId}`, Number(r.toFixed(3)));
        }
        continue;
      }
      const target = Math.round(selectedQty);
      const rounded = raw.map((x) => ({
        a: x.a,
        floor: Math.floor(x.raw),
        frac: x.raw - Math.floor(x.raw)
      }));
      const used = rounded.reduce((s, x) => s + x.floor, 0);
      let remainder = target - used;
      const order = [...rounded].sort((x, y) => y.frac - x.frac);
      for (const x of order) {
        if (remainder <= 0) break;
        x.floor += 1;
        remainder -= 1;
      }
      for (const x of rounded) {
        out.set(`${stockItemId}:${x.a.blockId}`, x.floor);
      }
    }
    return out;
  }
}
