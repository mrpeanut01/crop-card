# Re-verify — Harvest + Stock end-to-end flows (epic #196) — 2026-09-25

**Source audit:** `harvest-stock-flows-phase-25-verification-2026-05-25.md`
**Setup:** production build on port 5318, seeded DB, owner session. Three extra plantings were
inserted on Block-A: Astro arugula (cut-and-come-again, planted 30 d ago), Rocket arugula
(planted 2 d ago, pre-window) and Yukon Gold potato (planted 100 d ago, past window). Harvests
were recorded through `POST /api/harvest/record` (200).

| Finding | Issue | Status | Evidence |
|---|---|---|---|
| CT-HS-001 multi-pick "Record harvest" lost after first harvest | #197 (closed) | **Fixed, with a residual gap fixed in this pass** (`0940320`) | After a harvest, Astro arugula shows "Record another pick" plus the repeat-harvest banner. Residual: the gate read legacy `harvestStyle`, so it ignored `archetype_override`. It also missed the 6 potato plugins (`archetype: continuous-harvest-fruit`, `harvestStyle: single-event`), which render the continuous-harvest renderer but closed after one dig. Fix: `reHarvestArchetype()` resolves override > archetype > harvestStyle > family, as HarvestRouter does (6 tests). After: Yukon Gold shows "Record another pick". UC-06 updated. |
| CT-HS-002 pre-/past-window harvest has no UI path | #198 (closed) | **Fixed** | Rocket (pre-window): "Record harvest" + "Plugin DTM suggests this isn't ready yet (28d to window). Record anyway?". Yukon Gold (past): "Window closed 10d ago — logging late?". |
| CT-HS-003 catalog "Pick this" fails on missing `defaultUnit` | #199 (closed) | **Fixed** | The canonical `A_InventoryEditForm` always sends `defaultUnit`. `71cc00c` stops sending null `pluginId`/`reorderThreshold`. `92f4368` (#255) backfilled input-plugin metadata and added a CI coverage gate. |
| CT-HS-004 receipt writes `delta_hundredths = 0` | #200 (closed) | **Fixed** | `POST /api/stock/<id>/lots {receivedQuantity: 2.5}` → the movements row has `delta: 2.5, reason: receipt`. |
| CT-HS-006 stale validation error across add-method tabs | #201 (**open**; fix on branch in `71cc00c`) | **Fixed** | Each capture panel is keyed on the active method, so its error state is discarded on switch. Component test in `A_InventoryAddFlow.svelte.test.ts` ("stale errors do not cross methods"). The issue can be closed once `71cc00c` merges. |
| CT-HS-005 `/stock/[id]` wrong `<title>` | #150 (closed) | **Fixed / obsolete** | `/stock/*` redirects to `/inventory`. `/inventory/pesticide/<id>` has title "Wave E Test Gly — CropCard". |
| Flow 6 inspector blocked (no seeded assignment) | seed | **Fixed** | `inspector@cropcard.local` has an `inspector` assignment and lands on `/today`. |
| Flows 12/16 spray → stock loop blocked by sprayer seed owner mismatch | seed | **Fixed** | The seed now writes every fixture (sprayers included) under the seeded Owner's UUID. `/spray` lists both seeded sprayers. `decrementForUse` is covered by `stock.receipt.test.ts` and the insecticide/fungicide `gpaAndCrossContam` tests. |
| Flow 11 label-scan AI path "not fully exercised" | #249 | **Fixed** | Batch label upload shipped in `71cc00c` (queue stops with the real reason on no-key / over-cap). |

**Verdict:** ready to close once `71cc00c` (#201) merges.
